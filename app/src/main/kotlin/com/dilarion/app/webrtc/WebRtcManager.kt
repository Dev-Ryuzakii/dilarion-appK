package com.dilarion.app.webrtc

import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.*
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val TAG = "WebRtcManager"

/** Minimal info needed to reattach a UI to an in-progress call. */
data class CallSession(val callId: Int, val partner: String, val isVideo: Boolean)

@Singleton
class WebRtcManager @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private var initialized = false
    private var factory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var localAudioTrack: AudioTrack? = null
    private var localVideoTrackInternal: VideoTrack? = null
    private var videoCapturer: CameraVideoCapturer? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var audioFocusRequest: AudioFocusRequest? = null

    val eglBase: EglBase = EglBase.create()
    val eglBaseContext: EglBase.Context get() = eglBase.eglBaseContext

    private val _localVideo = MutableStateFlow<VideoTrack?>(null)
    val localVideo: StateFlow<VideoTrack?> = _localVideo

    private val _remoteVideo = MutableStateFlow<VideoTrack?>(null)
    val remoteVideo: StateFlow<VideoTrack?> = _remoteVideo

    // Set to true while a call is active; AudioMonitor checks this
    @Volatile var callActive: Boolean = false
    // Track user's speaker preference so ICE reconnect doesn't override it
    @Volatile private var userSpeakerOn: Boolean = true

    // Lightweight snapshot of the live call so a CallViewModel recreated after a
    // minimize (or config change) can reattach instead of starting a new call.
    private val _activeSession = MutableStateFlow<CallSession?>(null)
    val activeSession: StateFlow<CallSession?> = _activeSession
    fun setActiveSession(session: CallSession?) { _activeSession.value = session }
    /** True when a peer connection is live and we have a session to reattach to. */
    fun hasActiveCall(): Boolean = callActive && _activeSession.value != null

    // Conference: map peerUsername → PeerConnection for multi-party calls
    private val conferencePeers = mutableMapOf<String, PeerConnection>()
    private val _conferenceRemoteVideos = MutableStateFlow<Map<String, VideoTrack?>>(emptyMap())
    val conferenceRemoteVideos: StateFlow<Map<String, VideoTrack?>> = _conferenceRemoteVideos

    private val iceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun2.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun3.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun4.l.google.com:19302").createIceServer(),
        // Own VPS TURN — by hostname (DNS: turn.dilarion.eibstratoc.com → 41.242.54.66, grey cloud)
        PeerConnection.IceServer.builder("turn:turn.dilarion.eibstratoc.com:3478")
            .setUsername("dilarion").setPassword("dilarion2026").createIceServer(),
        PeerConnection.IceServer.builder("turn:turn.dilarion.eibstratoc.com:3478?transport=tcp")
            .setUsername("dilarion").setPassword("dilarion2026").createIceServer(),
        // Own VPS TURN — raw IP fallback (works before DNS is set)
        PeerConnection.IceServer.builder("turn:41.242.54.66:3478")
            .setUsername("dilarion").setPassword("dilarion2026").createIceServer(),
        PeerConnection.IceServer.builder("turn:41.242.54.66:3478?transport=tcp")
            .setUsername("dilarion").setPassword("dilarion2026").createIceServer(),
        // Public fallbacks
        PeerConnection.IceServer.builder("turn:a.relay.metered.ca:80")
            .setUsername("openrelayproject").setPassword("openrelayproject").createIceServer(),
        PeerConnection.IceServer.builder("turn:a.relay.metered.ca:443?transport=tcp")
            .setUsername("openrelayproject").setPassword("openrelayproject").createIceServer(),
        PeerConnection.IceServer.builder("turn:openrelay.metered.ca:80")
            .setUsername("openrelayproject").setPassword("openrelayproject").createIceServer(),
        PeerConnection.IceServer.builder("turn:openrelay.metered.ca:443?transport=tcp")
            .setUsername("openrelayproject").setPassword("openrelayproject").createIceServer(),
    )

    fun initialize() {
        if (initialized) return
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(false)
                .createInitializationOptions()
        )
        factory = PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options())
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
        initialized = true
        Log.i(TAG, "initialized")
    }

    fun startLocalStream(withVideo: Boolean) {
        val f = factory ?: return
        callActive = true

        requestAudioFocus()

        applyAudioOutput(true)  // Default speaker ON — user can toggle off

        val audioConstraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googHighpassFilter", "true"))
        }
        val audioSource = f.createAudioSource(audioConstraints)
        localAudioTrack = f.createAudioTrack("ARDAMSa0", audioSource)
        localAudioTrack?.setEnabled(true)
        Log.i(TAG, "audio track created, enabled=true")

        if (withVideo) {
            val hasCameraPermission = ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
            if (hasCameraPermission) {
                val capturer = createCapturer()
                if (capturer != null) {
                    videoCapturer = capturer
                    surfaceTextureHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.eglBaseContext)
                    val videoSource = f.createVideoSource(false)
                    capturer.initialize(surfaceTextureHelper, context, videoSource.capturerObserver)
                    capturer.startCapture(1280, 720, 30)
                    localVideoTrackInternal = f.createVideoTrack("ARDAMSv0", videoSource)
                    localVideoTrackInternal?.setEnabled(true)
                    _localVideo.value = localVideoTrackInternal
                    Log.i(TAG, "video capture started 1280x720@30")
                }
            }
        }
    }

    fun createPeerConnection(onIce: (IceCandidate) -> Unit) {
        val f = factory ?: return
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        }
        peerConnection = f.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(s: PeerConnection.SignalingState?) {
                Log.d(TAG, "signalingState=$s")
            }
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState?) {
                Log.i(TAG, "iceConnectionState=$s")
                if (s == PeerConnection.IceConnectionState.CONNECTED ||
                    s == PeerConnection.IceConnectionState.COMPLETED) {
                    applyAudioOutput(userSpeakerOn)
                    Log.i(TAG, "audio output re-applied on ICE connect, speaker=$userSpeakerOn")
                    // onAddTrack can fire before ICE is up; force-enable all remote receivers
                    peerConnection?.receivers?.forEach { receiver ->
                        (receiver.track() as? AudioTrack)?.let { t ->
                            t.setEnabled(true)
                            Log.i(TAG, "remote audio track force-enabled on ICE connect")
                        }
                        (receiver.track() as? VideoTrack)?.let { t ->
                            t.setEnabled(true)
                            _remoteVideo.value = t
                            Log.i(TAG, "remote video track force-enabled on ICE connect")
                        }
                    }
                }
            }
            override fun onIceConnectionReceivingChange(b: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) {
                Log.d(TAG, "iceGatheringState=$s")
            }
            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate?.let {
                    Log.d(TAG, "local ICE candidate: ${it.sdp}")
                    onIce(it)
                }
            }
            override fun onIceCandidatesRemoved(cs: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(dc: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                val track = receiver?.track() ?: return
                Log.i(TAG, "onAddTrack kind=${track.kind()} id=${track.id()}")
                when (track) {
                    is VideoTrack -> {
                        track.setEnabled(true)
                        _remoteVideo.value = track
                        Log.i(TAG, "remote video track received and enabled")
                    }
                    is AudioTrack -> {
                        track.setEnabled(true)
                        Log.i(TAG, "remote audio track received and enabled")
                    }
                }
            }
        })
        localAudioTrack?.let {
            peerConnection?.addTrack(it, listOf("ARDAMS"))
            Log.i(TAG, "local audio track added to peer connection")
        }
        localVideoTrackInternal?.let {
            peerConnection?.addTrack(it, listOf("ARDAMS"))
            Log.i(TAG, "local video track added to peer connection")
        }
    }

    suspend fun createOffer(): String = suspendCancellableCoroutine { cont ->
        val pc = peerConnection ?: run {
            cont.resumeWithException(Exception("No peer connection"))
            return@suspendCancellableCoroutine
        }
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
        }
        pc.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sdp: SessionDescription?) {
                if (sdp == null) { cont.resumeWithException(Exception("Null SDP")); return }
                Log.i(TAG, "offer created, setting local desc")
                pc.setLocalDescription(object : SdpObserver {
                    override fun onCreateSuccess(p: SessionDescription?) {}
                    override fun onSetSuccess() {
                        Log.i(TAG, "local desc set (offer)")
                        if (cont.isActive) cont.resume(sdp.description)
                    }
                    override fun onCreateFailure(e: String?) {}
                    override fun onSetFailure(e: String?) {
                        Log.e(TAG, "setLocalDesc offer failed: $e")
                        if (cont.isActive) cont.resumeWithException(Exception(e))
                    }
                }, sdp)
            }
            override fun onSetSuccess() {}
            override fun onCreateFailure(e: String?) {
                Log.e(TAG, "createOffer failed: $e")
                if (cont.isActive) cont.resumeWithException(Exception(e))
            }
            override fun onSetFailure(e: String?) {}
        }, constraints)
    }

    suspend fun handleOffer(sdpStr: String): String = suspendCancellableCoroutine { cont ->
        val pc = peerConnection ?: run {
            cont.resumeWithException(Exception("No peer connection"))
            return@suspendCancellableCoroutine
        }
        Log.i(TAG, "setting remote desc (offer)")
        pc.setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(p: SessionDescription?) {}
            override fun onSetSuccess() {
                Log.i(TAG, "remote desc set (offer), creating answer")
                val constraints = MediaConstraints().apply {
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
                }
                pc.createAnswer(object : SdpObserver {
                    override fun onCreateSuccess(answerSdp: SessionDescription?) {
                        if (answerSdp == null) { cont.resumeWithException(Exception("Null answer")); return }
                        pc.setLocalDescription(object : SdpObserver {
                            override fun onCreateSuccess(p: SessionDescription?) {}
                            override fun onSetSuccess() {
                                Log.i(TAG, "local desc set (answer)")
                                if (cont.isActive) cont.resume(answerSdp.description)
                            }
                            override fun onCreateFailure(p: String?) {}
                            override fun onSetFailure(e: String?) {
                                Log.e(TAG, "setLocalDesc answer failed: $e")
                                if (cont.isActive) cont.resumeWithException(Exception(e))
                            }
                        }, answerSdp)
                    }
                    override fun onSetSuccess() {}
                    override fun onCreateFailure(e: String?) {
                        Log.e(TAG, "createAnswer failed: $e")
                        if (cont.isActive) cont.resumeWithException(Exception(e))
                    }
                    override fun onSetFailure(e: String?) {}
                }, constraints)
            }
            override fun onCreateFailure(p: String?) {}
            override fun onSetFailure(e: String?) {
                Log.e(TAG, "setRemoteDesc offer failed: $e")
                if (cont.isActive) cont.resumeWithException(Exception(e))
            }
        }, SessionDescription(SessionDescription.Type.OFFER, sdpStr))
    }

    fun handleAnswer(sdpStr: String) {
        Log.i(TAG, "setting remote desc (answer)")
        peerConnection?.setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(p: SessionDescription?) {}
            override fun onSetSuccess() { Log.i(TAG, "remote desc set (answer) — ICE should start") }
            override fun onCreateFailure(p: String?) {}
            override fun onSetFailure(e: String?) { Log.e(TAG, "setRemoteDesc answer failed: $e") }
        }, SessionDescription(SessionDescription.Type.ANSWER, sdpStr))
    }

    fun getNetworkQuality(onResult: (Int) -> Unit) {
        peerConnection?.getStats { report ->
            var loss = 0.0
            var jitter = 0.0
            report.statsMap.values.forEach { stats ->
                if (stats.type == "inbound-rtp" && stats.members["kind"] == "audio") {
                    val lost = (stats.members["packetsLost"] as? Number)?.toLong() ?: 0L
                    val received = (stats.members["packetsReceived"] as? Number)?.toLong() ?: 1L
                    loss = if (lost + received > 0) lost.toDouble() / (lost + received) else 0.0
                    jitter = (stats.members["jitter"] as? Double) ?: 0.0
                }
            }
            val quality = when {
                loss > 0.15 || jitter > 0.1  -> 0
                loss > 0.08 || jitter > 0.05 -> 1
                loss > 0.04 || jitter > 0.02 -> 2
                loss > 0.01 || jitter > 0.01 -> 3
                else                          -> 4
            }
            onResult(quality)
        } ?: onResult(4)
    }

    fun addIceCandidate(sdpMid: String, sdpMLineIndex: Int, candidateStr: String) {
        Log.d(TAG, "addIceCandidate mid=$sdpMid")
        peerConnection?.addIceCandidate(IceCandidate(sdpMid, sdpMLineIndex, candidateStr))
    }

    fun setMuted(muted: Boolean) {
        localAudioTrack?.setEnabled(!muted)
        Log.i(TAG, "muted=$muted")
    }

    fun setSpeaker(speaker: Boolean) {
        userSpeakerOn = speaker
        applyAudioOutput(speaker)
        Log.i(TAG, "speaker toggled=$speaker")
    }

    fun flipCamera() { videoCapturer?.switchCamera(null) }

    // ── Conference (multi-party) ──────────────────────────────────────────────

    fun createConferencePeer(peerUsername: String, onIce: (IceCandidate) -> Unit): PeerConnection? {
        val f = factory ?: return null
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        }
        val pc = f.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(s: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState?) {
                if (s == PeerConnection.IceConnectionState.CONNECTED ||
                    s == PeerConnection.IceConnectionState.COMPLETED) {
                    applyAudioOutput(userSpeakerOn)
                    conferencePeers[peerUsername]?.receivers?.forEach { receiver ->
                        val audioTrack = receiver.track() as? AudioTrack
                        audioTrack?.setEnabled(true)
                        val videoTrack = receiver.track() as? VideoTrack
                        if (videoTrack != null) {
                            videoTrack.setEnabled(true)
                            _conferenceRemoteVideos.value = _conferenceRemoteVideos.value + (peerUsername to videoTrack)
                        }
                    }
                }
            }
            override fun onIceConnectionReceivingChange(b: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidate(candidate: IceCandidate?) { candidate?.let { onIce(it) } }
            override fun onIceCandidatesRemoved(cs: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(dc: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                val track = receiver?.track() ?: return
                when (track) {
                    is VideoTrack -> {
                        track.setEnabled(true)
                        _conferenceRemoteVideos.value = _conferenceRemoteVideos.value + (peerUsername to track)
                    }
                    is AudioTrack -> track.setEnabled(true)
                }
            }
        }) ?: return null

        // Add local tracks to this conference peer connection
        localAudioTrack?.let { pc.addTrack(it, listOf("ARDAMS")) }
        localVideoTrackInternal?.let { pc.addTrack(it, listOf("ARDAMS")) }
        conferencePeers[peerUsername] = pc
        Log.i(TAG, "conference peer created for $peerUsername")
        return pc
    }

    suspend fun createConferenceOffer(peerUsername: String): String? {
        val pc = conferencePeers[peerUsername] ?: return null
        return suspendCancellableCoroutine { cont ->
            val constraints = MediaConstraints().apply {
                mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
            }
            pc.createOffer(object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription?) {
                    if (sdp == null) { if (cont.isActive) cont.resume(null); return }
                    pc.setLocalDescription(object : SdpObserver {
                        override fun onCreateSuccess(p: SessionDescription?) {}
                        override fun onSetSuccess() { if (cont.isActive) cont.resume(sdp.description) }
                        override fun onCreateFailure(e: String?) {}
                        override fun onSetFailure(e: String?) { if (cont.isActive) cont.resume(null) }
                    }, sdp)
                }
                override fun onSetSuccess() {}
                override fun onCreateFailure(e: String?) { if (cont.isActive) cont.resume(null) }
                override fun onSetFailure(e: String?) {}
            }, constraints)
        }
    }

    suspend fun handleConferenceOffer(peerUsername: String, sdpStr: String): String? {
        val pc = conferencePeers[peerUsername] ?: return null
        return suspendCancellableCoroutine { cont ->
            pc.setRemoteDescription(object : SdpObserver {
                override fun onCreateSuccess(p: SessionDescription?) {}
                override fun onSetSuccess() {
                    val constraints = MediaConstraints().apply {
                        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                        mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
                    }
                    pc.createAnswer(object : SdpObserver {
                        override fun onCreateSuccess(ans: SessionDescription?) {
                            if (ans == null) { if (cont.isActive) cont.resume(null); return }
                            pc.setLocalDescription(object : SdpObserver {
                                override fun onCreateSuccess(p: SessionDescription?) {}
                                override fun onSetSuccess() { if (cont.isActive) cont.resume(ans.description) }
                                override fun onCreateFailure(p: String?) {}
                                override fun onSetFailure(e: String?) { if (cont.isActive) cont.resume(null) }
                            }, ans)
                        }
                        override fun onSetSuccess() {}
                        override fun onCreateFailure(e: String?) { if (cont.isActive) cont.resume(null) }
                        override fun onSetFailure(e: String?) {}
                    }, constraints)
                }
                override fun onCreateFailure(p: String?) {}
                override fun onSetFailure(e: String?) { if (cont.isActive) cont.resume(null) }
            }, SessionDescription(SessionDescription.Type.OFFER, sdpStr))
        }
    }

    fun handleConferenceAnswer(peerUsername: String, sdpStr: String) {
        conferencePeers[peerUsername]?.setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(p: SessionDescription?) {}
            override fun onSetSuccess() { Log.i(TAG, "conference answer set for $peerUsername") }
            override fun onCreateFailure(p: String?) {}
            override fun onSetFailure(e: String?) { Log.e(TAG, "conference answer failed for $peerUsername: $e") }
        }, SessionDescription(SessionDescription.Type.ANSWER, sdpStr))
    }

    fun addConferenceIceCandidate(peerUsername: String, sdpMid: String, sdpMLineIndex: Int, candidateStr: String) {
        conferencePeers[peerUsername]?.addIceCandidate(IceCandidate(sdpMid, sdpMLineIndex, candidateStr))
    }

    fun removeConferencePeer(peerUsername: String) {
        conferencePeers.remove(peerUsername)?.dispose()
        _conferenceRemoteVideos.value = _conferenceRemoteVideos.value - peerUsername
        Log.i(TAG, "conference peer removed: $peerUsername")
    }

    fun closeConference() {
        conferencePeers.keys.toList().forEach { removeConferencePeer(it) }
    }

    fun closeCall() {
        closeConference()
        callActive = false
        _activeSession.value = null
        try { videoCapturer?.stopCapture() } catch (_: Exception) {}
        videoCapturer?.dispose()
        videoCapturer = null
        surfaceTextureHelper?.dispose()
        surfaceTextureHelper = null
        localVideoTrackInternal?.dispose()
        localVideoTrackInternal = null
        localAudioTrack?.dispose()
        localAudioTrack = null
        peerConnection?.dispose()
        peerConnection = null
        _localVideo.value = null
        _remoteVideo.value = null
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = false
        }
        am.mode = AudioManager.MODE_NORMAL
        abandonAudioFocus()
        Log.i(TAG, "call closed")
    }

    private fun applyAudioOutput(speaker: Boolean) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val targetType = if (speaker) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                             else         AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
            val device = am.availableCommunicationDevices.firstOrNull { it.type == targetType }
            if (device != null) {
                am.setCommunicationDevice(device)
                Log.i(TAG, "setCommunicationDevice speaker=$speaker type=$targetType")
            } else {
                Log.w(TAG, "no device for type=$targetType available=${am.availableCommunicationDevices.map { it.type }}")
            }
        } else {
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = speaker
            Log.i(TAG, "isSpeakerphoneOn=$speaker (legacy API)")
        }
    }

    private fun requestAudioFocus() {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener {}
                .build()
            am.requestAudioFocus(req)
            audioFocusRequest = req
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN)
        }
        Log.i(TAG, "audio focus requested")
    }

    private fun abandonAudioFocus() {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus(null)
        }
    }

    private fun createCapturer(): CameraVideoCapturer? {
        val enumerator = Camera2Enumerator(context)
        return enumerator.deviceNames
            .firstOrNull { enumerator.isFrontFacing(it) }
            ?.let { enumerator.createCapturer(it, null) }
            ?: enumerator.deviceNames
                .firstOrNull { enumerator.isBackFacing(it) }
                ?.let { enumerator.createCapturer(it, null) }
    }
}
