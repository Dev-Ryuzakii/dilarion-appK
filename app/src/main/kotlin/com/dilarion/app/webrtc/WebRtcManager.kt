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
    private var localAudioSource: AudioSource? = null
    private var localVideoTrackInternal: VideoTrack? = null
    private var localVideoSource: VideoSource? = null
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
    // ICE candidates that arrived before the peer existed or before its remote
    // description was set. WebRTC rejects candidates added too early and the map
    // lookup silently drops them when the peer is missing — either way the
    // candidate set ends up incomplete, which is how a mesh call ends up with
    // audio flowing one way and then not at all.
    private val pendingConferenceCandidates = mutableMapOf<String, MutableList<IceCandidate>>()
    private val conferenceRemoteDescSet = mutableSetOf<String>()
    private val _conferenceRemoteVideos = MutableStateFlow<Map<String, VideoTrack?>>(emptyMap())
    val conferenceRemoteVideos: StateFlow<Map<String, VideoTrack?>> = _conferenceRemoteVideos

    // Server-issued, time-limited TURN credentials (see GET /webrtc/ice-servers).
    // Null until a fetch succeeds; the built-in list below is the fallback so a
    // backend outage never blocks calling.
    @Volatile private var dynamicIceServers: List<PeerConnection.IceServer>? = null

    /** Replace the ICE server list for subsequent peer connections. */
    fun setIceServers(servers: List<Triple<List<String>, String?, String?>>) {
        val mapped = servers.mapNotNull { (urls, user, cred) ->
            if (urls.isEmpty()) return@mapNotNull null
            PeerConnection.IceServer.builder(urls)
                .apply {
                    if (!user.isNullOrBlank()) setUsername(user)
                    if (!cred.isNullOrBlank()) setPassword(cred)
                }
                .createIceServer()
        }
        // Append, never replace. A backend that only knows about our own TURN
        // would otherwise strip the public relays compiled in below, leaving a
        // call between two mobile networks with no relay at all — media dies
        // while signalling still looks healthy.
        dynamicIceServers = if (mapped.isEmpty()) null else mapped + iceServers
        Log.i(TAG, "ICE servers from backend: ${mapped.size}, plus ${iceServers.size} built-in")
    }

    private fun activeIceServers(): List<PeerConnection.IceServer> =
        dynamicIceServers ?: iceServers

    private val iceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun2.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun3.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun4.l.google.com:19302").createIceServer(),
        // Own VPS TURN — by hostname (DNS: turndilarion.eibstratoc.com → 41.242.60.238, grey cloud)
        PeerConnection.IceServer.builder("turn:turndilarion.eibstratoc.com:3478")
            .setUsername("dilarion").setPassword("dilarion2026").createIceServer(),
        PeerConnection.IceServer.builder("turn:turndilarion.eibstratoc.com:3478?transport=tcp")
            .setUsername("dilarion").setPassword("dilarion2026").createIceServer(),
        // Own VPS TURN — raw IP fallback (works before DNS is set)
        PeerConnection.IceServer.builder("turn:41.242.60.238:3478")
            .setUsername("dilarion").setPassword("dilarion2026").createIceServer(),
        PeerConnection.IceServer.builder("turn:41.242.60.238:3478?transport=tcp")
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
        // A previous call's tracks would otherwise keep capturing alongside the new ones.
        if (localAudioTrack != null || peerConnection != null) closeCall()
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
        localAudioSource = audioSource
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
                    localVideoSource = videoSource
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
        val rtcConfig = PeerConnection.RTCConfiguration(activeIceServers()).apply {
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
                    logSelectedCandidatePair()
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

    /**
     * Log which candidate pair actually carries the media: "host" means a direct
     * local path, "srflx" a STUN-discovered public address, "relay" a TURN server.
     * Two peers on different mobile networks almost always need "relay" — if the
     * pair never becomes relay there, the call connects but stays silent.
     */
    private fun logSelectedCandidatePair() {
        peerConnection?.getStats { report ->
            val stats = report.statsMap.values
            val pair = stats.firstOrNull {
                it.type == "candidate-pair" && it.members["state"] == "succeeded" &&
                        (it.members["nominated"] as? Boolean == true)
            } ?: stats.firstOrNull { it.type == "candidate-pair" && it.members["state"] == "succeeded" }
            if (pair == null) {
                Log.w(TAG, "no succeeded candidate pair yet")
                return@getStats
            }
            fun typeOf(id: Any?): String {
                val c = stats.firstOrNull { it.id == id } ?: return "?"
                return c.members["candidateType"]?.toString() ?: "?"
            }
            val local = typeOf(pair.members["localCandidateId"])
            val remote = typeOf(pair.members["remoteCandidateId"])
            Log.i(TAG, "SELECTED PAIR local=$local remote=$remote " +
                    "bytesSent=${pair.members["bytesSent"]} bytesReceived=${pair.members["bytesReceived"]}")
        }
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
        val rtcConfig = PeerConnection.RTCConfiguration(activeIceServers()).apply {
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
                    logSelectedCandidatePair()
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

        // Add local tracks to this conference peer connection. If the mic is not
        // up yet this peer would be receive-only and nobody would hear us — log
        // loudly so that shows up rather than becoming silent one-way audio.
        if (localAudioTrack == null) {
            Log.e(TAG, "conference peer $peerUsername created with NO local audio track")
        }
        localAudioTrack?.let {
            pc.addTrack(it, listOf("ARDAMS"))
            Log.i(TAG, "local audio added to conference peer $peerUsername")
        }
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
                    flushConferenceCandidates(peerUsername)
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
            override fun onSetSuccess() {
                Log.i(TAG, "conference answer set for $peerUsername")
                flushConferenceCandidates(peerUsername)
            }
            override fun onCreateFailure(p: String?) {}
            override fun onSetFailure(e: String?) { Log.e(TAG, "conference answer failed for $peerUsername: $e") }
        }, SessionDescription(SessionDescription.Type.ANSWER, sdpStr))
    }

    fun addConferenceIceCandidate(peerUsername: String, sdpMid: String, sdpMLineIndex: Int, candidateStr: String) {
        val candidate = IceCandidate(sdpMid, sdpMLineIndex, candidateStr)
        val pc = conferencePeers[peerUsername]
        if (pc == null || peerUsername !in conferenceRemoteDescSet) {
            pendingConferenceCandidates.getOrPut(peerUsername) { mutableListOf() }.add(candidate)
            Log.d(TAG, "buffered ICE candidate for $peerUsername (peer not ready)")
            return
        }
        pc.addIceCandidate(candidate)
    }

    /** Apply candidates that arrived before this peer could accept them. */
    private fun flushConferenceCandidates(peerUsername: String) {
        conferenceRemoteDescSet.add(peerUsername)
        val pc = conferencePeers[peerUsername] ?: return
        val queued = pendingConferenceCandidates.remove(peerUsername) ?: return
        queued.forEach { pc.addIceCandidate(it) }
        Log.i(TAG, "flushed ${queued.size} buffered ICE candidates for $peerUsername")
    }

    fun hasConferencePeer(peerUsername: String): Boolean = conferencePeers.containsKey(peerUsername)

    fun removeConferencePeer(peerUsername: String) {
        pendingConferenceCandidates.remove(peerUsername)
        conferenceRemoteDescSet.remove(peerUsername)
        conferencePeers.remove(peerUsername)?.let { pc ->
            runCatching { pc.close() }
            runCatching { pc.dispose() }
        }
        _conferenceRemoteVideos.value = _conferenceRemoteVideos.value - peerUsername
        Log.i(TAG, "conference peer removed: $peerUsername")
    }

    fun closeConference() {
        conferencePeers.keys.toList().forEach { removeConferencePeer(it) }
    }

    @Synchronized
    fun closeCall() {
        closeConference()
        callActive = false
        _activeSession.value = null

        // Close before dispose: dispose() alone can leave the transport running,
        // which is why audio kept flowing after both sides pressed End.
        peerConnection?.let { pc ->
            pc.senders.forEach { s -> runCatching { pc.removeTrack(s) } }
            pc.receivers.forEach { r -> runCatching { r.track()?.setEnabled(false) } }
            runCatching { pc.close() }
            runCatching { pc.dispose() }
        }
        peerConnection = null

        try { videoCapturer?.stopCapture() } catch (_: Exception) {}
        runCatching { videoCapturer?.dispose() }
        videoCapturer = null
        runCatching { surfaceTextureHelper?.dispose() }
        surfaceTextureHelper = null
        localVideoTrackInternal?.setEnabled(false)
        runCatching { localVideoTrackInternal?.dispose() }
        localVideoTrackInternal = null
        runCatching { localVideoSource?.dispose() }
        localVideoSource = null
        localAudioTrack?.setEnabled(false)
        runCatching { localAudioTrack?.dispose() }
        localAudioTrack = null
        runCatching { localAudioSource?.dispose() }
        localAudioSource = null
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
