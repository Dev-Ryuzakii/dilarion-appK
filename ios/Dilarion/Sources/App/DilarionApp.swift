import SwiftUI

@main
struct DilarionApp: App {
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
    @ObservedObject private var meetingVM = MeetingViewModel.shared
    @ObservedObject private var appLock = AppLockManager.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        SwiftUI.Group {
            switch splashVM.destination {
            case .loading:
                SplashView()
            case .auth:
                AuthView(onSuccess: { splashVM.destination = .home })
            case .home:
                ZStack {
                    HomeView(onLogout: { splashVM.destination = .auth })
                    if appLock.isLocked {
                        AppLockOverlayView()
                    }
                }
            }
        }
        .onReceive(splashVM.$destination) { destination in
            if destination == .home { appLock.armIfEnabled() }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background { appLock.armIfEnabled() }
        }
        .fullScreenCover(isPresented: Binding(
            get: { callVM.uiState.state != .idle },
            set: { if !$0 { callVM.resetToIdle() } }
        )) {
            let masterToken = KeychainHelper.shared.read(key: "master_token") ?? ""
            CallScreen(vm: callVM, masterToken: masterToken) {
                callVM.resetToIdle()
            }
        }
        // Not a fullScreenCover: minimizing needs the rest of the app to stay
        // interactive underneath (Google Meet-style floating bubble) while the
        // LiveKit room stays connected in the background. MeetingRootView
        // renders EmptyView() while idle, so there's nothing here to block
        // touches the rest of the time.
        .overlay(alignment: meetingVM.isMinimized ? .bottomTrailing : .topLeading) {
            MeetingRootView()
        }
    }
}
