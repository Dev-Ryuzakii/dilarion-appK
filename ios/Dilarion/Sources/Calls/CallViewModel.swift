import Foundation
import Combine
import WebRTC
import AudioToolbox

enum CallState {
    case idle
    case calling
    case ringing
    case connected
    case incoming
    case ended
}

enum CallType {
    case voice
    case video
}

struct CallUiState {
    var state: CallState = .idle
    var peerUsername: String = ""
    var callId: Int? = nil
    var callType: CallType = .voice
    var durationSeconds: Int = 0
    var isMuted: Bool = false
    var isSpeaker: Bool = false
    var networkQuality: Int = 4
    var error: String? = nil
}

struct ConferenceUiState {
    var conferenceId: Int? = nil
    var participants: [String] = []
    var isActive: Bool = false
    var mutedParticipants: Set<String> = []
}

@MainActor
class CallViewModel: ObservableObject {
    static let shared = CallViewModel()
    
    @Published var uiState = CallUiState()
    @Published var localVideoTrack: RTCVideoTrack? = nil
    @Published var remoteVideoTrack: RTCVideoTrack? = nil
    @Published var conferenceState = ConferenceUiState()
    
    private var cancellables = Set<AnyCancellable>()
    private var timerSubscription: AnyCancellable? = nil
    private var pendingCandidates: [RTCIceCandidate] = []
    private var storedOfferSdp: String? = nil
    private var remoteDescSet = false
    private var pendingRemoteCandidates: [(sdpMid: String, sdpMLineIndex: Int32, candidate: String)] = []

    
    init() {
        setupTrackObservers()
        observeIncomingCalls()
    }
    
    private func observeIncomingCalls() {
        WebSocketManager.shared.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                if case .incomingCall(let callData) = event {
                    self?.setIncoming(incoming: callData)
                }
            }
            .store(in: &cancellables)
    }
    
    private func setupTrackObservers() {
        WebRTCManager.shared.$localVideoTrack
            .receive(on: DispatchQueue.main)
            .sink { [weak self] track in
                self?.localVideoTrack = track
            }
            .store(in: &cancellables)
            
        WebRTCManager.shared.$remoteVideoTrack
            .receive(on: DispatchQueue.main)
            .sink { [weak self] track in
                self?.remoteVideoTrack = track
            }
            .store(in: &cancellables)
    }
    
    func startOutgoingCall(peerUsername: String, type: CallType) {
        remoteDescSet = false
        pendingRemoteCandidates.removeAll()
        uiState = CallUiState(state: .calling, peerUsername: peerUsername, callType: type)
        observeWsEvents()
        
        Task {
            do {
                WebRTCManager.shared.initialize()
                WebRTCManager.shared.startLocalStream(withVideo: type == .video)
                WebRTCManager.shared.createPeerConnection { [weak self] candidate in
                    guard let self = self else { return }
                    Task { await self.sendIceCandidate(peerUsername: peerUsername, candidate: candidate) }
                }
                
                let offerSdp = try await WebRTCManager.shared.createOffer()
                let req = CallInitiateRequest(
                    recipientUsername: peerUsername,
                    callType: type == .video ? "video" : "voice",
                    offerSdp: offerSdp
                )
                
                let resp: CallResponse = try await APIClient.shared.post("/calls/initiate", body: req)
                if let cid = resp.callId {
                    await MainActor.run {
                        self.uiState.callId = cid
                        self.flushPendingCandidates(peerUsername: peerUsername, callId: cid)
                    }
                    self.startRingtoneLoop()
                } else {
                    await MainActor.run {
                        self.uiState.error = "Failed to initiate call"
                        self.uiState.state = .ended
                    }
                }
            } catch {
                await MainActor.run {
                    self.uiState.error = error.localizedDescription
                    self.uiState.state = .ended
                }
            }
        }
    }
    
    /// Starts a fresh meeting with no prior 1:1 call — call_id is omitted, which
    /// the backend already treats as "standalone conference". Mirrors the mic-
    /// before-signaling ordering used elsewhere: media must be up before an
    /// invitee accepts, or the peer connection they build has no inbound track
    /// from us.
    func startStandaloneConference(invitees: [String]) {
        guard !invitees.isEmpty else { return }
        uiState = CallUiState(state: .connected, peerUsername: invitees.first ?? "", callType: .voice)
        conferenceState = ConferenceUiState(participants: invitees, isActive: false)
        observeWsEvents()

        Task {
            do {
                WebRTCManager.shared.initialize()
                WebRTCManager.shared.startLocalStream(withVideo: false)

                let confId = try await APIClient.shared.createConference(callId: nil)
                await MainActor.run {
                    self.conferenceState.conferenceId = confId
                    self.conferenceState.isActive = true
                }
                self.startTimer()

                for username in invitees {
                    try? await APIClient.shared.conferenceInvite(conferenceId: confId, username: username)
                }
            } catch {
                await MainActor.run {
                    self.uiState.error = error.localizedDescription
                    self.uiState.state = .ended
                }
            }
        }
    }

    /// Joins a scheduled meeting by code. joinMeeting returns {conferenceId,
    /// participants} in the exact shape createConference+invite does, so this
    /// mirrors startStandaloneConference — the only difference is the
    /// conference already exists (or gets created on our behalf as the first
    /// joiner) instead of being created fresh here.
    func joinScheduledMeeting(joinCode: String) {
        uiState = CallUiState(state: .connected, peerUsername: "", callType: .voice)
        conferenceState = ConferenceUiState(isActive: false)
        observeWsEvents()

        Task {
            do {
                WebRTCManager.shared.initialize()
                WebRTCManager.shared.startLocalStream(withVideo: false)

                let resp = try await APIClient.shared.joinMeeting(joinCode: joinCode)
                await MainActor.run {
                    self.uiState.peerUsername = resp.participants.first ?? ""
                    self.conferenceState = ConferenceUiState(
                        conferenceId: resp.conference_id,
                        participants: resp.participants,
                        isActive: true
                    )
                }
                self.startTimer()
            } catch {
                await MainActor.run {
                    self.uiState.error = error.localizedDescription
                    self.uiState.state = .ended
                }
            }
        }
    }

    private func sendConferenceIceCandidate(confId: Int, to: String, candidate: RTCIceCandidate) async {
        let iceCand = WebRTCIceCandidate(
            sdpMid: candidate.sdpMid ?? "",
            sdpMLineIndex: Int(candidate.sdpMLineIndex),
            candidate: candidate.sdp
        )
        try? await APIClient.shared.conferenceSignalIce(conferenceId: confId, to: to, candidate: iceCand)
    }

    func setIncoming(incoming: IncomingCallData) {
        remoteDescSet = false
        pendingRemoteCandidates.removeAll()
        storedOfferSdp = incoming.offerSdp
        uiState = CallUiState(
            state: .incoming,
            peerUsername: incoming.callerUsername,
            callId: incoming.id,
            callType: incoming.callType == "video" ? .video : .voice
        )
        observeWsEvents()
        startRingtoneLoop()
        
        WebRTCManager.shared.initialize()
        WebRTCManager.shared.startLocalStream(withVideo: incoming.callType == "video")
        WebRTCManager.shared.createPeerConnection { [weak self] candidate in
            guard let self = self else { return }
            Task { await self.sendIceCandidate(peerUsername: incoming.callerUsername, candidate: candidate) }
        }
        
        // Notify caller device is ringing
        Task {
            let req = CallActionRequest(callId: incoming.id, action: "ringing", answerSdp: nil, mastertoken: nil)
            try? await APIClient.shared.postVoid("/calls/action", body: req)
        }
    }
    
    func acceptCall(masterToken: String) {
        stopRingtoneLoop()
        guard let callId = uiState.callId else { return }
        let peerUsername = uiState.peerUsername
        
        Task {
            do {
                let offerSdp = storedOfferSdp
                let answerSdp = offerSdp != nil ? try await WebRTCManager.shared.handleOffer(offerSdp!) : nil
                
                remoteDescSet = true
                for cand in pendingRemoteCandidates {
                    WebRTCManager.shared.addIceCandidate(cand.sdpMid, cand.sdpMLineIndex, cand.candidate)
                }
                pendingRemoteCandidates.removeAll()
                
                let req = CallActionRequest(callId: callId, action: "accept", answerSdp: answerSdp, mastertoken: masterToken)
                try await APIClient.shared.postVoid("/calls/action", body: req)
                
                flushPendingCandidates(peerUsername: peerUsername, callId: callId)
                await MainActor.run {
                    self.uiState.state = .connected
                    self.startTimer()
                }
            } catch {
                await MainActor.run {
                    self.uiState.error = error.localizedDescription
                }
            }
        }
    }
    
    func declineCall() {
        stopRingtoneLoop()
        guard let callId = uiState.callId else {
            uiState.state = .ended
            return
        }
        Task {
            let req = CallActionRequest(callId: callId, action: "decline", answerSdp: nil, mastertoken: nil)
            try? await APIClient.shared.postVoid("/calls/action", body: req)
            await MainActor.run {
                self.uiState.state = .ended
            }
        }
    }
    
    func endCall() {
        stopRingtoneLoop()
        timerSubscription?.cancel()
        let callId = uiState.callId
        Task {
            if let cid = callId {
                let req = CallActionRequest(callId: cid, action: "end", answerSdp: nil, mastertoken: nil)
                try? await APIClient.shared.postVoid("/calls/action", body: req)
            }
            await MainActor.run {
                self.uiState.state = .ended
            }
        }
    }
    
    func toggleMute() {
        let muted = !uiState.isMuted
        uiState.isMuted = muted
        WebRTCManager.shared.setMuted(muted)
    }
    
    func toggleSpeaker() {
        let speaker = !uiState.isSpeaker
        uiState.isSpeaker = speaker
        WebRTCManager.shared.setSpeaker(speaker)
    }
    
    func flipCamera() {
        WebRTCManager.shared.flipCamera()
    }
    
    func clearError() {
        uiState.error = nil
    }
    
    func resetToIdle() {
        stopRingtoneLoop()
        timerSubscription?.cancel()
        cancellables.removeAll()
        setupTrackObservers()
        
        uiState = CallUiState()
        remoteDescSet = false
        pendingRemoteCandidates.removeAll()
        pendingCandidates.removeAll()
        storedOfferSdp = nil
    }
    
    private func observeWsEvents() {
        WebSocketManager.shared.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self = self else { return }
                switch event {
                case .callSignal(let json):
                    let type = json["type"] as? String ?? ""

                    // Conference events key off conference_id, not call_id — must be
                    // handled before the 1:1 callId guard below, which would otherwise
                    // silently drop every one of them (they never carry a call_id).
                    if type == "conference_invite" || type == "conference_peer_connect"
                        || type == "conference_signal" || type == "conference_participant_left" {
                        self.handleConferenceSignal(json, type: type)
                        return
                    }

                    let callId = json["call_id"] as? Int ?? (json["data"] as? [String: Any])?["call_id"] as? Int
                    if callId != self.uiState.callId { return }

                    switch type {
                    case "call_answer":
                        let data = json["data"] as? [String: Any] ?? json
                        if let answerSdp = data["answer_sdp"] as? String {
                            Task {
                                try? await WebRTCManager.shared.handleAnswer(answerSdp)
                                await MainActor.run {
                                    self.stopRingtoneLoop()
                                    self.remoteDescSet = true
                                    for cand in self.pendingRemoteCandidates {
                                        WebRTCManager.shared.addIceCandidate(cand.sdpMid, cand.sdpMLineIndex, cand.candidate)
                                    }
                                    self.pendingRemoteCandidates.removeAll()
                                    self.uiState.state = .connected
                                    self.startTimer()
                                }
                            }
                        }
                    case "call_ice":
                        let data = json["data"] as? [String: Any] ?? json
                        if let candidateObj = data["candidate"] as? [String: Any],
                           let sdpMid = candidateObj["sdpMid"] as? String,
                           let sdpMLineIndex = candidateObj["sdpMLineIndex"] as? Int32,
                           let candidateStr = candidateObj["candidate"] as? String {
                            if !self.remoteDescSet {
                                self.pendingRemoteCandidates.append((sdpMid, sdpMLineIndex, candidateStr))
                            } else {
                                WebRTCManager.shared.addIceCandidate(sdpMid, sdpMLineIndex, candidateStr)
                            }
                        }
                    case "call_ended":
                        self.stopRingtoneLoop()
                        self.timerSubscription?.cancel()
                        self.uiState.state = .ended
                    default:
                        break
                    }
                default:
                    break
                }
            }
            .store(in: &cancellables)
    }

    /// Mirrors desktop CallModal.tsx's conference_peer_connect/conference_signal
    /// handling. Ignores events for a conference that isn't the one we're in —
    /// a stray invite/signal for something else should never touch our state.
    private func handleConferenceSignal(_ json: [String: Any], type: String) {
        switch type {
        case "conference_invite":
            // Only note it — joining happens after the invitee accepts elsewhere
            // (master token gate). Connecting here would open the mic on a call
            // nobody has agreed to yet.
            break

        case "conference_peer_connect":
            guard let data = json["data"] as? [String: Any],
                  let confId = data["conference_id"] as? Int,
                  confId == conferenceState.conferenceId,
                  let peer = data["peer_username"] as? String else { return }
            let role = data["role"] as? String ?? "offer"

            WebRTCManager.shared.createConferencePeer(
                username: peer,
                onIce: { [weak self] peerUser, candidate in
                    guard let self = self else { return }
                    Task { await self.sendConferenceIceCandidate(confId: confId, to: peerUser, candidate: candidate) }
                },
                onRemoteAudioTrack: { _ in }
            )
            if role == "offer" {
                Task {
                    if let offerSdp = try? await WebRTCManager.shared.createConferenceOffer(username: peer) {
                        try? await APIClient.shared.conferenceSignalOffer(conferenceId: confId, to: peer, sdp: offerSdp)
                    }
                }
            }

        case "conference_signal":
            guard let data = json["data"] as? [String: Any],
                  let confId = data["conference_id"] as? Int,
                  confId == conferenceState.conferenceId,
                  let fromUser = data["from"] as? String,
                  let signalType = data["signal_type"] as? String else { return }
            let signalData = data["data"] as? [String: Any] ?? [:]

            // Defensive: create the peer if conference_peer_connect hasn't arrived
            // yet, matching desktop's `confPeersRef.get(from) || createConferencePeer(...)`.
            WebRTCManager.shared.createConferencePeer(
                username: fromUser,
                onIce: { [weak self] peerUser, candidate in
                    guard let self = self else { return }
                    Task { await self.sendConferenceIceCandidate(confId: confId, to: peerUser, candidate: candidate) }
                },
                onRemoteAudioTrack: { _ in }
            )

            switch signalType {
            case "offer":
                guard let sdp = signalData["sdp"] as? String else { return }
                Task {
                    if let answerSdp = try? await WebRTCManager.shared.handleConferenceOffer(username: fromUser, sdp: sdp) {
                        try? await APIClient.shared.conferenceSignalAnswer(conferenceId: confId, to: fromUser, sdp: answerSdp)
                    }
                }
            case "answer":
                guard let sdp = signalData["sdp"] as? String else { return }
                Task { try? await WebRTCManager.shared.handleConferenceAnswer(username: fromUser, sdp: sdp) }
            case "ice_candidate":
                guard let sdpMid = signalData["sdpMid"] as? String,
                      let sdpMLineIndex = signalData["sdpMLineIndex"] as? Int32,
                      let candidateStr = signalData["candidate"] as? String else { return }
                WebRTCManager.shared.addConferenceIceCandidate(
                    username: fromUser, sdpMid: sdpMid, sdpMLineIndex: sdpMLineIndex, candidate: candidateStr
                )
            case "media_state":
                let muted = signalData["muted"] as? Bool ?? false
                if muted { conferenceState.mutedParticipants.insert(fromUser) }
                else { conferenceState.mutedParticipants.remove(fromUser) }
            default:
                break
            }

        case "conference_participant_left":
            guard let data = json["data"] as? [String: Any], let username = data["username"] as? String else { return }
            WebRTCManager.shared.closeConferencePeer(username: username)
            conferenceState.participants.removeAll { $0 == username }

        default:
            break
        }
    }


    private func sendIceCandidate(peerUsername: String, candidate: RTCIceCandidate) async {
        guard let callId = uiState.callId else {
            pendingCandidates.append(candidate)
            return
        }
        let iceCand = WebRTCIceCandidate(
            sdpMid: candidate.sdpMid ?? "",
            sdpMLineIndex: Int(candidate.sdpMLineIndex),
            candidate: candidate.sdp
        )
        let req = IceCandidateRequest(callId: callId, recipientUsername: peerUsername, candidate: iceCand)
        try? await APIClient.shared.postVoid("/calls/ice_candidate", body: req)
    }
    
    private func flushPendingCandidates(peerUsername: String, callId: Int) {
        for candidate in pendingCandidates {
            let iceCand = WebRTCIceCandidate(
                sdpMid: candidate.sdpMid ?? "",
                sdpMLineIndex: Int(candidate.sdpMLineIndex),
                candidate: candidate.sdp
            )
            let req = IceCandidateRequest(callId: callId, recipientUsername: peerUsername, candidate: iceCand)
            Task {
                try? await APIClient.shared.postVoid("/calls/ice_candidate", body: req)
            }
        }
        pendingCandidates.removeAll()
    }
    
    private func startTimer() {
        var tick = 0
        timerSubscription = Timer.publish(every: 1.0, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                guard let self = self else { return }
                self.uiState.durationSeconds += 1
                tick += 1
                if tick % 2 == 0 {
                    WebRTCManager.shared.getNetworkQuality { quality in
                        DispatchQueue.main.async {
                            self.uiState.networkQuality = quality
                        }
                    }
                }
            }
    }
    
    private func startRingtoneLoop() {
        AudioManager.shared.startRingtone()
    }
    
    private func stopRingtoneLoop() {
        AudioManager.shared.stopRingtone()
    }

}
