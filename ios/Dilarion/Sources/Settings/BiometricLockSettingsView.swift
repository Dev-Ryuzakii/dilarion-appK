import SwiftUI

// Toggle for AppLockManager (app-entry lock) plus the shared gate other
// settings screens call before sensitive account changes — master token
// create/change, 2FA enable/disable, linking a new device. Off by default;
// when off or the device has no biometrics/passcode enrolled, gateSensitiveAction
// passes straight through rather than blocking access the user never opted into.
struct BiometricLockSettingsRow: View {
    @AppStorage(AppLockManager.enabledKey) private var isEnabled = false
    @State private var unavailable = false

    static func gateSensitiveAction(reason: String = "Confirm it's you") async -> Bool {
        guard AppLockManager.isEnabled, BiometricAuth.isAvailable() else { return true }
        return await BiometricAuth.authenticate(reason: reason)
    }

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: "faceid")
                .font(.system(size: 20))
                .foregroundColor(.dilarionRed)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text("Biometric Lock")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.textPrimary)
                Text(unavailable
                     ? "Not available — set up Face ID/Touch ID or a passcode first"
                     : "Face ID to open Dilarion and before security changes")
                    .font(.system(size: 12))
                    .foregroundColor(.textSecondary)
            }

            Spacer()

            Toggle("", isOn: $isEnabled)
                .labelsHidden()
                .disabled(unavailable)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Color.surfaceWhite)
        .onAppear { unavailable = !BiometricAuth.isAvailable() }
    }
}
