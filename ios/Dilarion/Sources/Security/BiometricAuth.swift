import Foundation
import LocalAuthentication

// Thin wrapper around LocalAuthentication. Deliberately never touches the
// master token or content decryption — see AppLockManager / the settings
// rows that call this for what it's actually allowed to gate: opening the
// app, and account-security changes (master token, 2FA, device linking).
// A fresh LAContext per call, since a used context can't be re-evaluated.
enum BiometricAuth {
    static func isAvailable() -> Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    /// Falls back to the device passcode if biometrics aren't enrolled —
    /// still a real local secret, just not a fingerprint/face. Returns false
    /// (never throws) so callers can treat "unavailable" and "failed" the
    /// same way: don't proceed.
    static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            return false
        }
        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
                continuation.resume(returning: success)
            }
        }
    }
}
