import SwiftUI
import UIKit

// WhatsApp-style long-press menu: a floating quick-reaction row (real emoji,
// plus a "+" to open the full picker) above a dropdown action list (real SF
// Symbol icons, not emoji). Replaces the plain .contextMenu, which can't host
// a custom emoji row separate from the action list.
struct MessageActionOverlay: View {
    let message: Message
    let isMine: Bool
    let isStarred: Bool
    let onDismiss: () -> Void
    let onReact: (String) -> Void
    let onReply: () -> Void
    let onForward: () -> Void
    let onEdit: () -> Void
    let onTogglePin: () -> Void
    let onToggleStar: () -> Void
    let onDelete: () -> Void

    @State private var showEmojiPicker = false
    @State private var showInfo = false

    private var isDeleted: Bool { message.isDeleted == true }

    var body: some View {
        ZStack {
            Color.black.opacity(0.001) // full-area tap target
                .background(.ultraThinMaterial)
                .ignoresSafeArea()
                .onTapGesture { onDismiss() }

            VStack(spacing: 14) {
                reactionRow

                messagePreview

                actionList
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 340)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.96)))
        .alert("Message Info", isPresented: $showInfo) {
            Button("OK") { onDismiss() }
        } message: {
            Text(infoText)
        }
        .sheet(isPresented: $showEmojiPicker) {
            EmojiPickerSheet { emoji in
                showEmojiPicker = false
                onReact(emoji)
                onDismiss()
            }
        }
    }

    private var reactionRow: some View {
        HStack(spacing: 10) {
            ForEach(quickReactionEmoji, id: \.self) { emoji in
                Button {
                    onReact(emoji)
                    onDismiss()
                } label: {
                    Text(emoji).font(.system(size: 26))
                }
            }
            Button { showEmojiPicker = true } label: {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 24))
                    .foregroundColor(.textSecondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.surfaceWhite)
        .clipShape(Capsule())
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
    }

    private var messagePreview: some View {
        VStack(alignment: isMine ? .trailing : .leading, spacing: 2) {
            if let sender = message.sender {
                Text(sender)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.dilarionRed)
            }
            Text(message.content ?? message.decoyContent ?? "")
                .font(.system(size: 14))
                .foregroundColor(.textPrimary)
                .lineLimit(4)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(isMine ? Color.chatBubbleSelf : Color.chatBubbleOther)
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)
    }

    private var actionList: some View {
        VStack(spacing: 0) {
            actionRow(icon: "arrowshape.turn.up.left", label: "Reply") { onReply(); onDismiss() }
            Divider().padding(.leading, 48)
            actionRow(icon: "arrowshape.turn.up.right", label: "Forward") { onForward(); onDismiss() }
            if isMine {
                Divider().padding(.leading, 48)
                actionRow(icon: "pencil", label: "Edit") { onEdit(); onDismiss() }
            }
            Divider().padding(.leading, 48)
            actionRow(icon: message.isPinned == true ? "pin.slash" : "pin", label: message.isPinned == true ? "Unpin" : "Pin") {
                onTogglePin(); onDismiss()
            }
            Divider().padding(.leading, 48)
            actionRow(icon: isStarred ? "star.fill" : "star", label: isStarred ? "Unstar" : "Star") {
                onToggleStar(); onDismiss()
            }
            Divider().padding(.leading, 48)
            actionRow(icon: "doc.on.doc", label: "Copy") {
                UIPasteboard.general.string = message.content
                onDismiss()
            }
            Divider().padding(.leading, 48)
            actionRow(icon: "info.circle", label: "Info") { showInfo = true }
            if isMine {
                Divider().padding(.leading, 48)
                actionRow(icon: "trash", label: "Delete", destructive: true) { onDelete(); onDismiss() }
            }
        }
        .background(Color.surfaceWhite)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
    }

    private func actionRow(icon: String, label: String, destructive: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: icon)
                    .font(.system(size: 16))
                    .frame(width: 22)
                    .foregroundColor(destructive ? .red : .dilarionRed)
                Text(label)
                    .font(.system(size: 15))
                    .foregroundColor(destructive ? .red : .textPrimary)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var infoText: String {
        var lines: [String] = []
        lines.append("Sent: \(formatFullTimestamp(message.timestamp ?? ""))")
        if message.isEdited == true { lines.append("Edited") }
        if isMine { lines.append(message.read ? "Read" : "Delivered") }
        if message.isPinned == true { lines.append("Pinned") }
        return lines.joined(separator: "\n")
    }
}

private func formatFullTimestamp(_ iso: String) -> String {
    let fmts = ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSZZZZZ",
                "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                "yyyy-MM-dd'T'HH:mm:ss"]
    for fmt in fmts {
        let df = DateFormatter(); df.dateFormat = fmt
        if let d = df.date(from: iso) {
            let out = DateFormatter()
            out.dateStyle = .medium
            out.timeStyle = .short
            return out.string(from: d)
        }
    }
    return iso
}

// MARK: - Full emoji picker ("+" on the quick-reaction row)

private let emojiPickerSet: [String] = [
    "👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "🔥", "👏", "😍",
    "😅", "🤔", "😎", "😭", "😡", "🥳", "👀", "💯", "✅", "❌",
    "🙌", "👌", "🤝", "😴", "🤯", "😇", "🥹", "🤗", "😳", "🫡",
    "💪", "🙏🏽", "😆", "🤣", "😊", "🥰", "😘", "🤩", "🫶", "🙃",
]

struct EmojiPickerSheet: View {
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    private let columns = Array(repeating: GridItem(.flexible()), count: 6)

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(emojiPickerSet, id: \.self) { emoji in
                        Button { onPick(emoji) } label: {
                            Text(emoji).font(.system(size: 30))
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("React")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundColor(.dilarionRed)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
