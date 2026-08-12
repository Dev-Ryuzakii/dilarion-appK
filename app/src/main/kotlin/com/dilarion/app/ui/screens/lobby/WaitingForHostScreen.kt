package com.dilarion.app.ui.screens.lobby

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Shown after join_by_code comes back status "waiting" — the host has a
 * waiting room on and hasn't let this guest in yet. Just listens for the
 * admit/deny WS events the backend sends once the host acts.
 */
@Composable
fun WaitingForHostScreen(
    conferenceId: Int,
    onAdmitted: () -> Unit,
    onDenied: () -> Unit,
    onCancel: () -> Unit,
    viewModel: LobbyViewModel = hiltViewModel(),
) {
    LaunchedEffect(conferenceId) {
        viewModel.events.collect { msg ->
            val data = msg.data ?: return@collect
            val msgConfId = data.get("conference_id")?.takeIf { !it.isJsonNull }?.asInt
            if (msgConfId != conferenceId) return@collect
            when (msg.type) {
                "conference_admitted" -> onAdmitted()
                "conference_denied" -> onDenied()
            }
        }
    }

    Box(
        modifier = Modifier.fillMaxSize().background(Color(0xFF0B0B10)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
            Text("Waiting for the host to let you in…", color = Color.White, fontSize = 15.sp)
            Text("You'll join automatically once admitted.", color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp)
            OutlinedButton(onClick = onCancel) { Text("Cancel", color = Color.White) }
        }
    }
}
