import Foundation
import Combine

enum ChatItem: Identifiable {
    case textMessage(Message)
    case mediaMessage(MediaItem)

    var id: String {
        switch self {
        case .textMessage(let m): return "msg_\(m.id)"
        case .mediaMessage(let m): return "media_\(m.mediaId)"
        }
    }

    var timestamp: String? {
        switch self {
        case .textMessage(let m): return m.timestamp
        case .mediaMessage(let m): return m.timestamp
        }
    }
}

struct ChatUiState {
    var messages: [Message] = []
    var mediaItems: [MediaItem] = []
    var groupMembers: [GroupMember] = []
    var localFilePaths: [String: String] = [:]
    var isLoading: Bool = false
    var isSending: Bool = false
    var isRecording: Bool = false
    var recordingSeconds: Int = 0
    var isUploadingMedia: Bool = false
    var isUnlocked: Bool = false
    var playingMediaId: String? = nil
    var mentionQuery: String? = nil
    var taggedUser: String? = nil
    var error: String? = nil
    var currentUsername: String = KeychainHelper.shared.read(key: "username") ?? ""
}

@MainActor
class ChatViewModel: ObservableObject {
    @Published var state = ChatUiState()

    private(set) var partnerUsername: String = ""
    private(set) var groupId: Int? = nil
    private var cancellables = Set<AnyCancellable>()
    private var typingTask: Task<Void, Never>? = nil
    private var recordingURL: URL?
    @Published var partnerTyping = false

    init() {
        setupAudioObservers()
    }

    func initialize(username: String, groupId: Int?) {
        self.partnerUsername = username
        self.groupId = groupId
        subscribeToWS()
        Task { await loadMessages() }
        if let gid = groupId {
            Task { await loadGroupMembers(gid) }
        } else {
            Task { await loadMedia() }
        }
    }

    private func setupAudioObservers() {
        AudioManager.shared.$isRecording
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isRec in
                self?.state.isRecording = isRec
            }
            .store(in: &cancellables)

        AudioManager.shared.$recordingDuration
            .receive(on: DispatchQueue.main)
            .sink { [weak self] dur in
                self?.state.recordingSeconds = Int(dur)
            }
            .store(in: &cancellables)

        AudioManager.shared.$playingMediaId
            .receive(on: DispatchQueue.main)
            .sink { [weak self] playingId in
                self?.state.playingMediaId = playingId
            }
            .store(in: &cancellables)
    }

    func loadMedia() async {
        do {
            // GET /media/inbox → MediaInboxResponse { media_files: [...] }
            let response: MediaInboxResponse = try await APIClient.shared.get("/media/inbox")
            let me = state.currentUsername
            let files = response.mediaFiles ?? []
            var items: [MediaItem] = []
            for item in files {
                if (item.sender == partnerUsername && item.recipient == me) ||
                   (item.sender == me && item.recipient == partnerUsername) {
                    items.append(item)
                }
            }
            let filteredItems = items
            await MainActor.run {
                self.state.mediaItems = filteredItems
            }
        } catch {
            print("Failed to load media inbox: \(error)")
        }
    }

    // MARK: — Load Messages
    func loadMessages() async {
        await MainActor.run { state.isLoading = true }
        do {
            if let gid = groupId {
                // GET /messages/group/{groupId} → GroupMessagesResponse { messages: [...] }
                let resp: GroupMessagesResponse = try await APIClient.shared.get("/messages/group/\(gid)")
                let sorted = resp.messages.sorted { ($0.timestamp ?? "") < ($1.timestamp ?? "") }
                await MainActor.run { state.messages = sorted; state.isLoading = false }
            } else {
                // DM: GET /messages/inbox → filter for this peer (same as Android)
                let resp: InboxResponse = try await APIClient.shared.get("/messages/inbox")
                let me = state.currentUsername
                let filtered = resp.messages.filter { msg in
                    (msg.sender == partnerUsername && msg.recipient == me) ||
                    (msg.sender == me && msg.recipient == partnerUsername)
                }
                let sorted = filtered.sorted { ($0.timestamp ?? "") < ($1.timestamp ?? "") }
                await MainActor.run { state.messages = sorted; state.isLoading = false }
            }
        } catch {
            await MainActor.run { state.isLoading = false }
        }
    }

    private func loadGroupMembers(_ gid: Int) async {
        // GET /groups/{groupId}/members → [GroupMember]
        let members: [GroupMember]? = try? await APIClient.shared.get("/groups/\(gid)/members")
        await MainActor.run { state.groupMembers = members ?? [] }
    }

    // MARK: — Combined items (text + media sorted by timestamp)
    func combinedItems() -> [ChatItem] {
        let textItems = state.messages.map { ChatItem.textMessage($0) }
        let mediaItems = state.mediaItems.map { ChatItem.mediaMessage($0) }
        return (textItems + mediaItems)
            .sorted { ($0.timestamp ?? "") < ($1.timestamp ?? "") }
    }

    // MARK: — Send text
    func sendMessage(_ text: String) async {
        let tagged = state.taggedUser
        let me = state.currentUsername

        await MainActor.run { state.isSending = true; state.taggedUser = nil; state.mentionQuery = nil }

        // Optimistic message (negative id = pending)
        let optimisticId = -(Int(Date().timeIntervalSince1970 * 1000) % 100000)
        let optimistic = Message(
            id: optimisticId,
            sender: me,
            recipient: groupId == nil ? partnerUsername : (tagged ?? "group"),
            groupId: groupId,
            content: text.trimmingCharacters(in: .whitespaces),
            encryptedContent: nil,
            decoyContent: nil,
            contentType: nil,
            mediaType: nil,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            read: false,
            isPrivateTagged: nil
        )
        await MainActor.run {
            state.messages.append(optimistic)
            state.messages.sort { ($0.timestamp ?? "") < ($1.timestamp ?? "") }
        }

        do {
            if let gid = groupId {
                // POST /messages/group/send → { group_id, message, addressed_to_username? }
                let req = SendGroupMessageRequest(
                    groupId: gid,
                    message: text.trimmingCharacters(in: .whitespaces),
                    addressedToUsername: tagged
                )
                try await APIClient.shared.postVoid("/messages/group/send", body: req)
            } else {
                // POST /messages/send → { username, message }
                let req = SendDmRequest(
                    username: partnerUsername,
                    message: text.trimmingCharacters(in: .whitespaces)
                )
                try await APIClient.shared.postVoid("/messages/send", body: req)
            }
            // Reload messages from server (same as Android)
            await loadMessages()
            await MainActor.run { state.isSending = false }
        } catch {
            await MainActor.run {
                self.state.messages.removeAll { $0.id < 0 }
                self.state.isSending = false
                self.state.error = error.localizedDescription
            }
        }
    }

    // MARK: — Unlock
    func unlock(token: String) -> Bool {
        guard let masterToken = KeychainHelper.shared.read(key: "master_token"), !masterToken.isEmpty else {
            // No saved token — save this one and unlock
            KeychainHelper.shared.save(key: "master_token", value: token)
            state.isUnlocked = true
            return true
        }
        if token == masterToken {
            state.isUnlocked = true
            return true
        }
        return false
    }

    func clearError() { state.error = nil }

    // MARK: — Typing
    func sendTyping(isTyping: Bool) {
        typingTask?.cancel()
        typingTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            WebSocketManager.shared.send([
                "type": "typing",
                "recipient_username": partnerUsername,
                "is_typing": isTyping,
            ])
        }
    }

    // MARK: — Mark read (PUT /messages/{id}/read — matches Android)
    func markRead(_ messageId: Int) async {
        try? await APIClient.shared.putVoid("/messages/\(messageId)/read")
        await MainActor.run {
            if let idx = state.messages.firstIndex(where: { $0.id == messageId }) {
                state.messages[idx].read = true
            }
        }
    }

    // MARK: — Mention / tag
    func setMentionQuery(_ q: String?) { state.mentionQuery = q }
    func setTaggedUser(_ u: String?) { state.taggedUser = u }

    // MARK: — WS
    private func subscribeToWS() {
        WebSocketManager.shared.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self else { return }
                switch event {
                case .message(let msg):
                    let inThisChat = (self.groupId != nil && msg.groupId == self.groupId)
                        || (self.groupId == nil && (msg.sender == self.partnerUsername || msg.recipient == self.partnerUsername))
                    if inThisChat { self.state.messages.append(msg) }
                case .typing(let from, let isTyping):
                    if from == self.partnerUsername { self.partnerTyping = isTyping }
                case .newMedia:
                    if self.groupId == nil {
                        Task { await self.loadMedia() }
                    }
                default: break
                }
            }
            .store(in: &cancellables)
    }

    // MARK: — Media Actions
    func sendImage(data: Data) async {
        await MainActor.run { state.isUploadingMedia = true }
        do {
            let parameters = ["username": partnerUsername]
            let filename = "upload_\(Int(Date().timeIntervalSince1970)).jpg"
            let _: MediaUploadResponse = try await APIClient.shared.postMultipart(
                "/media/upload_raw",
                parameters: parameters,
                fileData: data,
                fileName: filename,
                mimeType: "image/jpeg"
            )
            await loadMedia()
        } catch {
            await MainActor.run { state.error = error.localizedDescription }
        }
        await MainActor.run { state.isUploadingMedia = false }
    }

    func startRecording() {
        let tempDir = NSTemporaryDirectory()
        let filename = "voice_\(UUID().uuidString).m4a"
        let fileURL = URL(fileURLWithPath: tempDir).appendingPathComponent(filename)
        recordingURL = fileURL

        AudioManager.shared.requestPermissions { [weak self] granted in
            guard granted else {
                self?.state.error = "Microphone permission denied"
                return
            }
            let success = AudioManager.shared.startRecording(to: fileURL)
            if !success {
                self?.state.error = "Failed to start audio recording"
            }
        }
    }

    func stopAndSendRecording() async {
        guard let url = AudioManager.shared.stopRecording() else { return }
        await MainActor.run { state.isUploadingMedia = true }
        do {
            let data = try Data(contentsOf: url)
            let parameters = [
                "username": partnerUsername,
                "content_type": "media/voice"
            ]
            let filename = url.lastPathComponent
            let _: MediaUploadResponse = try await APIClient.shared.postMultipart(
                "/media/upload_raw",
                parameters: parameters,
                fileData: data,
                fileName: filename,
                mimeType: "audio/m4a"
            )
            try? FileManager.default.removeItem(at: url)
            await loadMedia()
        } catch {
            await MainActor.run { state.error = error.localizedDescription }
        }
        await MainActor.run { state.isUploadingMedia = false }
    }

    func cancelRecording() {
        AudioManager.shared.cancelRecording()
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordingURL = nil
    }

    func playMedia(mediaId: String, useRealAudio: Bool) async {
        let cacheKey = "\(useRealAudio ? "real" : "fake")_\(mediaId)"
        if let localPath = state.localFilePaths[cacheKey] {
            let url = URL(fileURLWithPath: localPath)
            await MainActor.run {
                AudioManager.shared.startPlaying(fileURL: url, mediaId: mediaId) { [weak self] in
                    self?.state.playingMediaId = nil
                }
            }
            return
        }

        await MainActor.run { state.playingMediaId = mediaId }
        do {
            let endpoint = useRealAudio ? "/media/download/\(mediaId)" : "/media/decoy-voice/\(mediaId)"
            let data = try await APIClient.shared.getData(endpoint)

            let tempDir = NSTemporaryDirectory()
            let filename = "\(cacheKey).mp4"
            let fileURL = URL(fileURLWithPath: tempDir).appendingPathComponent(filename)
            try data.write(to: fileURL)

            await MainActor.run {
                state.localFilePaths[cacheKey] = fileURL.path
                AudioManager.shared.startPlaying(fileURL: fileURL, mediaId: mediaId) { [weak self] in
                    self?.state.playingMediaId = nil
                }
            }
        } catch {
            await MainActor.run {
                state.error = error.localizedDescription
                state.playingMediaId = nil
            }
        }
    }

    func stopPlayback() {
        AudioManager.shared.stopPlaying()
        state.playingMediaId = nil
    }

    func downloadImageForDisplay(mediaId: String) async {
        let cacheKey = "img_\(mediaId)"
        if state.localFilePaths[cacheKey] != nil { return }
        do {
            let data = try await APIClient.shared.getData("/media/download/\(mediaId)")
            let tempDir = NSTemporaryDirectory()
            let filename = "\(cacheKey).jpg"
            let fileURL = URL(fileURLWithPath: tempDir).appendingPathComponent(filename)
            try data.write(to: fileURL)

            await MainActor.run {
                state.localFilePaths[cacheKey] = fileURL.path
            }
        } catch {
            print("Failed to download image \(mediaId): \(error)")
        }
    }
}
