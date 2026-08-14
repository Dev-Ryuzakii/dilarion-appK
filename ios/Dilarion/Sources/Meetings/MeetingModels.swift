import Foundation

// ── LiveKit group video (gallery meetings) ──────────────────────────────────
// Mirrors desktop (GalleryView.tsx/api.ts) and Android (GalleryViewModel.kt).

struct LiveKitTokenResponse: Decodable {
    let url: String
    let token: String
    let room: String
}

struct IceServerConfig: Decodable {
    let urls: [String]
    let username: String?
    let credential: String?
}

struct IceServersResponse: Decodable {
    let ice_servers: [IceServerConfig]
    let ttl: Int?
}

struct WaitingParticipant: Decodable, Identifiable {
    let user_id: Int
    let username: String
    var id: Int { user_id }
}

private struct WaitingRoomResponse: Decodable {
    let waiting: [WaitingParticipant]
}

// GET /messages/conference/{id} — same slim ciphertext/key/iv shape as
// pinned/starred, decrypted with the same per-device RSA fanout as DM/group chat.
struct ConferenceChatMessage: Decodable, Identifiable {
    let id: Int
    let sender: String?
    let content: String?
    let content_type: String?
    let timestamp: String?
    let decoy_content: String?
    let encrypted_key: String?
    let iv: String?
}

private struct ConferenceMessagesResponse: Decodable {
    let messages: [ConferenceChatMessage]
    let count: Int?
}

private struct SendConferenceMessageRequest: Encodable {
    let conference_id: Int
    let message: String
    let encrypted_key: String?
    let iv: String?
    let decoy_content: String?
}

private struct RecordingStatusResponse: Decodable {
    let recording_id: Int
    let status: String
}

// Meeting invite/status shown inline in a chat/group thread — content_type is
// "meeting", not "encrypted" (a system notice, same non-E2E precedent as
// group admin announcements), so it renders unlocked and always visible with
// an immediate Join action. Mirrors desktop (MeetingCard.tsx) and Android.
struct MeetingCardPayload: Decodable {
    let kind: String // "instant" | "scheduled"
    let conference_id: Int?
    let meeting_id: Int?
    let join_code: String?
    let title: String?
    let scheduled_at: String?
    let duration_minutes: Int?

    static func parse(_ content: String?) -> MeetingCardPayload? {
        guard let content, let data = content.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(MeetingCardPayload.self, from: data)
    }
}

extension APIClient {
    func getLiveKitToken(conferenceId: Int, displayName: String?) async throws -> LiveKitTokenResponse {
        var path = "/calls/conference/\(conferenceId)/livekit-token"
        if let displayName, !displayName.isEmpty {
            path += "?display_name=\(displayName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? displayName)"
        }
        return try await get(path)
    }

    /// Falls back to built-in ICE servers (nil) if this fails — same fallback
    /// behavior as desktop/Android.
    func getMeetingIceServers() async -> [IceServerConfig] {
        (try? await get("/webrtc/ice-servers") as IceServersResponse)?.ice_servers ?? []
    }

    /// 200 vs 403 IS the host signal — there's no separate is-host field or
    /// endpoint; desktop/Android both infer host status purely from whether
    /// this call succeeds.
    func getWaitingRoom(conferenceId: Int) async throws -> [WaitingParticipant] {
        let resp: WaitingRoomResponse = try await get("/calls/conference/\(conferenceId)/waiting-room")
        return resp.waiting
    }

    func admitFromWaitingRoom(conferenceId: Int, userId: Int) async throws {
        try await postVoid("/calls/conference/\(conferenceId)/waiting-room/\(userId)/admit", body: EmptyBody())
    }

    func denyFromWaitingRoom(conferenceId: Int, userId: Int) async throws {
        try await postVoid("/calls/conference/\(conferenceId)/waiting-room/\(userId)/deny", body: EmptyBody())
    }

    @discardableResult
    func startConferenceRecording(conferenceId: Int) async throws -> String {
        let resp: RecordingStatusResponse = try await post("/calls/conference/\(conferenceId)/recording/start", body: EmptyBody())
        return resp.status
    }

    @discardableResult
    func stopConferenceRecording(conferenceId: Int) async throws -> String {
        let resp: RecordingStatusResponse = try await post("/calls/conference/\(conferenceId)/recording/stop", body: EmptyBody())
        return resp.status
    }

    func getConferenceMessages(conferenceId: Int) async throws -> [ConferenceChatMessage] {
        let resp: ConferenceMessagesResponse = try await get("/messages/conference/\(conferenceId)")
        return resp.messages
    }

    func sendConferenceMessage(conferenceId: Int, ciphertext: String, encryptedKey: String?, iv: String?, decoyContent: String?) async throws {
        try await postVoid(
            "/messages/conference/send",
            body: SendConferenceMessageRequest(conference_id: conferenceId, message: ciphertext, encrypted_key: encryptedKey, iv: iv, decoy_content: decoyContent)
        )
    }
}
