import Foundation

// GET /meetings/calendar?start=&end= — Meeting.recurrence (daily/weekly/monthly)
// is never materialized into rows; the backend expands one Meeting into virtual
// occurrences on the fly for whatever range is asked for. No separate
// "recurring instance" concept exists server-side — just synthesized datetimes.
// Mirrors desktop (91bbd18/281355b) and Android (f563b64).
struct MeetingOccurrence: Decodable, Identifiable {
    let meeting_id: Int
    let title: String?
    let occurrence_start: String
    let occurrence_end: String
    let duration_minutes: Int?
    let recurrence: String?
    let status: String
    let join_code: String
    let creator_username: String
    let group_id: Int?
    let waiting_room_enabled: Bool?

    var id: String { "\(meeting_id)_\(occurrence_start)" }

    var startDate: Date? {
        Self.parseISODate(occurrence_start)
    }

    // Python's datetime.isoformat() includes microseconds whenever they're
    // non-zero, which plain ISO8601DateFormatter (no fractional-seconds
    // option) fails to parse — same defensive pattern ChatView's
    // formatTimestamp already uses for message timestamps.
    static func parseISODate(_ iso: String) -> Date? {
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFractional.date(from: iso) { return d }
        return ISO8601DateFormatter().date(from: iso)
    }
}

private struct MeetingCalendarResponse: Decodable {
    let occurrences: [MeetingOccurrence]
    let count: Int?
}

extension APIClient {
    func getMeetingCalendar(start: Date, end: Date) async throws -> [MeetingOccurrence] {
        let iso = ISO8601DateFormatter()
        let startStr = iso.string(from: start).addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let endStr = iso.string(from: end).addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let resp: MeetingCalendarResponse = try await get("/meetings/calendar?start=\(startStr)&end=\(endStr)")
        return resp.occurrences
    }
}
