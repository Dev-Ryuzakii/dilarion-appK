import SwiftUI

struct AppLockOverlayView: View {
    @ObservedObject private var lock = AppLockManager.shared
    @State private var isAuthenticating = false

    var body: some View {
        ZStack {
            Color.backgroundGrey.ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "faceid")
                    .font(.system(size: 56))
                    .foregroundColor(.dilarionRed)
                Text("Dilarion is locked")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.textPrimary)
                Button {
                    authenticate()
                } label: {
                    HStack(spacing: 8) {
                        if isAuthenticating { ProgressView().tint(.white) }
                        Text("Unlock")
                    }
                    .fontWeight(.semibold)
                    .frame(maxWidth: 200)
                    .padding(.vertical, 14)
                    .background(Color.dilarionRed)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(isAuthenticating)
            }
        }
        .task { authenticate() }
    }

    private func authenticate() {
        guard !isAuthenticating else { return }
        isAuthenticating = true
        Task {
            _ = await lock.unlock()
            isAuthenticating = false
        }
    }
}
