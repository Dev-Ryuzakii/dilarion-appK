import SwiftUI
import LiveKit

// Pre-join device setup — pure local camera/mic preview, independent of the
// LiveKit Room (doesn't connect until "Join" is pressed). Mirrors desktop
// (MeetingLobby.tsx) and Android (LobbyScreen.kt).

struct MeetingLobbyView: View {
    let kind: MeetingLobbyKind
    let onCancel: () -> Void

    @ObservedObject private var vm = MeetingViewModel.shared
    @State private var micOn = true
    @State private var camOn = false
    @State private var displayName = KeychainHelper.shared.read(key: "username") ?? ""
    @State private var previewTrack: LocalVideoTrack? = nil

    var body: some View {
        ZStack {
            Color(hex: 0x121212).ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                ZStack {
                    RoundedRectangle(cornerRadius: 20)
                        .fill(Color.white.opacity(0.06))
                    if camOn, let previewTrack {
                        SwiftUIVideoView(previewTrack, layoutMode: .fill)
                            .clipShape(RoundedRectangle(cornerRadius: 20))
                    } else {
                        Circle()
                            .fill(Color.dilarionRed)
                            .frame(width: 88, height: 88)
                            .overlay(
                                Text(String(displayName.prefix(1)).uppercased())
                                    .font(.system(size: 34, weight: .bold))
                                    .foregroundColor(.white)
                            )
                    }
                }
                .frame(height: 280)
                .padding(.horizontal, 24)

                TextField("Display name", text: $displayName)
                    .textFieldStyle(.plain)
                    .foregroundColor(.white)
                    .padding(14)
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 24)

                HStack(spacing: 20) {
                    Button { micOn.toggle() } label: {
                        Image(systemName: micOn ? "mic.fill" : "mic.slash.fill")
                            .font(.system(size: 20))
                            .foregroundColor(.white)
                            .frame(width: 56, height: 56)
                            .background(micOn ? Color.white.opacity(0.15) : Color.white.opacity(0.3))
                            .clipShape(Circle())
                    }
                    Button {
                        camOn.toggle()
                        Task { await updatePreview() }
                    } label: {
                        Image(systemName: camOn ? "video.fill" : "video.slash.fill")
                            .font(.system(size: 20))
                            .foregroundColor(.white)
                            .frame(width: 56, height: 56)
                            .background(camOn ? Color.white.opacity(0.15) : Color.white.opacity(0.3))
                            .clipShape(Circle())
                    }
                }

                if case .ended(let message) = vm.phase, let message {
                    Text(message)
                        .font(.system(size: 13))
                        .foregroundColor(.dilarionRed)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }

                Spacer()

                Button {
                    joinTapped()
                } label: {
                    if vm.phase == .connecting {
                        ProgressView().tint(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                    } else {
                        Text("Join meeting")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                    }
                }
                .background(Color.dilarionRed)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .disabled(vm.phase == .connecting)
                .padding(.horizontal, 24)

                Button("Cancel") { teardownPreview(); onCancel() }
                    .foregroundColor(.white.opacity(0.7))
                    .padding(.bottom, 24)
            }
        }
        .statusBarHidden(true)
        .onDisappear { teardownPreview() }
    }

    private func joinTapped() {
        // Stop the lobby's own preview capture before handing off to the Room's
        // publish path — both would otherwise briefly hold the camera at once.
        teardownPreview()
        switch kind {
        case .instant(let invitees):
            vm.startInstantMeeting(invitees: invitees, displayName: displayName, initialMicOn: micOn, initialCamOn: camOn)
        case .join(let joinCode):
            vm.joinByCode(joinCode, displayName: displayName, initialMicOn: micOn, initialCamOn: camOn)
        }
    }

    @MainActor
    private func updatePreview() async {
        if camOn {
            let track = LocalVideoTrack.createCameraTrack()
            previewTrack = track
            try? await track.start()
        } else if let track = previewTrack {
            try? await track.stop()
            previewTrack = nil
        }
    }

    private func teardownPreview() {
        guard let track = previewTrack else { return }
        previewTrack = nil
        Task { try? await track.stop() }
    }
}
