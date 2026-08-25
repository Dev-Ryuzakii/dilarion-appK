import SwiftUI

// Mirrors HomeScreen.kt:
// - Red nav bar "Dilarion" + "end-to-end encrypted" subtitle
// - Settings + Logout icons in nav bar
// - Bottom tab: Chats / Groups / Calls
// - FAB on Chats tab
// - Conversation rows with avatar initial, unread badge
// - Empty states
// - Call history rows

enum HomeTab { case chats, groups, calls }

struct HomeView: View {
    let onLogout: () -> Void
    @StateObject private var vm = HomeViewModel()
    @State private var selectedTab: HomeTab = .chats
    @State private var showLogoutDialog = false
    @State private var showNewChat = false
    @State private var showMeetingsLanding = false
    @State private var navigateTo: String? = nil
    @State private var navigateToGroup: Group? = nil

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                Color.backgroundGrey.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Content
                    SwiftUI.Group {
                        switch selectedTab {
                        case .chats:
                            ChatsTab(state: vm.state, onOpenChat: { peer in navigateTo = peer })
                        case .groups:
                            GroupsTab(state: vm.state, onOpenGroup: { group in navigateToGroup = group })
                        case .calls:
                            CallsTab(state: vm.state)
                                .onAppear { vm.loadCallHistory() }
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    // Bottom nav
                    BottomNavBar(selected: $selectedTab)
                }

                // FAB — only on Chats tab
                if selectedTab == .chats {
                    Button { showNewChat = true } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 56, height: 56)
                            .background(Color.dilarionRed)
                            .clipShape(Circle())
                            .shadow(color: .black.opacity(0.2), radius: 6, y: 3)
                    }
                    .padding(.trailing, 20)
                    .padding(.bottom, 80)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text("Dilarion")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.white)
                        Text("end-to-end encrypted")
                            .font(.system(size: 10))
                            .foregroundColor(.white.opacity(0.75))
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    HStack(spacing: 4) {
                        Button { showMeetingsLanding = true } label: {
                            Image(systemName: "video")
                                .foregroundColor(.white)
                        }
                        NavigationLink(destination: SettingsViewFull(onLogout: onLogout)) {
                            Image(systemName: "gearshape")
                                .foregroundColor(.white)
                        }
                        Button { showLogoutDialog = true } label: {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                                .foregroundColor(.white)
                        }
                    }
                }
            }
            .toolbarBackground(Color.dilarionRed, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            // Hidden nav links
            .navigationDestination(isPresented: Binding(
                get: { navigateTo != nil },
                set: { if !$0 { navigateTo = nil } }
            )) {
                if let peer = navigateTo {
                    ChatView(username: peer, groupId: nil, groupName: nil)
                }
            }
            .navigationDestination(isPresented: Binding(
                get: { navigateToGroup != nil },
                set: { if !$0 { navigateToGroup = nil } }
            )) {
                if let group = navigateToGroup {
                    ChatView(username: "", groupId: group.id, groupName: group.name)
                }
            }
        }
        .sheet(isPresented: $showNewChat) {
            NewChatSheet(onSelect: { peer in
                showNewChat = false
                navigateTo = peer
            })
        }
        .sheet(isPresented: $showMeetingsLanding) {
            MeetingsLandingSheet(
                onJoinByCode: { joinCode in
                    MeetingViewModel.shared.presentLobby(.join(joinCode: joinCode))
                },
                onStartInstant: { invitees in
                    MeetingViewModel.shared.presentLobby(.instant(invitees: invitees))
                }
            )
        }
        .confirmationDialog("Log out", isPresented: $showLogoutDialog, titleVisibility: .visible) {
            Button("Log out", role: .destructive) {
                vm.logout(completion: onLogout)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to log out?")
        }
        .onAppear { vm.load() }
    }
}

// MARK: — Chats Tab
struct ChatsTab: View {
    let state: HomeUiState
    let onOpenChat: (String) -> Void

    struct Thread: Identifiable {
        var id: String { peer }
        let peer: String
        let lastMessage: Message
        let unread: Int
    }

    var threads: [Thread] {
        let me = state.currentUsername
        let dms = state.messages.filter { $0.groupId == nil }
        let grouped = Dictionary(grouping: dms) { msg -> String in
            ((msg.sender == me ? msg.recipient : msg.sender) ?? "").isEmpty
                ? "Unknown" : ((msg.sender == me ? msg.recipient : msg.sender) ?? "Unknown")
        }
        return grouped.compactMap { peer, msgs -> Thread? in
            guard let last = msgs.max(by: { ($0.timestamp ?? "") < ($1.timestamp ?? "") }) else { return nil }
            let unread = msgs.filter { !$0.read && $0.sender != me }.count
            return Thread(peer: peer, lastMessage: last, unread: unread)
        }
        .sorted { ($0.lastMessage.timestamp ?? "") > ($1.lastMessage.timestamp ?? "") }
    }

    var body: some View {
        SwiftUI.Group {
            if state.isLoading {
                SkeletonList()
            } else if threads.isEmpty {
                EmptyStateView(
                    icon: "bubble.left.and.bubble.right",
                    title: "No chats yet",
                    subtitle: "Tap + to find people and start a chat"
                )
            } else {
                List(threads) { thread in
                    Button { onOpenChat(thread.peer) } label: {
                        ConversationRow(
                            title: thread.peer,
                            subtitle: "",
                            time: thread.lastMessage.timestamp ?? "",
                            unread: thread.unread,
                            isGroup: false
                        )
                    }
                    .listRowInsets(.init(top: 0, leading: 0, bottom: 0, trailing: 0))
                    .listRowBackground(Color.surfaceWhite)
                    .listRowSeparator(.hidden)
                }
                .listStyle(.plain)
                .background(Color.backgroundGrey)
            }
        }
    }
}

// MARK: — Groups Tab
struct GroupsTab: View {
    let state: HomeUiState
    let onOpenGroup: (Group) -> Void

    var body: some View {
        SwiftUI.Group {
            if state.isLoading {
                SkeletonList()
            } else if state.groups.isEmpty {
                EmptyStateView(icon: "person.3", title: "No groups yet", subtitle: "Tap + to create a group")
            } else {
                List(state.groups) { group in
                    Button { onOpenGroup(group) } label: {
                        ConversationRow(
                            title: group.name,
                            subtitle: "",
                            time: group.createdAt ?? "",
                            unread: 0,
                            isGroup: true
                        )
                    }
                    .listRowInsets(.init(top: 0, leading: 0, bottom: 0, trailing: 0))
                    .listRowBackground(Color.surfaceWhite)
                    .listRowSeparator(.hidden)
                }
                .listStyle(.plain)
                .background(Color.backgroundGrey)
            }
        }
    }
}

// MARK: — Calls Tab
struct CallsTab: View {
    let state: HomeUiState

    var body: some View {
        SwiftUI.Group {
            if state.isCallHistoryLoading {
                SkeletonList(count: 6)
            } else if state.callHistory.isEmpty {
                EmptyStateView(icon: "phone", title: "No calls yet", subtitle: "Your call history will appear here")
            } else {
                List(state.callHistory) { call in
                    CallHistoryRow(call: call)
                        .listRowInsets(.init(top: 0, leading: 0, bottom: 0, trailing: 0))
                        .listRowBackground(Color.surfaceWhite)
                        .listRowSeparator(.hidden)
                }
                .listStyle(.plain)
                .background(Color.backgroundGrey)
            }
        }
    }
}

// MARK: — Call history row
struct CallHistoryRow: View {
    let call: CallHistoryItem

    private var peer: String { call.otherPartyUsername ?? "Unknown" }
    private var isVideo: Bool { call.callType == "video" }
    private var missed: Bool { ["declined","missed","busy"].contains(call.status) }
    private var isOutgoing: Bool { call.isCaller }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                // Avatar
                Circle()
                    .fill(Color.dilarionRed)
                    .frame(width: 50, height: 50)
                    .overlay(
                        Text(String(peer.prefix(1)).uppercased())
                            .font(.system(size: 20, weight: .bold))
                            .foregroundColor(.white)
                    )

                VStack(alignment: .leading, spacing: 3) {
                    Text(peer)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.textPrimary)
                    HStack(spacing: 4) {
                        Image(systemName: isOutgoing ? "phone.arrow.up.right" : "phone.arrow.down.left")
                            .font(.system(size: 12))
                            .foregroundColor(missed ? .dilarionRed : .onlineGreen)
                        Text(buildSubtitle())
                            .font(.system(size: 12))
                            .foregroundColor(missed ? .dilarionRed : .textSecondary)
                    }
                }

                Spacer()

                Text(formatTime(call.startedAt ?? ""))
                    .font(.system(size: 11))
                    .foregroundColor(.textSecondary)

                // Redial straight from the history entry — the whole point of
                // opening the calls tab after a call you did not take.
                if call.otherPartyUsername != nil {
                    Button {
                        CallViewModel.shared.startOutgoingCall(
                            peerUsername: peer,
                            type: isVideo ? .video : .voice
                        )
                    } label: {
                        Image(systemName: isVideo ? "video.fill" : "phone.fill")
                            .font(.system(size: 17))
                            .foregroundColor(.onlineGreen)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.surfaceWhite)

            Divider()
                .padding(.leading, 78)
        }
    }

    private func buildSubtitle() -> String {
        var parts = [isOutgoing ? "Outgoing" : (missed ? "Missed" : "Incoming")]
        parts.append(isVideo ? "Video" : "Voice")
        if call.duration > 0 {
            parts.append(String(format: "%02d:%02d", call.duration / 60, call.duration % 60))
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: — Conversation row (mirrors ConversationRow in Kotlin)
struct ConversationRow: View {
    let title: String
    let subtitle: String
    let time: String
    let unread: Int
    let isGroup: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                // Avatar — group shows icon, DM shows initial
                ZStack {
                    Circle()
                        .fill(isGroup ? Color.dilarionRed.opacity(0.12) : Color.dilarionRed)
                        .frame(width: 50, height: 50)
                    if isGroup {
                        Image(systemName: "person.3.fill")
                            .foregroundColor(.dilarionRed)
                            .font(.system(size: 20))
                    } else {
                        Text(String(title.prefix(1)).uppercased())
                            .font(.system(size: 20, weight: .bold))
                            .foregroundColor(.white)
                    }
                }

                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(title)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.textPrimary)
                            .lineLimit(1)
                        Spacer()
                        Text(formatRelativeTime(time))
                            .font(.system(size: 11))
                            .foregroundColor(unread > 0 ? .dilarionRed : .textSecondary)
                    }
                    HStack {
                        if !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        if unread > 0 {
                            Text(unread > 99 ? "99+" : "\(unread)")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 3)
                                .background(Color.dilarionRed)
                                .clipShape(Capsule())
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color.surfaceWhite)

            Divider()
                .padding(.leading, 78)
        }
        .contentShape(Rectangle())
    }
}

// MARK: — Bottom Nav Bar
struct BottomNavBar: View {
    @Binding var selected: HomeTab

    var body: some View {
        HStack(spacing: 0) {
            TabBarItem(icon: "bubble.left.and.bubble.right.fill", label: "Chats", tab: .chats, selected: $selected)
            TabBarItem(icon: "person.3.fill", label: "Groups", tab: .groups, selected: $selected)
            TabBarItem(icon: "phone.fill", label: "Calls", tab: .calls, selected: $selected)
        }
        .frame(height: 64)
        .background(Color.surfaceWhite.shadow(color: .black.opacity(0.08), radius: 4, y: -2))
    }
}

struct TabBarItem: View {
    let icon: String
    let label: String
    let tab: HomeTab
    @Binding var selected: HomeTab

    private var isSelected: Bool { selected == tab }

    var body: some View {
        Button { selected = tab } label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(isSelected ? .dilarionRed : .textSecondary)
                Text(label)
                    .font(.system(size: 10))
                    .foregroundColor(isSelected ? .dilarionRed : .textSecondary)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: — Empty state (mirrors EmptyState composable)
struct EmptyStateView: View {
    let icon: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 56))
                .foregroundColor(.textSecondary.opacity(0.3))
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.textSecondary)
            Text(subtitle)
                .font(.system(size: 13))
                .foregroundColor(.textSecondary.opacity(0.7))
                .multilineTextAlignment(.center)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.backgroundGrey)
    }
}

// MARK: — Skeleton loader
struct SkeletonList: View {
    var count: Int = 8

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { _ in
                SkeletonRow()
            }
            Spacer()
        }
        .background(Color.backgroundGrey)
    }
}

struct SkeletonRow: View {
    @State private var shimmer = false

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color.borderGrey)
                .frame(width: 50, height: 50)
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4).fill(Color.borderGrey).frame(width: 120, height: 12)
                RoundedRectangle(cornerRadius: 4).fill(Color.borderGrey).frame(width: 200, height: 10)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .opacity(shimmer ? 0.5 : 1)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.8).repeatForever()) { shimmer = true }
        }
    }
}

// MARK: — New Chat sheet
struct NewChatSheet: View {
    let onSelect: (String) -> Void
    @Environment(\.dismiss) var dismiss
    @State private var users: [UserProfile] = []
    @State private var search = ""

    var filtered: [UserProfile] {
        search.isEmpty ? users : users.filter { $0.username.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        NavigationStack {
            List(filtered) { user in
                Button { onSelect(user.username) } label: {
                    HStack(spacing: 12) {
                        Circle()
                            .fill(avatarColor(for: user.username))
                            .frame(width: 42, height: 42)
                            .overlay(
                                Text(String(user.username.prefix(1)).uppercased())
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(.white)
                            )
                        Text(user.username)
                            .foregroundColor(.textPrimary)
                    }
                }
                .listRowBackground(Color.surfaceWhite)
            }
            .listStyle(.plain)
            .searchable(text: $search, prompt: "Search users")
            .navigationTitle("New Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.dilarionRed)
                }
            }
            .task {
                users = (try? await APIClient.shared.get("/users")) ?? []
            }
        }
    }
}

/// Multi-select picker that starts a standalone conference (no prior 1:1 call)
/// and invites everyone picked. Mirrors NewChatSheet, swapping tap-to-open for
/// checkmarks and a bottom "Start Meeting" bar.
struct NewMeetingSheet: View {
    let onStart: ([String]) -> Void
    @Environment(\.dismiss) var dismiss
    @State private var users: [UserProfile] = []
    @State private var search = ""
    @State private var selected: Set<String> = []

    var filtered: [UserProfile] {
        search.isEmpty ? users : users.filter { $0.username.localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                List(filtered) { user in
                    Button {
                        if selected.contains(user.username) { selected.remove(user.username) }
                        else { selected.insert(user.username) }
                    } label: {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(avatarColor(for: user.username))
                                .frame(width: 42, height: 42)
                                .overlay(
                                    Text(String(user.username.prefix(1)).uppercased())
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundColor(.white)
                                )
                            Text(user.username)
                                .foregroundColor(.textPrimary)
                            Spacer()
                            Image(systemName: selected.contains(user.username) ? "checkmark.circle.fill" : "circle")
                                .foregroundColor(selected.contains(user.username) ? .dilarionRed : .gray)
                        }
                    }
                    .listRowBackground(Color.surfaceWhite)
                }
                .listStyle(.plain)
                .searchable(text: $search, prompt: "Search people to invite")

                if !selected.isEmpty {
                    Button {
                        onStart(Array(selected))
                    } label: {
                        HStack {
                            Image(systemName: "video.fill")
                            Text("Start Meeting (\(selected.count))")
                        }
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.dilarionRed)
                    }
                }
            }
            .navigationTitle("New Meeting")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.dilarionRed)
                }
            }
            .task {
                users = (try? await APIClient.shared.get("/users")) ?? []
            }
        }
    }
}

/// Upcoming-meetings list + a schedule form. Joining hands the join code to
/// MeetingViewModel.presentLobby(.join(...)), the same LiveKit gallery flow
/// instant meetings use — see MeetingViewModel.joinByCode.
struct MeetingsSheet: View {
    let onJoin: (String) -> Void
    @Environment(\.dismiss) var dismiss
    @State private var meetings: [MeetingSummary] = []
    @State private var loading = true
    @State private var errorText: String? = nil
    @State private var showForm = false
    @State private var showCalendar = false

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if showForm {
                    ScheduleMeetingForm(onScheduled: {
                        showForm = false
                        Task { meetings = (try? await APIClient.shared.getUpcomingMeetings()) ?? [] }
                    })
                } else {
                    VStack(spacing: 0) {
                        if loading {
                            Spacer()
                            ProgressView()
                            Spacer()
                        } else if meetings.isEmpty {
                            Spacer()
                            Text("No upcoming meetings").foregroundColor(.textSecondary)
                            Spacer()
                        } else {
                            List(meetings) { meeting in
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(meeting.title ?? "Untitled meeting")
                                            .foregroundColor(.textPrimary)
                                        Text("\(formatMeetingTime(meeting.scheduled_at)) · \(meeting.creator_username)")
                                            .font(.caption)
                                            .foregroundColor(.textSecondary)
                                    }
                                    Spacer()
                                    Button("Join") {
                                        onJoin(meeting.join_code)
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .tint(.dilarionRed)
                                }
                                .listRowBackground(Color.surfaceWhite)
                            }
                            .listStyle(.plain)
                        }
                        if let errorText { Text(errorText).foregroundColor(.red).font(.caption).padding(.bottom, 4) }
                        Button {
                            showForm = true
                        } label: {
                            Text("+ Schedule a meeting")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color.dilarionRed)
                        }
                    }
                }
            }
            .navigationTitle(showForm ? "Schedule Meeting" : "Meetings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(showForm ? "Back" : "Close") {
                        if showForm { showForm = false } else { dismiss() }
                    }
                    .foregroundColor(.dilarionRed)
                }
                if !showForm {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showCalendar = true } label: {
                            Image(systemName: "calendar")
                        }
                        .foregroundColor(.dilarionRed)
                    }
                }
            }
            .task {
                loading = true
                do {
                    meetings = try await APIClient.shared.getUpcomingMeetings()
                } catch {
                    errorText = error.localizedDescription
                }
                loading = false
            }
        }
        .sheet(isPresented: $showCalendar) {
            MeetingCalendarView(onJoin: onJoin)
        }
    }
}

private struct ScheduleMeetingForm: View {
    let onScheduled: () -> Void
    @State private var title = ""
    @State private var when = Date().addingTimeInterval(3600)
    @State private var users: [UserProfile] = []
    @State private var selected: Set<String> = []
    @State private var scheduling = false
    @State private var errorText: String? = nil

    var body: some View {
        Form {
            Section {
                TextField("Title (optional)", text: $title)
                DatePicker("When", selection: $when, displayedComponents: [.date, .hourAndMinute])
            }
            Section("Invite") {
                ForEach(users) { user in
                    Button {
                        if selected.contains(user.username) { selected.remove(user.username) }
                        else { selected.insert(user.username) }
                    } label: {
                        HStack {
                            Text(user.username).foregroundColor(.textPrimary)
                            Spacer()
                            if selected.contains(user.username) {
                                Image(systemName: "checkmark.circle.fill").foregroundColor(.dilarionRed)
                            } else {
                                Image(systemName: "circle").foregroundColor(.gray)
                            }
                        }
                    }
                }
            }
            if let errorText {
                Text(errorText).foregroundColor(.red).font(.caption)
            }
            Button {
                Task {
                    scheduling = true
                    do {
                        _ = try await APIClient.shared.createMeeting(
                            title: title.isEmpty ? nil : title,
                            scheduledAt: when,
                            inviteeUsernames: Array(selected)
                        )
                        onScheduled()
                    } catch {
                        errorText = error.localizedDescription
                    }
                    scheduling = false
                }
            } label: {
                if scheduling { ProgressView() } else { Text("Schedule") }
            }
            .disabled(scheduling)
        }
        .task {
            users = (try? await APIClient.shared.get("/users")) ?? []
        }
    }
}

private func formatMeetingTime(_ iso: String) -> String {
    let formatter = ISO8601DateFormatter()
    guard let date = formatter.date(from: iso) else { return iso }
    let out = DateFormatter()
    out.dateStyle = .medium
    out.timeStyle = .short
    return out.string(from: date)
}

// MARK: — Helpers
private func formatRelativeTime(_ iso: String) -> String {
    let fmts = ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSZZZZZ",
                "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                "yyyy-MM-dd'T'HH:mm:ss"]
    var date: Date? = nil
    for fmt in fmts {
        let df = DateFormatter()
        df.dateFormat = fmt
        if let d = df.date(from: iso) { date = d; break }
    }
    guard let d = date else { return "" }
    let diffH = Int(Date().timeIntervalSince(d) / 3600)
    if diffH < 24 {
        let df = DateFormatter(); df.dateFormat = "HH:mm"; return df.string(from: d)
    } else if diffH < 168 {
        let df = DateFormatter(); df.dateFormat = "EEE"; return df.string(from: d)
    } else {
        let df = DateFormatter(); df.dateFormat = "dd/MM/yy"; return df.string(from: d)
    }
}

private func formatTime(_ iso: String) -> String { formatRelativeTime(iso) }
