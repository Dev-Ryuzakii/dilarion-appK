import SwiftUI

@main
struct DilarionApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
        }
    }
}

// MARK: — Navigation root (mirrors AppNavigation.kt)
struct RootView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var splashVM = SplashViewModel()

    var body: some View {
        Group {
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
    }
}
