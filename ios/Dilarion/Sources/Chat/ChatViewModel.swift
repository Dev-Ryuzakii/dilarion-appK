import Foundation
import Combine

enum PendingUploadKind {
    case image, document, voice
}

// Shown in the timeline the instant a send starts — WhatsApp-style optimistic
// bubble — and removed once the real MediaItem lands via loadMedia(). Never
// persisted; purely a local placeholder for the in-flight request.
struct PendingUpload: Identifiable {
    let id = UUID()
    let kind: PendingUploadKind
    let previewImage: Data?
    let filename: String
    let timestamp: String = ISO8601DateFormatter().string(from: Date())
}

enum ChatItem: Identifiable {
    case textMessage(Message)
    case mediaMessage(MediaItem)
    case pendingUpload(PendingUpload)

    var id: String {
        switch self {
        case .textMessage(let m): return "msg_\(m.id)"
        case .mediaMessage(let m): return "media_\(m.mediaId)"
        case .pendingUpload(let p): return "pending_\(p.id)"
        }
    }

    var timestamp: String? {
        switch self {
        case .textMessage(let m): return m.timestamp
        case .mediaMessage(let m): return m.timestamp
        case .pendingUpload(let p): return p.timestamp
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
    var pendingUploads: [PendingUpload] = []
    // Session-level: user has proven they know the master token. Gates
    // decryption + whether a bubble tap needs the dialog or can reveal
    // straight away — it does NOT mean every message is shown in plaintext,
    // see `revealedMessageIds` for that.
    var isMasterTokenVerified: Bool = false
    // Per-message, temporary — which messages are currently displayed
    // decrypted. Tapping a locked bubble reveals just that one; it auto-hides
    // again after REVEAL_DURATION, same tap-to-reveal pattern as the meeting
    // chat panel, instead of one global "unlock the whole conversation" flip.
    var revealedMessageIds: Set<Int> = []
    var playingMediaId: String? = nil
    // Documents: which media ids have been verified to view the real file —
    // permanent for the session once granted (the real download is already a
    // one-time server-side read, no need to also re-lock client-side).
    var unlockedMediaIds: Set<String> = []
    // In-memory only, never written to disk as a permanent file — see
    // ChatViewModel.openDocument. Keyed the same as unlockedMediaIds/media ids.
    var documentBytes: [String: Data] = [:]
    var viewingDocumentMediaId: String? = nil
    var documentError: String? = nil
    var mentionQuery: String? = nil
    var taggedUser: String? = nil
    var error: String? = nil
    var currentUsername: String = KeychainHelper.shared.read(key: "username") ?? ""

    // Chat collaboration: reactions, edit, delete, pin, star, reply, forward, mentions
    var replyTarget: Message? = nil
    var editingMessage: Message? = nil
    var forwardTarget: Message? = nil
    var pinnedMessages: [PinnedMessage] = []
    var starredMessageIds: Set<Int> = []
    var showPinnedBanner: Bool { !pinnedMessages.isEmpty }
}

// Available quick-react emoji, matches desktop/Android's reaction picker set.
let quickReactionEmoji = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

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
        Task { await loadPinnedMessages() }
        Task { await loadStarredIds() }
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
            var rawMessages: [Message] = []
            if let gid = groupId {
                // GET /groups/{groupId}/messages — full field parity (reactions,
                // reply/forward/edit/delete/pin, mentions); the legacy
                // /messages/group/{id} endpoint lacks all of that.
                rawMessages = try await APIClient.shared.getGroupMessages(groupId: gid)
            } else {
                // GET /messages/conversation/{partner} — same full field parity;
                // /messages/inbox is the legacy bare-bones list.
                rawMessages = try await APIClient.shared.getConversation(partner: partnerUsername)
            }
            
            var decryptedMessages: [Message] = []
            let privKeyB64 = KeychainHelper.shared.read(key: "private_key")
            let myDeviceUuid = KeychainHelper.shared.read(key: "device_uuid")
            let me = state.currentUsername

            for var msg in rawMessages {
                if msg.isDeleted == true {
                    decryptedMessages.append(msg)
                    continue
                }
                if state.isMasterTokenVerified, let content = msg.content, let encKey = msg.encryptedKey, let iv = msg.iv, let pk = privKeyB64, !pk.isEmpty {
                    do {
                        var actualEncKey = encKey
                        if encKey.hasPrefix("{"), let data = encKey.data(using: .utf8), let map = try? JSONDecoder().decode([String: String].self, from: data) {
                            // Prefer our device_uuid entry; fall back to the legacy
                            // username-keyed entry for older messages.
                            actualEncKey = (myDeviceUuid.flatMap { map[$0] }) ?? map[me] ?? encKey
                        }
                        let plain = try EncryptionManager.shared.decryptMessage(ciphertextB64: content, encryptedKeyB64: actualEncKey, ivB64: iv, privateKeyB64: pk)
                        msg.content = plain
                    } catch {
                        msg.content = "[Decryption Failed]"
                    }
                }
                decryptedMessages.append(msg)
            }
            
            let sorted = decryptedMessages.sorted { ($0.timestamp ?? "") < ($1.timestamp ?? "") }
            await MainActor.run { state.messages = sorted; state.isLoading = false }
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
        let textItems = state.messages
            .filter { !isMediaFilenameMessage($0) }
            .map { ChatItem.textMessage($0) }
        let mediaItems = state.mediaItems.map { ChatItem.mediaMessage($0) }
        let pending = state.pendingUploads.map { ChatItem.pendingUpload($0) }
        return (textItems + mediaItems + pending)
            .sorted { ($0.timestamp ?? "") < ($1.timestamp ?? "") }
    }

    // Media uploads produce a companion text message whose content is just the
    // stored filename (e.g. "40a98e3e-….jpg") — the media bubble already renders
    // the attachment, so hide these.
    private static let mediaFilenameRegex = try! NSRegularExpression(
        pattern: #"^(upload_\d+|voice_[0-9a-fA-F-]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.(jpg|jpeg|png|gif|heic|mp4|mov|m4a|wav|mp3|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip)$"#
    )

    private func isMediaFilenameMessage(_ msg: Message) -> Bool {
        let content = (msg.content ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return false }
        if state.mediaItems.contains(where: { $0.filename == content }) { return true }
        let range = NSRange(content.startIndex..., in: content)
        return Self.mediaFilenameRegex.firstMatch(in: content, options: [], range: range) != nil
    }

    // Cleartext @mention scan — server can't parse @mentions out of ciphertext,
    // so the client says who was mentioned explicitly, for notification
    // targeting only, never message content.
    private func extractMentions(_ text: String) -> [String]? {
        guard groupId != nil else { return nil }
        let knownUsernames = Set(state.groupMembers.map { $0.username })
        guard !knownUsernames.isEmpty else { return nil }
        var found = Set<String>()
        let range = NSRange(text.startIndex..., in: text)
        let regex = try! NSRegularExpression(pattern: #"@(\w+)"#)
        regex.enumerateMatches(in: text, options: [], range: range) { match, _, _ in
            guard let match, let r = Range(match.range(at: 1), in: text) else { return }
            let candidate = String(text[r])
            if knownUsernames.contains(candidate) { found.insert(candidate) }
        }
        return found.isEmpty ? nil : Array(found)
    }

    // MARK: — Send text
    func sendMessage(_ text: String) async {
        let tagged = state.taggedUser
        let me = state.currentUsername
        let replyToId = state.replyTarget?.id
        let forwardedFromId = state.forwardTarget?.id
        let mentions = extractMentions(text)

        await MainActor.run {
            state.isSending = true
            state.taggedUser = nil
            state.mentionQuery = nil
            state.replyTarget = nil
            state.forwardTarget = nil
        }

        // Optimistic message (negative id = pending)
        let optimisticId = -(Int(Date().timeIntervalSince1970 * 1000) % 100000)
        var optimistic = Message(
            id: optimisticId,
            sender: me,
            recipient: groupId == nil ? partnerUsername : (tagged ?? "group"),
            groupId: groupId,
            content: text.trimmingCharacters(in: .whitespaces),
            encryptedContent: nil,
            decoyContent: nil,
            encryptedKey: nil,
            iv: nil,
            contentType: nil,
            mediaType: nil,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            read: false,
            isPrivateTagged: nil
        )
        optimistic.replyToMessageId = replyToId
        optimistic.forwardedFromMessageId = forwardedFromId
        optimistic.mentions = mentions
        await MainActor.run {
            state.messages.append(optimistic)
            state.messages.sort { ($0.timestamp ?? "") < ($1.timestamp ?? "") }
        }

        do {
            let decoys = ["hey are you free tonight", "what are you up to later", "just wanted to check in with you", "hope everything is going well with you", "did you eat anything yet today", "have so much work piled up right now"]
            let decoy = decoys.randomElement()!
            let plaintext = text.trimmingCharacters(in: .whitespaces)

            // Wrap the AES key once per active device (keyed by device_uuid) of every
            // recipient and of ourselves, so all of everyone's devices can read it.
            var recipients = Set<String>()
            if groupId != nil {
                recipients = Set(state.groupMembers.map { $0.username })
                recipients.insert(me)
            } else {
                recipients = [partnerUsername, me]
            }
            var deviceKeys = [String: String]()
            for u in recipients {
                if let resp: UserDevicesResponse = try? await APIClient.shared.get("/users/\(u)/devices") {
                    for d in resp.devices where !d.public_key.isEmpty {
                        deviceKeys[d.device_uuid] = d.public_key
                    }
                }
            }
            guard !deviceKeys.isEmpty else { throw URLError(.badServerResponse) }

            let (ciphertext, encKeysMap, iv) = try EncryptionManager.shared.encryptGroupMessage(plaintext, memberPublicKeys: deviceKeys)
            let encKeysJson = String(data: try JSONEncoder().encode(encKeysMap), encoding: .utf8)

            if let gid = groupId {
                let req = SendGroupMessageRequest(
                    groupId: gid,
                    message: ciphertext,
                    addressedToUsername: tagged,
                    encryptedKey: encKeysJson,
                    iv: iv,
                    decoyContent: decoy,
                    replyToMessageId: replyToId,
                    forwardedFromMessageId: forwardedFromId,
                    mentions: mentions
                )
                try await APIClient.shared.postVoid("/messages/group/send", body: req)
            } else {
                let req = SendDmRequest(
                    username: partnerUsername,
                    message: ciphertext,
                    encryptedKey: encKeysJson,
                    iv: iv,
                    decoyContent: decoy,
                    replyToMessageId: replyToId,
                    forwardedFromMessageId: forwardedFromId,
                    mentions: mentions
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
    // Awaits the re-decrypt so callers that reveal a specific message right
    // after verifying never briefly flash raw ciphertext for it.
    func unlock(token: String) async -> Bool {
        guard let masterToken = KeychainHelper.shared.read(key: "master_token"), !masterToken.isEmpty else {
            // No saved token — save this one and verify
            KeychainHelper.shared.save(key: "master_token", value: token)
            state.isMasterTokenVerified = true
            await loadMessages()
            return true
        }
        if token == masterToken {
            state.isMasterTokenVerified = true
            await loadMessages()
            return true
        }
        return false
    }

    // MARK: — Per-message reveal (tap-to-reveal, auto-hides again)
    private static let revealDurationSeconds: UInt64 = 30

    func revealMessage(_ id: Int) {
        guard id >= 0 else { return }
        state.revealedMessageIds.insert(id)
        Task {
            try? await Task.sleep(nanoseconds: Self.revealDurationSeconds * 1_000_000_000)
            state.revealedMessageIds.remove(id)
        }
    }

    func hideMessage(_ id: Int) {
        state.revealedMessageIds.remove(id)
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

    // MARK: — Reactions
    func toggleReaction(_ message: Message, emoji: String) async {
        guard message.id >= 0 else { return }
        _ = try? await APIClient.shared.toggleReaction(messageId: message.id, emoji: emoji)
        await loadMessages()
    }

    // MARK: — Reply
    func message(withId id: Int) -> Message? {
        state.messages.first { $0.id == id }
    }

    func setReplyTarget(_ message: Message?) {
        state.replyTarget = message
        if message != nil { state.forwardTarget = nil }
    }

    // MARK: — Edit (sender-only)
    func startEdit(_ message: Message) {
        guard message.sender == state.currentUsername, message.id >= 0, message.isDeleted != true else { return }
        state.editingMessage = message
        state.replyTarget = nil
    }

    func cancelEdit() { state.editingMessage = nil }

    func submitEdit(_ newText: String) async {
        guard let editing = state.editingMessage else { return }
        let plaintext = newText.trimmingCharacters(in: .whitespaces)
        guard !plaintext.isEmpty else { return }
        await MainActor.run { state.editingMessage = nil }
        do {
            var recipients = Set<String>()
            if let gid = groupId {
                recipients = Set(state.groupMembers.map { $0.username })
                recipients.insert(state.currentUsername)
                _ = gid
            } else {
                recipients = [partnerUsername, state.currentUsername]
            }
            var deviceKeys = [String: String]()
            for u in recipients {
                if let resp: UserDevicesResponse = try? await APIClient.shared.get("/users/\(u)/devices") {
                    for d in resp.devices where !d.public_key.isEmpty {
                        deviceKeys[d.device_uuid] = d.public_key
                    }
                }
            }
            guard !deviceKeys.isEmpty else { throw URLError(.badServerResponse) }
            let (ciphertext, encKeysMap, iv) = try EncryptionManager.shared.encryptGroupMessage(plaintext, memberPublicKeys: deviceKeys)
            let encKeysJson = String(data: try JSONEncoder().encode(encKeysMap), encoding: .utf8)
            let decoys = ["hey are you free tonight", "what are you up to later", "just wanted to check in with you"]
            try await APIClient.shared.editMessage(
                messageId: editing.id,
                ciphertext: ciphertext,
                encryptedKey: encKeysJson,
                iv: iv,
                decoyContent: decoys.randomElement()
            )
            await loadMessages()
        } catch {
            await MainActor.run { state.error = error.localizedDescription }
        }
    }

    // MARK: — Delete (soft delete, sender-only)
    func deleteMessage(_ message: Message) async {
        guard message.id >= 0 else { return }
        do {
            try await APIClient.shared.deleteMessage(messageId: message.id)
            await loadMessages()
        } catch {
            await MainActor.run { state.error = error.localizedDescription }
        }
    }

    // MARK: — Pin
    func togglePin(_ message: Message) async {
        guard message.id >= 0 else { return }
        do {
            if message.isPinned == true {
                try await APIClient.shared.unpinMessage(messageId: message.id)
            } else {
                try await APIClient.shared.pinMessage(messageId: message.id)
            }
            await loadMessages()
            await loadPinnedMessages()
        } catch {
            await MainActor.run { state.error = error.localizedDescription }
        }
    }

    func loadPinnedMessages() async {
        do {
            let pinned: [PinnedMessage]
            if let gid = groupId {
                pinned = try await APIClient.shared.getPinnedMessages(groupId: gid)
            } else {
                pinned = try await APIClient.shared.getPinnedMessages(username: partnerUsername)
            }
            await MainActor.run { state.pinnedMessages = pinned }
        } catch {
            // Non-fatal — pinned banner just stays empty.
        }
    }

    // MARK: — Star (personal, not shared with the other participant)
    func toggleStar(_ message: Message) async {
        guard message.id >= 0 else { return }
        let isStarred = state.starredMessageIds.contains(message.id)
        do {
            if isStarred {
                try await APIClient.shared.unstarMessage(messageId: message.id)
                state.starredMessageIds.remove(message.id)
            } else {
                try await APIClient.shared.starMessage(messageId: message.id)
                state.starredMessageIds.insert(message.id)
            }
        } catch {
            await MainActor.run { state.error = error.localizedDescription }
        }
    }

    func loadStarredIds() async {
        guard let starred = try? await APIClient.shared.getStarredMessages() else { return }
        let ids = Set(starred.map { $0.id })
        await MainActor.run { state.starredMessageIds = ids }
    }

    // MARK: — Forward
    func setForwardTarget(_ message: Message?) {
        guard message?.isDeleted != true else { return }
        state.forwardTarget = message
        if message != nil { state.replyTarget = nil }
    }

    /// Immediate forward to a different conversation, chosen from the "Forward to…"
    /// picker — re-sends the already-decrypted plaintext via the normal encrypted
    /// send path (content stays E2EE end to end), tagged forwarded_from_message_id
    /// for the UI label only. `groupMemberUsernames` is required when forwarding to
    /// a group, so the AES key can be wrapped for every member's devices.
    func forwardMessage(_ message: Message, toUsername: String? = nil, toGroupId: Int? = nil, groupMemberUsernames: [String] = []) async throws {
        guard let plaintext = message.content, message.isDeleted != true, !plaintext.isEmpty else {
            throw URLError(.cannotDecodeContentData)
        }
        let me = state.currentUsername
        var recipients = Set<String>()
        if toGroupId != nil {
            recipients = Set(groupMemberUsernames)
            recipients.insert(me)
        } else if let user = toUsername {
            recipients = [user, me]
        }
        var deviceKeys = [String: String]()
        for u in recipients {
            if let resp: UserDevicesResponse = try? await APIClient.shared.get("/users/\(u)/devices") {
                for d in resp.devices where !d.public_key.isEmpty {
                    deviceKeys[d.device_uuid] = d.public_key
                }
            }
        }
        guard !deviceKeys.isEmpty else { throw URLError(.badServerResponse) }
        let (ciphertext, encKeysMap, iv) = try EncryptionManager.shared.encryptGroupMessage(plaintext, memberPublicKeys: deviceKeys)
        let encKeysJson = String(data: try JSONEncoder().encode(encKeysMap), encoding: .utf8)
        let decoys = ["hey are you free tonight", "what are you up to later", "just wanted to check in with you"]

        if let gid = toGroupId {
            let req = SendGroupMessageRequest(
                groupId: gid, message: ciphertext, addressedToUsername: nil,
                encryptedKey: encKeysJson, iv: iv, decoyContent: decoys.randomElement(),
                forwardedFromMessageId: message.id
            )
            try await APIClient.shared.postVoid("/messages/group/send", body: req)
        } else if let user = toUsername {
            let req = SendDmRequest(
                username: user, message: ciphertext,
                encryptedKey: encKeysJson, iv: iv, decoyContent: decoys.randomElement(),
                forwardedFromMessageId: message.id
            )
            try await APIClient.shared.postVoid("/messages/send", body: req)
        }
        await MainActor.run { state.forwardTarget = nil }
    }

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
                case .messageUpdated(_, let updatedGroupId):
                    let inThisChat = (self.groupId != nil && updatedGroupId == self.groupId)
                        || (self.groupId == nil && updatedGroupId == nil)
                    if inThisChat {
                        Task { await self.loadMessages(); await self.loadPinnedMessages() }
                    }
                default: break
                }
            }
            .store(in: &cancellables)
    }

    // MARK: — Media Actions
    func sendImage(data: Data) async {
        let placeholder = PendingUpload(kind: .image, previewImage: data, filename: "Photo")
        await MainActor.run {
            state.isUploadingMedia = true
            state.pendingUploads.append(placeholder)
        }
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
        await MainActor.run {
            state.isUploadingMedia = false
            state.pendingUploads.removeAll { $0.id == placeholder.id }
        }
    }

    /// Generic file attachment — gets a decoy document rather than the plain
    /// lock gate images/voice notes use. `decoyKind` is nil for a group-chat
    /// send when the user skips the picker (backend falls back to a default).
    func sendDocument(data: Data, filename: String, mimeType: String, decoyKind: DecoyKind?) async {
        let placeholder = PendingUpload(kind: .document, previewImage: nil, filename: filename)
        await MainActor.run {
            state.isUploadingMedia = true
            state.pendingUploads.append(placeholder)
        }
        do {
            _ = try await APIClient.shared.uploadDocument(
                recipient: groupId == nil ? partnerUsername : nil,
                groupId: groupId,
                fileData: data,
                filename: filename,
                mimeType: mimeType,
                decoyKind: decoyKind
            )
            await loadMedia()
        } catch {
            await MainActor.run { state.error = error.localizedDescription }
        }
        await MainActor.run {
            state.isUploadingMedia = false
            state.pendingUploads.removeAll { $0.id == placeholder.id }
        }
    }

    /// Tapping a document bubble always opens *something* — the decoy while
    /// locked, the real file once unlocked — so it must look identical either
    /// way, matching desktop/Android. Real file bytes are cached in memory
    /// only (`state.documentBytes`), never written to a permanent file;
    /// PDFKit renders straight from Data. Non-PDF real files go through
    /// QuickLook instead, which needs a file URL — DocumentViewerSheet writes
    /// that to NSTemporaryDirectory (OS-purgeable scratch space, not user
    /// storage) right before presenting and deletes it the moment the sheet
    /// closes; nothing here persists across app launches.
    func openDocument(mediaId: String) async {
        let cacheKey = state.unlockedMediaIds.contains(mediaId) ? "real_\(mediaId)" : "decoy_\(mediaId)"
        if state.documentBytes[cacheKey] != nil {
            state.viewingDocumentMediaId = mediaId
            return
        }
        state.documentError = nil
        do {
            let path = state.unlockedMediaIds.contains(mediaId) ? "/media/download/\(mediaId)" : "/media/decoy-file/\(mediaId)"
            let data = try await APIClient.shared.getData(path)
            state.documentBytes[cacheKey] = data
            state.viewingDocumentMediaId = mediaId
        } catch {
            state.documentError = error.localizedDescription
        }
    }

    func closeDocumentViewer() {
        state.viewingDocumentMediaId = nil
    }

    func documentBytes(for mediaId: String) -> Data? {
        let cacheKey = state.unlockedMediaIds.contains(mediaId) ? "real_\(mediaId)" : "decoy_\(mediaId)"
        return state.documentBytes[cacheKey]
    }

    /// Reveals exactly one document — never the whole conversation. Local
    /// compare against the saved master token, same as text messages; the
    /// real download is already a one-time server-side read, so there's
    /// nothing further to gate once this succeeds.
    func unlockMedia(mediaId: String, token: String) -> Bool {
        guard let saved = KeychainHelper.shared.read(key: "master_token"), !saved.isEmpty, token == saved else {
            return false
        }
        state.unlockedMediaIds.insert(mediaId)
        // Drop any cached decoy bytes for this item and open the real file
        // straight away — matches revealing a locked text bubble.
        state.documentBytes.removeValue(forKey: "decoy_\(mediaId)")
        Task { await openDocument(mediaId: mediaId) }
        return true
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
        let placeholder = PendingUpload(kind: .voice, previewImage: nil, filename: "Voice message")
        await MainActor.run {
            state.isUploadingMedia = true
            state.pendingUploads.append(placeholder)
        }
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
        await MainActor.run {
            state.isUploadingMedia = false
            state.pendingUploads.removeAll { $0.id == placeholder.id }
        }
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
