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

class ChatViewModel: ObservableObject {
    @Published var state = ChatUiState()

    private(set) var partnerUsername: String = ""
    private(set) var groupId: Int? = nil
    private var cancellables = Set<AnyCancellable>()
    private var typingTask: Task<Void, Never>? = nil
    private var typingClearTask: Task<Void, Never>? = nil
    @Published var partnerTyping = false

    func initialize(username: String, groupId: Int?) {
        self.partnerUsername = username
        self.groupId = groupId
        subscribeToWS()
        Task { await loadMessages() }
        if let gid = groupId {
            Task { await loadGroupMembers(gid) }
        }
    }

    // MARK: — Load
    func loadMessages() async {
        await MainActor.run { state.isLoading = true }
        do {
            if let gid = groupId {
                let msgs: [Message] = try await APIClient.shared.get("/groups/\(gid)/messages")
                await MainActor.run { state.messages = msgs; state.isLoading = false }
            } else {
                let msgs: [Message] = try await APIClient.shared.get("/messages/conversation/\(partnerUsername)")
                await MainActor.run { state.messages = msgs; state.isLoading = false }
            }
        } catch {
            await MainActor.run { state.isLoading = false }
        }
    }

    private func loadGroupMembers(_ gid: Int) async {
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
        let masterToken = KeychainHelper.shared.read(key: "master_token") ?? ""
        let encrypted = masterToken.isEmpty
            ? text
            : (try? EncryptionManager.shared.encrypt(text, masterToken: masterToken)) ?? text

        await MainActor.run { state.isSending = true }

        // Optimistic message (negative id = pending)
        let optimisticId = -(Int(Date().timeIntervalSince1970 * 1000) % 100000)
        let optimistic = Message(
            id: optimisticId,
            sender: state.currentUsername,
            recipient: groupId == nil ? partnerUsername : nil,
            groupId: groupId,
            content: text,
            encryptedContent: encrypted,
            decoyContent: nil,
            contentType: masterToken.isEmpty ? nil : "encrypted",
            mediaType: nil,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            read: false,
            isPrivateTagged: state.taggedUser != nil ? true : nil
        )
        await MainActor.run { state.messages.append(optimistic) }

        let req: SendMessageRequest
        if let gid = groupId {
            req = SendMessageRequest(
                recipientUsername: nil,
                groupId: gid,
                encryptedContent: encrypted,
                decoyContent: nil,
                isPrivateTagged: nil,
                replyToId: nil,
                taggedUsername: state.taggedUser
            )
        } else {
            req = SendMessageRequest(
                recipientUsername: partnerUsername,
                groupId: nil,
                encryptedContent: encrypted,
                decoyContent: nil,
                isPrivateTagged: state.taggedUser != nil ? true : nil,
                replyToId: nil,
                taggedUsername: state.taggedUser
            )
        }

        do {
            let endpoint = groupId != nil ? "/messages/group/send" : "/messages/send"
            let sent: Message = try await APIClient.shared.post(endpoint, body: req)
            await MainActor.run {
                self.state.messages.removeAll { $0.id == optimisticId }
                self.state.messages.append(sent)
                self.state.isSending = false
                self.state.taggedUser = nil
            }
        } catch {
            await MainActor.run {
                self.state.messages.removeAll { $0.id == optimisticId }
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

    // MARK: — Mark read
    func markRead(_ messageId: Int) async {
        let endpoint = groupId != nil
            ? "/groups/\(groupId!)/messages/\(messageId)/read"
            : "/messages/\(messageId)/read"
        try? await APIClient.shared.postVoid(endpoint, body: EmptyBody())
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
                default: break
                }
            }
            .store(in: &cancellables)
    }
}
