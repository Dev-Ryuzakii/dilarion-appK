import SwiftUI

// Mirrors AuthScreen.kt exactly:
// - Gradient bg (red tint → grey → surface)
// - Logo 110pt circular
// - "Welcome Back" / "Sign in to continue"
// - Card: Username + Authentication Token (with show/hide)
// - Red Sign In button
// - "Secure · Private · Encrypted" footer

struct AuthView: View {
    let onSuccess: () -> Void
    @StateObject private var vm = AuthViewModel()
    @State private var username = ""
    @State private var token = ""
    @State private var showToken = false
    @FocusState private var focusField: Field?

    enum Field { case username, token }

    var body: some View {
        ZStack {
            // Gradient: DilarionRed 6% → BackgroundGrey → surface (mirrors Kotlin gradient)
            LinearGradient(
                colors: [
                    Color.dilarionRed.opacity(0.06),
                    Color.backgroundGrey,
                    Color(UIColor.systemBackground).opacity(0.96),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: 48)

                    // Logo
                    LogoImage(size: 110)

                    Spacer().frame(height: 24)

                    Text("Welcome Back")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(.textPrimary)

                    Text("Sign in to continue")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .padding(.top, 6)

                    Spacer().frame(height: 40)

                    // Card
                    VStack(spacing: 16) {
                        // Username field
                        HStack {
                            Image(systemName: "person")
                                .foregroundColor(.textSecondary)
                                .frame(width: 24)
                            TextField("Username", text: $username)
                                .autocapitalization(.none)
                                .autocorrectionDisabled()
                                .submitLabel(.next)
                                .focused($focusField, equals: .username)
                                .onSubmit { focusField = .token }
                        }
                        .padding(14)
                        .background(Color.backgroundGrey)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(focusField == .username ? Color.dilarionRed : Color.borderGrey, lineWidth: 1.5)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 14))

                        // Authentication Token field (not "Password" — matches Kotlin label)
                        HStack {
                            Image(systemName: "lock")
                                .foregroundColor(.textSecondary)
                                .frame(width: 24)
                            Group {
                                if showToken {
                                    TextField("Authentication Token", text: $token)
                                } else {
                                    SecureField("Authentication Token", text: $token)
                                }
                            }
                            .autocapitalization(.none)
                            .autocorrectionDisabled()
                            .submitLabel(.done)
                            .focused($focusField, equals: .token)
                            .onSubmit { doLogin() }

                            Button {
                                showToken.toggle()
                            } label: {
                                Image(systemName: showToken ? "eye.slash" : "eye")
                                    .foregroundColor(.textSecondary)
                            }
                        }
                        .padding(14)
                        .background(Color.backgroundGrey)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(focusField == .token ? Color.dilarionRed : Color.borderGrey, lineWidth: 1.5)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 14))

                        Spacer().frame(height: 4)

                        // Sign In button
                        Button(action: doLogin) {
                            ZStack {
                                if vm.state.isLoading {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Text("Sign In")
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(.white)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                        }
                        .background(
                            RoundedRectangle(cornerRadius: 14)
                                .fill(Color.dilarionRed)
                        )
                        .disabled(vm.state.isLoading || username.isEmpty || token.isEmpty)
                        .opacity((username.isEmpty || token.isEmpty) ? 0.6 : 1)
                    }
                    .padding(24)
                    .background(Color.surfaceWhite)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .shadow(color: .black.opacity(0.06), radius: 8, y: 4)
                    .padding(.horizontal, 24)

                    Spacer().frame(height: 24)

                    Text("Secure · Private · Encrypted")
                        .font(.system(size: 12))
                        .foregroundColor(.textSecondary)

                    Spacer().frame(height: 48)
                }
            }
        }
        .onChange(of: vm.state.success) { success in
            if success { onSuccess() }
        }
        .alert("Error", isPresented: Binding(
            get: { vm.state.error != nil },
            set: { if !$0 { vm.clearError() } }
        )) {
            Button("OK") { vm.clearError() }
        } message: {
            Text(vm.state.error ?? "")
        }
    }

    private func doLogin() {
        focusField = nil
        vm.login(username: username, token: token)
    }
}
