import Foundation

// The signed-in account's own voice. The server uses Chatterbox Nano to
// speak decoy notes and text typed in settings. Another account cannot
// download the sample or the generated clips.
struct VoiceIdentityUploadResponse: Decodable {
    let message: String?
    let path: String?
}

struct VoiceSpeechClip: Decodable, Identifiable {
    let id: String
    let text: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, text
        case createdAt = "created_at"
    }
}

private struct VoiceSpeechRequest: Encodable {
    let text: String
}

private struct VoiceSpeechList: Decodable {
    let clips: [VoiceSpeechClip]
}

extension APIClient {
    func uploadVoiceIdentity(data: Data) async throws {
        let _: VoiceIdentityUploadResponse = try await postMultipart(
            "/users/me/voice-identity",
            parameters: [:],
            fileData: data,
            fileName: "voice_identity.m4a",
            mimeType: "audio/m4a"
        )
    }

    /// No dedicated status endpoint — GET the sample by username and treat a
    /// 404 as "not enrolled yet" rather than an error.
    func hasVoiceIdentity(username: String) async -> Bool {
        do {
            _ = try await getData("/users/\(username)/voice-identity")
            return true
        } catch {
            return false
        }
    }

    func deleteVoiceIdentity() async throws {
        try await deleteVoid("/users/me/voice-identity")
    }

    func createVoiceSpeech(text: String) async throws -> VoiceSpeechClip {
        try await post("/users/me/voice-speech", body: VoiceSpeechRequest(text: text))
    }

    func listVoiceSpeech() async throws -> [VoiceSpeechClip] {
        let body: VoiceSpeechList = try await get("/users/me/voice-speech")
        return body.clips
    }

    func downloadVoiceSpeech(id: String) async throws -> Data {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return try await getData("/users/me/voice-speech/\(escaped)")
    }

    func deleteVoiceSpeech(id: String) async throws {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        try await deleteVoid("/users/me/voice-speech/\(escaped)")
    }
}
