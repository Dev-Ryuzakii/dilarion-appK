import Foundation
import UIKit
import UserNotifications

// Mirrors Android NotificationHelper.kt:
// - Message notifications use the beep sound from assets
// - Incoming call notifications use the ringingtone sound from assets
// UNNotificationSound requires caf/wav/aiff, so beep.caf / ringingtone.caf
// (converted from the mp3 assets) are bundled alongside the mp3s.
final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()
    private override init() { super.init() }

    static let messageSound = UNNotificationSound(named: UNNotificationSoundName("beep.caf"))
    static let callSound = UNNotificationSound(named: UNNotificationSoundName("ringingtone.caf"))

    func configure() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    // NOTE: APNs remote push (killed-app notifications) removed for now — it
    // requires a paid Apple Developer account for the aps-environment
    // entitlement. The backend /notifications/register-device endpoint and
    // push sender stay in place; re-add registerForRemoteNotifications +
    // AppDelegate token handling once the account is paid and the p8 key set.

    // Matches Android buildMessageNotification: "New message" / "From <sender>"
    func notifyNewMessage(from sender: String) {
        post(
            id: "dilarion_message",
            title: "New message",
            body: "From \(sender)",
            sound: Self.messageSound
        )
    }

    func notifyNewMedia(from sender: String?) {
        post(
            id: "dilarion_media",
            title: "New media",
            body: sender.map { "From \($0)" } ?? "You received new media",
            sound: Self.messageSound
        )
    }

    // Matches Android buildCallNotification: "Incoming Voice/Video Call" / caller
    func notifyIncomingCall(from caller: String, isVideo: Bool) {
        post(
            id: "dilarion_call",
            title: "Incoming \(isVideo ? "Video" : "Voice") Call",
            body: caller,
            sound: Self.callSound
        )
    }

    func cancelCallNotification() {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["dilarion_call"])
        center.removeDeliveredNotifications(withIdentifiers: ["dilarion_call"])
    }

    // Only post when the app is not active — in the foreground AudioManager
    // already plays the beep/ringtone directly.
    private func post(id: String, title: String, body: String, sound: UNNotificationSound) {
        DispatchQueue.main.async {
            guard UIApplication.shared.applicationState != .active else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = sound
            let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request)
        }
    }

    // MARK: - UNUserNotificationCenterDelegate
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Foreground: AudioManager handles sound, skip system presentation
        completionHandler([])
    }
}
