package com.dilarion.app.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.collectAsState
import com.dilarion.app.data.model.CallHistoryItem
import com.dilarion.app.data.model.Group
import com.dilarion.app.data.model.Message
import com.dilarion.app.ui.components.ConversationListSkeleton
import com.dilarion.app.ui.components.UserListSkeleton
import com.dilarion.app.ui.theme.*
import java.text.SimpleDateFormat
import java.util.Locale

private enum class HomeTab { CHATS, GROUPS, MEETINGS, CALENDAR, CALLS }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onOpenChat: (String) -> Unit,
    /** Redial someone straight from their call-history entry. */
    onCallUser: (String) -> Unit,
    onOpenGroupChat: (Int, String) -> Unit,
    onNewChat: () -> Unit,
    onNewMeeting: () -> Unit,
    onMeetings: () -> Unit,
    onJoinMeeting: (joinCode: String, title: String?) -> Unit,
    onSettings: () -> Unit,
    onLogout: () -> Unit,
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedTab by remember { mutableStateOf(HomeTab.CHATS) }
    var showLogoutDialog by remember { mutableStateOf(false) }

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
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Dilarion", style = MaterialTheme.typography.titleLarge, color = SurfaceWhite)
                        Text("end-to-end encrypted", fontSize = 10.sp, color = SurfaceWhite.copy(alpha = 0.75f))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
                actions = {
                    IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "Settings", tint = SurfaceWhite) }
                    IconButton(onClick = { showLogoutDialog = true }) { Icon(Icons.Default.ExitToApp, "Logout", tint = SurfaceWhite) }
                },
            )
        },
        bottomBar = {
            NavigationBar(containerColor = SurfaceWhite, tonalElevation = 8.dp) {
                NavigationBarItem(
                    selected = selectedTab == HomeTab.CHATS,
                    onClick = { selectedTab = HomeTab.CHATS },
                    icon = { Icon(Icons.Default.ChatBubble, "Chats") },
                    label = { Text("Chats") },
                    colors = NavigationBarItemDefaults.colors(indicatorColor = DilarionRed.copy(alpha = 0.12f), selectedIconColor = DilarionRed, selectedTextColor = DilarionRed),
                )
                NavigationBarItem(
                    selected = selectedTab == HomeTab.GROUPS,
                    onClick = { selectedTab = HomeTab.GROUPS },
                    icon = { Icon(Icons.Default.Group, "Groups") },
                    label = { Text("Groups") },
                    colors = NavigationBarItemDefaults.colors(indicatorColor = DilarionRed.copy(alpha = 0.12f), selectedIconColor = DilarionRed, selectedTextColor = DilarionRed),
                )
                NavigationBarItem(
                    selected = selectedTab == HomeTab.MEETINGS,
                    onClick = { selectedTab = HomeTab.MEETINGS },
                    icon = { Icon(Icons.Default.Videocam, "Meetings") },
                    label = { Text("Meetings") },
                    colors = NavigationBarItemDefaults.colors(indicatorColor = DilarionRed.copy(alpha = 0.12f), selectedIconColor = DilarionRed, selectedTextColor = DilarionRed),
                )
                NavigationBarItem(
                    selected = selectedTab == HomeTab.CALENDAR,
                    onClick = { selectedTab = HomeTab.CALENDAR },
                    icon = { Icon(Icons.Default.CalendarMonth, "Calendar") },
                    label = { Text("Calendar") },
                    colors = NavigationBarItemDefaults.colors(indicatorColor = DilarionRed.copy(alpha = 0.12f), selectedIconColor = DilarionRed, selectedTextColor = DilarionRed),
                )
                NavigationBarItem(
                    selected = selectedTab == HomeTab.CALLS,
                    onClick = {
                        selectedTab = HomeTab.CALLS
                        viewModel.loadCallHistory()
                    },
                    icon = { Icon(Icons.Default.Call, "Calls") },
                    label = { Text("Calls") },
                    colors = NavigationBarItemDefaults.colors(indicatorColor = DilarionRed.copy(alpha = 0.12f), selectedIconColor = DilarionRed, selectedTextColor = DilarionRed),
                )
            }
        },
        floatingActionButton = {
            if (selectedTab == HomeTab.CHATS) {
                FloatingActionButton(onClick = onNewChat, containerColor = DilarionRed) {
                    Icon(Icons.Default.Add, "New chat", tint = SurfaceWhite)
                }
            }
        },
        containerColor = BackgroundGrey,
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            when (selectedTab) {
                HomeTab.CHATS    -> ChatsTab(uiState, onOpenChat)
                HomeTab.GROUPS   -> GroupsTab(uiState, onOpenGroupChat)
                HomeTab.MEETINGS -> MeetingsTab(onNewMeeting, onMeetings)
                HomeTab.CALENDAR -> com.dilarion.app.ui.screens.calendar.CalendarScreen(onJoinMeeting = onJoinMeeting)
                HomeTab.CALLS    -> CallsTab(uiState, uiState.currentUsername, onCallUser)
            }
        }
    }
}

// ── Meetings Tab ─────────────────────────────────────────────────────────────
// Consolidates the two things that used to be small top-bar icon buttons.

@Composable
private fun MeetingsTab(onNewMeeting: () -> Unit, onMeetings: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        MeetingsTabCard(
            icon = Icons.Default.Videocam,
            title = "Start Instant Meeting",
            subtitle = "Group video — invite anyone, add more later",
            onClick = onNewMeeting,
        )
        MeetingsTabCard(
            icon = Icons.Default.CalendarMonth,
            title = "Scheduled Meetings",
            subtitle = "Upcoming, join by code, or schedule a new one",
            onClick = onMeetings,
        )
    }
}

@Composable
private fun MeetingsTabCard(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(SurfaceWhite)
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(40.dp).clip(CircleShape).background(DilarionRed),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = SurfaceWhite)
        }
        Spacer(Modifier.width(14.dp))
        Column {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(subtitle, fontSize = 12.sp, color = Color.Gray)
        }
    }
}

// ── Chats Tab ────────────────────────────────────────────────────────────────

@Composable
private fun ChatsTab(uiState: HomeUiState, onOpenChat: (String) -> Unit) {
    val me = uiState.currentUsername
    val threads = uiState.messages
        .filter { it.groupId == null }
        .groupBy { ((if (it.sender == me) it.recipient else it.sender) ?: "").ifEmpty { "Unknown" } }
        .map { (peer, msgs) ->
            val last = msgs.maxByOrNull { it.timestamp ?: "" } ?: msgs.first()
            val unread = msgs.count { !it.read && it.sender != me }
            Triple(peer, last, unread)
        }
        .sortedByDescending { it.second.timestamp ?: "" }

    if (uiState.isLoading) {
        ConversationListSkeleton()
        return
    }

    if (threads.isEmpty()) {
        EmptyState(Icons.Default.ChatBubble, "No chats yet", "Tap + to find people and start a chat")
        return
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
        items(threads, key = { "dm_${it.first}" }) { (peer, last, unread) ->
            ConversationRow(
                title    = peer,
                subtitle = "",
                time     = last.timestamp ?: "",
                unread   = unread,
                isGroup  = false,
                onClick  = { onOpenChat(peer) },
            )
        }
    }
}

// ── Groups Tab ───────────────────────────────────────────────────────────────

@Composable
private fun GroupsTab(uiState: HomeUiState, onOpenGroupChat: (Int, String) -> Unit) {
    if (uiState.isLoading) {
        ConversationListSkeleton()
        return
    }

    if (uiState.groups.isEmpty()) {
        EmptyState(Icons.Default.Group, "No groups yet", "Tap + to create a group")
        return
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
        items(uiState.groups, key = { "group_${it.id}" }) { group ->
            val groupMsgs = uiState.messages.filter { it.groupId == group.id }
            val unread = groupMsgs.count { !it.read }
            ConversationRow(
                title    = group.name,
                subtitle = if (groupMsgs.isEmpty()) "No messages yet" else "",
                time     = groupMsgs.maxByOrNull { it.timestamp ?: "" }?.timestamp ?: group.createdAt,
                unread   = unread,
                isGroup  = true,
                onClick  = { onOpenGroupChat(group.id, group.name) },
            )
        }
    }
}

// ── Calls Tab ────────────────────────────────────────────────────────────────

@Composable
private fun CallsTab(
    uiState: HomeUiState,
    currentUsername: String,
    onCallUser: (String) -> Unit,
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
            CallHistoryRow(call, currentUsername, onCallUser)
        }
    }
}

@Composable
private fun CallHistoryRow(
    call: CallHistoryItem,
    currentUsername: String,
    onCallUser: (String) -> Unit,
) {
    val isOutgoing = call.isCaller
    val peer = call.otherPartyUsername ?: "Unknown"
    val isVideo = call.callType == "video"
    val missed = call.status == "declined" || call.status == "missed" || call.status == "busy"

    val canCallBack = call.otherPartyUsername != null && peer != currentUsername

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(SurfaceWhite)
            .then(if (canCallBack) Modifier.clickable { onCallUser(peer) } else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(50.dp).clip(CircleShape).background(DilarionRed),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                peer.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                color = SurfaceWhite, fontSize = 20.sp, fontWeight = FontWeight.Bold,
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
                        append(if (isOutgoing) "Outgoing" else if (missed) "Missed" else "Incoming")
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
            IconButton(onClick = { onCallUser(peer) }) {
                Icon(
                    if (isVideo) Icons.Default.Videocam else Icons.Default.Call,
                    "Call $peer back",
                    tint = OnlineGreen,
                    modifier = Modifier.size(22.dp),
                )
            }
        }
    }
    HorizontalDivider(modifier = Modifier.padding(start = 78.dp), color = BorderGrey, thickness = 0.5.dp)
}

// ── Shared components ─────────────────────────────────────────────────────────

@Composable
private fun ConversationRow(
    title: String,
    subtitle: String,
    time: String,
    unread: Int,
    isGroup: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(SurfaceWhite)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(50.dp)
                .clip(CircleShape)
                .background(if (isGroup) DilarionRed.copy(alpha = 0.12f) else DilarionRed),
            contentAlignment = Alignment.Center,
        ) {
            if (isGroup) {
                Icon(Icons.Default.Group, null, tint = DilarionRed, modifier = Modifier.size(26.dp))
            } else {
                Text(
                    title.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                    color = SurfaceWhite, fontSize = 20.sp, fontWeight = FontWeight.Bold,
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    formatTime(time),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (unread > 0) DilarionRed else TextSecondary,
                )
            }
            Spacer(Modifier.height(2.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (subtitle.isNotEmpty()) {
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    Spacer(Modifier.weight(1f))
                }
                if (unread > 0) {
                    Box(
                        modifier = Modifier.size(20.dp).clip(CircleShape).background(DilarionRed),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (unread > 99) "99+" else unread.toString(),
                            color = SurfaceWhite, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
    HorizontalDivider(modifier = Modifier.padding(start = 78.dp), color = BorderGrey, thickness = 0.5.dp)
}

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
    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
    val date = sdf.parse(iso) ?: return ""
    val diffHours = (System.currentTimeMillis() - date.time) / 3_600_000
    when {
        diffHours < 24  -> SimpleDateFormat("HH:mm", Locale.getDefault()).format(date)
        diffHours < 168 -> SimpleDateFormat("EEE", Locale.getDefault()).format(date)
        else            -> SimpleDateFormat("dd/MM/yy", Locale.getDefault()).format(date)
    }
}.getOrElse { "" }

private fun formatDuration(seconds: Int) = "%02d:%02d".format(seconds / 60, seconds % 60)
