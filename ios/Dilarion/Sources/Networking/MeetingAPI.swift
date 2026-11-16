import Foundation

// ── Scheduled meetings ──────────────────────────────────────────────────────
//
// A meeting is inert until someone joins — joinMeeting hands back a
// conferenceId + participants shaped exactly like ConferenceAPI's
// createConference+invite, so the client join path is identical either way.
// Mirrors desktop (services/api.ts) and Android (ApiService.kt + ApiModels.kt).

struct MeetingSummary: Decodable, Identifiable {
    let id: Int
    let title: String?
    let scheduled_at: String
    let duration_minutes: Int
    let status: String
    let join_code: String
    let creator_username: String
    let group_id: Int?
}

private struct MeetingsResponse: Decodable {
    let meetings: [MeetingSummary]
}

private struct MeetingCreateRequest: Encodable {
    let title: String?
    let scheduled_at: String
    let duration_minutes: Int
    let group_id: Int?
    let invitee_usernames: [String]?
    let recurrence: String?
}

struct MeetingCreateResponse: Decodable {
    let meeting_id: Int
    let join_code: String
    let scheduled_at: String
}

private struct MeetingJoinRequest: Encodable {
    let join_code: String
}

struct MeetingJoinResponse: Decodable {
    let conference_id: Int
    let status: String
    let participants: [String]
}

extension APIClient {
    func createMeeting(
        title: String?,
        scheduledAt: Date,
        durationMinutes: Int = 60,
        groupId: Int? = nil,
        inviteeUsernames: [String]? = nil,
        recurrence: String? = nil
    ) async throws -> MeetingCreateResponse {
        let formatter = ISO8601DateFormatter()
        return try await post(
            "/meetings/create",
            body: MeetingCreateRequest(
                title: title,
                scheduled_at: formatter.string(from: scheduledAt),
                duration_minutes: durationMinutes,
                group_id: groupId,
                invitee_usernames: inviteeUsernames,
                recurrence: recurrence
            )
        )
    }

    func getUpcomingMeetings() async throws -> [MeetingSummary] {
        let resp: MeetingsResponse = try await get("/meetings/upcoming")
        return resp.meetings
    }

    func joinMeeting(joinCode: String) async throws -> MeetingJoinResponse {
        try await post("/meetings/join_by_code", body: MeetingJoinRequest(join_code: joinCode))
    }

    func cancelMeeting(meetingId: Int) async throws {
        try await postVoid("/meetings/\(meetingId)/cancel", body: EmptyBody())
    }
}

struct ChannelItem: Decodable, Identifiable {
    let id: Int
    let name: String
    let topic: String?
    let description: String?
    let visibility: String
    let posting_policy: String
    let is_archived: Bool
    let member_count: Int
    let my_role: String?
    let unread_count: Int?
}

private struct ChannelCreateBody: Encodable {
    let name: String
    let visibility: String
    let posting_policy: String
}

extension APIClient {
    func listChannels() async throws -> [ChannelItem] {
        try await get("/channels")
    }

    func browseChannels(query: String) async throws -> [ChannelItem] {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return try await get("/channels/browse?q=\(q)")
    }

    func createChannel(name: String) async throws -> ChannelItem {
        try await post("/channels", body: ChannelCreateBody(name: name, visibility: "public", posting_policy: "everyone"))
    }

    func joinChannel(id: Int) async throws -> ChannelItem {
        try await post("/channels/\(id)/join", body: EmptyBody())
    }
}
