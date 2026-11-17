package com.dilarion.app.ui.screens.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.saveable.rememberSaveable
import com.dilarion.app.data.model.CallHistoryItem
import com.dilarion.app.data.model.Message
import com.dilarion.app.ui.components.ConversationListSkeleton
import com.dilarion.app.ui.components.UserListSkeleton
import com.dilarion.app.ui.theme.*
import java.util.Locale

private enum class HomeTab(val label: String, val icon: ImageVector) {
    HOME("Home", Icons.Default.Home),
    DMS("DMs", Icons.Default.ChatBubble),
    CALLS("Calls", Icons.Default.Call),
    CALENDAR("Calendar", Icons.Default.CalendarMonth),
    TASKS("Tasks", Icons.Default.Checklist),
}

/** One direct-message conversation, newest message first in the list. */
private data class DmThread(val peer: String, val last: Message, val unread: Int)

private fun dmThreads(uiState: HomeUiState): List<DmThread> {
    val me = uiState.currentUsername
    return uiState.messages
        .filter { it.groupId == null }
        .groupBy { ((if (it.sender == me) it.recipient else it.sender) ?: "").ifEmpty { "Unknown" } }
        .map { (peer, msgs) ->
            val last = msgs.maxByOrNull { it.timestamp ?: "" } ?: msgs.first()
            DmThread(peer, last, msgs.count { !it.read && it.sender != me })
        }
        .sortedByDescending { it.last.timestamp ?: "" }
}

/**
 * Message bodies are end-to-end encrypted, so the list never shows text.
 * It says what kind of message it was and who sent it instead.
 */
private fun previewOf(msg: Message, me: String, unread: Int): String {
    val kind = when (msg.contentType?.lowercase()) {
        "image", "photo" -> "Photo"
        "video" -> "Video"
        "audio", "voice", "voice_note" -> "Voice note"
        "file", "document" -> "File"
        "sticker" -> "Sticker"
        else -> null
    }
    return when {
        msg.isDeleted -> "Message deleted"
        msg.sender == me -> "You: ${kind ?: "message sent"}"
        unread > 1 -> "$unread new messages"
        unread == 1 -> if (kind != null) "New ${kind.lowercase()}" else "New message"
        else -> kind ?: "Encrypted message"
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onOpenChat: (String) -> Unit,
    /** Redial someone straight from their call-history entry. */
    onCallUser: (String) -> Unit,
    /** Call everyone who was on a group call. */
    onRedialGroup: (Int) -> Unit = {},
    onOpenGroupChat: (Int, String) -> Unit,
    onNewChat: () -> Unit,
    onNewGroup: () -> Unit = {},
    onNewMeeting: () -> Unit,
    onMeetings: () -> Unit,
    onJoinMeeting: (joinCode: String, title: String?) -> Unit,
    onSettings: () -> Unit,
    onSearch: () -> Unit = {},
    onLogout: () -> Unit,
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedTab by remember { mutableStateOf(HomeTab.HOME) }
    var showLogoutDialog by remember { mutableStateOf(false) }
    var showJoinGroup by remember { mutableStateOf(false) }

    if (showJoinGroup) {
        com.dilarion.app.ui.screens.groups.JoinGroupDialog(
            onDismiss = { showJoinGroup = false },
            onJoined = { g -> showJoinGroup = false; viewModel.loadData(); onOpenGroupChat(g.id, g.name) },
        )
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Log out") },
            text  = { Text("Are you sure you want to log out?") },
            confirmButton = {
                TextButton(onClick = { showLogoutDialog = false; viewModel.logout(onLogout) }) {
                    Text("Log out", color = DilarionRed)
                }
            },
            dismissButton = { TextButton(onClick = { showLogoutDialog = false }) { Text("Cancel") } },
        )
    }

    Scaffold(
        bottomBar = {
            FloatingNavBar(
                selected = selectedTab,
                dmUnread = dmThreads(uiState).sumOf { it.unread },
                onSelect = { tab ->
                    selectedTab = tab
                    if (tab == HomeTab.CALLS) viewModel.loadCallHistory()
                },
            )
        },
        containerColor = SurfaceWhite,
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            when (selectedTab) {
                HomeTab.HOME -> HomeTabContent(
                    uiState = uiState,
                    onOpenChat = onOpenChat,
                    onOpenGroupChat = onOpenGroupChat,
                    onNewChat = onNewChat,
                    onNewGroup = onNewGroup,
                    onJoinGroup = { showJoinGroup = true },
                    onNewMeeting = onNewMeeting,
                    onMeetings = onMeetings,
                    onSearch = onSearch,
                    onSettings = onSettings,
                    onLogout = { showLogoutDialog = true },
                )
                HomeTab.DMS -> DmsTab(uiState, onOpenChat, onNewChat, onSearch)
                HomeTab.CALLS -> Column(Modifier.fillMaxSize()) {
                    TabHeader("Calls")
                    CallsTab(uiState, uiState.currentUsername, onCallUser, onRedialGroup)
                }
                HomeTab.CALENDAR -> Column(Modifier.fillMaxSize()) {
                    TabHeader("Calendar")
                    com.dilarion.app.ui.screens.calendar.CalendarScreen(onJoinMeeting = onJoinMeeting)
                }
                HomeTab.TASKS -> Column(Modifier.fillMaxSize()) {
                    TabHeader("Tasks")
                    com.dilarion.app.ui.screens.tasks.TasksScreen()
                }
            }
        }
    }
}

// ── Floating bottom bar ──────────────────────────────────────────────────────
// A rounded brand-colour pill that floats above the content. The selected tab
// gets a white chip with its label; the others show just the icon.

@Composable
private fun FloatingNavBar(selected: HomeTab, dmUnread: Int, onSelect: (HomeTab) -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(SurfaceWhite)
            .navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .shadow(12.dp, RoundedCornerShape(32.dp), ambientColor = DilarionRed, spotColor = DilarionRed)
                .clip(RoundedCornerShape(32.dp))
                .background(DilarionRed)
                .padding(horizontal = 8.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeTab.entries.forEach { tab ->
                val isSel = tab == selected
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(24.dp))
                        .background(if (isSel) SurfaceWhite else Color.Transparent)
                        .clickable { onSelect(tab) }
                        .animateContentSize()
                        .padding(horizontal = if (isSel) 14.dp else 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    BadgedBox(badge = {
                        if (tab == HomeTab.DMS && dmUnread > 0 && !isSel) {
                            Badge(containerColor = SurfaceWhite, contentColor = DilarionRed) {
                                Text(if (dmUnread > 99) "99+" else dmUnread.toString(), fontSize = 9.sp)
                            }
                        }
                    }) {
                        Icon(
                            tab.icon,
                            contentDescription = tab.label,
                            tint = if (isSel) DilarionRed else SurfaceWhite.copy(alpha = 0.85f),
                            modifier = Modifier.size(22.dp),
                        )
                    }
                    AnimatedVisibility(visible = isSel) {
                        Text(
                            tab.label,
                            color = DilarionRed,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(start = 6.dp),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TabHeader(title: String, action: (@Composable () -> Unit)? = null) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 8.dp, top = 12.dp, bottom = 8.dp)
            .heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = TextPrimary, modifier = Modifier.weight(1f))
        action?.invoke()
    }
}

@Composable
private fun JumpToField(placeholder: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(InputGrey)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.Search, null, tint = TextMuted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(placeholder, color = TextMuted, fontSize = 15.sp)
    }
}

// ── Home tab ─────────────────────────────────────────────────────────────────
// Profile header, "Jump to…" search, quick actions, then collapsible
// Channels / Groups / Direct messages sections — one place to see everything.

@Composable
private fun HomeTabContent(
    uiState: HomeUiState,
    onOpenChat: (String) -> Unit,
    onOpenGroupChat: (Int, String) -> Unit,
    onNewChat: () -> Unit,
    onNewGroup: () -> Unit,
    onJoinGroup: () -> Unit,
    onNewMeeting: () -> Unit,
    onMeetings: () -> Unit,
    onSearch: () -> Unit,
    onSettings: () -> Unit,
    onLogout: () -> Unit,
) {
    var channelsOpen by rememberSaveable { mutableStateOf(true) }
    var groupsOpen by rememberSaveable { mutableStateOf(true) }
    var dmsOpen by rememberSaveable { mutableStateOf(true) }
    var showGroupMenu by remember { mutableStateOf(false) }
    var showProfileMenu by remember { mutableStateOf(false) }
    val me = uiState.currentUsername
    val threads = dmThreads(uiState)
    val channels = uiState.channels.filter { !it.isArchived }

    // The skeleton is itself a scrolling list, so it must sit beside the
    // LazyColumn, never inside one of its items (that crashes on measure).
    val showSkeleton = uiState.isLoading && uiState.messages.isEmpty() && uiState.groups.isEmpty()
    Column(Modifier.fillMaxSize()) {
    LazyColumn(
        if (showSkeleton) Modifier.fillMaxWidth() else Modifier.fillMaxWidth().weight(1f),
        contentPadding = PaddingValues(bottom = 16.dp),
    ) {
        // Profile header
        item {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box {
                    Avatar(name = me.ifEmpty { "D" }, size = 44.dp, online = true)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(me.ifEmpty { "Dilarion" }, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Lock, null, tint = TextMuted, modifier = Modifier.size(11.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Dilarion · end-to-end encrypted", fontSize = 12.sp, color = TextSecondary)
                    }
                }
                IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "Settings", tint = TextPrimary) }
                Box {
                    IconButton(onClick = { showProfileMenu = true }) { Icon(Icons.Default.MoreVert, "More", tint = TextPrimary) }
                    DropdownMenu(expanded = showProfileMenu, onDismissRequest = { showProfileMenu = false }) {
                        DropdownMenuItem(
                            text = { Text("Log out", color = DilarionRed) },
                            leadingIcon = { Icon(Icons.Default.ExitToApp, null, tint = DilarionRed) },
                            onClick = { showProfileMenu = false; onLogout() },
                        )
                    }
                }
            }
        }
        item { JumpToField("Jump to…", onSearch) }

        // Quick actions
        item {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                QuickAction(Icons.Default.Videocam, "Meet now", Modifier.weight(1f), onNewMeeting)
                QuickAction(Icons.Default.Event, "Meetings", Modifier.weight(1f), onMeetings)
                QuickAction(Icons.Default.Edit, "New chat", Modifier.weight(1f), onNewChat)
            }
        }

        if (showSkeleton) return@LazyColumn

        // Channels
        item {
            SectionHeader("Channels", channelsOpen, channels.sumOf { it.unreadCount }, onToggle = { channelsOpen = !channelsOpen })
        }
        if (channelsOpen) {
            if (channels.isEmpty()) {
                item { SectionHint("Channels in your organization show up here") }
            }
            items(channels, key = { "channel_${it.id}" }) { channel ->
                SidebarRow(
                    leading = { Text("#", fontSize = 18.sp, color = if (channel.unreadCount > 0) TextPrimary else TextMuted, fontWeight = FontWeight.Medium) },
                    title = channel.name,
                    unread = channel.unreadCount,
                    onClick = { onOpenGroupChat(channel.id, channel.name) },
                )
            }
        }

        // Groups
        item {
            SectionHeader(
                "Groups", groupsOpen,
                unread = uiState.groups.sumOf { g -> uiState.messages.count { it.groupId == g.id && !it.read && it.sender != me } },
                onToggle = { groupsOpen = !groupsOpen },
                action = {
                    Box {
                        SectionAddButton("New group") { showGroupMenu = true }
                        DropdownMenu(expanded = showGroupMenu, onDismissRequest = { showGroupMenu = false }) {
                            DropdownMenuItem(
                                text = { Text("New group") },
                                leadingIcon = { Icon(Icons.Default.GroupAdd, null) },
                                onClick = { showGroupMenu = false; onNewGroup() },
                            )
                            DropdownMenuItem(
                                text = { Text("Join via link or QR") },
                                leadingIcon = { Icon(Icons.Default.QrCodeScanner, null) },
                                onClick = { showGroupMenu = false; onJoinGroup() },
                            )
                        }
                    }
                },
            )
        }
        if (groupsOpen) {
            if (uiState.groups.isEmpty()) {
                item { SectionHint("Tap + to create or join a group") }
            }
            items(uiState.groups, key = { "group_${it.id}" }) { group ->
                val unread = uiState.messages.count { it.groupId == group.id && !it.read && it.sender != me }
                SidebarRow(
                    leading = { Icon(Icons.Default.Group, null, tint = if (unread > 0) TextPrimary else TextMuted, modifier = Modifier.size(18.dp)) },
                    title = group.name,
                    unread = unread,
                    onClick = { onOpenGroupChat(group.id, group.name) },
                )
            }
        }

        // Direct messages
        item {
            SectionHeader(
                "Direct messages", dmsOpen, threads.sumOf { it.unread },
                onToggle = { dmsOpen = !dmsOpen },
                action = { SectionAddButton("New chat", onNewChat) },
            )
        }
        if (dmsOpen) {
            if (threads.isEmpty()) {
                item { SectionHint("Tap + to find people and start a chat") }
            }
            items(threads, key = { "dm_${it.peer}" }) { t ->
                SidebarRow(
                    leading = { Avatar(t.peer, size = 26.dp, corner = 7.dp) },
                    title = t.peer,
                    unread = t.unread,
                    onClick = { onOpenChat(t.peer) },
                )
            }
        }
    }
    if (showSkeleton) Box(Modifier.fillMaxWidth().weight(1f)) { ConversationListSkeleton() }
    }
}

@Composable
private fun QuickAction(icon: ImageVector, label: String, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(DilarionRedSoft)
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(4.dp))
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = DilarionRedDark)
    }
}

@Composable
private fun SectionHeader(
    title: String,
    open: Boolean,
    unread: Int,
    onToggle: () -> Unit,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(start = 12.dp, end = 8.dp, top = 10.dp, bottom = 4.dp)
            .heightIn(min = 36.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            Icons.Default.KeyboardArrowDown, null,
            tint = TextSecondary,
            modifier = Modifier.size(20.dp).rotate(if (open) 0f else -90f),
        )
        Spacer(Modifier.width(4.dp))
        Text(title, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TextPrimary)
        if (!open && unread > 0) {
            Spacer(Modifier.width(8.dp))
            UnreadBadge(unread)
        }
        Spacer(Modifier.weight(1f))
        action?.invoke()
    }
}

@Composable
private fun SectionAddButton(description: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(30.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(InputGrey)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Default.Add, description, tint = TextPrimary, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun SectionHint(text: String) {
    Text(text, fontSize = 13.sp, color = TextMuted, modifier = Modifier.padding(start = 40.dp, top = 2.dp, bottom = 6.dp))
}

@Composable
private fun SidebarRow(leading: @Composable () -> Unit, title: String, unread: Int, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(start = 18.dp, end = 16.dp, top = 9.dp, bottom = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(26.dp), contentAlignment = Alignment.Center) { leading() }
        Spacer(Modifier.width(12.dp))
        Text(
            title,
            fontSize = 15.sp,
            fontWeight = if (unread > 0) FontWeight.Bold else FontWeight.Normal,
            color = if (unread > 0) TextPrimary else TextSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (unread > 0) UnreadBadge(unread)
    }
}

@Composable
private fun UnreadBadge(count: Int) {
    Box(
        modifier = Modifier
            .heightIn(min = 20.dp)
            .widthIn(min = 20.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(DilarionRed)
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), color = SurfaceWhite, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}

/** Initial-letter avatar on a colour picked from the name, so people are easy to tell apart. */
@Composable
private fun Avatar(name: String, size: androidx.compose.ui.unit.Dp, corner: androidx.compose.ui.unit.Dp = size / 3, online: Boolean = false) {
    val palette = listOf(
        DilarionRed, Color(0xFF2563EB), Color(0xFF059669), Color(0xFFD97706),
        Color(0xFF7C3AED), Color(0xFFDB2777), Color(0xFF0891B2), Color(0xFF4B5563),
    )
    val bg = palette[(name.lowercase().hashCode() and 0x7fffffff) % palette.size]
    Box {
        Box(
            modifier = Modifier.size(size).clip(RoundedCornerShape(corner)).background(bg),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                name.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                color = SurfaceWhite,
                fontSize = (size.value * 0.42f).sp,
                fontWeight = FontWeight.Bold,
            )
        }
        if (online) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .offset(x = 2.dp, y = 2.dp)
                    .size(12.dp)
                    .clip(CircleShape)
                    .background(SurfaceWhite)
                    .padding(2.dp)
                    .clip(CircleShape)
                    .background(OnlineGreen),
            )
        }
    }
}

// ── DMs tab ──────────────────────────────────────────────────────────────────

@Composable
private fun DmsTab(uiState: HomeUiState, onOpenChat: (String) -> Unit, onNewChat: () -> Unit, onSearch: () -> Unit) {
    val threads = dmThreads(uiState)
    Column(Modifier.fillMaxSize()) {
        TabHeader("Direct messages") {
            IconButton(onClick = onNewChat) { Icon(Icons.Default.Edit, "New chat", tint = TextPrimary) }
        }
        JumpToField("Find a DM", onSearch)
        Spacer(Modifier.height(8.dp))
        when {
            uiState.isLoading && threads.isEmpty() -> ConversationListSkeleton()
            threads.isEmpty() -> EmptyState(Icons.Default.ChatBubble, "No chats yet", "Tap the pencil to find people and start a chat")
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 4.dp)) {
                items(threads, key = { "dmrow_${it.peer}" }) { t ->
                    DmRow(t, uiState.currentUsername) { onOpenChat(t.peer) }
                }
            }
        }
    }
}

@Composable
private fun DmRow(t: DmThread, me: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(t.peer, size = 48.dp, corner = 14.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    t.peer,
                    fontSize = 16.sp,
                    fontWeight = if (t.unread > 0) FontWeight.Bold else FontWeight.SemiBold,
                    color = TextPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    formatTime(t.last.timestamp ?: ""),
                    fontSize = 12.sp,
                    color = if (t.unread > 0) DilarionRed else TextMuted,
                    fontWeight = if (t.unread > 0) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    previewOf(t.last, me, t.unread),
                    fontSize = 14.sp,
                    color = if (t.unread > 0) TextPrimary else TextSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (t.unread > 0) {
                    Spacer(Modifier.width(8.dp))
                    UnreadBadge(t.unread)
                }
            }
        }
    }
}

// ── Calls Tab ────────────────────────────────────────────────────────────────

@Composable
private fun CallsTab(
    uiState: HomeUiState,
    currentUsername: String,
    onCallUser: (String) -> Unit,
    onRedialGroup: (Int) -> Unit,
) {
    if (uiState.isCallHistoryLoading) {
        UserListSkeleton(count = 6)
        return
    }

    if (uiState.callHistory.isEmpty()) {
        EmptyState(Icons.Default.Call, "No calls yet", "Your call history will appear here")
        return
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
        items(uiState.callHistory, key = { "call_${it.id}" }) { call ->
            CallHistoryRow(call, currentUsername, onCallUser, onRedialGroup)
        }
    }
}

@Composable
private fun CallHistoryRow(
    call: CallHistoryItem,
    currentUsername: String,
    onCallUser: (String) -> Unit,
    onRedialGroup: (Int) -> Unit,
) {
    val isOutgoing = call.isCaller
    val peer = if (call.isGroup) (call.otherPartyUsername ?: "Group call") else (call.otherPartyUsername ?: "Unknown")
    val isVideo = call.callType == "video"
    val missed = call.status == "declined" || call.status == "missed" || call.status == "busy"

    val canCallBack = if (call.isGroup) call.conferenceId != null else call.otherPartyUsername != null && peer != currentUsername
    val callBack = {
        val confId = call.conferenceId
        if (call.isGroup && confId != null) onRedialGroup(confId) else onCallUser(peer)
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(SurfaceWhite)
            .then(if (canCallBack) Modifier.clickable { callBack() } else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(DilarionRedSoft),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                peer.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                color = DilarionRed, fontSize = 19.sp, fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(peer, style = MaterialTheme.typography.titleMedium, maxLines = 1)
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (isOutgoing) Icons.Default.CallMade else Icons.Default.CallReceived,
                    null,
                    modifier = Modifier.size(14.dp),
                    tint = if (missed) DilarionRed else OnlineGreen,
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    buildString {
                        append(
                            if (call.isGroup) "Group call"
                            else if (isOutgoing) "Outgoing"
                            else if (call.answeredElsewhere) "Answered on another device"
                            else if (missed) "Missed" else "Incoming"
                        )
                        append(" · ")
                        append(if (isVideo) "Video" else "Voice")
                        if (call.duration > 0) append(" · ${formatDuration(call.duration)}")
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = if (missed) DilarionRed else TextSecondary,
                )
            }
        }
        Text(
            formatTime(call.startedAt ?: ""),
            style = MaterialTheme.typography.labelSmall,
            color = TextSecondary,
        )
        if (canCallBack) {
            IconButton(onClick = { callBack() }) {
                Icon(
                    if (isVideo) Icons.Default.Videocam else Icons.Default.Call,
                    "Call $peer back",
                    tint = OnlineGreen,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }
    }

// ── Shared components ─────────────────────────────────────────────────────────

@Composable
private fun EmptyState(icon: ImageVector, title: String, subtitle: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(40.dp)) {
            Icon(icon, null, modifier = Modifier.size(64.dp), tint = TextSecondary.copy(alpha = 0.3f))
            Spacer(Modifier.height(12.dp))
            Text(title, style = MaterialTheme.typography.titleMedium, color = TextSecondary)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = TextSecondary.copy(alpha = 0.7f))
        }
    }
}

private fun formatTime(iso: String): String = runCatching {
    // Server times are UTC with a +00:00 offset; convert to the device's own
    // zone so the list shows the viewer's real local time (WAT in West Africa).
    val zoned = runCatching {
        java.time.OffsetDateTime.parse(iso).atZoneSameInstant(java.time.ZoneId.systemDefault())
    }.getOrElse {
        java.time.LocalDateTime.parse(iso).atZone(java.time.ZoneOffset.UTC)
            .withZoneSameInstant(java.time.ZoneId.systemDefault())
    }
    val diffHours = (System.currentTimeMillis() - zoned.toInstant().toEpochMilli()) / 3_600_000
    val pattern = when {
        diffHours < 24  -> "HH:mm"
        diffHours < 168 -> "EEE"
        else            -> "dd/MM/yy"
    }
    zoned.format(java.time.format.DateTimeFormatter.ofPattern(pattern, Locale.getDefault()))
}.getOrElse { "" }

private fun formatDuration(seconds: Int) = "%02d:%02d".format(seconds / 60, seconds % 60)
