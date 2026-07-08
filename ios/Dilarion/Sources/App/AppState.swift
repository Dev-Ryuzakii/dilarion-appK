import Foundation
import Combine

class AppState: ObservableObject {
    @Published var isConnected: Bool = false
    @Published var unreadCount: Int = 0
    @Published var pendingCall: IncomingCallData? = nil
    @Published var currentUsername: String = KeychainHelper.shared.read(key: "username") ?? ""
}
