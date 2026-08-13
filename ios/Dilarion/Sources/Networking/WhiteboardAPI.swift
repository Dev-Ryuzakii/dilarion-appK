import Foundation

// ── Whiteboard ───────────────────────────────────────────────────────────
//
// Ephemeral for v1 — strokes relay live via WS (POST -> ws_manager push),
// nothing persisted server-side. Mirrors desktop (api.ts) and Android
// (ApiService.kt + ApiModels.kt).

struct WhiteboardStroke: Encodable {
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
}
