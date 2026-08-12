package com.dilarion.app.ui.screens.meetings

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.MeetingSummary
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.ui.theme.BackgroundGrey
import com.dilarion.app.ui.theme.BorderGrey
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite
import com.dilarion.app.ui.theme.TextSecondary
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Upcoming-meetings list + a schedule form. Joining renders via GalleryScreen
 * (LiveKit) like every other group call - see MeetingsViewModel.joinMeeting.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeetingsScreen(
    onBack: () -> Unit,
    onJoined: (joinCode: String, title: String?) -> Unit,
    viewModel: MeetingsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    var joinError by remember { mutableStateOf<String?>(null) }

    joinError?.let { err ->
        AlertDialog(
            onDismissRequest = { joinError = null },
            title = { Text("Could not join") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = { joinError = null }) { Text("OK") } },
        )
    }
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
                    IconButton(onClick = { if (uiState.showForm) viewModel.closeForm() else onBack() }) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite)
                    }
                },
                title = { Text(if (uiState.showForm) "Schedule Meeting" else "Meetings", color = SurfaceWhite, style = MaterialTheme.typography.titleMedium) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        containerColor = BackgroundGrey,
    ) { innerPadding ->
        if (uiState.showForm) {
            ScheduleForm(
                uiState = uiState,
                viewModel = viewModel,
                context = context,
                modifier = Modifier.padding(innerPadding),
            )
        } else {
            Column(modifier = Modifier.padding(innerPadding).fillMaxSize()) {
                if (uiState.isLoading) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = DilarionRed)
                    }
                } else if (uiState.meetings.isEmpty()) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("No upcoming meetings", color = TextSecondary)
                    }
                } else {
                    LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(vertical = 4.dp)) {
                        items(uiState.meetings, key = { it.id }) { meeting ->
                            MeetingRow(
                                meeting = meeting,
                                isMine = viewModel.isMine(meeting),
                                onJoin = { onJoined(meeting.joinCode, meeting.title) },
                                onCancel = { viewModel.cancelMeeting(meeting.id) },
                            )
                        }
                    }
                }
                Button(
                    onClick = viewModel::openForm,
                    colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                ) { Text("+ Schedule a meeting", color = SurfaceWhite) }
            }
        }
    }
}

@Composable
private fun MeetingRow(meeting: MeetingSummary, isMine: Boolean, onJoin: () -> Unit, onCancel: () -> Unit) {
    val displayTime = remember(meeting.scheduledAt) { formatMeetingTime(meeting.scheduledAt) }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(SurfaceWhite)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                meeting.title ?: "Untitled meeting",
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "$displayTime · ${meeting.creatorUsername}",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
            )
        }
        Button(onClick = onJoin, colors = ButtonDefaults.buttonColors(containerColor = DilarionRed)) {
            Text("Join", color = SurfaceWhite)
        }
        if (isMine) {
            IconButton(onClick = onCancel) {
                Icon(Icons.Default.Close, "Cancel", tint = TextSecondary)
            }
        }
    }
    HorizontalDivider(color = BorderGrey, thickness = 0.5.dp)
}

@Composable
private fun ScheduleForm(
    uiState: MeetingsUiState,
    viewModel: MeetingsViewModel,
    context: android.content.Context,
    modifier: Modifier = Modifier,
) {
    val displayTime = remember(uiState.scheduledAtMillis) {
        uiState.scheduledAtMillis?.let { formatMeetingTime(java.time.Instant.ofEpochMilli(it).toString()) }
    }

    Column(modifier = modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = uiState.title,
            onValueChange = viewModel::setTitle,
            label = { Text("Title (optional)") },
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DilarionRed),
        )

        OutlinedButton(
            onClick = {
                val cal = Calendar.getInstance()
                DatePickerDialog(context, { _, year, month, day ->
                    TimePickerDialog(context, { _, hour, minute ->
                        cal.set(year, month, day, hour, minute, 0)
                        viewModel.setScheduledAt(cal.timeInMillis)
                    }, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), false).show()
                }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(displayTime ?: "Pick date & time")
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(
                checked = uiState.waitingRoomEnabled,
                onCheckedChange = viewModel::setWaitingRoomEnabled,
                colors = CheckboxDefaults.colors(checkedColor = DilarionRed),
            )
            Text("Waiting room — approve guests before they join", style = MaterialTheme.typography.bodySmall)
        }

        Text("Invite:", style = MaterialTheme.typography.labelMedium, color = TextSecondary)
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (uiState.loadingUsers) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DilarionRed)
                }
            } else {
                LazyColumn {
                    items(uiState.users, key = { it.username ?: "" }) { user ->
                        InviteRow(
                            user = user,
                            checked = uiState.selected.contains(user.username),
                            onTap = { user.username?.let(viewModel::toggle) },
                        )
                    }
                }
            }
        }

        Button(
            onClick = viewModel::schedule,
            enabled = uiState.scheduledAtMillis != null && !uiState.scheduling,
            colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (uiState.scheduling) "Scheduling…" else "Schedule", color = SurfaceWhite)
        }
    }
}

@Composable
private fun InviteRow(user: UserInfo, checked: Boolean, onTap: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onTap)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(38.dp).clip(CircleShape).background(DilarionRed),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                user.username?.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                color = SurfaceWhite,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.width(10.dp))
        Text(user.username ?: "", modifier = Modifier.weight(1f))
        Box(
            modifier = Modifier
                .size(20.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(if (checked) DilarionRed else androidx.compose.ui.graphics.Color.Transparent),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) Icon(Icons.Default.Check, null, tint = SurfaceWhite, modifier = Modifier.size(14.dp))
        }
    }
}

private fun formatMeetingTime(iso: String): String {
    return try {
        val instant = java.time.Instant.parse(iso.let { if (it.endsWith("Z") || it.contains("+")) it else "${it}Z" })
        val fmt = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())
        fmt.timeZone = java.util.TimeZone.getDefault()
        fmt.format(java.util.Date.from(instant))
    } catch (e: Exception) {
        iso
    }
}
