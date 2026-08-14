import Foundation

// ── Whiteboard ───────────────────────────────────────────────────────────
//
// Ephemeral for DM/group targets — strokes relay live via WS (POST ->
// ws_manager push), nothing persisted server-side. The in-meeting
// (conference_id) target is different: the backend keeps the current stroke
// list for the conference's lifetime so it reads like a shared surface (see
// getWhiteboardHistory) rather than each viewer getting their own blank
// canvas. Mirrors desktop (api.ts) and Android (ApiService.kt + ApiModels.kt).

struct WhiteboardStroke: Codable {
    let x0: Double
    let y0: Double
    let x1: Double
    let y1: Double
    let color: String
    let width: Double
}

private struct WhiteboardStrokeRequest: Encodable {
    let username: String?
    let group_id: Int?
    let conference_id: Int?
    let stroke: WhiteboardStroke
}

private struct WhiteboardClearRequest: Encodable {
    let username: String?
    let group_id: Int?
    let conference_id: Int?
}

private struct WhiteboardOpenRequest: Encodable {
    let conference_id: Int
}

private struct WhiteboardHistoryResponse: Decodable {
    let strokes: [WhiteboardStroke]
}

extension APIClient {
    /// Exactly one of username/groupId/conferenceId scopes the target — the third
    /// (in-meeting) case matches desktop/Android's meeting-only whiteboard entry point.
    func sendWhiteboardStroke(username: String?, groupId: Int?, conferenceId: Int? = nil, stroke: WhiteboardStroke) async throws {
        try await postVoid(
            "/whiteboard/stroke",
            body: WhiteboardStrokeRequest(username: username, group_id: groupId, conference_id: conferenceId, stroke: stroke)
        )
    }

    func sendWhiteboardClear(username: String?, groupId: Int?, conferenceId: Int? = nil) async throws {
        try await postVoid(
            "/whiteboard/clear",
            body: WhiteboardClearRequest(username: username, group_id: groupId, conference_id: conferenceId)
        )
    }

    /// Announces the whiteboard to everyone in the meeting the moment one
    /// participant opens it — surfaces it for the room like a screen share
    /// would, instead of everyone needing to separately tap in to discover it.
    func openWhiteboard(conferenceId: Int) async throws {
        try await postVoid("/whiteboard/open", body: WhiteboardOpenRequest(conference_id: conferenceId))
    }

    /// Current shared canvas — lets opening (or reopening) the whiteboard show
    /// what's already there instead of starting blank every time.
    func getWhiteboardHistory(conferenceId: Int) async throws -> [WhiteboardStroke] {
        let resp: WhiteboardHistoryResponse = try await get("/whiteboard/history/\(conferenceId)")
        return resp.strokes
    }
}
