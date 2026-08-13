import SwiftUI

// No polling — purely WS-driven (conference_admitted / conference_denied),
// mirrors desktop (WaitingForHostScreen.tsx) and Android (WaitingForHostScreen.kt).
// MeetingViewModel flips `phase` itself on those events; this view just reflects it.
struct WaitingForHostView: View {
    let onCancel: () -> Void

    @ObservedObject private var vm = MeetingViewModel.shared

    var body: some View {
        ZStack {
            Color(hex: 0x121212).ignoresSafeArea()
            VStack(spacing: 20) {
                Spacer()
                ProgressView().tint(.white).scaleEffect(1.4)
                Text("Waiting for the host to let you in…")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Spacer()
                Button("Cancel") { onCancel() }
                    .foregroundColor(.white.opacity(0.7))
                    .padding(.bottom, 24)
            }
        }
        .statusBarHidden(true)
    }
}
