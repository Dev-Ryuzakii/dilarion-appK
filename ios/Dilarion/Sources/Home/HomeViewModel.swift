import Foundation
import Combine

struct HomeUiState {
    var messages: [Message] = []
    var groups: [Group] = []
    var callHistory: [CallHistoryItem] = []
    var isLoading: Bool = false
    var isCallHistoryLoading: Bool = false
    var currentUsername: String = KeychainHelper.shared.read(key: "username") ?? ""
}

class HomeViewModel: ObservableObject {
    @Published var state = HomeUiState()
    private var cancellables = Set<AnyCancellable>()

    init() {
        load()
        subscribeToWS()
    }

    func load() {
        state.isLoading = true
        Task {
            async let msgs: [Message]? = try? APIClient.shared.get("/messages/inbox")
            async let grps: [Group]? = try? APIClient.shared.get("/groups")
            let (m, g) = await (msgs, grps)
            await MainActor.run {
                self.state.messages = m ?? []
                self.state.groups = g ?? []
                self.state.isLoading = false
            }
        }
    }

    func loadCallHistory() {
        state.isCallHistoryLoading = true
        Task {
            let history: [CallHistoryItem]? = try? await APIClient.shared.get("/calls/history")
            await MainActor.run {
                self.state.callHistory = history ?? []
                self.state.isCallHistoryLoading = false
            }
        }
    }

    func logout(completion: @escaping () -> Void) {
        Task { try? await APIClient.shared.postVoid("/auth/logout", body: EmptyBody()) }
        WebSocketManager.shared.disconnect()
        KeychainHelper.shared.delete(key: "session_token")
        KeychainHelper.shared.delete(key: "username")
        KeychainHelper.shared.delete(key: "user_id")
        KeychainHelper.shared.delete(key: "master_token")
        completion()
    }

    private func subscribeToWS() {
        WebSocketManager.shared.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                if case .message(let msg) = event {
                    self?.state.messages.append(msg)
                }
            }
            .store(in: &cancellables)
    }
}
