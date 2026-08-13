import Foundation

// ── Chat collaboration: reactions, edit, delete, pin, star, reply, forward, mentions ──
//
// Mirrors desktop (services/api.ts) and Android for backend aa528fd. Content
// stays E2EE end to end — reply_to_message_id/forwarded_from_message_id are
// label-only metadata, mentions are cleartext usernames for notification
// targeting only, never message content. No server-side full-text search:
// content is E2EE, so search has to run client-side over already-decrypted
// messages.

private struct ReactionRequestBody: Encodable { let emoji: String }
private struct ReactionResponse: Decodable { let status: String }

private struct MessageEditRequestBody: Encodable {
    let message: String
    let encryptedKey: String?
    let iv: String?
    let decoyContent: String?

    enum CodingKeys: String, CodingKey {
        case message
        case encryptedKey = "encrypted_key"
        case iv
        case decoyContent = "decoy_content"
    }
}

extension APIClient {
    /// Toggles a reaction — adds it if the user hasn't reacted with this emoji
    /// yet, removes it if they have. Returns "added" or "removed".
    @discardableResult
    func toggleReaction(messageId: Int, emoji: String) async throws -> String {
        let resp: ReactionResponse = try await post("/messages/\(messageId)/react", body: ReactionRequestBody(emoji: emoji))
        return resp.status
    }

    /// Sender-only. Re-encrypts client-side; this just swaps the stored ciphertext/key/iv/decoy.
    func editMessage(messageId: Int, ciphertext: String, encryptedKey: String?, iv: String?, decoyContent: String?) async throws {
        let body = MessageEditRequestBody(message: ciphertext, encryptedKey: encryptedKey, iv: iv, decoyContent: decoyContent)
        try await putVoid("/messages/\(messageId)", body: body)
    }

    /// Soft delete — sender only. List endpoints substitute a tombstone once is_deleted is set.
    func deleteMessage(messageId: Int) async throws {
        try await deleteVoid("/messages/\(messageId)")
    }

    func pinMessage(messageId: Int) async throws {
        try await postVoid("/messages/\(messageId)/pin", body: EmptyBody())
    }

    func unpinMessage(messageId: Int) async throws {
        try await postVoid("/messages/\(messageId)/unpin", body: EmptyBody())
    }

    /// Exactly one of username/groupId.
    func getPinnedMessages(username: String? = nil, groupId: Int? = nil) async throws -> [PinnedMessage] {
        var path = "/messages/pinned?"
        if let username { path += "username=\(username.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? username)" }
        if let groupId { path += "group_id=\(groupId)" }
        let resp: PinnedMessagesResponse = try await get(path)
        return resp.messages
    }

    func starMessage(messageId: Int) async throws {
        try await postVoid("/messages/\(messageId)/star", body: EmptyBody())
    }

    /// Personal — not visible to the other participant(s).
    func unstarMessage(messageId: Int) async throws {
        try await deleteVoid("/messages/\(messageId)/star")
    }

    func getStarredMessages() async throws -> [StarredMessageItem] {
        let resp: StarredMessagesResponse = try await get("/messages/starred")
        return resp.messages
    }

    /// Full field parity (reactions/reply/forward/edit/delete/pin/mentions) — unlike
    /// /messages/inbox, which is the legacy bare-bones list.
    func getConversation(partner: String) async throws -> [Message] {
        let resp: InboxResponse = try await get("/messages/conversation/\(partner.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? partner)")
        return resp.messages
    }

    /// Full field parity — unlike /messages/group/{id}, which is the legacy bare-bones list.
    func getGroupMessages(groupId: Int) async throws -> [Message] {
        try await get("/groups/\(groupId)/messages")
    }
}
