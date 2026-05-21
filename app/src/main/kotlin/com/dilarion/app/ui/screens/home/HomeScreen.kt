package com.dilarion.app.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dilarion.app.data.model.Group
import com.dilarion.app.data.model.Message
import com.dilarion.app.ui.theme.*
import java.text.SimpleDateFormat
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onOpenChat: (String) -> Unit,
    onOpenGroupChat: (Int, String) -> Unit,
    onLogout: () -> Unit,
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var showLogoutDialog by remember { mutableStateOf(false) }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Log out") },
            text  = { Text("Are you sure you want to log out?") },
            confirmButton = {
                TextButton(onClick = { showLogoutDialog = false; onLogout() }) {
                    Text("Log out", color = DilarionRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) { Text("Cancel") }
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "Dilarion",
                            style = MaterialTheme.typography.titleLarge,
                            color = SurfaceWhite,
                        )
                        Text(
                            "🔒 end-to-end encrypted",
                            fontSize = 10.sp,
                            color = SurfaceWhite.copy(alpha = 0.75f),
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
                actions = {
                    IconButton(onClick = { showLogoutDialog = true }) {
                        Icon(Icons.Default.ExitToApp, "Logout", tint = SurfaceWhite)
                    }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { /* TODO: open new chat */ },
                containerColor = DilarionRed,
            ) {
                Icon(Icons.Default.Add, "New chat", tint = SurfaceWhite)
            }
        },
        containerColor = BackgroundGrey,
    ) { innerPadding ->
        if (uiState.isLoading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = DilarionRed)
            }
            return@Scaffold
        }

        val me = uiState.currentUsername

        // Group DM threads by peer username
        val dmThreads = uiState.messages
            .filter { it.groupId == null }
            .groupBy { if (it.sender == me) it.recipient else it.sender }
            .map { (peer, msgs) ->
                val last = msgs.maxByOrNull { it.timestamp } ?: msgs.first()
                val unread = msgs.count { !it.read && it.sender != me }
                Triple(peer, last, unread)
            }
            .sortedByDescending { it.second.timestamp }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
            contentPadding = PaddingValues(vertical = 8.dp),
        ) {

            // ── Group chats ──────────────────────────────────────────────────
            items(uiState.groups, key = { "group_${it.id}" }) { group ->
                val groupMsgs = uiState.messages.filter { it.groupId == group.id }
                val last = groupMsgs.maxByOrNull { it.timestamp }
                val unread = groupMsgs.count { !it.read }
                ConversationRow(
                    title    = group.name,
                    subtitle = last?.decoyContent ?: "No messages yet",
                    time     = last?.timestamp ?: group.createdAt,
                    unread   = unread,
                    isGroup  = true,
                    onClick  = { onOpenGroupChat(group.id, group.name) },
                )
            }

            // ── DM threads ───────────────────────────────────────────────────
            items(dmThreads, key { "dm_${it.first}" }) { (peer, last, unread) ->
                ConversationRow(
                    title    = peer,
                    subtitle = last.decoyContent,
                    time     = last.timestamp,
                    unread   = unread,
                    isGroup  = false,
                    onClick  = { onOpenChat(peer) },
                )
            }

            if (uiState.groups.isEmpty() && dmThreads.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillParentMaxSize()
                            .padding(40.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                Icons.Default.Add,
                                null,
                                modifier = Modifier.size(64.dp),
                                tint = TextSecondary.copy(alpha = 0.3f),
                            )
                            Spacer(Modifier.height(12.dp))
                            Text(
                                "No messages yet",
                                style = MaterialTheme.typography.titleMedium,
                                color = TextSecondary,
                            )
                            Text(
                                "Tap + to find people and start a chat",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondary.copy(alpha = 0.7f),
                            )
                        }
                    }
                }
            }
        }
    }
}

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

        // Avatar
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
                    color = SurfaceWhite,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
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
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (unread > 0) {
                    Box(
                        modifier = Modifier
                            .size(20.dp)
                            .clip(CircleShape)
                            .background(DilarionRed),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (unread > 99) "99+" else unread.toString(),
                            color = SurfaceWhite,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }

    Divider(
        modifier = Modifier.padding(start = 78.dp),
        color = BorderGrey,
        thickness = 0.5.dp,
    )
}

private fun formatTime(iso: String): String {
    return runCatching {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        val date = sdf.parse(iso) ?: return ""
        val now = java.util.Date()
        val diffMs = now.time - date.time
        val diffHours = diffMs / (1000 * 60 * 60)
        when {
            diffHours < 24  -> SimpleDateFormat("HH:mm", Locale.getDefault()).format(date)
            diffHours < 168 -> SimpleDateFormat("EEE", Locale.getDefault()).format(date)
            else            -> SimpleDateFormat("dd/MM/yy", Locale.getDefault()).format(date)
        }
    }.getOrElse { "" }
}
