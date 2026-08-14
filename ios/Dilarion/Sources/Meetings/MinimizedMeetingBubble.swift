import SwiftUI
import LiveKit

// Google Meet-style floating bubble — the meeting stays connected in the
// background while the rest of the app is fully usable underneath. Draggable
// within the screen bounds; tap to re-expand, X to leave without expanding.
struct MinimizedMeetingBubble: View {
    @ObservedObject private var vm = MeetingViewModel.shared
    @State private var position: CGPoint? = nil
    @State private var dragTranslation: CGSize = .zero

    private static let size = CGSize(width: 120, height: 160)
    private static let margin: CGFloat = 16

    private var mainTile: MeetingTile? {
        vm.tiles.first { $0.isScreenShare }
            ?? vm.tiles.first { $0.isSpeaking && !$0.isLocal }
            ?? vm.tiles.first { !$0.isLocal }
            ?? vm.tiles.first
    }

    var body: some View {
        GeometryReader { geo in
            let bounds = geo.frame(in: .local)
            let resolvedPosition = position ?? defaultPosition(in: bounds)

            bubbleContent
                .position(x: resolvedPosition.x + dragTranslation.width, y: resolvedPosition.y + dragTranslation.height)
                .gesture(
                    DragGesture()
                        .onChanged { value in dragTranslation = value.translation }
                        .onEnded { value in
                            let moved = CGPoint(x: resolvedPosition.x + value.translation.width, y: resolvedPosition.y + value.translation.height)
                            dragTranslation = .zero
                            position = clamp(moved, in: bounds)
                        }
                )
                .animation(.interactiveSpring(), value: dragTranslation)
        }
        .allowsHitTesting(true)
    }

    private var bubbleContent: some View {
        ZStack(alignment: .topTrailing) {
            ZStack {
                RoundedRectangle(cornerRadius: 14).fill(Color(hex: 0x1E1E1E))
                if let track = mainTile?.videoTrack, mainTile?.camOn == true || mainTile?.isScreenShare == true {
                    SwiftUIVideoView(track, layoutMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                } else {
                    Circle()
                        .fill(Color.dilarionRed)
                        .frame(width: 40, height: 40)
                        .overlay(
                            Text(initials(for: mainTile?.displayName ?? "?"))
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                        )
                }
                if !vm.isMicOn {
                    VStack {
                        Spacer()
                        HStack {
                            Image(systemName: "mic.slash.fill")
                                .font(.system(size: 10))
                                .foregroundColor(.white)
                                .padding(5)
                                .background(Color.black.opacity(0.5))
                                .clipShape(Circle())
                            Spacer()
                        }
                    }
                    .padding(6)
                }
            }
            .frame(width: Self.size.width, height: Self.size.height)
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.15), lineWidth: 1))
            .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
            .onTapGesture { vm.isMinimized = false }

            Button {
                vm.leave()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .background(Circle().fill(Color.black.opacity(0.6)))
            }
            .offset(x: 8, y: -8)
        }
    }

    private func defaultPosition(in bounds: CGRect) -> CGPoint {
        CGPoint(
            x: bounds.maxX - Self.size.width / 2 - Self.margin,
            y: bounds.maxY - Self.size.height / 2 - Self.margin - 80
        )
    }

    private func clamp(_ point: CGPoint, in bounds: CGRect) -> CGPoint {
        let halfW = Self.size.width / 2
        let halfH = Self.size.height / 2
        let minX = bounds.minX + halfW + Self.margin
        let maxX = bounds.maxX - halfW - Self.margin
        let minY = bounds.minY + halfH + Self.margin
        let maxY = bounds.maxY - halfH - Self.margin
        return CGPoint(x: min(max(point.x, minX), maxX), y: min(max(point.y, minY), maxY))
    }
}
