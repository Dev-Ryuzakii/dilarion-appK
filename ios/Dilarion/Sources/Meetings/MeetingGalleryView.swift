import SwiftUI
import LiveKit

// Adaptive gallery layout — mirrors desktop (GalleryView.tsx) and Android
// (GalleryScreen.kt) exactly:
//   0/1 participants -> one fullscreen tile
//   2 participants    -> even vertical split
//   3+                -> a thumbnail strip + one large "main" tile, where
//                        main = active screen-share > active remote speaker
//                        > first remote > self (fallback)
// No manual pin/spotlight exists on any platform — this priority chain is
// the only override, and screen-share always wins.
struct MeetingGalleryView: View {
    let onDismiss: () -> Void

    @ObservedObject private var vm = MeetingViewModel.shared
    @State private var showParticipants = false
    @State private var showChat = false
    @State private var showWhiteboard = false
    @State private var showReactionPicker = false

    private var mainTile: MeetingTile? {
        vm.tiles.first { $0.isScreenShare }
            ?? vm.tiles.first { $0.isSpeaking && !$0.isLocal }
            ?? vm.tiles.first { !$0.isLocal }
            ?? vm.tiles.first
    }
    private var sideTiles: [MeetingTile] {
        guard let main = mainTile else { return [] }
        return vm.tiles.filter { $0.id != main.id }
    }

    var body: some View {
        ZStack {
            Color(hex: 0x121212).ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                galleryBody
                bottomBar
            }

            // Floating reactions
            VStack {
                Spacer()
                ForEach(vm.floatingReactions) { r in
                    Text("\(r.emoji) \(r.from)")
                        .font(.system(size: 22))
                        .foregroundColor(.white)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
                .padding(.bottom, 120)
            }
            .allowsHitTesting(false)
            .animation(.easeOut(duration: 0.4), value: vm.floatingReactions.count)
        }
        .statusBarHidden(true)
        .sheet(isPresented: $showParticipants) {
            MeetingParticipantsSheet()
        }
        .sheet(isPresented: $showChat) {
            MeetingChatPanel(conferenceId: vm.conferenceId ?? 0)
                .onAppear { vm.unreadChatCount = 0 }
        }
        .sheet(isPresented: $showWhiteboard) {
            WhiteboardView(username: nil, groupId: nil, conferenceId: vm.conferenceId)
        }
        .onChange(of: vm.phase) { phase in
            if case .ended = phase { onDismiss() }
        }
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack(spacing: 12) {
            if vm.isRecording {
                HStack(spacing: 4) {
                    Circle().fill(Color.red).frame(width: 8, height: 8)
                    Text("REC").font(.system(size: 11, weight: .bold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Color.red.opacity(0.25))
                .clipShape(Capsule())
            }
            Text("\(vm.tiles.count) in meeting")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.white.opacity(0.8))

            Spacer()

            if vm.isHost {
                Button { vm.toggleRecording() } label: {
                    Image(systemName: vm.isRecording ? "record.circle.fill" : "record.circle")
                        .foregroundColor(vm.isRecording ? .red : .white)
                }
                .disabled(vm.recordingBusy)
            }
            Button { showWhiteboard = true } label: {
                Image(systemName: "scribble").foregroundColor(.white)
            }
            Button { showChat = true } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "message").foregroundColor(.white)
                    if vm.unreadChatCount > 0 {
                        Circle().fill(Color.dilarionRed).frame(width: 8, height: 8).offset(x: 6, y: -4)
                    }
                }
            }
            Button { showParticipants = true } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "person.2").foregroundColor(.white)
                    if !vm.waitingList.isEmpty {
                        Circle().fill(Color.dilarionRed).frame(width: 8, height: 8).offset(x: 6, y: -4)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Color.black.opacity(0.35))

        .alert("Recording", isPresented: Binding(
            get: { vm.recordingError != nil },
            set: { if !$0 { vm.recordingError = nil } }
        )) {
            Button("OK") { vm.recordingError = nil }
        } message: {
            Text(vm.recordingError ?? "")
        }
    }

    // MARK: - Gallery body

    @ViewBuilder
    private var galleryBody: some View {
        if vm.tiles.count <= 1 {
            if let tile = vm.tiles.first {
                MeetingTileCard(tile: tile).padding(8)
            } else {
                ProgressView().tint(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if vm.tiles.count == 2 {
            VStack(spacing: 6) {
                ForEach(vm.tiles) { tile in
                    MeetingTileCard(tile: tile)
                }
            }
            .padding(8)
        } else {
            VStack(spacing: 6) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(sideTiles) { tile in
                            MeetingTileCard(tile: tile, compact: true)
                                .frame(width: 110, height: 150)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .frame(height: 150)

                if let main = mainTile {
                    MeetingTileCard(tile: main).padding(.horizontal, 8)
                }
            }
            .padding(.vertical, 6)
        }
    }

    // MARK: - Bottom bar

    private var bottomBar: some View {
        VStack(spacing: 12) {
            if showReactionPicker {
                HStack(spacing: 14) {
                    ForEach(MeetingViewModel.reactionEmojis, id: \.self) { emoji in
                        Button {
                            vm.sendReaction(emoji)
                            showReactionPicker = false
                        } label: {
                            Text(emoji).font(.system(size: 26))
                        }
                    }
                }
                .padding(10)
                .background(Color.black.opacity(0.6))
                .clipShape(Capsule())
            }

            HStack(spacing: 18) {
                controlButton(icon: vm.isMicOn ? "mic.fill" : "mic.slash.fill", active: !vm.isMicOn) { vm.toggleMic() }
                controlButton(icon: vm.isCamOn ? "video.fill" : "video.slash.fill", active: !vm.isCamOn) { vm.toggleCamera() }
                controlButton(icon: vm.isScreenSharing ? "rectangle.on.rectangle.fill" : "rectangle.on.rectangle", active: vm.isScreenSharing) { vm.toggleScreenShare() }
                controlButton(icon: "face.smiling") { showReactionPicker.toggle() }
                Button { vm.leave() } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 20))
                        .foregroundColor(.white)
                        .frame(width: 56, height: 56)
                        .background(Color.dilarionRed)
                        .clipShape(Circle())
                }
            }
            .padding(.bottom, 20)
        }
        .padding(.top, 10)
        .background(Color.black.opacity(0.35))
    }

    private func controlButton(icon: String, active: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(.white)
                .frame(width: 48, height: 48)
                .background(active ? Color.white.opacity(0.35) : Color.white.opacity(0.15))
                .clipShape(Circle())
        }
    }
}

// MARK: - Tile card

struct MeetingTileCard: View {
    let tile: MeetingTile
    var compact: Bool = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(hex: 0x1E1E1E))

            if let track = tile.videoTrack, tile.camOn || tile.isScreenShare {
                SwiftUIVideoView(track, layoutMode: tile.isScreenShare ? .fit : .fill)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                Circle()
                    .fill(avatarColor(for: tile.identity))
                    .frame(width: compact ? 44 : 84, height: compact ? 44 : 84)
                    .overlay(
                        Text(initials(for: tile.displayName))
                            .font(.system(size: compact ? 16 : 28, weight: .bold))
                            .foregroundColor(.white)
                    )
            }

            VStack {
                Spacer()
                HStack(spacing: 4) {
                    if !tile.micOn && !tile.isScreenShare {
                        Image(systemName: "mic.slash.fill")
                            .font(.system(size: compact ? 9 : 11))
                            .foregroundColor(.white)
                            .padding(4)
                            .background(Color.black.opacity(0.5))
                            .clipShape(Circle())
                    }
                    Text(tile.isLocal ? "You" : tile.displayName)
                        .font(.system(size: compact ? 10 : 12, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.black.opacity(0.5))
                        .clipShape(Capsule())
                    Spacer()
                }
                .padding(6)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(tile.isSpeaking ? Color(hex: 0x25D366) : .clear, lineWidth: 2)
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Participants sheet (host waiting-room admit/deny)

struct MeetingParticipantsSheet: View {
    @ObservedObject private var vm = MeetingViewModel.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if vm.isHost && !vm.waitingList.isEmpty {
                    Section("Waiting to join (\(vm.waitingList.count))") {
                        ForEach(vm.waitingList) { guest in
                            HStack {
                                Text(guest.username)
                                Spacer()
                                Button("Deny", role: .destructive) { vm.denyGuest(guest) }
                                Button("Admit") { vm.admitGuest(guest) }
                                    .buttonStyle(.borderedProminent)
                                    .tint(.dilarionRed)
                            }
                        }
                    }
                }
                Section("In the meeting (\(vm.tiles.count))") {
                    ForEach(vm.tiles) { tile in
                        HStack {
                            Text(tile.isLocal ? "\(tile.displayName) (You)" : tile.displayName)
                            Spacer()
                            if !tile.micOn { Image(systemName: "mic.slash.fill").foregroundColor(.textSecondary) }
                        }
                    }
                }
            }
            .navigationTitle("Participants")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }
}

