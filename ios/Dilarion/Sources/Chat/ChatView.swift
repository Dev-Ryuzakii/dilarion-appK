import SwiftUI
import PhotosUI
import AVFoundation
import UniformTypeIdentifiers
import PDFKit
import QuickLook

// Mirrors ChatScreen.kt, with one deliberate iOS deviation: no global
// "unlock the whole conversation" toggle. Decoy text shown per-message;
// tapping a locked bubble reveals just that message for 30s (prompting for
// the master token once per session, not once per tap) instead of decrypting
// every message in the thread at once.
// - Red top bar with avatar initial, name, "end-to-end encrypted"
// - Chat background (pattern at 0.45 alpha)
// - Unlock dialog with master token field, triggered by tapping a bubble
// - Message bubbles: mine=green (#DCF8C6), other=white, rounded corners
// - Timestamp + read receipt icons (Done / DoneAll)
// - Date separators (Today / Yesterday / date)
// - Input bar: attach (DM only), text field, send OR mic button
// - @mention dropdown (groups)
// - Private tag chip

struct ChatView: View {
    let username: String
    let groupId: Int?
    let groupName: String?

    @StateObject private var vm = ChatViewModel()
    @State private var inputText = ""
    @State private var showUnlockDialog = false
    @State private var unlockError: String? = nil
    @State private var selectedPhotoItem: PhotosPickerItem? = nil
    @State private var viewerImage: ViewerImage? = nil
    @State private var showWhiteboard = false
    @State private var showPinnedList = false
    @State private var forwardCandidate: Message? = nil
    @State private var actionMessage: Message? = nil
    @State private var pendingRevealMessageId: Int? = nil
    @State private var pendingUnlockMediaId: String? = nil
    @State private var pendingDocumentPick: Data? = nil
    @State private var pendingDocumentFilename: String = ""
    @State private var pendingDocumentMime: String = ""
    @State private var showDocumentPicker = false
    @State private var showDecoyKindPicker = false

    private var displayName: String { groupId != nil ? (groupName ?? "Group") : username }

    var body: some View {
        ZStack {
            // Chat background pattern at 0.45 alpha (matches chat_bg in Kotlin)
            ChatBackground()

            VStack(spacing: 0) {
                // Pinned messages banner
                if vm.state.showPinnedBanner {
                    Button { showPinnedList = true } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "pin.fill")
                                .font(.system(size: 12))
                            Text(vm.state.pinnedMessages.count == 1 ? "1 pinned message" : "\(vm.state.pinnedMessages.count) pinned messages")
                                .font(.system(size: 12, weight: .medium))
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 11))
                        }
                        .foregroundColor(.textPrimary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.surfaceWhite)
                    }
                    Divider()
                }

                // Messages
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 4) {
                            let items = vm.combinedItems()
                            ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                                let prevTs = idx > 0 ? items[idx - 1].timestamp : nil
                                let curTs = item.timestamp

                                if let ts = curTs, shouldShowDateSep(current: ts, previous: prevTs) {
                                    DateSeparator(timestamp: ts)
                                }

                                chatItemView(for: item)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                    }
                    .onChange(of: vm.combinedItems().count) { _ in
                        if let last = vm.combinedItems().last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                // Typing indicator
                if vm.partnerTyping {
                    HStack {
                        Text("\(displayName) is typing...")
                            .font(.system(size: 12))
                            .foregroundColor(.textSecondary)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 4)
                    .background(Color.surfaceWhite.opacity(0.8))
                }

                // Reply / edit context bar
                if let editing = vm.state.editingMessage {
                    ComposeContextBar(
                        icon: "pencil",
                        label: "Editing message",
                        snippet: editing.content ?? "",
                        tint: .dilarionRed
                    ) {
                        vm.cancelEdit()
                        inputText = ""
                    }
                } else if let replying = vm.state.replyTarget {
                    ComposeContextBar(
                        icon: "arrowshape.turn.up.left.fill",
                        label: "Replying to \(replying.sender ?? "")",
                        snippet: replying.content ?? "",
                        tint: Color(hex: 0xA78BFA)
                    ) {
                        vm.setReplyTarget(nil)
                    }
                }

                // Input area
                if vm.state.isRecording {
                    RecordingRow(
                        seconds: vm.state.recordingSeconds,
                        onCancel: { vm.cancelRecording() },
                        onSend: { Task { await vm.stopAndSendRecording() } }
                    )
                } else {
                    InputArea(
                        inputText: $inputText,
                        state: vm.state,
                        groupId: groupId,
                        selectedPhotoItem: $selectedPhotoItem,
                        showDocumentPicker: $showDocumentPicker,
                        onSend: {
                            let text = inputText.trimmingCharacters(in: .whitespaces)
                            guard !text.isEmpty else { return }
                            inputText = ""
                            vm.setMentionQuery(nil)
                            if vm.state.editingMessage != nil {
                                Task { await vm.submitEdit(text) }
                            } else {
                                Task { await vm.sendMessage(text) }
                            }
                        },
                        onStartRecording: { vm.startRecording() },
                        onTyping: { vm.sendTyping(isTyping: !inputText.isEmpty) },
                        onMentionQuery: { q in vm.setMentionQuery(q) },
                        onSelectMention: { member in
                            vm.setTaggedUser(member.username)
                            // strip @word at end of input
                            inputText = inputText.replacingOccurrences(
                                of: "@\\w*$", with: "", options: .regularExpression
                            )
                            vm.setMentionQuery(nil)
                        },
                        onClearTag: { vm.setTaggedUser(nil) }
                    )
                }
            }

            if let msg = actionMessage {
                MessageActionOverlay(
                    message: msg,
                    isMine: msg.sender == vm.state.currentUsername,
                    isStarred: vm.state.starredMessageIds.contains(msg.id),
                    onDismiss: { withAnimation(.spring(response: 0.3)) { actionMessage = nil } },
                    onReact: { emoji in Task { await vm.toggleReaction(msg, emoji: emoji) } },
                    onReply: { vm.setReplyTarget(msg) },
                    onForward: { forwardCandidate = msg },
                    onEdit: { inputText = msg.content ?? ""; vm.startEdit(msg) },
                    onTogglePin: { Task { await vm.togglePin(msg) } },
                    onToggleStar: { Task { await vm.toggleStar(msg) } },
                    onDelete: { Task { await vm.deleteMessage(msg) } }
                )
                .zIndex(1)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 10) {
                    // Avatar circle
                    Circle()
                        .fill(Color.dilarionRedDark)
                        .frame(width: 36, height: 36)
                        .overlay(
                            Text(String(displayName.prefix(1)).uppercased())
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(.white)
                        )
                    VStack(alignment: .leading, spacing: 1) {
                        Text(displayName)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                        HStack(spacing: 3) {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 8))
                                .foregroundColor(.white.opacity(0.7))
                            Text("end-to-end encrypted")
                                .font(.system(size: 10))
                                .foregroundColor(.white.opacity(0.7))
                        }
                    }
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if groupId == nil {
                    Button {
                        CallViewModel.shared.startOutgoingCall(peerUsername: username, type: .voice)
                    } label: {
                        Image(systemName: "phone")
                            .foregroundColor(.white)
                    }
                    Button {
                        CallViewModel.shared.startOutgoingCall(peerUsername: username, type: .video)
                    } label: {
                        Image(systemName: "video")
                            .foregroundColor(.white)
                    }
                }
                Button { showWhiteboard = true } label: {
                    Image(systemName: "scribble")
                        .foregroundColor(.white)
                }
            }
        }
        .toolbarBackground(Color.dilarionRed, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .sheet(isPresented: $showWhiteboard) {
            WhiteboardView(username: groupId == nil ? username : nil, groupId: groupId)
        }
        .alert("Error", isPresented: Binding(
            get: { vm.state.error != nil },
            set: { if !$0 { vm.clearError() } }
        )) {
            Button("OK") { vm.clearError() }
        } message: {
            Text(vm.state.error ?? "")
        }
        .sheet(isPresented: $showUnlockDialog) {
            UnlockDialogSheet(error: unlockError) { token in
                if let pendingMedia = pendingUnlockMediaId {
                    if vm.unlockMedia(mediaId: pendingMedia, token: token) {
                        showUnlockDialog = false
                        unlockError = nil
                        pendingUnlockMediaId = nil
                    } else {
                        unlockError = "Incorrect master token"
                    }
                    return
                }
                Task {
                    let ok = await vm.unlock(token: token)
                    if ok {
                        showUnlockDialog = false
                        unlockError = nil
                        if let pending = pendingRevealMessageId {
                            vm.revealMessage(pending)
                            pendingRevealMessageId = nil
                        }
                    } else {
                        unlockError = "Incorrect master token"
                    }
                }
            } onDismiss: {
                showUnlockDialog = false; unlockError = nil; pendingRevealMessageId = nil; pendingUnlockMediaId = nil
            }
        }
        .sheet(isPresented: Binding(
            get: { vm.state.viewingDocumentMediaId != nil },
            set: { if !$0 { vm.closeDocumentViewer() } }
        )) {
            if let mediaId = vm.state.viewingDocumentMediaId {
                DocumentViewerSheet(
                    mediaId: mediaId,
                    data: vm.documentBytes(for: mediaId),
                    onDismiss: { vm.closeDocumentViewer() }
                )
            }
        }
        .alert("Error", isPresented: Binding(
            get: { vm.state.documentError != nil },
            set: { if !$0 { vm.state.documentError = nil } }
        )) {
            Button("OK") { vm.state.documentError = nil }
        } message: {
            Text(vm.state.documentError ?? "")
        }
        .onAppear {
            vm.initialize(username: username, groupId: groupId)
        }
        .onChange(of: selectedPhotoItem) { item in
            guard let item = item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    await vm.sendImage(data: data)
                }
                selectedPhotoItem = nil
            }
        }
        .fileImporter(isPresented: $showDocumentPicker, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            guard let url = try? result.get().first else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            pendingDocumentPick = data
            pendingDocumentFilename = url.lastPathComponent
            pendingDocumentMime = (try? url.resourceValues(forKeys: [.contentTypeKey]))?.contentType?.preferredMIMEType ?? "application/octet-stream"
            showDecoyKindPicker = true
        }
        .confirmationDialog("Disguise this document as…", isPresented: $showDecoyKindPicker, titleVisibility: .visible) {
            ForEach(DecoyKind.allCases, id: \.self) { kind in
                Button(kind.label) {
                    if let data = pendingDocumentPick {
                        Task { await vm.sendDocument(data: data, filename: pendingDocumentFilename, mimeType: pendingDocumentMime, decoyKind: kind) }
                    }
                    pendingDocumentPick = nil
                }
            }
            Button("Cancel", role: .cancel) { pendingDocumentPick = nil }
        }
        .fullScreenCover(item: $viewerImage) { image in
            FullScreenImageViewer(imagePath: image.path) {
                viewerImage = nil
            }
        }
        .sheet(isPresented: $showPinnedList) {
            PinnedMessagesSheet(vm: vm)
        }
        .sheet(item: $forwardCandidate) { message in
            ForwardPickerSheet(message: message) { targetUsername, targetGroupId, memberUsernames in
                Task {
                    do {
                        try await vm.forwardMessage(message, toUsername: targetUsername, toGroupId: targetGroupId, groupMemberUsernames: memberUsernames)
                    } catch {
                        vm.state.error = error.localizedDescription
                    }
                }
                forwardCandidate = nil
            }
        }
    }

    @ViewBuilder
    private func chatItemView(for item: ChatItem) -> some View {
        switch item {
        case .textMessage(let msg) where msg.contentType == "meeting":
            if let payload = MeetingCardPayload.parse(msg.content) {
                MeetingCardBubbleView(payload: payload, senderUsername: msg.sender ?? "", isMine: msg.sender == vm.state.currentUsername) {
                    joinFromMeetingCard(payload, invitedBy: msg.sender ?? "")
                }
                .id(item.id)
            } else {
                Text("📅 Meeting update")
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
                    .id(item.id)
            }
        case .textMessage(let msg):
            let isMine = msg.sender == vm.state.currentUsername
            let isRevealed = vm.state.revealedMessageIds.contains(msg.id)
            MessageBubbleView(
                message: msg,
                isMine: isMine,
                isUnlocked: isRevealed,
                isGroup: groupId != nil,
                replyPreview: msg.replyToMessageId.flatMap { vm.message(withId: $0) },
                isStarred: vm.state.starredMessageIds.contains(msg.id),
                onTapLocked: { revealOrPrompt(msg.id) },
                onReact: { emoji in Task { await vm.toggleReaction(msg, emoji: emoji) } },
                onLongPress: { withAnimation(.spring(response: 0.3)) { actionMessage = msg } }
            )
            .id(item.id)
            .task {
                if !msg.read && !isMine {
                    await vm.markRead(msg.id)
                }
            }
        case .mediaMessage(let media):
            let isMine = media.sender == vm.state.currentUsername
            if isDocumentMedia(media) {
                DocumentBubbleView(
                    media: media,
                    isMine: isMine,
                    isUnlocked: vm.state.unlockedMediaIds.contains(media.mediaId),
                    onOpen: { Task { await vm.openDocument(mediaId: media.mediaId) } },
                    onLockTap: { pendingUnlockMediaId = media.mediaId }
                )
                .id(item.id)
            } else {
            MediaBubbleView(
                media: media,
                isMine: isMine,
                isUnlocked: vm.state.isMasterTokenVerified,
                localFilePaths: vm.state.localFilePaths,
                playingMediaId: vm.state.playingMediaId,
                onPlay: { mid, unlocked in
                    Task { await vm.playMedia(mediaId: mid, useRealAudio: unlocked) }
                },
                onStop: {
                    vm.stopPlayback()
                },
                onDownloadImage: { mid in
                    Task { await vm.downloadImageForDisplay(mediaId: mid) }
                },
                onImageTap: { path in
                    viewerImage = ViewerImage(path: path)
                },
                onTapLocked: {
                    pendingRevealMessageId = nil
                    showUnlockDialog = true
                }
            )
            .id(item.id)
            }
        case .pendingUpload(let pending):
            PendingUploadBubbleView(pending: pending)
                .id(item.id)
        }
    }

    private func isDocumentMedia(_ media: MediaItem) -> Bool {
        let ct = media.contentType?.lowercased() ?? ""
        let mt = media.mediaType.lowercased()
        if mt == "voice" || ct.hasPrefix("audio/") || media.filename.hasSuffix(".m4a") || media.filename.hasSuffix(".wav") { return false }
        if ct.hasPrefix("image/") || mt == "photo" { return false }
        return ct.hasPrefix("application/") || ct.hasPrefix("media/") || mt == "raw" || mt == "document"
    }

    // Tapping a locked bubble: already proved you know the master token this
    // session -> reveal that one message directly. First time -> prompt for
    // it, then reveal the message that was tapped once it checks out.
    private func revealOrPrompt(_ messageId: Int) {
        if vm.state.isMasterTokenVerified {
            vm.revealMessage(messageId)
        } else {
            pendingRevealMessageId = messageId
            showUnlockDialog = true
        }
    }

    // Instant meetings still need the master-token accept gate (opening a mic
    // without consent isn't okay) — MeetingLobbyView handles that for
    // .acceptInvite. Scheduled meetings join directly by code, same as
    // anywhere else a join code is used.
    private func joinFromMeetingCard(_ payload: MeetingCardPayload, invitedBy: String) {
        if payload.kind == "instant", let conferenceId = payload.conference_id {
            MeetingViewModel.shared.presentLobby(.acceptInvite(conferenceId: conferenceId, invitedBy: invitedBy))
        } else if let joinCode = payload.join_code {
            MeetingViewModel.shared.presentLobby(.join(joinCode: joinCode))
        }
    }

    private func shouldShowDateSep(current: String, previous: String?) -> Bool {
        guard let prev = previous else { return true }
        return current.prefix(10) != prev.prefix(10)
    }
}

// MARK: — Chat wallpaper/background
struct ChatBackground: View {
    var body: some View {
        ZStack {
            Color.backgroundGrey
            // chat_bg pattern asset at 0.45 alpha, crop-scaled (matches ChatScreen.kt);
            // the imageset carries a dark-appearance variant for dark mode
            GeometryReader { geo in
                Image("chat_bg")
                    .resizable()
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
                    .opacity(0.45)
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: — Message bubble
struct MessageBubbleView: View {
    let message: Message
    let isMine: Bool
    let isUnlocked: Bool
    let isGroup: Bool
    var replyPreview: Message? = nil
    var isStarred: Bool = false
    let onTapLocked: () -> Void
    var onReact: (String) -> Void = { _ in }
    var onLongPress: () -> Void = {}

    private var isPrivateTagged: Bool { message.contentType == "private_tagged" }
    private var isEncrypted: Bool { message.contentType == "encrypted" }
    private var isDeleted: Bool { message.isDeleted == true }
    private var hasRecipient: Bool {
        !(message.recipient ?? "").isEmpty && message.recipient != "group"
    }
    private var privatePurple: Color { Color(hex: 0xA78BFA) }
    private var showDecoy: Bool { isEncrypted && !isUnlocked }

    private var bubbleColor: Color {
        if isPrivateTagged { return Color(hex: 0x1A1020) }
        return isMine ? .chatBubbleSelf : .chatBubbleOther
    }
    private var bubbleShape: some Shape {
        if isMine {
            return RoundedCorner(radius: 18, corners: [.topLeft, .bottomLeft, .bottomRight])
        } else {
            return RoundedCorner(radius: 18, corners: [.topRight, .bottomLeft, .bottomRight])
        }
    }

    var body: some View {
        VStack(alignment: isMine ? .trailing : .leading, spacing: 2) {
            // "→ @recipient" hint above bubble
            if hasRecipient && !isPrivateTagged {
                Text("→ @\(message.recipient ?? "")")
                    .font(.system(size: 11))
                    .foregroundColor(privatePurple)
                    .padding(.leading, isGroup && !isMine ? 38 : 0)
            }

            HStack(alignment: .bottom, spacing: 6) {
                if isMine { Spacer(minLength: 60) }

                // Group sender avatar
                if isGroup && !isMine {
                    Circle()
                        .fill(avatarColor(for: message.sender ?? ""))
                        .frame(width: 32, height: 32)
                        .overlay(
                            Text(initials(for: message.sender ?? "?"))
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.white)
                        )
                }

                VStack(alignment: isMine ? .trailing : .leading, spacing: 2) {
                    // Sender name in groups
                    if isGroup && !isMine, let sender = message.sender {
                        Text(sender)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(avatarColor(for: sender))
                            .padding(.leading, 4)
                    }

                    // Bubble
                    VStack(alignment: .leading, spacing: 4) {
                        if isDeleted {
                            HStack(spacing: 6) {
                                Image(systemName: "trash")
                                    .font(.system(size: 11))
                                Text("This message was deleted")
                                    .font(.system(size: 13))
                                    .italic()
                            }
                            .foregroundColor(.textSecondary)
                        } else if isPrivateTagged {
                            HStack(spacing: 6) {
                                Image(systemName: "lock.fill")
                                    .font(.system(size: 12))
                                    .foregroundColor(privatePurple)
                                Text("Private message for @\(message.recipient ?? "")")
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundColor(privatePurple)
                            }
                        } else if showDecoy {
                            Text(decoyFor(id: message.id))
                                .font(.system(size: 14))
                                .foregroundColor(.textPrimary.opacity(0.65))
                        } else {
                            if let quoted = replyPreview {
                                QuotedReplyPreview(message: quoted, isUnlocked: isUnlocked)
                            }
                            if message.forwardedFromMessageId != nil {
                                HStack(spacing: 4) {
                                    Image(systemName: "arrowshape.turn.up.right.fill")
                                        .font(.system(size: 10))
                                    Text("Forwarded")
                                        .font(.system(size: 11, weight: .medium))
                                        .italic()
                                }
                                .foregroundColor(.textSecondary)
                            }
                            Text(message.content ?? message.encryptedContent ?? "")
                                .font(.system(size: 14))
                                .foregroundColor(.textPrimary)
                        }

                        // Timestamp + edited flag + read receipt
                        HStack(spacing: 3) {
                            if message.isEdited == true && !isDeleted {
                                Text("edited")
                                    .font(.system(size: 10))
                                    .italic()
                                    .foregroundColor(.textSecondary)
                            }
                            if isStarred {
                                Image(systemName: "star.fill")
                                    .font(.system(size: 9))
                                    .foregroundColor(.textSecondary)
                            }
                            if message.isPinned == true {
                                Image(systemName: "pin.fill")
                                    .font(.system(size: 9))
                                    .foregroundColor(.textSecondary)
                            }
                            Text(formatTimestamp(message.timestamp ?? ""))
                                .font(.system(size: 11))
                                .foregroundColor(.textSecondary)
                            if isMine {
                                if message.id < 0 {
                                    // Pending
                                    Image(systemName: "clock")
                                        .font(.system(size: 10))
                                        .foregroundColor(.textSecondary.opacity(0.6))
                                } else if message.read {
                                    // Read — double tick red (mirrors DoneAll + DilarionRed tint)
                                    Image(systemName: "checkmark.message.fill")
                                        .font(.system(size: 12))
                                        .foregroundColor(.dilarionRed)
                                } else {
                                    // Delivered
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 11))
                                        .foregroundColor(.textSecondary)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(bubbleColor)
                    .clipShape(bubbleShape)
                    .frame(maxWidth: 260, alignment: isMine ? .trailing : .leading)
                    .onTapGesture {
                        if isEncrypted && !isUnlocked { onTapLocked() }
                    }
                    .onLongPressGesture(minimumDuration: 0.35) {
                        guard !isDeleted && isUnlocked else { return }
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        onLongPress()
                    }

                    // Reaction chips
                    if let reactions = message.reactions, !reactions.isEmpty, !isDeleted {
                        HStack(spacing: 4) {
                            ForEach(reactions) { r in
                                Button { onReact(r.emoji) } label: {
                                    HStack(spacing: 3) {
                                        Text(r.emoji).font(.system(size: 12))
                                        Text("\(r.count)").font(.system(size: 10, weight: .semibold))
                                    }
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(r.reactedByMe ? Color.dilarionRed.opacity(0.15) : Color.borderGrey.opacity(0.5))
                                    .overlay(
                                        Capsule().stroke(r.reactedByMe ? Color.dilarionRed : .clear, lineWidth: 1)
                                    )
                                    .clipShape(Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                if !isMine { Spacer(minLength: 60) }
            }
        }
        .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)
    }
}

// MARK: — Quoted reply preview (shown inside a bubble that replies to another message)
struct QuotedReplyPreview: View {
    let message: Message
    let isUnlocked: Bool

    private var snippet: String {
        if message.isDeleted == true { return "Message deleted" }
        // Keep the decoy illusion intact in the quoted snippet too — never
        // surface raw ciphertext just because the reply target isn't unlocked.
        if message.contentType == "encrypted" && !isUnlocked { return decoyFor(id: message.id) }
        return message.content ?? "…"
    }

    var body: some View {
        HStack(spacing: 6) {
            Rectangle()
                .fill(Color.dilarionRed.opacity(0.6))
                .frame(width: 3)
            VStack(alignment: .leading, spacing: 1) {
                Text(message.sender ?? "")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.dilarionRed)
                Text(snippet)
                    .font(.system(size: 12))
                    .foregroundColor(.textSecondary)
                    .lineLimit(1)
            }
        }
        .padding(6)
        .background(Color.borderGrey.opacity(0.35))
        .cornerRadius(6)
    }
}

// MARK: — Reply/edit context bar above the input area
struct ComposeContextBar: View {
    let icon: String
    let label: String
    let snippet: String
    let tint: Color
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundColor(tint)
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(tint)
                Text(snippet)
                    .font(.system(size: 12))
                    .foregroundColor(.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.system(size: 12))
                    .foregroundColor(.textSecondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.surfaceWhite)
    }
}

// Custom rounded corners (mirrors Kotlin RoundedCornerShape per-corner)
struct RoundedCorner: Shape {
    var radius: CGFloat
    var corners: UIRectCorner

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

// MARK: — Date separator
struct DateSeparator: View {
    let timestamp: String

    private var label: String {
        let fmts = ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSZZZZZ",
                    "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                    "yyyy-MM-dd'T'HH:mm:ss"]
        var date: Date? = nil
        for fmt in fmts {
            let df = DateFormatter(); df.dateFormat = fmt
            if let d = df.date(from: timestamp) { date = d; break }
        }
        guard let d = date else { return "" }
        if Calendar.current.isDateInToday(d) { return "Today" }
        if Calendar.current.isDateInYesterday(d) { return "Yesterday" }
        let df = DateFormatter(); df.dateFormat = "EEEE, d MMMM"
        return df.string(from: d)
    }

    var body: some View {
        if !label.isEmpty {
            HStack {
                Spacer()
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.textSecondary)
                    .tracking(0.5)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 5)
                    .background(Color.borderGrey.opacity(0.55))
                    .clipShape(Capsule())
                Spacer()
            }
            .padding(.vertical, 10)
        }
    }
}

// MARK: — Input area
struct InputArea: View {
    @Binding var inputText: String
    let state: ChatUiState
    let groupId: Int?
    @Binding var selectedPhotoItem: PhotosPickerItem?
    @Binding var showDocumentPicker: Bool
    let onSend: () -> Void
    let onStartRecording: () -> Void
    let onTyping: () -> Void
    let onMentionQuery: (String?) -> Void
    let onSelectMention: (GroupMember) -> Void
    let onClearTag: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // @mention dropdown
            if let query = state.mentionQuery, groupId != nil {
                let filtered = state.groupMembers.filter {
                    $0.username != state.currentUsername &&
                    $0.username.localizedCaseInsensitiveContains(query)
                }
                if !filtered.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(filtered) { member in
                            Button { onSelectMention(member) } label: {
                                HStack(spacing: 8) {
                                    Text("@")
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundColor(Color(hex: 0xA78BFA))
                                    Text(member.username)
                                        .foregroundColor(.textPrimary)
                                    Spacer()
                                    Text(member.role)
                                        .font(.system(size: 11))
                                        .foregroundColor(.textSecondary)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 10)
                            }
                            Divider()
                        }
                    }
                    .background(Color(hex: 0x1A1A1A))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .shadow(radius: 4)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 4)
                }
            }

            // Private tag chip
            if let tagged = state.taggedUser {
                HStack(spacing: 4) {
                    HStack(spacing: 4) {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 9))
                            .foregroundColor(Color(hex: 0xA78BFA))
                        Text("Private → @\(tagged)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Color(hex: 0xA78BFA))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color(hex: 0x1E1A2E))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color(hex: 0x4C1D95), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                    Button { onClearTag() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 12))
                            .foregroundColor(.textSecondary)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 6)
            }

            // Main input row
            HStack(alignment: .bottom, spacing: 8) {
                // Attach (DM only)
                if groupId == nil {
                    Menu {
                        PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                            Label("Photo", systemImage: "photo")
                        }
                        Button { showDocumentPicker = true } label: {
                            Label("Document", systemImage: "doc")
                        }
                    } label: {
                        Image(systemName: "paperclip")
                            .font(.system(size: 20))
                            .foregroundColor(.textSecondary)
                            .frame(width: 36, height: 36)
                    }
                }

                // Text field
                TextField(
                    state.taggedUser != nil
                        ? "Private to @\(state.taggedUser!)…"
                        : (groupId != nil ? "Message or @ to tag…" : "Message"),
                    text: $inputText,
                    axis: .vertical
                )
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.surfaceWhite)
                .overlay(
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(state.taggedUser != nil ? Color(hex: 0x4C1D95) : Color.borderGrey, lineWidth: 1.5)
                )
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .lineLimit(1...5)
                .onChange(of: inputText) { v in
                    onTyping()
                    if groupId != nil {
                        let match = v.range(of: "@(\\w*)$", options: .regularExpression)
                        if let r = match {
                            let full = String(v[r])
                            let query = String(full.dropFirst()) // strip @
                            onMentionQuery(query)
                        } else {
                            onMentionQuery(nil)
                        }
                    }
                }

                // Send or Mic
                if !inputText.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button(action: onSend) {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 18))
                            .foregroundColor(.white)
                            .frame(width: 44, height: 44)
                            .background(Color.dilarionRed)
                            .clipShape(Circle())
                    }
                    .disabled(state.isSending)
                } else if groupId == nil {
                    Button(action: onStartRecording) {
                        Image(systemName: "mic")
                            .font(.system(size: 20))
                            .foregroundColor(.textSecondary)
                            .frame(width: 44, height: 44)
                            .background(Color.borderGrey)
                            .clipShape(Circle())
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .background(Color.surfaceWhite)
            .shadow(color: .black.opacity(0.06), radius: 4, y: -2)

            if state.isUploadingMedia {
                ProgressView()
                    .progressViewStyle(.linear)
                    .tint(.dilarionRed)
                    .frame(height: 2)
            }
        }
    }
}

// MARK: — Unlock sheet
struct UnlockDialogSheet: View {
    let error: String?
    let onConfirm: (String) -> Void
    let onDismiss: () -> Void

    @State private var token = ""
    @State private var showToken = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: "key.fill")
                    .font(.system(size: 36))
                    .foregroundColor(.dilarionRed)

                Text("Enter Master Token")
                    .font(.system(size: 20, weight: .bold))

                Text("Enter your master token to reveal real message content.")
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
                    .multilineTextAlignment(.center)

                HStack {
                    Image(systemName: "key")
                        .foregroundColor(.dilarionRed)
                    SwiftUI.Group {
                        if showToken {
                            TextField("Master Token", text: $token)
                        } else {
                            SecureField("Master Token", text: $token)
                        }
                    }
                    Button { showToken.toggle() } label: {
                        Image(systemName: showToken ? "eye.slash" : "eye")
                            .foregroundColor(.textSecondary)
                    }
                }
                .padding(14)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(error != nil ? Color.red : Color.dilarionRed, lineWidth: 1.5)
                )

                if let err = error {
                    Text(err)
                        .font(.system(size: 12))
                        .foregroundColor(.red)
                }

                Button {
                    onConfirm(token)
                } label: {
                    Text("Unlock")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.dilarionRed)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .disabled(token.isEmpty)

                Spacer()
            }
            .padding(24)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { onDismiss() }
                        .foregroundColor(.dilarionRed)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: — Timestamp helper
private func formatTimestamp(_ iso: String) -> String {
    let fmts = ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSZZZZZ",
                "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
                "yyyy-MM-dd'T'HH:mm:ss"]
    for fmt in fmts {
        let df = DateFormatter()
        df.dateFormat = fmt
        if let d = df.date(from: iso) {
            let out = DateFormatter()
            out.dateFormat = "HH:mm"
            return out.string(from: d)
        }
    }
    return ""
}

// MARK: — Recording Row UI
struct RecordingRow: View {
    let seconds: Int
    let onCancel: () -> Void
    let onSend: () -> Void

    @State private var pulseAlpha: Double = 1.0

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color.dilarionRed)
                .frame(width: 10, height: 10)
                .opacity(pulseAlpha)
                .onAppear {
                    withAnimation(Animation.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                        pulseAlpha = 0.2
                    }
                }
            
            Text(String(format: "Recording %02d:%02d", seconds / 60, seconds % 60))
                .font(.system(size: 14))
                .foregroundColor(.textPrimary)
            
            Spacer()
            
            Button(action: onCancel) {
                Image(systemName: "xmark")
                    .font(.system(size: 16))
                    .foregroundColor(.textSecondary)
                    .frame(width: 36, height: 36)
            }
            
            Button(action: onSend) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.dilarionRed)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(Color.surfaceWhite)
        .shadow(color: .black.opacity(0.06), radius: 4, y: -2)
    }
}

// MARK: — Media Bubble View UI
struct MediaBubbleView: View {
    let media: MediaItem
    let isMine: Bool
    let isUnlocked: Bool
    let localFilePaths: [String: String]
    let playingMediaId: String?
    let onPlay: (String, Bool) -> Void
    let onStop: () -> Void
    let onDownloadImage: (String) -> Void
    let onImageTap: (String) -> Void
    let onTapLocked: () -> Void

    var body: some View {
        HStack {
            if isMine { Spacer() }
            
            VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
                // Sender name if left-aligned
                if !isMine, let sender = media.sender {
                    Text(sender)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.textSecondary)
                }

                // Bubble Content
                VStack(spacing: 8) {
                    if isVoiceNote {
                        // Voice note UI
                        HStack(spacing: 12) {
                            Button {
                                if playingMediaId == media.mediaId {
                                    onStop()
                                } else {
                                    onPlay(media.mediaId, isUnlocked)
                                }
                            } label: {
                                Image(systemName: playingMediaId == media.mediaId ? "stop.fill" : "play.fill")
                                    .font(.system(size: 16))
                                    .foregroundColor(.white)
                                    .frame(width: 36, height: 36)
                                    .background(Color.dilarionRed)
                                    .clipShape(Circle())
                            }

                            VStack(alignment: .leading, spacing: 2) {
                                Text(isUnlocked ? "Voice Note" : "Decoy Voice Note")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundColor(.textPrimary)
                                
                                Text(playingMediaId == media.mediaId ? "Playing..." : "Tap to listen")
                                    .font(.system(size: 11))
                                    .foregroundColor(.textSecondary)
                            }
                            
                            Spacer()
                            
                            if !isUnlocked {
                                Image(systemName: "lock.fill")
                                    .font(.system(size: 12))
                                    .foregroundColor(.textSecondary)
                            }
                        }
                        .padding(12)
                        .frame(width: 220)
                    } else {
                        // Image UI
                        if isUnlocked {
                            let cacheKey = "img_\(media.mediaId)"
                            if let localPath = localFilePaths[cacheKey],
                               let uiImage = UIImage(contentsOfFile: localPath) {
                                Image(uiImage: uiImage)
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(maxWidth: 240, maxHeight: 180)
                                    .clipped()
                                    .cornerRadius(12)
                                    .contentShape(Rectangle())
                                    .onTapGesture { onImageTap(localPath) }
                            } else {
                                ProgressView()
                                    .frame(width: 240, height: 180)
                                    .background(Color.borderGrey)
                                    .cornerRadius(12)
                                    .onAppear {
                                        onDownloadImage(media.mediaId)
                                    }
                            }
                        } else {
                            // Decoy Locked Image Placeholder
                            Button(action: onTapLocked) {
                                VStack(spacing: 8) {
                                    Image(systemName: "lock.rectangle.stack.fill")
                                        .font(.system(size: 32))
                                        .foregroundColor(Color.dilarionRed)
                                    Text("Encrypted Media")
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundColor(.textPrimary)
                                    Text("Tap to decrypt")
                                        .font(.system(size: 11))
                                        .foregroundColor(.textSecondary)
                                }
                                .frame(width: 240, height: 150)
                                .background(Color.borderGrey)
                                .cornerRadius(12)
                            }
                        }
                    }
                }
                .background(isMine ? Color.dilarionRed.opacity(0.1) : Color.borderGrey.opacity(0.4))
                .cornerRadius(16)
                
                // Timestamp
                if let ts = media.timestamp {
                    Text(formatTime(ts))
                        .font(.system(size: 9))
                        .foregroundColor(.textSecondary)
                }
            }
            .id(media.mediaId)
            
            if !isMine { Spacer() }
        }
    }

    private var isVoiceNote: Bool {
        media.mediaType.lowercased() == "voice" || media.filename.hasSuffix(".m4a") || media.filename.hasSuffix(".wav")
    }

    private func formatTime(_ ts: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = formatter.date(from: ts)
        if date == nil {
            let simpleFormatter = ISO8601DateFormatter()
            simpleFormatter.formatOptions = [.withInternetDateTime]
            date = simpleFormatter.date(from: ts)
        }
        guard let date = date else { return "" }
        let outFormatter = DateFormatter()
        outFormatter.dateFormat = "HH:mm"
        return outFormatter.string(from: date)
    }
}

// MARK: — Meeting card bubble
// Always-visible system notice (never encrypted, never a decoy) — matches
// desktop (MeetingCard.tsx) and Android's equivalent.
struct MeetingCardBubbleView: View {
    let payload: MeetingCardPayload
    let senderUsername: String
    let isMine: Bool
    let onJoin: () -> Void

    private var isInstant: Bool { payload.kind == "instant" }
    private var title: String { payload.title ?? (isInstant ? "Instant meeting" : "Scheduled meeting") }
    private var subtitle: String {
        if isInstant { return "Group video call" }
        guard let scheduledAt = payload.scheduled_at, let duration = payload.duration_minutes,
              let date = ISO8601DateFormatter().date(from: scheduledAt) else { return "" }
        let end = date.addingTimeInterval(TimeInterval(duration * 60))
        let df = DateFormatter(); df.dateStyle = .medium
        let tf = DateFormatter(); tf.timeStyle = .short
        return "\(df.string(from: date)) · \(tf.string(from: date)) – \(tf.string(from: end))"
    }

    var body: some View {
        HStack {
            if isMine { Spacer() }
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10).fill(Color.dilarionRed)
                    Image(systemName: "video.fill")
                        .font(.system(size: 16))
                        .foregroundColor(.white)
                }
                .frame(width: 38, height: 38)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.textPrimary)
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: 11))
                            .foregroundColor(.textSecondary)
                    }
                }

                Spacer(minLength: 8)

                Button("Join", action: onJoin)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(Color.dilarionRed)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(10)
            .frame(minWidth: 240, maxWidth: 300)
            .background(Color.surfaceWhite)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            if !isMine { Spacer() }
        }
    }
}

// MARK: — Document bubble
// A generic file attachment. Tapping it always opens *something* — the
// generated decoy while locked, the real file once unlocked — so both must
// look identical; nothing here may hint a decoy exists. The small lock icon
// (matching the voice-note bubble) is the only way to trigger the
// master-token dialog, kept separate from the open action itself. Mirrors
// desktop (MediaBubble.tsx's DocumentBubble) and Android (ChatScreen.kt's
// DocumentBubble).
// WhatsApp-style optimistic "sending" bubble — appears the instant an
// upload starts, in the exact spot the real bubble will land, so the send
// never looks like it silently vanished while the network call is in flight.
struct PendingUploadBubbleView: View {
    let pending: PendingUpload

    var body: some View {
        HStack {
            Spacer()
            HStack(spacing: 8) {
                thumbnail
                VStack(alignment: .leading, spacing: 2) {
                    Text(pending.filename)
                        .font(.system(size: 13))
                        .foregroundColor(.textPrimary)
                        .lineLimit(1)
                    Text("Sending…")
                        .font(.system(size: 11))
                        .foregroundColor(.textSecondary)
                }
                ProgressView()
                    .scaleEffect(0.75)
            }
            .padding(8)
            .frame(minWidth: 160, maxWidth: 240)
            .background(Color.chatBubbleSelf.opacity(0.6))
            .cornerRadius(16)
        }
    }

    @ViewBuilder
    private var thumbnail: some View {
        switch pending.kind {
        case .image:
            if let data = pending.previewImage, let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .opacity(0.6)
            } else {
                Image(systemName: "photo.fill")
                    .foregroundColor(.textSecondary)
                    .frame(width: 36, height: 36)
            }
        case .document:
            Image(systemName: "doc.fill")
                .font(.system(size: 20))
                .foregroundColor(.textSecondary)
                .frame(width: 36, height: 36)
        case .voice:
            Image(systemName: "waveform")
                .font(.system(size: 20))
                .foregroundColor(.textSecondary)
                .frame(width: 36, height: 36)
        }
    }
}

struct DocumentBubbleView: View {
    let media: MediaItem
    let isMine: Bool
    let isUnlocked: Bool
    let onOpen: () -> Void
    let onLockTap: () -> Void

    var body: some View {
        HStack {
            if isMine { Spacer() }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 4) {
                if !isMine, let sender = media.sender {
                    Text(sender)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.textSecondary)
                }
                HStack(spacing: 8) {
                    Button(action: onOpen) {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 22))
                            .foregroundColor(.dilarionRed)
                            .frame(width: 36, height: 36)
                    }
                    Text("Tap to open")
                        .font(.system(size: 13))
                        .foregroundColor(.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if !isUnlocked {
                        Button(action: onLockTap) {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 13))
                                .foregroundColor(.textSecondary)
                                .frame(width: 28, height: 28)
                        }
                    }
                }
                .padding(8)
                .frame(width: 220)
                .background(isMine ? Color.dilarionRed.opacity(0.1) : Color.borderGrey.opacity(0.4))
                .cornerRadius(16)

                if let ts = media.timestamp {
                    Text(formatTimestamp(ts))
                        .font(.system(size: 9))
                        .foregroundColor(.textSecondary)
                }
            }
            if !isMine { Spacer() }
        }
    }
}

// Renders straight from in-memory Data — no permanent file for the common
// (PDF) case. Non-PDF real files fall back to QuickLook, which needs a file
// URL; that gets written to NSTemporaryDirectory right before presenting and
// deleted the moment the sheet closes (see .onDisappear below) — OS-purgeable
// scratch space, not a saved copy, same handling images/voice notes already get.
struct DocumentViewerSheet: View {
    let mediaId: String
    let data: Data?
    let onDismiss: () -> Void

    @State private var tempFileURL: URL? = nil

    var body: some View {
        NavigationStack {
            SwiftUI.Group {
                if let data, let pdf = PDFDocument(data: data) {
                    PDFKitView(document: pdf)
                } else if let url = tempFileURL {
                    QuickLookView(url: url)
                } else if data != nil {
                    ProgressView().onAppear { writeTempFileIfNeeded() }
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Document")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { onDismiss() }
                }
            }
        }
        .onDisappear {
            if let tempFileURL {
                try? FileManager.default.removeItem(at: tempFileURL)
            }
        }
    }

    private func writeTempFileIfNeeded() {
        guard tempFileURL == nil, let data else { return }
        let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("docpreview_\(UUID().uuidString)")
        try? data.write(to: url)
        tempFileURL = url
    }
}

private struct PDFKitView: UIViewRepresentable {
    let document: PDFDocument
    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.document = document
        view.autoScales = true
        return view
    }
    func updateUIView(_ uiView: PDFView, context: Context) {
        uiView.document = document
    }
}

private struct QuickLookView: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {
        uiViewController.reloadData()
    }

    class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as QLPreviewItem
        }
    }
}

// MARK: — Full-screen image viewer (WhatsApp-style)
struct ViewerImage: Identifiable {
    let path: String
    var id: String { path }
}

struct FullScreenImageViewer: View {
    let imagePath: String
    let onDismiss: () -> Void

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var showControls = true

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let uiImage = UIImage(contentsOfFile: imagePath) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in
                                scale = min(max(lastScale * value, 1), 5)
                            }
                            .onEnded { _ in
                                lastScale = scale
                                if scale <= 1 { resetZoom() }
                            }
                    )
                    .simultaneousGesture(
                        DragGesture()
                            .onChanged { value in
                                if scale > 1 {
                                    offset = CGSize(
                                        width: lastOffset.width + value.translation.width,
                                        height: lastOffset.height + value.translation.height
                                    )
                                } else {
                                    // Not zoomed — drag down to dismiss
                                    offset = CGSize(width: 0, height: max(0, value.translation.height))
                                }
                            }
                            .onEnded { value in
                                if scale > 1 {
                                    lastOffset = offset
                                } else if value.translation.height > 120 {
                                    onDismiss()
                                } else {
                                    withAnimation(.spring()) { offset = .zero }
                                }
                            }
                    )
                    .onTapGesture(count: 2) {
                        withAnimation(.spring()) {
                            if scale > 1 {
                                resetZoom()
                            } else {
                                scale = 2.5
                                lastScale = 2.5
                            }
                        }
                    }
                    .onTapGesture {
                        withAnimation { showControls.toggle() }
                    }
            }

            if showControls {
                VStack {
                    HStack {
                        Button(action: onDismiss) {
                            Image(systemName: "xmark")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(width: 38, height: 38)
                                .background(Color.white.opacity(0.15))
                                .clipShape(Circle())
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    Spacer()
                }
            }
        }
        .statusBarHidden()
    }

    private func resetZoom() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}

