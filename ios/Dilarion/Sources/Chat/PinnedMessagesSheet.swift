import SwiftUI

// Sheet listing pinned messages for the current conversation (DM or group),
// backed by GET /messages/pinned. Decrypts client-side with the same
// device_uuid-keyed AES key format as the main chat list.
struct PinnedMessagesSheet: View {
    @ObservedObject var vm: ChatViewModel

    var body: some View {
        NavigationStack {
            List {
                ForEach(vm.state.pinnedMessages) { pinned in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(pinned.sender ?? "")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.dilarionRed)
                        Text(decryptedText(for: pinned))
                            .font(.system(size: 14))
                            .foregroundColor(.textPrimary)
                        if let pinnedBy = pinned.pinnedBy {
                            Text("Pinned by \(pinnedBy)")
                                .font(.system(size: 11))
                                .foregroundColor(.textSecondary)
                        }
                    }
                    .padding(.vertical, 4)
                    .swipeActions {
                        Button("Unpin", role: .destructive) {
                            Task {
                                await vm.togglePin(asMessage(pinned))
                            }
                        }
                    }
                }
            }
            .overlay {
                if vm.state.pinnedMessages.isEmpty {
                    Text("No pinned messages")
                        .foregroundColor(.textSecondary)
                }
            }
            .navigationTitle("Pinned Messages")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await vm.loadPinnedMessages() }
    }

    private func decryptedText(for pinned: PinnedMessage) -> String {
        guard vm.state.isMasterTokenVerified else { return pinned.decoyContent ?? "" }
        return MessageDecryption.decrypt(content: pinned.content, encryptedKey: pinned.encryptedKey, iv: pinned.iv)
            ?? "[Decryption Failed]"
    }

    private func asMessage(_ pinned: PinnedMessage) -> Message {
        var msg = Message(
            id: pinned.id, sender: pinned.sender, recipient: nil, groupId: nil,
            content: nil, encryptedContent: nil, decoyContent: pinned.decoyContent,
            encryptedKey: pinned.encryptedKey, iv: pinned.iv, contentType: pinned.contentType,
            mediaType: nil, timestamp: pinned.timestamp, read: true, isPrivateTagged: nil
        )
        msg.isPinned = true
        return msg
    }
}
