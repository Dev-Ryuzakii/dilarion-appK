package com.dilarion.app.webrtc

import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
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

    val eglBase: EglBase = EglBase.create()
    val eglBaseContext: EglBase.Context get() = eglBase.eglBaseContext

    private val _localVideo = MutableStateFlow<VideoTrack?>(null)
    val localVideo: StateFlow<VideoTrack?> = _localVideo

    private val _remoteVideo = MutableStateFlow<VideoTrack?>(null)
    val remoteVideo: StateFlow<VideoTrack?> = _remoteVideo

    private val iceServers = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),
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
    }

    fun startLocalStream(withVideo: Boolean) {
        val f = factory ?: return
        val audioSource = f.createAudioSource(MediaConstraints())
        localAudioTrack = f.createAudioTrack("ARDAMSa0", audioSource)
        localAudioTrack?.setEnabled(true)

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
                }
            }
        }

        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.mode = AudioManager.MODE_IN_COMMUNICATION
    }

    fun createPeerConnection(onIce: (IceCandidate) -> Unit) {
        val f = factory ?: return
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        peerConnection = f.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
            override fun onSignalingChange(s: PeerConnection.SignalingState?) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState?) {}
            override fun onIceConnectionReceivingChange(b: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState?) {}
            override fun onIceCandidate(candidate: IceCandidate?) { candidate?.let { onIce(it) } }
            override fun onIceCandidatesRemoved(cs: Array<out IceCandidate>?) {}
            override fun onAddStream(stream: MediaStream?) {}
            override fun onRemoveStream(stream: MediaStream?) {}
            override fun onDataChannel(dc: DataChannel?) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                val track = receiver?.track()
                if (track is VideoTrack) {
                    track.setEnabled(true)
                    _remoteVideo.value = track
                }
            }
        })
        localAudioTrack?.let { peerConnection?.addTrack(it, listOf("ARDAMS")) }
        localVideoTrackInternal?.let { peerConnection?.addTrack(it, listOf("ARDAMS")) }
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
                pc.setLocalDescription(object : SdpObserver {
                    override fun onCreateSuccess(p: SessionDescription?) {}
                    override fun onSetSuccess() { if (cont.isActive) cont.resume(sdp.description) }
                    override fun onCreateFailure(e: String?) {}
                    override fun onSetFailure(e: String?) { if (cont.isActive) cont.resumeWithException(Exception(e)) }
                }, sdp)
            }
            override fun onSetSuccess() {}
            override fun onCreateFailure(e: String?) { if (cont.isActive) cont.resumeWithException(Exception(e)) }
            override fun onSetFailure(e: String?) {}
        }, constraints)
    }

    suspend fun handleOffer(sdpStr: String): String = suspendCancellableCoroutine { cont ->
        val pc = peerConnection ?: run {
            cont.resumeWithException(Exception("No peer connection"))
            return@suspendCancellableCoroutine
        }
        pc.setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(p: SessionDescription?) {}
            override fun onSetSuccess() {
                val constraints = MediaConstraints().apply {
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
                }
                pc.createAnswer(object : SdpObserver {
                    override fun onCreateSuccess(answerSdp: SessionDescription?) {
                        if (answerSdp == null) { cont.resumeWithException(Exception("Null answer")); return }
                        pc.setLocalDescription(object : SdpObserver {
                            override fun onCreateSuccess(p: SessionDescription?) {}
                            override fun onSetSuccess() { if (cont.isActive) cont.resume(answerSdp.description) }
                            override fun onCreateFailure(p: String?) {}
                            override fun onSetFailure(e: String?) { if (cont.isActive) cont.resumeWithException(Exception(e)) }
                        }, answerSdp)
                    }
                    override fun onSetSuccess() {}
                    override fun onCreateFailure(e: String?) { if (cont.isActive) cont.resumeWithException(Exception(e)) }
                    override fun onSetFailure(e: String?) {}
                }, constraints)
            }
            override fun onCreateFailure(p: String?) {}
            override fun onSetFailure(e: String?) { if (cont.isActive) cont.resumeWithException(Exception(e)) }
        }, SessionDescription(SessionDescription.Type.OFFER, sdpStr))
    }

    fun handleAnswer(sdpStr: String) {
        peerConnection?.setRemoteDescription(object : SdpObserver {
            override fun onCreateSuccess(p: SessionDescription?) {}
            override fun onSetSuccess() {}
            override fun onCreateFailure(p: String?) {}
            override fun onSetFailure(p: String?) {}
        }, SessionDescription(SessionDescription.Type.ANSWER, sdpStr))
    }

    fun addIceCandidate(sdpMid: String, sdpMLineIndex: Int, candidateStr: String) {
        peerConnection?.addIceCandidate(IceCandidate(sdpMid, sdpMLineIndex, candidateStr))
    }

    fun setMuted(muted: Boolean) { localAudioTrack?.setEnabled(!muted) }

    fun setSpeaker(speaker: Boolean) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.isSpeakerphoneOn = speaker
    }

    fun flipCamera() { videoCapturer?.switchCamera(null) }

    fun closeCall() {
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
        am.mode = AudioManager.MODE_NORMAL
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
