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

// ── Per-peer signaling ──────────────────────────────────────────────────────────
//
// One typed request per signal kind rather than a loose [String: Any] "data"
// field — matches how this file already treats /calls/ice_candidate (typed
// WebRTCIceCandidate), not the WebSocket layer's looser JSONSerialization
// handling (which is receive-only).

private struct ConferenceSdpSignalRequest: Encodable {
    let to: String
    let signal_type: String
    let data: SdpPayload
    struct SdpPayload: Encodable { let sdp: String }
}

private struct ConferenceIceSignalRequest: Encodable {
    let to: String
    let signal_type = "ice_candidate"
    let data: WebRTCIceCandidate
}

private struct ConferenceMediaStateSignalRequest: Encodable {
    let to: String
    let signal_type = "media_state"
    let data: MutedPayload
    struct MutedPayload: Encodable { let muted: Bool }
}

extension APIClient {
    func conferenceSignalOffer(conferenceId: Int, to: String, sdp: String) async throws {
        try await postVoid(
            "/calls/conference/\(conferenceId)/signal",
            body: ConferenceSdpSignalRequest(to: to, signal_type: "offer", data: .init(sdp: sdp))
        )
    }

    func conferenceSignalAnswer(conferenceId: Int, to: String, sdp: String) async throws {
        try await postVoid(
            "/calls/conference/\(conferenceId)/signal",
            body: ConferenceSdpSignalRequest(to: to, signal_type: "answer", data: .init(sdp: sdp))
        )
    }

    func conferenceSignalIce(conferenceId: Int, to: String, candidate: WebRTCIceCandidate) async throws {
        try await postVoid(
            "/calls/conference/\(conferenceId)/signal",
            body: ConferenceIceSignalRequest(to: to, data: candidate)
        )
    }

    func conferenceSignalMuted(conferenceId: Int, to: String, muted: Bool) async throws {
        try await postVoid(
            "/calls/conference/\(conferenceId)/signal",
            body: ConferenceMediaStateSignalRequest(to: to, data: .init(muted: muted))
        )
    }
}
