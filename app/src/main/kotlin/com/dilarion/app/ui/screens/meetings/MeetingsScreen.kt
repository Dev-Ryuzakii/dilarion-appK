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
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.border
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
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
import com.dilarion.app.ui.theme.DilarionRedSoft
import com.dilarion.app.ui.theme.InputGrey
import com.dilarion.app.ui.theme.TextMuted
import com.dilarion.app.ui.theme.TextPrimary
import com.dilarion.app.ui.theme.BorderGrey
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite
import com.dilarion.app.ui.theme.TextSecondary
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Meetings hub: start, schedule or join by code, plus upcoming meetings
 * grouped by day. Joining renders via GalleryScreen (LiveKit) like every other
 * group call - see MeetingsViewModel.joinMeeting.
 */
@Composable
fun MeetingsScreen(
    onBack: () -> Unit,
    onJoined: (joinCode: String, title: String?) -> Unit,
    onNewMeeting: () -> Unit = {},
    viewModel: MeetingsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    var joinError by remember { mutableStateOf<String?>(null) }
    var joinCode by rememberSaveable { mutableStateOf("") }

    BackHandler(enabled = uiState.showForm) { viewModel.closeForm() }

    joinError?.let { err ->
        AlertDialog(
            onDismissRequest = { joinError = null },
            title = { Text("Could not join") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = { joinError = null }) { Text("OK", color = DilarionRed) } },
        )
    }
    uiState.error?.let { err ->
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Something went wrong") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = viewModel::clearError) { Text("OK", color = DilarionRed) } },
        )
    }

    fun submitCode() {
        val code = parseJoinCode(joinCode)
        if (code == null) joinError = "Enter a meeting code or paste an invite link." else onJoined(code, null)
    }

    Column(Modifier.fillMaxSize().background(PageBg).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 6.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = { if (uiState.showForm) viewModel.closeForm() else onBack() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = TextPrimary)
            }
            Text(
                if (uiState.showForm) "Schedule meeting" else "Meetings",
                fontSize = 24.sp, fontWeight = FontWeight.Bold, color = TextPrimary,
            )
        }

        if (uiState.showForm) {
            ScheduleForm(uiState = uiState, viewModel = viewModel, context = context)
            return@Column
        }

        val grouped = remember(uiState.meetings) {
            uiState.meetings
                .sortedBy { it.scheduledAt }
                .groupBy { dayLabel(it.scheduledAt) }
        }

        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ActionCard(
                        icon = Icons.Default.Videocam, title = "New meeting", subtitle = "Start now",
                        filled = true, modifier = Modifier.weight(1f), onClick = onNewMeeting,
                    )
                    ActionCard(
                        icon = Icons.Default.CalendarMonth, title = "Schedule", subtitle = "Plan for later",
                        filled = false, modifier = Modifier.weight(1f), onClick = viewModel::openForm,
                    )
                }
            }
            item {
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(SurfaceWhite)
                        .border(1.dp, BorderGrey, RoundedCornerShape(18.dp)).padding(14.dp),
                ) {
                    Text("Join with a code", fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = TextPrimary)
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        BasicTextField(
                            value = joinCode,
                            onValueChange = { joinCode = it },
                            singleLine = true,
                            textStyle = TextStyle(fontSize = 15.sp, color = TextPrimary),
                            cursorBrush = SolidColor(DilarionRed),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                            keyboardActions = KeyboardActions(onGo = { submitCode() }),
                            modifier = Modifier.weight(1f),
                            decorationBox = { inner ->
                                Box(
                                    Modifier.clip(RoundedCornerShape(12.dp)).background(InputGrey)
                                        .padding(horizontal = 14.dp, vertical = 13.dp),
                                ) {
                                    if (joinCode.isEmpty()) Text("Code or invite link", color = TextMuted, fontSize = 15.sp)
                                    inner()
                                }
                            },
                        )
                        Spacer(Modifier.width(8.dp))
                        Button(
                            onClick = ::submitCode,
                            enabled = joinCode.isNotBlank(),
                            shape = RoundedCornerShape(50),
                            colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
                        ) { Text("Join", color = SurfaceWhite, fontWeight = FontWeight.SemiBold) }
                    }
                }
            }

            item {
                Text(
                    "Upcoming", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = TextPrimary,
                    modifier = Modifier.padding(top = 10.dp, start = 2.dp),
                )
            }

            when {
                uiState.isLoading -> item {
                    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = DilarionRed, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                    }
                }
                uiState.meetings.isEmpty() -> item { EmptyMeetings(onSchedule = viewModel::openForm) }
                else -> grouped.forEach { (day, meetings) ->
                    item(key = "day-$day") {
                        Text(
                            day.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                            color = TextMuted, letterSpacing = 0.6.sp,
                            modifier = Modifier.padding(top = 6.dp, start = 2.dp),
                        )
                    }
                    items(meetings, key = { it.id }) { meeting ->
                        MeetingCard(
                            meeting = meeting,
                            isMine = viewModel.isMine(meeting),
                            onJoin = { onJoined(meeting.joinCode, meeting.title) },
                            onCancel = { viewModel.cancelMeeting(meeting.id) },
                        )
                    }
                }
            }
        }
    }
}

private val PageBg = Color(0xFFF6F7F9)

@Composable
private fun ActionCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    filled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .clip(shape)
            .background(if (filled) DilarionRed else SurfaceWhite)
            .then(if (filled) Modifier else Modifier.border(1.dp, BorderGrey, shape))
            .clickable(onClick = onClick)
            .padding(14.dp),
    ) {
        Box(
            Modifier.size(40.dp).clip(RoundedCornerShape(12.dp))
                .background(if (filled) Color.White.copy(alpha = 0.2f) else DilarionRedSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = if (filled) SurfaceWhite else DilarionRed, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = if (filled) SurfaceWhite else TextPrimary)
        Text(subtitle, fontSize = 12.sp, color = if (filled) Color.White.copy(alpha = 0.8f) else TextSecondary)
    }
}

@Composable
private fun EmptyMeetings(onSchedule: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(SurfaceWhite)
            .border(1.dp, BorderGrey, RoundedCornerShape(18.dp)).padding(vertical = 28.dp, horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier.size(52.dp).clip(CircleShape).background(DilarionRedSoft),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Default.EventAvailable, null, tint = DilarionRed, modifier = Modifier.size(26.dp)) }
        Spacer(Modifier.height(12.dp))
        Text("No upcoming meetings", fontWeight = FontWeight.SemiBold, color = TextPrimary)
        Text("Scheduled meetings will show up here.", fontSize = 13.sp, color = TextSecondary)
        Spacer(Modifier.height(12.dp))
        OutlinedButton(
            onClick = onSchedule,
            shape = RoundedCornerShape(50),
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderGrey),
        ) { Text("Schedule a meeting", color = DilarionRed) }
    }
}

@Composable
private fun MeetingCard(meeting: MeetingSummary, isMine: Boolean, onJoin: () -> Unit, onCancel: () -> Unit) {
    val time = remember(meeting.scheduledAt) { formatClock(meeting.scheduledAt) }
    val live = meeting.status.equals("live", ignoreCase = true)
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(SurfaceWhite)
            .border(1.dp, BorderGrey, RoundedCornerShape(16.dp)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).height(40.dp).clip(RoundedCornerShape(2.dp)).background(DilarionRed))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    meeting.title ?: "Untitled meeting",
                    fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = TextPrimary,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                )
                if (live) {
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "LIVE", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = SurfaceWhite,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(DilarionRed)
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            Text(
                "$time · ${meeting.durationMinutes} min · ${meeting.creatorUsername}",
                fontSize = 12.sp, color = TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(8.dp))
        Button(
            onClick = onJoin,
            shape = RoundedCornerShape(50),
            colors = ButtonDefaults.buttonColors(containerColor = if (live) DilarionRed else DilarionRedSoft),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        ) { Text("Join", color = if (live) SurfaceWhite else DilarionRed, fontWeight = FontWeight.SemiBold) }
        if (isMine) {
            IconButton(onClick = onCancel, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Default.Close, "Cancel meeting", tint = TextMuted, modifier = Modifier.size(18.dp))
            }
        }
    }
}

/** Accepts a bare code or an invite link (`…/join/CODE` or `?code=CODE`). */
private fun parseJoinCode(raw: String): String? {
    val text = raw.trim()
    if (text.isEmpty()) return null
    Regex("[?&]code=([A-Za-z0-9_-]+)").find(text)?.let { return it.groupValues[1] }
    val tail = text.substringBefore('?').trimEnd('/').substringAfterLast('/')
    return tail.takeIf { it.isNotBlank() }
}

private fun meetingInstant(iso: String): java.time.ZonedDateTime =
    java.time.Instant.parse(if (iso.endsWith("Z") || iso.contains("+")) iso else "${iso}Z")
        .atZone(java.time.ZoneId.systemDefault())

private fun dayLabel(iso: String): String = try {
    val date = meetingInstant(iso).toLocalDate()
    val today = java.time.LocalDate.now()
    when (date) {
        today -> "Today"
        today.plusDays(1) -> "Tomorrow"
        else -> date.format(java.time.format.DateTimeFormatter.ofPattern("EEEE, MMM d"))
    }
} catch (e: Exception) { "Later" }

private fun formatClock(iso: String): String = try {
    meetingInstant(iso).format(java.time.format.DateTimeFormatter.ofPattern("h:mm a"))
} catch (e: Exception) { iso }

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
    var query by rememberSaveable { mutableStateOf("") }
    val people = remember(uiState.users, query, uiState.selected) {
        val q = query.trim()
        uiState.users
            .filter { u ->
                q.isEmpty() || listOf(u.username, u.fullName, u.jobTitle).any { (it ?: "").contains(q, ignoreCase = true) }
            }
            // People already picked stay on top, so a search never hides them.
            .sortedByDescending { uiState.selected.contains(it.username) }
    }

    Column(modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                FormCard {
                    FieldLabel("Title")
                    BasicTextField(
                        value = uiState.title,
                        onValueChange = viewModel::setTitle,
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 15.sp, color = TextPrimary),
                        cursorBrush = SolidColor(DilarionRed),
                        modifier = Modifier.fillMaxWidth(),
                        decorationBox = { inner ->
                            Box(
                                Modifier.clip(RoundedCornerShape(12.dp)).background(InputGrey)
                                    .padding(horizontal = 14.dp, vertical = 13.dp),
                            ) {
                                if (uiState.title.isEmpty()) Text("Weekly sync (optional)", color = TextMuted, fontSize = 15.sp)
                                inner()
                            }
                        },
                    )
                    Spacer(Modifier.height(14.dp))
                    FieldLabel("When")
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(InputGrey)
                            .clickable {
                                val cal = Calendar.getInstance()
                                DatePickerDialog(context, { _, year, month, day ->
                                    TimePickerDialog(context, { _, hour, minute ->
                                        cal.set(year, month, day, hour, minute, 0)
                                        viewModel.setScheduledAt(cal.timeInMillis)
                                    }, cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE), false).show()
                                }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
                            }
                            .padding(horizontal = 14.dp, vertical = 13.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.CalendarMonth, null, tint = DilarionRed, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(
                            displayTime ?: "Pick date & time",
                            color = if (displayTime == null) TextMuted else TextPrimary, fontSize = 15.sp,
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(
                        Modifier.fillMaxWidth().clickable { viewModel.setWaitingRoomEnabled(!uiState.waitingRoomEnabled) }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("Waiting room", fontWeight = FontWeight.Medium, color = TextPrimary)
                            Text("Approve guests before they join", fontSize = 12.sp, color = TextSecondary)
                        }
                        Switch(
                            checked = uiState.waitingRoomEnabled,
                            onCheckedChange = viewModel::setWaitingRoomEnabled,
                            colors = SwitchDefaults.colors(checkedThumbColor = SurfaceWhite, checkedTrackColor = DilarionRed),
                        )
                    }
                }
            }
            item {
                Row(Modifier.padding(top = 6.dp, start = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Invite people", fontWeight = FontWeight.Bold, fontSize = 17.sp, color = TextPrimary, modifier = Modifier.weight(1f))
                    if (uiState.selected.isNotEmpty()) {
                        Text("${uiState.selected.size} selected", fontSize = 13.sp, color = DilarionRed, fontWeight = FontWeight.Medium)
                    }
                }
            }
            item {
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 15.sp, color = TextPrimary),
                    cursorBrush = SolidColor(DilarionRed),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { inner ->
                        Row(
                            Modifier.clip(RoundedCornerShape(12.dp)).background(SurfaceWhite)
                                .border(1.dp, BorderGrey, RoundedCornerShape(12.dp))
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.Search, null, tint = TextMuted, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Box(Modifier.weight(1f)) {
                                if (query.isEmpty()) Text("Search by name, username or role", color = TextMuted, fontSize = 15.sp)
                                inner()
                            }
                        }
                    },
                )
            }
            if (uiState.loadingUsers) {
                item {
                    Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = DilarionRed, strokeWidth = 2.dp, modifier = Modifier.size(26.dp))
                    }
                }
            } else {
                item {
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(SurfaceWhite)
                            .border(1.dp, BorderGrey, RoundedCornerShape(16.dp)),
                    ) {
                        if (people.isEmpty()) {
                            Text("No one matches.", color = TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
                        }
                        people.forEachIndexed { index, user ->
                            if (index > 0) HorizontalDivider(color = BorderGrey, thickness = 0.5.dp, modifier = Modifier.padding(start = 64.dp))
                            InviteRow(
                                user = user,
                                checked = uiState.selected.contains(user.username),
                                onTap = { user.username?.let(viewModel::toggle) },
                            )
                        }
                    }
                }
            }
        }

        Surface(color = SurfaceWhite, shadowElevation = 8.dp) {
            Button(
                onClick = viewModel::schedule,
                enabled = uiState.scheduledAtMillis != null && !uiState.scheduling,
                shape = RoundedCornerShape(50),
                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp).height(50.dp),
            ) {
                Text(
                    when {
                        uiState.scheduling -> "Scheduling…"
                        uiState.scheduledAtMillis == null -> "Pick a time to schedule"
                        else -> "Schedule meeting"
                    },
                    color = SurfaceWhite, fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun FormCard(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(SurfaceWhite)
            .border(1.dp, BorderGrey, RoundedCornerShape(18.dp)).padding(14.dp),
        content = content,
    )
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = TextSecondary, modifier = Modifier.padding(bottom = 6.dp))
}

@Composable
private fun InviteRow(user: UserInfo, checked: Boolean, onTap: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onTap)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(38.dp).clip(CircleShape).background(DilarionRedSoft),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                (user.fullName?.takeIf { it.isNotBlank() } ?: user.username)?.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                color = DilarionRed,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.width(12.dp))
        val name = user.fullName?.takeIf { it.isNotBlank() } ?: user.username ?: ""
        Column(Modifier.weight(1f)) {
            Text(name, color = TextPrimary, fontSize = 15.sp, maxLines = 1)
            if (name != user.username) {
                Text(
                    "@${user.username ?: ""}" + (user.jobTitle?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""),
                    color = TextMuted, fontSize = 12.sp, maxLines = 1,
                )
            }
        }
        Box(
            modifier = Modifier
                .size(22.dp)
                .clip(CircleShape)
                .background(if (checked) DilarionRed else Color.Transparent)
                .border(1.5.dp, if (checked) DilarionRed else BorderGrey, CircleShape),
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
