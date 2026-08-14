import SwiftUI

// Master-token 2FA — a second secret required to create/replace the master
// token, so a stolen session/bearer token alone can't silently reset it out
// from under the real owner. Never involved in decrypting content — only
// gates /mastertoken/create. Mirrors desktop/Android's api.ts/ApiService.kt
// wrappers (no client UI existed anywhere yet when this was built).
@MainActor
final class TwoFactorSettingsViewModel: ObservableObject {
    @Published var isEnabled = false
    @Published var isLoading = true
    @Published var error: String? = nil

    func refresh() {
        isLoading = true
        Task {
            isEnabled = (try? await APIClient.shared.getMasterToken2FAStatus()) ?? false
            isLoading = false
        }
    }

    func enable(masterToken: String, twoFaPassword: String) async -> Bool {
        do {
            try await APIClient.shared.enableMasterToken2FA(masterToken: masterToken, twoFaPassword: twoFaPassword)
            isEnabled = true
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func disable(twoFaPassword: String) async -> Bool {
        do {
            try await APIClient.shared.disableMasterToken2FA(twoFaPassword: twoFaPassword)
            isEnabled = false
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

struct TwoFactorSettingsRow: View {
    @StateObject private var vm = TwoFactorSettingsViewModel()
    @State private var showEnableSheet = false
    @State private var showDisableSheet = false

    var body: some View {
        Button {
            if vm.isEnabled { showDisableSheet = true } else { showEnableSheet = true }
        } label: {
            HStack(spacing: 16) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 20))
                    .foregroundColor(.dilarionRed)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Master-Token 2FA")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.textPrimary)
                    Text(vm.isLoading ? "Checking…" : (vm.isEnabled ? "On — required to change your master token" : "Off — add a second secret for changing it"))
                        .font(.system(size: 12))
                        .foregroundColor(.textSecondary)
                }

                Spacer()

                if !vm.isLoading {
                    Text(vm.isEnabled ? "On" : "Off")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(vm.isEnabled ? .green : .textSecondary)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.textSecondary.opacity(0.6))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color.surfaceWhite)
        }
        .buttonStyle(.plain)
        .disabled(vm.isLoading)
        .onAppear { vm.refresh() }
        .sheet(isPresented: $showEnableSheet, onDismiss: { vm.refresh() }) {
            TwoFactorEnableSheet(vm: vm) { showEnableSheet = false }
        }
        .sheet(isPresented: $showDisableSheet, onDismiss: { vm.refresh() }) {
            TwoFactorDisableSheet(vm: vm) { showDisableSheet = false }
        }
    }
}

private struct TwoFactorEnableSheet: View {
    @ObservedObject var vm: TwoFactorSettingsViewModel
    let onDone: () -> Void

    @State private var masterToken = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var isSubmitting = false
    @State private var localError: String? = nil

    private var canSubmit: Bool {
        !masterToken.isEmpty && password.count >= 6 && password == confirmPassword
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Enabling 2FA requires your current master token, then a separate password you'll need any time you change it going forward.")
                        .font(.system(size: 13))
                        .foregroundColor(.textSecondary)
                }
                Section("Current master token") {
                    SecureField("Master token", text: $masterToken)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                }
                Section("New 2FA password") {
                    SecureField("At least 6 characters", text: $password)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                    SecureField("Confirm password", text: $confirmPassword)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                }
                if let localError {
                    Text(localError).foregroundColor(.red).font(.system(size: 12))
                }
            }
            .navigationTitle("Enable 2FA")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { onDone() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task {
                            isSubmitting = true
                            localError = nil
                            let ok = await vm.enable(masterToken: masterToken, twoFaPassword: password)
                            isSubmitting = false
                            if ok { onDone() } else { localError = vm.error }
                        }
                    } label: {
                        if isSubmitting { ProgressView() } else { Text("Enable").bold() }
                    }
                    .disabled(!canSubmit || isSubmitting)
                }
            }
        }
    }
}

private struct TwoFactorDisableSheet: View {
    @ObservedObject var vm: TwoFactorSettingsViewModel
    let onDone: () -> Void

    @State private var password = ""
    @State private var isSubmitting = false
    @State private var localError: String? = nil

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Enter your 2FA password to turn this off. Your master token itself won't change.")
                        .font(.system(size: 13))
                        .foregroundColor(.textSecondary)
                }
                Section("2FA password") {
                    SecureField("Password", text: $password)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                }
                if let localError {
                    Text(localError).foregroundColor(.red).font(.system(size: 12))
                }
            }
            .navigationTitle("Disable 2FA")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { onDone() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .destructive) {
                        Task {
                            isSubmitting = true
                            localError = nil
                            let ok = await vm.disable(twoFaPassword: password)
                            isSubmitting = false
                            if ok { onDone() } else { localError = vm.error }
                        }
                    } label: {
                        if isSubmitting { ProgressView() } else { Text("Disable").bold() }
                    }
                    .disabled(password.isEmpty || isSubmitting)
                }
            }
        }
    }
}
