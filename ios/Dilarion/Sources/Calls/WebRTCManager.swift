import Foundation
import WebRTC
import AVFoundation

class WebRTCManager: NSObject, ObservableObject {
    static let shared = WebRTCManager()
    
    private var factory: RTCPeerConnectionFactory
    private var peerConnection: RTCPeerConnection?
    private var localAudioTrack: RTCAudioTrack?
    private var videoCapturer: RTCCameraVideoCapturer?
    private var isFrontCamera = true
    private var onIceCandidate: ((RTCIceCandidate) -> Void)?
    
    @Published var localVideoTrack: RTCVideoTrack? = nil
    @Published var remoteVideoTrack: RTCVideoTrack? = nil
    
    private let iceServers = [
        RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]),
        RTCIceServer(urlStrings: ["stun:stun1.l.google.com:19302"]),
        RTCIceServer(urlStrings: ["stun:stun2.l.google.com:19302"]),
        RTCIceServer(urlStrings: ["stun:stun3.l.google.com:19302"]),
        RTCIceServer(urlStrings: ["stun:stun4.l.google.com:19302"]),
        RTCIceServer(urlStrings: ["turn:turn.dilarion.eibstratoc.com:3478"], username: "dilarion", credential: "dilarion2026"),
        RTCIceServer(urlStrings: ["turn:turn.dilarion.eibstratoc.com:3478?transport=tcp"], username: "dilarion", credential: "dilarion2026"),
        RTCIceServer(urlStrings: ["turn:41.242.54.66:3478"], username: "dilarion", credential: "dilarion2026"),
        RTCIceServer(urlStrings: ["turn:41.242.54.66:3478?transport=tcp"], username: "dilarion", credential: "dilarion2026")
    ]
    
    private override init() {
        RTCInitializeSSL()
        let videoEncoderFactory = RTCDefaultVideoEncoderFactory()
        let videoDecoderFactory = RTCDefaultVideoDecoderFactory()
        self.factory = RTCPeerConnectionFactory(encoderFactory: videoEncoderFactory, decoderFactory: videoDecoderFactory)
        super.init()
    }
    
    func initialize() {
        // Factory is initialized in init()
        remoteVideoTrack = nil
        localVideoTrack = nil
    }
    
    func startLocalStream(withVideo: Bool) {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)
        } catch {
            print("Failed to configure AVAudioSession for calling: \(error)")
        }
        
        let audioConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let audioSource = factory.audioSource(with: audioConstraints)
        self.localAudioTrack = factory.audioTrack(with: audioSource, trackId: "audio0")
        
        if withVideo {
            let videoSource = factory.videoSource()
            let videoCapturer = RTCCameraVideoCapturer(delegate: videoSource)
            self.videoCapturer = videoCapturer
            
            guard let device = RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == .front }) ??
                               RTCCameraVideoCapturer.captureDevices().first else { return }
            let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
            guard let format = formats.last else { return }
            
            videoCapturer.startCapture(with: device, format: format, fps: 30) { error in
                if let error = error {
                    print("Failed to start camera capture: \(error)")
                }
            }
            
            let track = factory.videoTrack(with: videoSource, trackId: "video0")
            self.localVideoTrack = track
        }
    }
    
    func createPeerConnection(onIce: @escaping (RTCIceCandidate) -> Void) {
        let configuration = RTCConfiguration()
        configuration.iceServers = iceServers
        configuration.sdpSemantics = .unifiedPlan
        
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "true",
                "OfferToReceiveVideo": "true"
            ],
            optionalConstraints: nil
        )
        
        self.onIceCandidate = onIce
        self.peerConnection = factory.peerConnection(with: configuration, constraints: constraints, delegate: self)
        
        if let audioTrack = localAudioTrack {
            peerConnection?.add(audioTrack, streamIds: ["stream0"])
        }
        if let videoTrack = localVideoTrack {
            peerConnection?.add(videoTrack, streamIds: ["stream0"])
        }
    }
    
    func createOffer() async throws -> String {
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "true",
                "OfferToReceiveVideo": "true"
            ],
            optionalConstraints: nil
        )
        return try await withCheckedThrowingContinuation { continuation in
            self.peerConnection?.offer(for: constraints) { sdp, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let sdp = sdp else {
                    continuation.resume(throwing: NSError(domain: "WebRTC", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create offer"]))
                    return
                }
                self.peerConnection?.setLocalDescription(sdp) { error in
                    if let error = error {
                        continuation.resume(throwing: error)
                        return
                    }
                    continuation.resume(returning: sdp.sdpDescription)
                }
            }
        }
    }
    
    func handleOffer(_ sdpStr: String) async throws -> String {
        let sdp = RTCSessionDescription(type: .offer, sdp: sdpStr)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.peerConnection?.setRemoteDescription(sdp) { error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
        
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "true",
                "OfferToReceiveVideo": "true"
            ],
            optionalConstraints: nil
        )
        let answerSdp = try await withCheckedThrowingContinuation { continuation in
            self.peerConnection?.answer(for: constraints) { sdp, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let sdp = sdp else {
                    continuation.resume(throwing: NSError(domain: "WebRTC", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create answer"]))
                    return
                }
                self.peerConnection?.setLocalDescription(sdp) { error in
                    if let error = error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume(returning: sdp.sdpDescription)
                    }
                }
            }
        }
        return answerSdp
    }
    
    func handleAnswer(_ sdpStr: String) async throws {
        let sdp = RTCSessionDescription(type: .answer, sdp: sdpStr)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.peerConnection?.setRemoteDescription(sdp) { error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
    
    func addIceCandidate(_ sdpMid: String, _ sdpMLineIndex: Int32, _ candidateStr: String) {
        let candidate = RTCIceCandidate(sdp: candidateStr, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        peerConnection?.add(candidate)
    }
    
    func setMuted(_ muted: Bool) {
        localAudioTrack?.isEnabled = !muted
    }
    
    func setSpeaker(_ enabled: Bool) {
        let session = AVAudioSession.sharedInstance()
        try? session.overrideOutputAudioPort(enabled ? .speaker : .none)
    }
    
    func flipCamera() {
        guard let capturer = videoCapturer else { return }
        isFrontCamera.toggle()
        let targetPosition: AVCaptureDevice.Position = isFrontCamera ? .front : .back
        guard let device = RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == targetPosition }) ??
                           RTCCameraVideoCapturer.captureDevices().first else { return }
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        guard let format = formats.last else { return }
        capturer.stopCapture { [weak self] in
            guard let self = self else { return }
            capturer.startCapture(with: device, format: format, fps: 30)
        }
    }
    
    func closeCall() {
        try? videoCapturer?.stopCapture()
        videoCapturer = nil
        localVideoTrack = nil
        remoteVideoTrack = nil
        localAudioTrack = nil
        peerConnection?.close()
        peerConnection = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
    }
    
    func getNetworkQuality(completion: @escaping (Int) -> Void) {
        // Stat reports in iOS SDK are block based
        peerConnection?.statistics { report in
            var loss = 0.0
            var jitter = 0.0
            for stats in report.statistics.values {
                if stats.type == "inbound-rtp", stats.values["mediaType"] as? String == "audio" {
                    let lost = (stats.values["packetsLost"] as? NSNumber)?.int64Value ?? 0
                    let received = (stats.values["packetsReceived"] as? NSNumber)?.int64Value ?? 1
                    loss = lost + received > 0 ? Double(lost) / Double(lost + received) : 0.0
                    jitter = (stats.values["jitter"] as? NSNumber)?.doubleValue ?? 0.0
                }
            }
            let quality: Int
            if loss > 0.15 || jitter > 0.1 { quality = 0 }
            else if loss > 0.08 || jitter > 0.05 { quality = 1 }
            else if loss > 0.04 || jitter > 0.02 { quality = 2 }
            else if loss > 0.01 || jitter > 0.01 { quality = 3 }
            else { quality = 4 }
            completion(quality)
        }
    }
}

// MARK: - RTCPeerConnectionDelegate
extension WebRTCManager: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        DispatchQueue.main.async { [weak self] in
            self?.onIceCandidate?(candidate)
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
    
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd receiver: RTCRtpReceiver, streams: [RTCMediaStream]) {
        guard let track = receiver.track else { return }
        if let videoTrack = track as? RTCVideoTrack {
            DispatchQueue.main.async { [weak self] in
                self?.remoteVideoTrack = videoTrack
            }
        }
    }
}
