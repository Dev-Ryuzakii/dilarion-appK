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

                // Generate the E2EE keypair ONCE per device. Regenerating on every
                // login would rotate the identity and make all previously received
                // messages permanently undecryptable.
                let existingPriv = KeychainHelper.shared.read(key: "private_key")
                let existingPub = KeychainHelper.shared.read(key: "public_key")
                var pubB64: String? = existingPub
                if existingPriv == nil || existingPriv?.isEmpty == true || existingPub == nil || existingPub?.isEmpty == true {
                    if let (pub, priv) = EncryptionManager.shared.generateKeyPair() {
                        KeychainHelper.shared.save(key: "private_key", value: priv)
                        KeychainHelper.shared.save(key: "public_key", value: pub)
                        pubB64 = pub
                        do {
                            struct UpdateKeyRequest: Codable { let public_key: String }
                            let _: EmptyBody = try await APIClient.shared.post(
                                "/users/update_public_key",
                                body: UpdateKeyRequest(public_key: pub)
                            )
                        } catch {
                            print("Failed to upload public key: \(error)")
                        }
                    }
                }

                // Register this phone as a device so senders can encrypt to it and we
                // know our device_uuid for finding our entry in a message key map.
                if let pub = pubB64 {
                    do {
                        let resp: DeviceRegisterResponse = try await APIClient.shared.post(
                            "/devices/register",
                            body: DeviceRegisterRequest(public_key: pub, platform: "ios", device_name: "iPhone")
                        )
                        KeychainHelper.shared.save(key: "device_uuid", value: resp.device_uuid)
                    } catch {
                        print("Device register failed: \(error)")
                    }
                }

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
