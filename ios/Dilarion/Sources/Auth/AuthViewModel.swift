import Foundation

struct AuthUiState {
    var isLoading: Bool = false
    var error: String? = nil
    var success: Bool = false
}

class AuthViewModel: ObservableObject {
    @Published var state = AuthUiState()

    // mirrors AuthViewModel.kt: login(username, token)
    func login(username: String, token: String) {
        guard !username.trimmingCharacters(in: .whitespaces).isEmpty,
              !token.trimmingCharacters(in: .whitespaces).isEmpty else {
            state = AuthUiState(error: "Username and token are required")
            return
        }
        state = AuthUiState(isLoading: true)
        Task {
            do {
                let response: LoginResponse = try await APIClient.shared.post(
                    "/auth/login",
                    body: LoginRequest(username: username.trimmingCharacters(in: .whitespaces),
                                       token: token.trimmingCharacters(in: .whitespaces))
                )
                if response.token.isEmpty {
                    await MainActor.run { state = AuthUiState(error: "Server returned no session token") }
                    return
                }
                KeychainHelper.shared.save(key: "session_token", value: response.token)
                KeychainHelper.shared.save(key: "username", value: response.username)
                WebSocketManager.shared.connect(token: response.token)
                await MainActor.run { state = AuthUiState(success: true) }
            } catch APIError.serverError(let code, _) {
                let msg: String
                switch code {
                case 401: msg = "Invalid credentials"
                case 500: msg = "Server error. Try again."
                default:  msg = "Login failed (\(code))"
                }
                await MainActor.run { state = AuthUiState(error: msg) }
            } catch {
                await MainActor.run { state = AuthUiState(error: error.localizedDescription) }
            }
        }
    }

    func clearError() { state.error = nil }
}
