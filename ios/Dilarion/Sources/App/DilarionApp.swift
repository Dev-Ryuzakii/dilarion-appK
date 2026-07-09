import SwiftUI
import UIKit

// Receives the APNs device token and hands it to NotificationManager
class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let tokenHex = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotificationManager.shared.deviceTokenRegistered(tokenHex)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("APNs registration failed: \(error.localizedDescription)")
    }
}

@main
struct DilarionApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppState()
    @AppStorage(AppearanceMode.storageKey) private var appearanceRaw = AppearanceMode.system.rawValue

    init() {
        NotificationManager.shared.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .preferredColorScheme((AppearanceMode(rawValue: appearanceRaw) ?? .system).colorScheme)
        }
    }
}

// MARK: — Navigation root (mirrors AppNavigation.kt)
struct RootView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var splashVM = SplashViewModel()
    @ObservedObject private var callVM = CallViewModel.shared

    var body: some View {
        SwiftUI.Group {
            switch splashVM.destination {
            case .loading:
                SplashView()
            case .auth:
                AuthView(onSuccess: { splashVM.destination = .home })
            case .home:
                HomeView(onLogout: { splashVM.destination = .auth })
            }
        }
        .onReceive(splashVM.$destination) { _ in }
        .fullScreenCover(isPresented: Binding(
            get: { callVM.uiState.state != .idle },
            set: { if !$0 { callVM.resetToIdle() } }
        )) {
            let masterToken = KeychainHelper.shared.read(key: "master_token") ?? ""
            CallScreen(vm: callVM, masterToken: masterToken) {
                callVM.resetToIdle()
            }
        }
    }
}
