package com.dilarion.app.ui.screens.newmeeting

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.ui.theme.BackgroundGrey
import com.dilarion.app.ui.theme.BorderGrey
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite
import com.dilarion.app.ui.theme.TextSecondary

/**
 * Multi-select picker that starts a standalone conference (no prior 1:1 call)
 * and invites everyone picked. Mirrors NewChatScreen's layout, swapping tap-to-
 * open for a checkbox + a bottom "Start Meeting" bar. Renders via GalleryScreen
 * (LiveKit), not the mesh CallScreen — mesh's O(n^2) cost capped group calls
 * at 4 people, LiveKit doesn't have that ceiling.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewMeetingScreen(
    onBack: () -> Unit,
    onMeetingStarted: (conferenceId: Int) -> Unit,
    viewModel: NewMeetingViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val filtered = viewModel.filteredUsers()

    uiState.error?.let { err ->
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Error") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = viewModel::clearError) { Text("OK") } },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite)
                    }
                },
                title = { Text("New Meeting", color = SurfaceWhite, style = MaterialTheme.typography.titleMedium) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        bottomBar = {
            if (uiState.selected.isNotEmpty()) {
                Surface(color = SurfaceWhite, tonalElevation = 8.dp) {
                    Button(
                        onClick = {
                            viewModel.startMeeting { conferenceId, _ ->
                                if (conferenceId != null) onMeetingStarted(conferenceId)
                            }
                        },
                        enabled = !uiState.starting,
                        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                    ) {
                        Icon(Icons.Default.Videocam, null, tint = SurfaceWhite)
                        Spacer(Modifier.width(8.dp))
                        Text(if (uiState.starting) "Starting…" else "Start Meeting (${uiState.selected.size})", color = SurfaceWhite)
                    }
                }
            }
        },
        containerColor = BackgroundGrey,
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            OutlinedTextField(
                value = uiState.query,
                onValueChange = viewModel::setQuery,
                placeholder = { Text("Search people to invite…", color = TextSecondary) },
                leadingIcon = { Icon(Icons.Default.Search, null, tint = TextSecondary) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                shape = RoundedCornerShape(24.dp),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = DilarionRed,
                    unfocusedBorderColor = BorderGrey,
                    focusedContainerColor = SurfaceWhite,
                    unfocusedContainerColor = SurfaceWhite,
                ),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            )

            if (uiState.isLoading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DilarionRed)
                }
            } else if (filtered.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (uiState.query.isNotEmpty()) "No users found" else "No users available",
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            } else {
                LazyColumn(contentPadding = PaddingValues(vertical = 4.dp)) {
                    items(filtered, key = { it.username ?: "" }) { user ->
                        MeetingUserRow(
                            user = user,
                            checked = uiState.selected.contains(user.username),
                            onTap = { user.username?.let(viewModel::toggle) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MeetingUserRow(user: UserInfo, checked: Boolean, onTap: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(SurfaceWhite)
            .clickable(onClick = onTap)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(50.dp)
                .clip(CircleShape)
                .background(DilarionRed),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                user.username?.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                color = SurfaceWhite,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                user.username ?: "",
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        Box(
            modifier = Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(if (checked) DilarionRed else Color.Transparent)
                .border(1.5.dp, if (checked) DilarionRed else BorderGrey, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) {
                Icon(Icons.Default.Check, null, tint = SurfaceWhite, modifier = Modifier.size(14.dp))
            }
        }
    }

    HorizontalDivider(
        modifier = Modifier.padding(start = 78.dp),
        color = BorderGrey,
        thickness = 0.5.dp,
    )
}
