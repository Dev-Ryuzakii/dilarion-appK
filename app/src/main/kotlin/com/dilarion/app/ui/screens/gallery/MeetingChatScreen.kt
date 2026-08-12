package com.dilarion.app.ui.screens.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.Message
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite

/**
 * In-meeting encrypted chat — a fullscreen dialog over the gallery, not a
 * nav destination, since it's ephemeral to the call. Scoped by conference_id;
 * key-fanout targets whoever is currently in [participantUsernames].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeetingChatSheet(
    conferenceId: Int,
    participantUsernames: List<String>,
    onDismiss: () -> Unit,
    viewModel: MeetingChatViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var text by remember { mutableStateOf("") }
    var unlockTarget by remember { mutableStateOf<Int?>(null) }
    var unlockError by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()

    LaunchedEffect(conferenceId) { viewModel.init(conferenceId) }

    LaunchedEffect(Unit) {
        viewModel.events.collect { msg ->
            if (msg.type == "new_conference_message") {
                val evtConfId = msg.data?.get("conference_id")?.takeIf { !it.isJsonNull }?.asInt
                if (evtConfId == conferenceId) viewModel.loadMessages()
            }
        }
    }

    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.size - 1)
    }

    unlockTarget?.let { messageId ->
        AlertDialog(
            onDismissRequest = { unlockTarget = null; unlockError = null },
            title = { Text("Enter Master Token") },
            text = {
                Column {
                    var token by remember { mutableStateOf("") }
                    OutlinedTextField(
                        value = token,
                        onValueChange = { token = it },
                        label = { Text("Master Token") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    unlockError?.let { Text(it, color = Color(0xFFEF4444), style = MaterialTheme.typography.bodySmall) }
                    Button(onClick = {
                        val ok = viewModel.unlock(token, messageId)
                        if (ok) { unlockTarget = null; unlockError = null } else unlockError = "Incorrect master token"
                    }, modifier = Modifier.padding(top = 8.dp)) { Text("Unlock") }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { unlockTarget = null; unlockError = null }) { Text("Cancel") } },
        )
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Scaffold(
            containerColor = Color(0xFF0B0B10),
            topBar = {
                TopAppBar(
                    navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite) } },
                    title = { Text("In-meeting chat", color = SurfaceWhite, style = MaterialTheme.typography.titleMedium) },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
                )
            },
            bottomBar = {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it },
                        placeholder = { Text("Message everyone in the meeting…") },
                        modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                            focusedBorderColor = DilarionRed, unfocusedBorderColor = Color.White.copy(alpha = 0.3f),
                        ),
                    )
                    FilledIconButton(
                        onClick = {
                            if (text.isNotBlank()) { viewModel.sendMessage(text, participantUsernames); text = "" }
                        },
                        enabled = !state.sending,
                    ) { Icon(Icons.Default.Send, "Send") }
                }
            },
        ) { padding ->
            LazyColumn(
                state = listState,
                modifier = Modifier.padding(padding).fillMaxSize(),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(state.messages, key = { it.id }) { msg ->
                    MeetingChatBubble(
                        msg = msg,
                        isMine = msg.sender == state.currentUsername,
                        unlocked = state.unlockedIds.contains(msg.id),
                        decrypted = state.decryptedTexts[msg.id],
                        onTap = { unlockTarget = msg.id },
                    )
                }
            }
        }
    }
}

@Composable
private fun MeetingChatBubble(
    msg: Message,
    isMine: Boolean,
    unlocked: Boolean,
    decrypted: String?,
    onTap: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isMine) Alignment.End else Alignment.Start,
    ) {
        if (!isMine) {
            Text(msg.sender ?: "", color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 4.dp, bottom = 2.dp))
        }
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(12.dp))
                .background(if (isMine) Color(0xFF25D366).copy(alpha = 0.15f) else Color.White.copy(alpha = 0.06f))
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            if (unlocked && decrypted != null) {
                Text(decrypted, color = Color.White, style = MaterialTheme.typography.bodyMedium)
            } else {
                Text(
                    msg.decoyContent?.takeIf { it.isNotBlank() } ?: "…",
                    color = Color.White.copy(alpha = 0.6f),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.clickableNoRipple(onTap),
                )
            }
        }
    }
}

@Composable
private fun Modifier.clickableNoRipple(onClick: () -> Unit): Modifier {
    return this.clickable(
        indication = null,
        interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
        onClick = onClick,
    )
}
