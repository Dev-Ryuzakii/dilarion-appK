import SwiftUI
import Combine

// Ephemeral shared canvas — strokes relay live via WS (POST /whiteboard/stroke
// -> ws_manager push), nothing is persisted, so this always opens blank.
// Coordinates are normalized to 0..1 so different screen sizes still align.
// Mirrors desktop (WhiteboardModal.tsx) and Android (WhiteboardScreen.kt).

private struct UiSegment: Identifiable {
    let id = UUID()
    let x0: CGFloat, y0: CGFloat, x1: CGFloat, y1: CGFloat
    let color: Color
    let width: CGFloat
}

private let palette: [(hex: String, color: Color)] = [
    ("#e5484d", Color(red: 0.898, green: 0.282, blue: 0.302)),
    ("#0ea5e9", Color(red: 0.055, green: 0.647, blue: 0.914)),
    ("#22c55e", Color(red: 0.133, green: 0.773, blue: 0.369)),
    ("#f59e0b", Color(red: 0.961, green: 0.620, blue: 0.043)),
    ("#111827", Color(red: 0.067, green: 0.094, blue: 0.153)),
]

private func colorFromHex(_ hex: String) -> Color {
    palette.first(where: { $0.hex == hex })?.color ?? .black
}

struct WhiteboardView: View {
    let username: String?
    let groupId: Int?

    @Environment(\.dismiss) private var dismiss
    @State private var segments: [UiSegment] = []
    @State private var selectedHex = palette[0].hex
    @State private var lastPoint: CGPoint? = nil
    @State private var cancellables = Set<AnyCancellable>()

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    ForEach(palette, id: \.hex) { entry in
                        Circle()
                            .fill(entry.color)
                            .frame(width: 28, height: 28)
                            .overlay(
                                Circle().stroke(Color.black, lineWidth: entry.hex == selectedHex ? 2 : 0)
                            )
                            .onTapGesture { selectedHex = entry.hex }
                    }
                    Spacer()
                }
                .padding(10)

                GeometryReader { geo in
                    Canvas { context, size in
                        for seg in segments {
                            var path = Path()
                            path.move(to: CGPoint(x: seg.x0 * size.width, y: seg.y0 * size.height))
                            path.addLine(to: CGPoint(x: seg.x1 * size.width, y: seg.y1 * size.height))
                            context.stroke(path, with: .color(seg.color), style: StrokeStyle(lineWidth: seg.width, lineCap: .round))
                        }
                    }
                    .background(Color.white)
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                let w = max(geo.size.width, 1)
                                let h = max(geo.size.height, 1)
                                let prev = lastPoint ?? value.location
                                let nx0 = prev.x / w, ny0 = prev.y / h
                                let nx1 = value.location.x / w, ny1 = value.location.y / h
                                segments.append(UiSegment(x0: nx0, y0: ny0, x1: nx1, y1: ny1, color: colorFromHex(selectedHex), width: 4))
                                Task {
                                    try? await APIClient.shared.sendWhiteboardStroke(
                                        username: username, groupId: groupId,
                                        stroke: WhiteboardStroke(x0: nx0, y0: ny0, x1: nx1, y1: ny1, color: selectedHex, width: 4)
                                    )
                                }
                                lastPoint = value.location
                            }
                            .onEnded { _ in lastPoint = nil }
                    )
                }
            }
            .navigationTitle("Whiteboard")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear") {
                        segments = []
                        Task { try? await APIClient.shared.sendWhiteboardClear(username: username, groupId: groupId) }
                    }
                }
            }
        }
        .onAppear(perform: subscribeToWS)
    }

    private func subscribeToWS() {
        WebSocketManager.shared.events
            .receive(on: DispatchQueue.main)
            .sink { event in
                guard case .whiteboardEvent(let json) = event else { return }
                let type = json["type"] as? String
                let data = json["data"] as? [String: Any]
                let msgGroupId = data?["group_id"] as? Int
                let matches = groupId != nil ? msgGroupId == groupId : msgGroupId == nil
                guard matches else { return }
                switch type {
                case "whiteboard_stroke":
                    guard let s = data?["stroke"] as? [String: Any],
                          let x0 = s["x0"] as? Double, let y0 = s["y0"] as? Double,
                          let x1 = s["x1"] as? Double, let y1 = s["y1"] as? Double,
                          let hex = s["color"] as? String,
                          let width = s["width"] as? Double else { return }
                    segments.append(UiSegment(x0: x0, y0: y0, x1: x1, y1: y1, color: colorFromHex(hex), width: width))
                case "whiteboard_clear":
                    segments = []
                default:
                    break
                }
            }
            .store(in: &cancellables)
    }
}
