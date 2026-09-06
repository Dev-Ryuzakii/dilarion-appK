import Foundation

// AI Voice Decoy — an enrolled sample of the user's own voice, cloned
// server-side (XTTS-v2, falls back to a generic voice or a scrambled
// original when unavailable — see backend voice_scrambler.py) to generate a
// decoy voice note in that same voice for every real one sent. The sample
// itself never leaves the server once uploaded; only decoy audio comes back.
struct VoiceIdentityUploadResponse: Decodable {
    let message: String?
    let path: String?
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
}
