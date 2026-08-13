import SwiftUI

// Single fullScreenCover host for the whole LiveKit meeting flow, driven
// entirely by MeetingViewModel.phase — mirrors desktop's
// meetingLobby/waitingRoomState/activeGalleryCall three-state wiring in
// HomeScreen.tsx and Android's Lobby/Waiting/Gallery nav destinations.
struct MeetingRootView: View {
    @ObservedObject private var vm = MeetingViewModel.shared

    var body: some View {
        SwiftUI.Group {
            switch vm.phase {
            case .idle:
                Color.clear
            case .lobby(let kind):
                MeetingLobbyView(kind: kind, onCancel: { vm.phase = .idle })
            case .connecting:
                ZStack {
                    Color(hex: 0x121212).ignoresSafeArea()
                    ProgressView().tint(.white)
                }
                .statusBarHidden(true)
            case .waitingForHost:
                WaitingForHostView(onCancel: { vm.leave() })
            case .active:
                MeetingGalleryView(onDismiss: { vm.reset() })
            case .ended(let message):
                MeetingEndedView(message: message) { vm.reset() }
            }
        }
    }
}

private struct MeetingEndedView: View {
    let message: String?
    let onDone: () -> Void

    var body: some View {
        ZStack {
            Color(hex: 0x121212).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: message == nil ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .font(.system(size: 40))
                    .foregroundColor(message == nil ? .green : .dilarionRed)
                Text(message ?? "Meeting ended")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
        }
        .statusBarHidden(true)
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { onDone() }
        }
    }
}
