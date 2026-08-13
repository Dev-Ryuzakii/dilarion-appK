import Foundation
import Combine

enum WSEvent {
    case message(Message)
    case incomingCall(IncomingCallData)
    case typing(from: String, isTyping: Bool)
    case callSignal([String: Any])
    case whiteboardEvent([String: Any])
    case newMedia
    case connected
    case disconnected
    // Covers message_reaction_updated / message_edited / message_deleted /
    // message_pinned / message_unpinned — all carry just enough to know which
    // conversation to refresh; content itself never travels over these.
    case messageUpdated(messageId: Int, groupId: Int?)
}

class WebSocketManager: ObservableObject {
    static let shared = WebSocketManager()
    private init() {}

    private var task: URLSessionWebSocketTask?
    // Set via WS_BASE_URL in Config-Production.xcconfig / Config-Staging.xcconfig.
    private let baseWSURL = (Bundle.main.object(forInfoDictionaryKey: "WSBaseURL") as? String)
        .flatMap { $0.isEmpty ? nil : $0 } ?? "wss://apidilarion.eibstratoc.com/ws"
    let events = PassthroughSubject<WSEvent, Never>()
    @Published var isConnected = false

    func connect(token: String) {
        guard let url = URL(string: "\(baseWSURL)?token=\(token)") else { return }
        task?.cancel(with: .goingAway, reason: nil)
        task = URLSession.shared.webSocketTask(with: url)
        task?.resume()
        isConnected = true
        events.send(.connected)
        receive()
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        isConnected = false
        events.send(.disconnected)
    }

    func send(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let str = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(str)) { _ in }
    }

    private func receive() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let msg):
                if case .string(let text) = msg { self.handle(text) }
                self.receive()
            case .failure:
                self.isConnected = false
                self.events.send(.disconnected)
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                    if let token = KeychainHelper.shared.read(key: "session_token") {
                        self.connect(token: token)
                    }
                }
            }
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        switch type {
        case "new_message":
            // Backend wraps message in "data" or sends flat
            let payload = json["data"].flatMap { $0 as? [String: Any] } ?? json
            if let msgData = try? JSONSerialization.data(withJSONObject: payload),
               let msg = try? JSONDecoder().decode(Message.self, from: msgData) {
                AudioManager.shared.playNotificationSound()
                NotificationManager.shared.notifyNewMessage(from: msg.sender ?? "Unknown")
                events.send(.message(msg))
            }
        case "incoming_call":
            if let callData = try? JSONSerialization.data(withJSONObject: json),
               let call = try? JSONDecoder().decode(IncomingCallData.self, from: callData) {
                NotificationManager.shared.notifyIncomingCall(
                    from: call.callerUsername,
                    isVideo: call.callType == "video"
                )
                events.send(.incomingCall(call))
            }
        case "typing":
            let from = json["sender_username"] as? String ?? ""
            let isTyping = json["is_typing"] as? Bool ?? false
            events.send(.typing(from: from, isTyping: isTyping))
        case "new_media":
            AudioManager.shared.playNotificationSound()
            NotificationManager.shared.notifyNewMedia(from: json["sender_username"] as? String)
            events.send(.newMedia)
        case "call_answer", "call_ice", "call_ended",
             "conference_invite", "conference_peer_connect", "conference_signal", "conference_participant_left",
             "conference_admitted", "conference_denied", "conference_join_request",
             "conference_recording_started", "conference_recording_stopped", "new_conference_message":
            if type == "call_ended" {
                NotificationManager.shared.cancelCallNotification()
            }
            events.send(.callSignal(json))
        case "whiteboard_stroke", "whiteboard_clear":
            events.send(.whiteboardEvent(json))
        case "message_reaction_updated", "message_edited", "message_deleted", "message_pinned", "message_unpinned":
            let payload = json["data"].flatMap { $0 as? [String: Any] } ?? json
            if let messageId = payload["message_id"] as? Int {
                events.send(.messageUpdated(messageId: messageId, groupId: payload["group_id"] as? Int))
            }
        default:
            break
        }
    }
}
