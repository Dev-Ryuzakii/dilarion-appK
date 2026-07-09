import SwiftUI

// Mirrors AuthScreen.kt — dark themed:
// - Black gradient background
// - Logo 110pt circular
// - "Welcome Back" / "Sign in to continue" in white
// - Dark card: Username + Authentication Token (with show/hide)
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
            // Dark gradient background
            LinearGradient(
                colors: [
                    Color(hex: 0x0A0A0A),
                    Color(hex: 0x111111),
                    Color(hex: 0x1A1A1A),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: 64)

                    // Logo — uses the actual asset from Assets.xcassets
                    LogoImage(size: 110)

                    Spacer().frame(height: 24)

                    Text("Welcome Back")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(.white)

                    Text("Sign in to continue")
                        .font(.system(size: 14))
                        .foregroundColor(.white.opacity(0.55))
                        .padding(.top, 6)

                    Spacer().frame(height: 40)

                    // Card — dark surface
                    VStack(spacing: 16) {
                        // Username field
                        HStack {
                            Image(systemName: "person")
                                .foregroundColor(.white.opacity(0.45))
                                .frame(width: 24)
                            TextField("Username", text: $username)
                                .foregroundColor(.white)
                                .autocapitalization(.none)
                                .autocorrectionDisabled()
                                .submitLabel(.next)
                                .focused($focusField, equals: .username)
                                .onSubmit { focusField = .token }
                        }
                        .padding(14)
                        .background(Color(hex: 0x1E1E1E))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(focusField == .username ? Color.dilarionRed : Color(hex: 0x333333), lineWidth: 1.5)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 14))

                        // Authentication Token field
                        HStack {
                            Image(systemName: "lock")
                                .foregroundColor(.white.opacity(0.45))
                                .frame(width: 24)
                            SwiftUI.Group {
                                if showToken {
                                    TextField("Authentication Token", text: $token)
                                        .foregroundColor(.white)
                                } else {
                                    SecureField("Authentication Token", text: $token)
                                        .foregroundColor(.white)
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
                                    .foregroundColor(.white.opacity(0.45))
                            }
                        }
                        .padding(14)
                        .background(Color(hex: 0x1E1E1E))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(focusField == .token ? Color.dilarionRed : Color(hex: 0x333333), lineWidth: 1.5)
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
                    .background(Color(hex: 0x151515))
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(Color(hex: 0x2A2A2A), lineWidth: 1)
                    )
                    .padding(.horizontal, 24)

                    Spacer().frame(height: 24)

                    Text("Secure · Private · Encrypted")
                        .font(.system(size: 12))
                        .foregroundColor(.white.opacity(0.4))

                    Spacer().frame(height: 48)
                }
            }
        }
        .preferredColorScheme(.dark)
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
