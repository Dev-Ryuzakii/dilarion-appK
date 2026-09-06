import Foundation
import Combine

// App-entry biometric gate — opt-in (Settings > Biometric Lock), off by
// default. Locks on backgrounding and on first reaching Home each launch;
// unlocking here only reveals the UI shell (chat list, etc), it never
// touches the master token or decrypts anything — that stays behind its own
// tap-to-reveal flow regardless of this being on or off.
final class AppLockManager: ObservableObject {
    static let shared = AppLockManager()
    static let enabledKey = "biometric_lock_enabled"

    @Published var isLocked = false
    private init() {}

    static var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: enabledKey)
    }

    func armIfEnabled() {
        guard Self.isEnabled, BiometricAuth.isAvailable() else { return }
        isLocked = true
    }

    @discardableResult
    func unlock() async -> Bool {
        let ok = await BiometricAuth.authenticate(reason: "Unlock Dilarion")
        if ok {
            await MainActor.run { isLocked = false }
        }
        return ok
    }
}
