package com.dilarion.app.ui.screens.calls

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.services.NotificationHelper
import com.dilarion.app.ui.theme.*
import kotlinx.coroutines.launch

/**
 * Someone is adding us to a call already in progress.
 *
 * This rings and waits like any other incoming call: the invite alone must not
 * attach a microphone to a conversation nobody agreed to join, and answering
 * requires the master token exactly as a direct call does.
 */
@Composable
fun IncomingConferenceOverlay(
    invite: ConferenceInviteData,
    onDismiss: () -> Unit,
    onJoined: (Int) -> Unit,
) {
    val viewModel: CallViewModel = hiltViewModel(LocalContext.current as ComponentActivity)

    val scope = rememberCoroutineScope()
    var showTokenDialog by remember { mutableStateOf(false) }
    var rejected by remember { mutableStateOf(false) }
    var joining by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val context = LocalContext.current
    DisposableEffect(invite.conferenceId) {
        NotificationHelper.startRingtone(context)
        onDispose { NotificationHelper.stopRingtone() }
    }

    if (showTokenDialog) {
        MasterTokenJoinDialog(
            rejected = rejected,
            onDismiss = { showTokenDialog = false },
            onConfirm = { entered ->
                showTokenDialog = false
                joining = true
                scope.launch {
                    val failure = viewModel.acceptConferenceForGallery(invite.conferenceId, entered)
                    joining = false
                    if (failure == null) {
                        NotificationHelper.stopRingtone()
                        onJoined(invite.conferenceId)
                    } else if (failure == "Master token rejected") {
                        // Keep ringing so a typo can be corrected.
                        rejected = true
                        showTokenDialog = true
                    } else {
                        error = failure
                    }
                }
            },
        )
    }

    error?.let { message ->
        AlertDialog(
            onDismissRequest = { error = null; onDismiss() },
            title = { Text("Could not join") },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = { error = null; onDismiss() }) { Text("OK") }
            },
        )
    }

    Box(
        modifier = Modifier.fillMaxSize().background(CallBackground),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxSize().padding(24.dp),
        ) {
            Spacer(Modifier.weight(1f))

            Icon(
                Icons.Default.Groups, null,
                tint = SurfaceWhite.copy(alpha = 0.6f),
                modifier = Modifier.size(32.dp),
            )
            Spacer(Modifier.height(10.dp))
            Text(
                "Group call",
                color = SurfaceWhite.copy(alpha = 0.7f),
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "${invite.invitedBy} is adding you",
                color = SurfaceWhite,
                fontSize = 24.sp,
                textAlign = TextAlign.Center,
            )
            if (invite.existingParticipants.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                Text(
                    "Already on the call: " + invite.existingParticipants.joinToString(", "),
                    color = SurfaceWhite.copy(alpha = 0.55f),
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center,
                )
            }

            Spacer(Modifier.weight(1f))

            if (joining) {
                CircularProgressIndicator(color = SurfaceWhite)
                Spacer(Modifier.height(12.dp))
                Text("Joining…", color = SurfaceWhite.copy(alpha = 0.7f), fontSize = 14.sp)
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    CallActionButton(Icons.Default.CallEnd, "Decline", EndCallRed) {
                        NotificationHelper.stopRingtone()
                        onDismiss()
                    }
                    CallActionButton(Icons.Default.Groups, "Join", AcceptGreen) {
                        rejected = false
                        showTokenDialog = true
                    }
                }
            }
            Spacer(Modifier.height(48.dp))
        }
    }
}

@Composable
private fun MasterTokenJoinDialog(
    rejected: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var token by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Enter Master Token") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (rejected) "That token was rejected. The call is still ringing — try again."
                    else "Required to join an encrypted call.",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (rejected) DilarionRed else androidx.compose.ui.graphics.Color.Gray,
                )
                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it },
                    label = { Text("Master Token") },
                    singleLine = true,
                    visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { if (token.isNotBlank()) onConfirm(token.trim()) },
                enabled = token.isNotBlank(),
            ) { Text("Join") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
