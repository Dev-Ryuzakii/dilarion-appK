import Foundation
import Combine
import LiveKit

// ── LiveKit group video (gallery meetings) ──────────────────────────────────
//
// Replaces the old P2P WebRTC mesh conference path (CallViewModel's
// conferenceState/handleConferenceSignal) — group video now runs entirely
// through a LiveKit SFU room, matching desktop (GalleryView.tsx) and Android
// (GalleryViewModel.kt). 1:1 calls are untouched and keep using WebRTCManager.
//
// isHost is inferred the same way both siblings do it: there is no explicit
// "am I the host" field — GET .../waiting-room succeeding (200) means host,
// 403 means guest. This is also what gates the recording button.

struct MeetingTile: Identifiable {
    let identity: String
    var displayName: String
    var isLocal: Bool
    var isSpeaking: Bool = false
    var micOn: Bool = true
    var camOn: Bool = false
    var isScreenShare: Bool = false
    var videoTrack: VideoTrack? = nil
    var id: String { identity + (isScreenShare ? "::screen" : "") }
}

struct FloatingReaction: Identifiable {
    let id = UUID()
    let emoji: String
    let from: String
}

enum MeetingLobbyKind: Equatable {
    case instant(invitees: [String])
    case join(joinCode: String)
}

enum MeetingPhase: Equatable {
    case idle
    case lobby(MeetingLobbyKind)
    case connecting
    case waitingForHost
    case active
    case ended(String?)
}

@MainActor
final class MeetingViewModel: NSObject, ObservableObject {
    static let shared = MeetingViewModel()

    @Published var phase: MeetingPhase = .idle
    @Published var tiles: [MeetingTile] = []
    @Published var isHost = false
    @Published var waitingList: [WaitingParticipant] = []
    @Published var isMicOn = true
    @Published var isCamOn = false
    @Published var isScreenSharing = false
    @Published var isRecording = false
    @Published var recordingBusy = false
    @Published var recordingError: String? = nil
    @Published var floatingReactions: [FloatingReaction] = []
    @Published var unreadChatCount = 0

    static let reactionEmojis = ["👍", "❤️", "😂", "👏", "🎉", "😮"]

    private(set) var conferenceId: Int? = nil
    private var pendingDisplayName: String? = nil
    private var room: Room? = nil
    private var cancellables = Set<AnyCancellable>()
    private var myUsername: String { KeychainHelper.shared.read(key: "username") ?? "" }

    private override init() {
        super.init()
        subscribeToWS()
    }

    // MARK: - Entry points

    func presentLobby(_ kind: MeetingLobbyKind) {
        phase = .lobby(kind)
    }

    /// Standalone instant meeting: create + invite, straight to the gallery —
    /// instant meetings are never waiting-room-gated, only scheduled ones are.
    func startInstantMeeting(invitees: [String], displayName: String? = nil, initialMicOn: Bool = true, initialCamOn: Bool = false) {
        isMicOn = initialMicOn
        isCamOn = initialCamOn
        phase = .connecting
        Task {
            do {
                let confId = try await APIClient.shared.createConference(callId: nil)
                for username in invitees {
                    try? await APIClient.shared.conferenceInvite(conferenceId: confId, username: username)
                }
                await enterGallery(conferenceId: confId, displayName: displayName)
            } catch {
                phase = .ended(error.localizedDescription)
            }
        }
    }

    /// Scheduled meeting via join code — branches on the returned status.
    func joinByCode(_ joinCode: String, displayName: String? = nil, initialMicOn: Bool = true, initialCamOn: Bool = false) {
        isMicOn = initialMicOn
        isCamOn = initialCamOn
        phase = .connecting
        self.pendingDisplayName = displayName
        Task {
            do {
                let resp = try await APIClient.shared.joinMeeting(joinCode: joinCode)
                if resp.status == "waiting" {
                    conferenceId = resp.conference_id
                    phase = .waitingForHost
                } else {
                    await enterGallery(conferenceId: resp.conference_id, displayName: displayName)
                }
            } catch {
                phase = .ended(error.localizedDescription)
            }
        }
    }

    // MARK: - Room connect

    private func enterGallery(conferenceId: Int, displayName: String?) async {
        self.conferenceId = conferenceId
        phase = .connecting

        async let tokenResp = APIClient.shared.getLiveKitToken(conferenceId: conferenceId, displayName: displayName)
        async let iceServers = APIClient.shared.getMeetingIceServers()
        async let waitingRoom: [WaitingParticipant]? = try? await APIClient.shared.getWaitingRoom(conferenceId: conferenceId)

        do {
            let (token, ice, waiting) = try await (tokenResp, iceServers, waitingRoom)
            isHost = waiting != nil
            waitingList = waiting ?? []

            let r = Room(delegate: self)
            room = r

            let connectOptions = ConnectOptions(
                iceServers: ice.map { IceServer(urls: $0.urls, username: $0.username, credential: $0.credential) }
            )
            // Both default to false in the SDK — Android had the identical bug
            // (fixed this session, d953289) — without this, subscribed video
            // quality never downgrades on bad bandwidth and unwatched layers
            // never pause server-side.
            let roomOptions = RoomOptions(adaptiveStream: true, dynacast: true)

            try await r.connect(url: token.url, token: token.token, connectOptions: connectOptions, roomOptions: roomOptions)
            _ = try? await r.localParticipant.setMicrophone(enabled: isMicOn)
            _ = try? await r.localParticipant.setCamera(enabled: isCamOn)

            upsertTile(from: r.localParticipant, isLocal: true)
            for p in r.remoteParticipants.values {
                upsertTile(from: p, isLocal: false)
            }
            phase = .active
        } catch {
            phase = .ended(error.localizedDescription)
        }
    }

    func leave() {
        let confId = conferenceId
        Task {
            if let confId {
                try? await APIClient.shared.conferenceLeave(conferenceId: confId)
            }
            await room?.disconnect()
            room = nil
        }
        phase = .ended(nil)
    }

    func reset() {
        // Covers dismissal paths that skip leave() (e.g. the system swiping the
        // cover away) — never leave camera/mic capturing after the sheet closes.
        if let activeRoom = room {
            Task { await activeRoom.disconnect() }
        }
        let confId = conferenceId
        if let confId, phase == .active || phase == .waitingForHost {
            Task { try? await APIClient.shared.conferenceLeave(conferenceId: confId) }
        }
        room = nil
        conferenceId = nil
        phase = .idle
        tiles = []
        isHost = false
        waitingList = []
        isMicOn = true
        isCamOn = false
        isScreenSharing = false
        isRecording = false
        floatingReactions = []
        unreadChatCount = 0
    }

    // MARK: - Local media controls

    func toggleMic() {
        let next = !isMicOn
        isMicOn = next
        Task { try? await room?.localParticipant.setMicrophone(enabled: next) }
    }

    func toggleCamera() {
        let next = !isCamOn
        isCamOn = next
        Task { try? await room?.localParticipant.setCamera(enabled: next) }
    }

    /// iOS captures in-app content only (LiveKit's InAppScreenCapturer) — full
    /// device/background screen share needs a separate Broadcast Upload
    /// Extension target, out of scope here.
    func toggleScreenShare() {
        Task {
            do {
                try await room?.localParticipant.setScreenShare(enabled: !isScreenSharing)
                isScreenSharing.toggle()
            } catch {
                // User cancelled — leave state as-is, matches desktop's silent catch.
            }
        }
    }

    // MARK: - Waiting room (host)

    func admitGuest(_ guest: WaitingParticipant) {
        guard let confId = conferenceId else { return }
        Task {
            try? await APIClient.shared.admitFromWaitingRoom(conferenceId: confId, userId: guest.user_id)
            waitingList.removeAll { $0.user_id == guest.user_id }
        }
    }

    func denyGuest(_ guest: WaitingParticipant) {
        guard let confId = conferenceId else { return }
        Task {
            try? await APIClient.shared.denyFromWaitingRoom(conferenceId: confId, userId: guest.user_id)
            waitingList.removeAll { $0.user_id == guest.user_id }
        }
    }

    // MARK: - Recording (host-only, gated by isHost the same as the waiting room)

    func toggleRecording() {
        guard let confId = conferenceId else { return }
        recordingBusy = true
        recordingError = nil
        Task {
            do {
                if isRecording {
                    _ = try await APIClient.shared.stopConferenceRecording(conferenceId: confId)
                    isRecording = false
                } else {
                    _ = try await APIClient.shared.startConferenceRecording(conferenceId: confId)
                    isRecording = true
                }
            } catch {
                recordingError = error.localizedDescription
            }
            recordingBusy = false
        }
    }

    // MARK: - Reactions — ephemeral LiveKit data channel, not the message-reaction feature

    func sendReaction(_ emoji: String) {
        guard let room else { return }
        addFloatingReaction(emoji: emoji, from: "You")
        let payload = (try? JSONSerialization.data(withJSONObject: ["type": "reaction", "emoji": emoji])) ?? Data()
        Task { try? await room.localParticipant.publish(data: payload, options: DataPublishOptions(reliable: false)) }
    }

    private func addFloatingReaction(emoji: String, from: String) {
        let reaction = FloatingReaction(emoji: emoji, from: from)
        floatingReactions.append(reaction)
        Task {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            floatingReactions.removeAll { $0.id == reaction.id }
        }
    }

    // MARK: - Tile bookkeeping

    private func upsertTile(from participant: Participant, isLocal: Bool) {
        let identity = participant.identity?.stringValue ?? ""
        guard !identity.isEmpty else { return }
        let name = participant.name?.isEmpty == false ? participant.name! : identity
        let camPub = participant.trackPublications.values.first { $0.source == .camera }
        let micPub = participant.trackPublications.values.first { $0.source == .microphone }

        var tile = tiles.first { $0.identity == identity && !$0.isScreenShare } ?? MeetingTile(identity: identity, displayName: name, isLocal: isLocal)
        tile.displayName = name
        tile.camOn = camPub?.track != nil && !(camPub?.isMuted ?? true)
        tile.micOn = micPub?.track != nil && !(micPub?.isMuted ?? true)
        tile.videoTrack = camPub?.track as? VideoTrack

        if let idx = tiles.firstIndex(where: { $0.identity == identity && !$0.isScreenShare }) {
            tiles[idx] = tile
        } else {
            tiles.append(tile)
        }
    }

    private func removeTile(identity: String) {
        tiles.removeAll { $0.identity == identity }
    }

    private func upsertScreenTile(identity: String, name: String, track: VideoTrack?) {
        var tile = tiles.first { $0.identity == identity && $0.isScreenShare }
            ?? MeetingTile(identity: identity, displayName: name, isLocal: identity == myUsername, isScreenShare: true)
        tile.videoTrack = track
        if let idx = tiles.firstIndex(where: { $0.identity == identity && $0.isScreenShare }) {
            tiles[idx] = tile
        } else {
            tiles.append(tile)
        }
    }

    private func removeScreenTile(identity: String) {
        tiles.removeAll { $0.identity == identity && $0.isScreenShare }
    }

    // MARK: - WS (waiting room / recording / chat nudge — meeting WS types ride the
    // same presence socket as everything else, bucketed under .callSignal)

    private func subscribeToWS() {
        WebSocketManager.shared.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self, case .callSignal(let json) = event else { return }
                let type = json["type"] as? String ?? ""
                let data = json["data"] as? [String: Any] ?? json
                guard let confId = self.conferenceId, (data["conference_id"] as? Int) == confId else { return }

                switch type {
                case "conference_admitted":
                    if self.phase == .waitingForHost {
                        Task { await self.enterGallery(conferenceId: confId, displayName: self.pendingDisplayName) }
                    }
                case "conference_denied":
                    self.phase = .ended("The host denied your request to join")
                case "conference_join_request":
                    guard let userId = data["user_id"] as? Int, let username = data["username"] as? String else { return }
                    if !self.waitingList.contains(where: { $0.user_id == userId }) {
                        self.waitingList.append(WaitingParticipant(user_id: userId, username: username))
                    }
                case "conference_recording_started":
                    self.isRecording = true
                case "conference_recording_stopped":
                    self.isRecording = false
                case "new_conference_message":
                    self.unreadChatCount += 1
                default:
                    break
                }
            }
            .store(in: &cancellables)
    }
}

// MARK: - RoomDelegate

extension MeetingViewModel: RoomDelegate {
    nonisolated func roomDidConnect(_ room: Room) {}

    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor in
            guard room === self.room else { return }
            self.phase = .ended(error?.localizedDescription)
        }
    }

    nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        Task { @MainActor in
            guard room === self.room else { return }
            self.upsertTile(from: participant, isLocal: false)
        }
    }

    nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        Task { @MainActor in
            guard room === self.room, let identity = participant.identity?.stringValue else { return }
            self.removeTile(identity: identity)
        }
    }

    nonisolated func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        Task { @MainActor in
            guard room === self.room else { return }
            let speaking = Set(participants.compactMap { $0.identity?.stringValue })
            for idx in self.tiles.indices {
                self.tiles[idx].isSpeaking = speaking.contains(self.tiles[idx].identity)
            }
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        Task { @MainActor in
            guard room === self.room, let identity = participant.identity?.stringValue else { return }
            let name = participant.name?.isEmpty == false ? participant.name! : identity
            if publication.source == .screenShareVideo {
                self.upsertScreenTile(identity: identity, name: name, track: publication.track as? VideoTrack)
            } else {
                self.upsertTile(from: participant, isLocal: false)
            }
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) {
        Task { @MainActor in
            guard room === self.room, let identity = participant.identity?.stringValue else { return }
            if publication.source == .screenShareVideo {
                self.removeScreenTile(identity: identity)
            } else {
                self.upsertTile(from: participant, isLocal: false)
            }
        }
    }

    nonisolated func room(_ room: Room, participant: LocalParticipant, didPublishTrack publication: LocalTrackPublication) {
        Task { @MainActor in
            guard room === self.room else { return }
            if publication.source == .screenShareVideo {
                self.upsertScreenTile(identity: self.myUsername, name: self.myUsername, track: publication.track as? VideoTrack)
            } else {
                self.upsertTile(from: participant, isLocal: true)
            }
        }
    }

    nonisolated func room(_ room: Room, participant: LocalParticipant, didUnpublishTrack publication: LocalTrackPublication) {
        Task { @MainActor in
            guard room === self.room else { return }
            if publication.source == .screenShareVideo {
                self.removeScreenTile(identity: self.myUsername)
                self.isScreenSharing = false
            } else {
                self.upsertTile(from: participant, isLocal: true)
            }
        }
    }

    nonisolated func room(_ room: Room, participant: RemoteParticipant?, didReceiveData data: Data, forTopic topic: String, encryptionType: EncryptionType) {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              obj["type"] as? String == "reaction",
              let emoji = obj["emoji"] as? String else { return }
        let from = participant?.name ?? participant?.identity?.stringValue ?? "Someone"
        Task { @MainActor in
            guard room === self.room else { return }
            self.addFloatingReaction(emoji: emoji, from: from)
        }
    }
}
