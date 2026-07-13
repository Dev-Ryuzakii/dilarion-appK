import SwiftUI

// MARK: — Settings ViewModel
@MainActor
class SettingsViewModel: ObservableObject {
    @Published var username: String = KeychainHelper.shared.read(key: "username") ?? ""
    @Published var hasMasterToken: Bool = false
    @Published var error: String? = nil
    
    init() {
        let masterToken = KeychainHelper.shared.read(key: "master_token") ?? ""
        self.hasMasterToken = !masterToken.isEmpty
    }
    
    func logout(completion: @escaping () -> Void) {
        Task {
            try? await APIClient.shared.postVoid("/auth/logout", body: EmptyBody())
            WebSocketManager.shared.disconnect()
            KeychainHelper.shared.delete(key: "session_token")
            KeychainHelper.shared.delete(key: "username")
            KeychainHelper.shared.delete(key: "master_token")
            await MainActor.run {
                completion()
            }
        }
    }
    
    func refreshState() {
        let masterToken = KeychainHelper.shared.read(key: "master_token") ?? ""
        self.hasMasterToken = !masterToken.isEmpty
    }
}

// MARK: — Settings View
struct SettingsViewFull: View {
    let onLogout: () -> Void
    @StateObject private var vm = SettingsViewModel()
    @State private var showLogoutDialog = false
    @State private var showMasterTokenSetup = false
    @AppStorage(AppearanceMode.storageKey) private var appearanceRaw = AppearanceMode.system.rawValue
    
    var body: some View {
        ZStack {
            Color.backgroundGrey.ignoresSafeArea()
            
            ScrollView {
                VStack(spacing: 0) {
                    // Profile Header
                    VStack(spacing: 12) {
                        Circle()
                            .fill(Color.dilarionRed)
                            .frame(width: 80, height: 80)
                            .overlay(
                                Text(String(vm.username.prefix(1)).uppercased())
                                    .font(.system(size: 32, weight: .bold))
                                    .foregroundColor(.white)
                            )
                            .shadow(color: Color.dilarionRed.opacity(0.3), radius: 6, y: 3)
                        
                        Text(vm.username)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundColor(.textPrimary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 28)
                    .background(Color.surfaceWhite)
                    
                    Spacer().frame(height: 16)
                    
                    // Master Token Section
                    VStack(alignment: .leading, spacing: 6) {
                        Text("MASTER TOKEN")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.textSecondary)
                            .padding(.leading, 16)
                        
                        Button {
                            showMasterTokenSetup = true
                        } label: {
                            HStack(spacing: 16) {
                                Image(systemName: "shield.fill")
                                    .font(.system(size: 20))
                                    .foregroundColor(.dilarionRed)
                                    .frame(width: 24)
                                
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(vm.hasMasterToken ? "Change Master Token" : "Set Master Token")
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundColor(.textPrimary)
                                    
                                    Text(vm.hasMasterToken ? "Update token used to reveal messages" : "Required to decrypt and read messages")
                                        .font(.system(size: 12))
                                        .foregroundColor(.textSecondary)
                                }
                                
                                Spacer()
                                
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(.textSecondary.opacity(0.6))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(Color.surfaceWhite)
                        }
                        .buttonStyle(.plain)
                    }
                    
                    Spacer().frame(height: 20)

                    // Devices Section
                    VStack(alignment: .leading, spacing: 6) {
                        Text("DEVICES")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.textSecondary)
                            .padding(.leading, 16)

                        NavigationLink {
                            LinkedDevicesView()
                        } label: {
                            HStack(spacing: 16) {
                                Image(systemName: "laptopcomputer.and.iphone")
                                    .font(.system(size: 18))
                                    .foregroundColor(.dilarionRed)
                                    .frame(width: 24)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Linked devices")
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundColor(.textPrimary)
                                    Text("Scan a QR to link your desktop; unlink devices")
                                        .font(.system(size: 12))
                                        .foregroundColor(.textSecondary)
                                }

                                Spacer()

                                Image(systemName: "chevron.right")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(.textSecondary.opacity(0.6))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(Color.surfaceWhite)
                        }
                        .buttonStyle(.plain)
                    }

                    Spacer().frame(height: 20)

                    // Appearance Section
                    VStack(alignment: .leading, spacing: 6) {
                        Text("APPEARANCE")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.textSecondary)
                            .padding(.leading, 16)

                        VStack(spacing: 0) {
                            ForEach(AppearanceMode.allCases) { mode in
                                Button {
                                    appearanceRaw = mode.rawValue
                                } label: {
                                    HStack(spacing: 16) {
                                        Image(systemName: mode.icon)
                                            .font(.system(size: 18))
                                            .foregroundColor(.dilarionRed)
                                            .frame(width: 24)

                                        Text(mode.label)
                                            .font(.system(size: 15, weight: .medium))
                                            .foregroundColor(.textPrimary)

                                        Spacer()

                                        if appearanceRaw == mode.rawValue {
                                            Image(systemName: "checkmark.circle.fill")
                                                .font(.system(size: 18))
                                                .foregroundColor(.dilarionRed)
                                        }
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 14)
                                    .background(Color.surfaceWhite)
                                }
                                .buttonStyle(.plain)

                                if mode != AppearanceMode.allCases.last {
                                    Divider().padding(.leading, 56)
                                }
                            }
                        }

                        Text("System Default follows your device's light or dark setting.")
                            .font(.system(size: 11))
                            .foregroundColor(.textSecondary.opacity(0.8))
                            .padding(.leading, 16)
                            .padding(.top, 2)
                    }

                    Spacer().frame(height: 20)

                    // Account Section
                    VStack(alignment: .leading, spacing: 6) {
                        Text("ACCOUNT")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.textSecondary)
                            .padding(.leading, 16)
                        
                        Button {
                            showLogoutDialog = true
                        } label: {
                            HStack(spacing: 16) {
                                Image(systemName: "rectangle.portrait.and.arrow.right")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundColor(.dilarionRed)
                                    .frame(width: 24)
                                
                                Text("Log out")
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundColor(.dilarionRed)
                                
                                Spacer()
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(Color.surfaceWhite)
                        }
                        .buttonStyle(.plain)
                    }
                    
                    Spacer().frame(height: 48)
                    
                    // Footer details
                    Text("Dilarion v1.0.0 · Secure · Private · Encrypted")
                        .font(.system(size: 11))
                        .foregroundColor(.textSecondary.opacity(0.6))
                }
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Log out", isPresented: $showLogoutDialog, titleVisibility: .visible) {
            Button("Log out", role: .destructive) {
                vm.logout(completion: onLogout)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to log out?")
        }
        .sheet(isPresented: $showMasterTokenSetup, onDismiss: {
            vm.refreshState()
        }) {
            MasterTokenSetupView {
                showMasterTokenSetup = false
            }
        }
        .onAppear {
            vm.refreshState()
        }
    }
}

// MARK: — Master Token Setup ViewModel
@MainActor
class MasterTokenSetupViewModel: ObservableObject {
    enum Step { case create, confirm }
    
    @Published var step: Step = .create
    @Published var isLoading = false
    @Published var error: String? = nil
    @Published var success = false
    
    private var pendingToken = ""
    
    func create(token: String) {
        if let err = validate(token) {
            self.error = err
            return
        }
        isLoading = true
        error = nil
        
        Task {
            do {
                try await APIClient.shared.postVoid("/mastertoken/create", body: MasterTokenRequest(masterToken: token))
                pendingToken = token
                step = .confirm
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
    
    func confirm(token: String) {
        if token != pendingToken {
            self.error = "Tokens do not match"
            return
        }
        isLoading = true
        error = nil
        
        Task {
            do {
                try await APIClient.shared.postVoid("/mastertoken/confirm", body: MasterTokenRequest(masterToken: token))
                KeychainHelper.shared.save(key: "master_token", value: token)
                success = true
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
    
    func backToCreate() {
        pendingToken = ""
        step = .create
        error = nil
    }
    
    func clearError() { error = nil }
    
    private func validate(_ token: String) -> String? {
        if token.count < 12 { return "Master token must be at least 12 characters" }
        let upper = token.contains { $0.isUppercase }
        let lower = token.contains { $0.isLowercase }
        let digit = token.contains { $0.isNumber }
        let special = token.contains { "!@#$%^&*".contains($0) }
        let complexity = [upper, lower, digit, special].filter { $0 }.count
        if complexity < 3 {
            return "Must include at least 3 of: uppercase, lowercase, digit, special (!@#$%^&*)"
        }
        return nil
    }
}

// MARK: — Master Token Setup View
struct MasterTokenSetupView: View {
    let onComplete: () -> Void
    @StateObject private var vm = MasterTokenSetupViewModel()
    @State private var token = ""
    @State private var confirmToken = ""
    @State private var showToken = false
    @State private var showConfirmToken = false
    
    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [Color.dilarionRed, Color.dilarionRedDark],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
                
                ScrollView {
                    VStack(spacing: 0) {
                        Spacer().frame(height: 36)
                        
                        // Header info
                        VStack(spacing: 14) {
                            Circle()
                                .fill(Color.white.opacity(0.18))
                                .frame(width: 80, height: 80)
                                .overlay(
                                    Image(systemName: "key.fill")
                                        .font(.system(size: 36))
                                        .foregroundColor(.white)
                                )
                            
                            Text(vm.step == .create ? "Create Master Token" : "Confirm Master Token")
                                .font(.system(size: 24, weight: .bold))
                                .foregroundColor(.white)
                            
                            Text(vm.step == .create
                                 ? "Your master token unlocks your encrypted messages. Store it safely — it cannot be recovered."
                                 : "Re-enter your master token to confirm")
                                .font(.system(size: 14))
                                .foregroundColor(.white.opacity(0.85))
                                .multilineTextAlignment(.center)
                                .lineLimit(3)
                                .padding(.horizontal, 24)
                        }
                        
                        Spacer().frame(height: 32)
                        
                        // Card container
                        VStack(spacing: 20) {
                            if vm.step == .create {
                                CreateStepView(vm: vm, token: $token, showToken: $showToken)
                            } else {
                                ConfirmStepView(vm: vm, confirmToken: $confirmToken, showConfirmToken: $showConfirmToken)
                            }
                        }
                        .padding(24)
                        .background(Color.surfaceWhite)
                        .cornerRadius(24)
                        .padding(.horizontal, 24)
                        .shadow(color: .black.opacity(0.12), radius: 8, y: 4)
                        
                        Spacer()
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        onComplete()
                    }
                    .foregroundColor(.white)
                }
            }
            .alert("Error", isPresented: Binding(
                get: { vm.error != nil },
                set: { if !$0 { vm.clearError() } }
            )) {
                Button("OK") { vm.clearError() }
            } message: {
                Text(vm.error ?? "")
            }
            .onChange(of: vm.success) { success in
                if success { onComplete() }
            }
        }
    }
}

// MARK: — Sub-components to ease type-checker load
struct CreateStepView: View {
    @ObservedObject var vm: MasterTokenSetupViewModel
    @Binding var token: String
    @Binding var showToken: Bool
    
    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Image(systemName: "key")
                    .foregroundColor(.dilarionRed)
                    .frame(width: 24)
                
            SwiftUI.Group {
                if showToken {
                    TextField("Master Token", text: $token)
                } else {
                    SecureField("Master Token", text: $token)
                }
            }
                .autocapitalization(.none)
                .autocorrectionDisabled()
                
                Button { showToken.toggle() } label: {
                    Image(systemName: showToken ? "eye.slash" : "eye")
                        .foregroundColor(.textSecondary)
                }
            }
            .padding(14)
            .background(Color.backgroundGrey)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(Color.borderGrey, lineWidth: 1.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
            
            // Requirements Tips
            VStack(alignment: .leading, spacing: 6) {
                Text("Requirements:")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.dilarionRed)
                
                Text("• At least 12 characters")
                Text("• At least 3 of: uppercase, lowercase, digit, special")
                Text("• Store it safely — cannot be recovered")
                Text("• Never share it with anyone")
            }
            .font(.system(size: 11))
            .foregroundColor(.dilarionRed.opacity(0.85))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color.dilarionRed.opacity(0.06))
            .cornerRadius(12)
            
            Button {
                vm.create(token: token)
            } label: {
                ZStack {
                    if vm.isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text("Create Token")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(token.isEmpty ? Color.dilarionRed.opacity(0.5) : Color.dilarionRed)
                .cornerRadius(14)
            }
            .disabled(token.isEmpty || vm.isLoading)
        }
    }
}

struct ConfirmStepView: View {
    @ObservedObject var vm: MasterTokenSetupViewModel
    @Binding var confirmToken: String
    @Binding var showConfirmToken: Bool
    
    var body: some View {
        VStack(spacing: 20) {
            Text("Re-enter the master token you just created to verify it's correct.")
                .font(.system(size: 13))
                .foregroundColor(.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            
            HStack {
                Image(systemName: "key")
                    .foregroundColor(.dilarionRed)
                    .frame(width: 24)
                
            SwiftUI.Group {
                if showConfirmToken {
                    TextField("Confirm Master Token", text: $confirmToken)
                } else {
                    SecureField("Confirm Master Token", text: $confirmToken)
                }
            }
                .autocapitalization(.none)
                .autocorrectionDisabled()
                
                Button { showConfirmToken.toggle() } label: {
                    Image(systemName: showConfirmToken ? "eye.slash" : "eye")
                        .foregroundColor(.textSecondary)
                }
            }
            .padding(14)
            .background(Color.backgroundGrey)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(Color.borderGrey, lineWidth: 1.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
            
            Button {
                vm.confirm(token: confirmToken)
            } label: {
                ZStack {
                    if vm.isLoading {
                        ProgressView().tint(.white)
                    } else {
                        Text("Confirm & Continue")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(confirmToken.isEmpty ? Color.dilarionRed.opacity(0.5) : Color.dilarionRed)
                .cornerRadius(14)
            }
            .disabled(confirmToken.isEmpty || vm.isLoading)
            
            Button {
                vm.backToCreate()
            } label: {
                Text("Go Back")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.textSecondary)
                    .padding(.vertical, 8)
            }
        }
    }
}
