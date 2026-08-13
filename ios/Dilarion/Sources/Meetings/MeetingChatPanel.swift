import SwiftUI
import Combine

// In-meeting encrypted chat — reuses the exact same per-device RSA key-fanout
// + master-token decoy/unlock model as DM/group chat (POST
// /messages/conference/send), not a simplified scheme. Mirrors desktop
// (MeetingChatPanel.tsx) and Android (MeetingChatViewModel.kt). The WS event
// `new_conference_message` carries no content — it's just a "go refetch" nudge.
struct MeetingChatPanel: View {
    let conferenceId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var messages: [ConferenceChatMessage] = []
    @State private var decrypted: [Int: String] = [:]
    @State private var inputText = ""
    @State private var isUnlocked = !(KeychainHelper.shared.read(key: "master_token") ?? "").isEmpty
    @State private var isSending = false
    @State private var error: String? = nil
    @State private var cancellables = Set<AnyCancellable>()

    private var me: String { KeychainHelper.shared.read(key: "username") ?? "" }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 8) {
                            ForEach(messages) { msg in
                                bubble(for: msg).id(msg.id)
                            }
                        }
                        .padding(12)
                    }
                    .onChange(of: messages.count) { _ in
                        if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                }

                HStack(spacing: 8) {
                    TextField("Message", text: $inputText, axis: .vertical)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(Color.surfaceWhite)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .overlay(RoundedRectangle(cornerRadius: 20).stroke(Color.borderGrey, lineWidth: 1))
                    Button {
                        Task { await send() }
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .foregroundColor(.white)
                            .frame(width: 40, height: 40)
                            .background(Color.dilarionRed)
                            .clipShape(Circle())
                    }
                    .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
                }
                .padding(10)
                .background(Color.backgroundGrey)
            }
            .navigationTitle("Meeting Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
            .alert("Error", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK") { error = nil }
            } message: { Text(error ?? "") }
        }
        .task { await load() }
        .onAppear(perform: subscribeToWS)
    }

    @ViewBuilder
    private func bubble(for msg: ConferenceChatMessage) -> some View {
        let isMine = msg.sender == me
        VStack(alignment: isMine ? .trailing : .leading, spacing: 2) {
            Text(msg.sender ?? "")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.textSecondary)
            Text(displayText(for: msg))
                .font(.system(size: 14))
                .foregroundColor(.textPrimary)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(isMine ? Color.chatBubbleSelf : Color.chatBubbleOther)
                .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)
    }

    private func displayText(for msg: ConferenceChatMessage) -> String {
        guard isUnlocked else { return msg.decoy_content ?? "" }
        return decrypted[msg.id] ?? "[Decryption Failed]"
    }

    private func load() async {
        messages = (try? await APIClient.shared.getConferenceMessages(conferenceId: conferenceId)) ?? []
        decryptAll()
    }

    private func decryptAll() {
        guard isUnlocked else { return }
        for msg in messages where decrypted[msg.id] == nil {
            if let plain = MessageDecryption.decrypt(content: msg.content, encryptedKey: msg.encrypted_key, iv: msg.iv) {
                decrypted[msg.id] = plain
            }
        }
    }

    private func send() async {
        let plaintext = inputText.trimmingCharacters(in: .whitespaces)
        guard !plaintext.isEmpty else { return }
        isSending = true
        inputText = ""
        defer { isSending = false }

        do {
            var usernames = Set(MeetingViewModel.shared.tiles.filter { !$0.isScreenShare }.map(\.identity))
            usernames.insert(me)
            var deviceKeys = [String: String]()
            for u in usernames {
                if let resp: UserDevicesResponse = try? await APIClient.shared.get("/users/\(u)/devices") {
                    for d in resp.devices where !d.public_key.isEmpty {
                        deviceKeys[d.device_uuid] = d.public_key
                    }
                }
            }
            guard !deviceKeys.isEmpty else { throw URLError(.badServerResponse) }

            let (ciphertext, encKeysMap, iv) = try EncryptionManager.shared.encryptGroupMessage(plaintext, memberPublicKeys: deviceKeys)
            let encKeysJson = String(data: try JSONEncoder().encode(encKeysMap), encoding: .utf8)
            let decoys = ["hey are you free tonight", "what are you up to later", "just wanted to check in with you"]

            try await APIClient.shared.sendConferenceMessage(
                conferenceId: conferenceId, ciphertext: ciphertext,
                encryptedKey: encKeysJson, iv: iv, decoyContent: decoys.randomElement()
            )
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func subscribeToWS() {
        WebSocketManager.shared.events
            .receive(on: DispatchQueue.main)
            .sink { event in
                guard case .callSignal(let json) = event, json["type"] as? String == "new_conference_message" else { return }
                let data = json["data"] as? [String: Any] ?? json
                guard (data["conference_id"] as? Int) == conferenceId else { return }
                Task { await load() }
            }
            .store(in: &cancellables)
    }
}
