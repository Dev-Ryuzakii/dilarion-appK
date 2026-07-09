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

@MainActor
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
            // GET /messages/inbox → InboxResponse { messages: [...] }
            async let inboxResp: InboxResponse? = try? APIClient.shared.get("/messages/inbox")
            // GET /groups → [Group]
            async let grps: [Group]? = try? APIClient.shared.get("/groups")

            let (inbox, g) = await (inboxResp, grps)
            await MainActor.run {
                self.state.messages = inbox?.messages ?? []
                self.state.groups = g ?? []
                self.state.isLoading = false
            }
        }
    }

    func loadCallHistory() {
        state.isCallHistoryLoading = true
        Task {
            // GET /calls/history → CallHistoryResponse { calls: [...] }
            let resp: CallHistoryResponse? = try? await APIClient.shared.get("/calls/history")
            await MainActor.run {
                self.state.callHistory = resp?.calls ?? []
                self.state.isCallHistoryLoading = false
            }
        }
    }

    func logout(completion: @escaping () -> Void) {
        Task { try? await APIClient.shared.postVoid("/auth/logout", body: EmptyBody()) }
        WebSocketManager.shared.disconnect()
        KeychainHelper.shared.delete(key: "session_token")
        KeychainHelper.shared.delete(key: "username")
        KeychainHelper.shared.delete(key: "master_token")
        completion()
    }

    private func subscribeToWS() {
        WebSocketManager.shared.events
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                switch event {
                case .message:
                    // Reload full inbox on any new message
                    self?.load()
                default: break
                }
            }
            .store(in: &cancellables)
    }
}
