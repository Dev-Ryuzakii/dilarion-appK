import Foundation

// ── Conference (multi-party calls) ─────────────────────────────────────────────
//
// Mirrors the desktop (services/api.ts) and Android (ApiService.kt) conference
// endpoints. call_id is optional on create — the backend already treats it as
// standalone-conference-if-omitted (payload.get("call_id") returns None either
// way), so no separate "start meeting" endpoint was needed server-side.

private struct CreateConferenceRequest: Encodable {
    let call_id: Int?
}

struct ConferenceCreateResponse: Decodable {
    let conference_id: Int
}

private struct ConferenceInviteRequest: Encodable {
    let username: String
}

private struct ConferenceAcceptRequest: Encodable {
    let mastertoken: String
}

struct ConferenceAcceptResponse: Decodable {
    let participants: [String]
}

extension APIClient {
    /// `callId` upgrades an existing 1:1 call into a conference; omit it to
    /// start a fresh standalone meeting.
    func createConference(callId: Int? = nil) async throws -> Int {
        let resp: ConferenceCreateResponse = try await post(
            "/calls/conference/create",
            body: CreateConferenceRequest(call_id: callId)
        )
        return resp.conference_id
    }

    func conferenceInvite(conferenceId: Int, username: String) async throws {
        try await postVoid(
            "/calls/conference/\(conferenceId)/invite",
            body: ConferenceInviteRequest(username: username)
        )
    }

    /// Join a conference you were rung for. Master token required, like any answer.
    func conferenceAccept(conferenceId: Int, masterToken: String) async throws -> [String] {
        let resp: ConferenceAcceptResponse = try await post(
            "/calls/conference/\(conferenceId)/accept",
            body: ConferenceAcceptRequest(mastertoken: masterToken)
        )
        return resp.participants
    }

    func conferenceDecline(conferenceId: Int) async throws {
        try? await postVoid("/calls/conference/\(conferenceId)/decline", body: EmptyBody())
    }

    func conferenceLeave(conferenceId: Int) async throws {
        try? await postVoid("/calls/conference/\(conferenceId)/leave", body: EmptyBody())
    }
}
