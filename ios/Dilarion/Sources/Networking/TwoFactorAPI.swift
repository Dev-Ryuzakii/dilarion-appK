import Foundation

// ── Master-token 2FA ─────────────────────────────────────────────────────
// Mirrors desktop (api.ts: createMasterToken/getMasterToken2FAStatus/
// enableMasterToken2FA/disableMasterToken2FA) and Android (ApiService.kt).

extension APIClient {
    func getMasterToken2FAStatus() async throws -> Bool {
        let resp: TwoFAStatusResponse = try await get("/mastertoken/2fa/status")
        return resp.enabled
    }

    /// Requires the CURRENT active master token — proves real ownership
    /// before a second factor can be attached.
    func enableMasterToken2FA(masterToken: String, twoFaPassword: String) async throws {
        try await postVoid("/mastertoken/2fa/enable", body: Enable2FARequest(mastertoken: masterToken, two_fa_password: twoFaPassword))
    }

    /// Requires the 2FA password itself, not just being logged in.
    func disableMasterToken2FA(twoFaPassword: String) async throws {
        try await postVoid("/mastertoken/2fa/disable", body: Disable2FARequest(two_fa_password: twoFaPassword))
    }
}
