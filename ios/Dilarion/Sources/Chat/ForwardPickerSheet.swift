import SwiftUI

// "Forward to…" picker — lists DM contacts (derived from /messages/inbox,
// same source HomeViewModel uses) and groups, then hands the chosen target
// back to the caller. For a group target it also fetches member usernames so
// the caller can wrap the AES key for every member's devices.
struct ForwardPickerSheet: View {
    let message: Message
    let onPick: (_ toUsername: String?, _ toGroupId: Int?, _ groupMemberUsernames: [String]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var contacts: [String] = []
    @State private var groups: [Group] = []
    @State private var isLoading = true
    @State private var isResolvingGroup = false

    var body: some View {
        NavigationStack {
            List {
                if !contacts.isEmpty {
                    Section("Direct Messages") {
                        ForEach(contacts, id: \.self) { username in
                            Button {
                                onPick(username, nil, [])
                            } label: {
                                Label(username, systemImage: "person.circle")
                            }
                        }
                    }
                }
                if !groups.isEmpty {
                    Section("Groups") {
                        ForEach(groups) { group in
                            Button {
                                Task { await resolveGroupAndPick(group) }
                            } label: {
                                Label(group.name, systemImage: "person.3")
                            }
                        }
                    }
                }
                if !isLoading && contacts.isEmpty && groups.isEmpty {
                    Text("No conversations to forward to yet")
                        .foregroundColor(.textSecondary)
                }
            }
            .overlay {
                if isLoading || isResolvingGroup { ProgressView() }
            }
            .navigationTitle("Forward to…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .task { await load() }
    }

    private func resolveGroupAndPick(_ group: Group) async {
        isResolvingGroup = true
        let members: [GroupMember]? = try? await APIClient.shared.get("/groups/\(group.id)/members")
        isResolvingGroup = false
        onPick(nil, group.id, (members ?? []).map { $0.username })
    }

    private func load() async {
        let me = KeychainHelper.shared.read(key: "username") ?? ""
        async let inboxResp: InboxResponse? = try? APIClient.shared.get("/messages/inbox")
        async let grps: [Group]? = try? APIClient.shared.get("/groups")
        let (inbox, g) = await (inboxResp, grps)

        var unique = Set<String>()
        for m in inbox?.messages ?? [] where m.groupId == nil {
            if let s = m.sender, s != me { unique.insert(s) }
            if let r = m.recipient, r != me, r != "group" { unique.insert(r) }
        }
        contacts = unique.sorted()
        groups = g ?? []
        isLoading = false
    }
}
