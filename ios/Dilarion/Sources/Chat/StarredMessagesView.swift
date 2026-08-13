import SwiftUI

// Personal "Saved items"-style list spanning every conversation, backed by
// GET /messages/starred. Not shared with the other participant(s).
struct StarredMessagesView: View {
    @State private var items: [StarredMessageItem] = []
    @State private var isLoading = true
    @State private var error: String? = nil
    private let isUnlocked = !(KeychainHelper.shared.read(key: "master_token") ?? "").isEmpty

    var body: some View {
        List {
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(item.sender ?? "")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.dilarionRed)
                        Spacer()
                        Text(item.groupName ?? item.recipient ?? "")
                            .font(.system(size: 11))
                            .foregroundColor(.textSecondary)
                    }
                    Text(decryptedText(for: item))
                        .font(.system(size: 14))
                        .foregroundColor(.textPrimary)
                }
                .padding(.vertical, 4)
                .swipeActions {
                    Button("Unstar", role: .destructive) {
                        Task { await unstar(item) }
                    }
                }
            }
        }
        .overlay {
            if isLoading {
                ProgressView()
            } else if items.isEmpty {
                Text("No starred messages yet")
                    .foregroundColor(.textSecondary)
            }
        }
        .navigationTitle("Starred Messages")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Error", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK") { error = nil }
        } message: {
            Text(error ?? "")
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        items = (try? await APIClient.shared.getStarredMessages()) ?? []
        isLoading = false
    }

    private func unstar(_ item: StarredMessageItem) async {
        do {
            try await APIClient.shared.unstarMessage(messageId: item.id)
            items.removeAll { $0.id == item.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func decryptedText(for item: StarredMessageItem) -> String {
        guard isUnlocked else { return item.decoyContent ?? "" }
        return MessageDecryption.decrypt(content: item.content, encryptedKey: item.encryptedKey, iv: item.iv)
            ?? "[Decryption Failed]"
    }
}
