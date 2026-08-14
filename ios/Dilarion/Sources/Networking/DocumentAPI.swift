import Foundation

// ── Document attachments ────────────────────────────────────────────────────
//
// Generic files (PDF/doc/xls/etc, as opposed to photos and voice notes) get a
// decoy document on first open instead of a plain lock gate — mirrors desktop
// (MediaBubble.tsx's DocumentBubble) and Android (ChatScreen.kt's
// DocumentBubble). The decoy is a real, server-generated fake PDF
// (GET /media/decoy-file/{id}, reusable, never deletes) matching one of a
// small set of plausible document "kinds" picked at send time; the real file
// (GET /media/download/{id}) is a one-time read — the server deletes it after.

enum DecoyKind: String, CaseIterable {
    case invoice
    case delivery
    case minutes
    case memo

    var label: String {
        switch self {
        case .invoice: return "Invoice"
        case .delivery: return "Delivery note"
        case .minutes: return "Meeting minutes"
        case .memo: return "Memo"
        }
    }
}

extension APIClient {
    /// `groupId` selects /media/upload_raw_group over /media/upload_raw — same
    /// split as the rest of the media pipeline.
    func uploadDocument(
        recipient: String?,
        groupId: Int?,
        fileData: Data,
        filename: String,
        mimeType: String,
        decoyKind: DecoyKind?
    ) async throws -> MediaUploadResponse {
        var parameters: [String: String] = ["content_type": mimeType]
        if let groupId {
            parameters["group_id"] = String(groupId)
        } else if let recipient {
            parameters["username"] = recipient
        }
        if let decoyKind {
            parameters["decoy_kind"] = decoyKind.rawValue
        }
        let path = groupId != nil ? "/media/upload_raw_group" : "/media/upload_raw"
        return try await postMultipart(path, parameters: parameters, fileData: fileData, fileName: filename, mimeType: mimeType)
    }
}
