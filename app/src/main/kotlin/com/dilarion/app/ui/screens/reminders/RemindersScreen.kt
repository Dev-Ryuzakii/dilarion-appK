package com.dilarion.app.ui.screens.reminders

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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
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
import com.dilarion.app.data.model.ReminderItem
import com.dilarion.app.reminders.parseServerTime
import com.dilarion.app.ui.theme.*
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val RECURRENCES = listOf(null to "Once", "daily" to "Daily", "weekdays" to "Weekdays", "weekly" to "Weekly", "monthly" to "Monthly")

fun formatReminderTime(iso: String): String {
    val at = parseServerTime(iso) ?: return iso
    val local = at.atZone(ZoneId.systemDefault())
    val today = LocalDate.now()
    val day = when (local.toLocalDate()) {
        today -> "Today"
        today.plusDays(1) -> "Tomorrow"
        today.minusDays(1) -> "Yesterday"
        else -> local.format(DateTimeFormatter.ofPattern("EEE, MMM d", Locale.getDefault()))
    }
    return "$day, ${local.format(DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault()))}"
}

@Composable
fun RemindersScreen(onBack: () -> Unit, viewModel: RemindersViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsState()
    var confirmDelete by remember { mutableStateOf<ReminderItem?>(null) }

    if (ui.showCreate) {
        CreateReminderDialog(
            busy = ui.busy, error = ui.createError,
            onDismiss = { viewModel.openCreate(false) },
            onSave = viewModel::create,
        )
    }
    confirmDelete?.let { r ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = { Text("Delete reminder?") },
            text = { Text("\"${r.title}\" will be removed.") },
            confirmButton = { TextButton(onClick = { viewModel.delete(r.id); confirmDelete = null }) { Text("Delete", color = DilarionRed) } },
            dismissButton = { TextButton(onClick = { confirmDelete = null }) { Text("Cancel") } },
        )
    }

    val ringing = ui.reminders.filter { it.status == "fired" }
    val upcoming = ui.reminders.filter { it.status == "scheduled" }.sortedBy { parseServerTime(it.remindAt) }
    val past = ui.reminders.filter { it.status == "done" || it.status == "dismissed" }.take(20)

    Scaffold(
        containerColor = BackgroundGrey,
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { viewModel.openCreate(true) },
                containerColor = DilarionRed, contentColor = SurfaceWhite,
                icon = { Icon(Icons.Default.Add, null) }, text = { Text("New reminder") },
            )
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 6.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = TextPrimary) }
                Text("Reminders", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = TextPrimary, modifier = Modifier.weight(1f))
                IconButton(onClick = { viewModel.load() }) { Icon(Icons.Default.Refresh, "Refresh", tint = TextSecondary) }
            }
            ui.error?.let { Text(it, color = DilarionRed, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
            when {
                ui.loading && ui.reminders.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DilarionRed) }
                ui.reminders.isEmpty() -> EmptyState()
                else -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (ringing.isNotEmpty()) {
                        item { Section("Ringing") }
                        items(ringing, key = { it.id }) { r ->
                            ReminderRow(r, highlight = true) {
                                TextButton(onClick = { viewModel.snooze(r.id, 10) }) { Text("Snooze 10m", color = TextSecondary) }
                                Button(onClick = { viewModel.done(r.id) }, colors = ButtonDefaults.buttonColors(containerColor = DilarionRed)) { Text("Done") }
                            }
                        }
                    }
                    if (upcoming.isNotEmpty()) {
                        item { Section("Upcoming") }
                        items(upcoming, key = { it.id }) { r ->
                            ReminderRow(r) {
                                IconButton(onClick = { viewModel.done(r.id) }) { Icon(Icons.Default.Check, "Mark done", tint = TextSecondary) }
                                IconButton(onClick = { confirmDelete = r }) { Icon(Icons.Default.DeleteOutline, "Delete", tint = TextSecondary) }
                            }
                        }
                    }
                    if (past.isNotEmpty()) {
                        item { Section("Earlier") }
                        items(past, key = { it.id }) { r ->
                            ReminderRow(r, faded = true) {
                                IconButton(onClick = { confirmDelete = r }) { Icon(Icons.Default.DeleteOutline, "Delete", tint = TextMuted) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(title.uppercase(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = TextSecondary, letterSpacing = 0.6.sp,
        modifier = Modifier.padding(start = 4.dp, top = 12.dp, bottom = 2.dp))
}

@Composable
private fun EmptyState() {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(DilarionRedSoft), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Alarm, null, tint = DilarionRed, modifier = Modifier.size(30.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text("No reminders yet", fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = TextPrimary)
        Spacer(Modifier.height(4.dp))
        Text("Set one and it rings like an alarm, even when Dilarion is closed.", color = TextSecondary, fontSize = 14.sp)
    }
}

@Composable
private fun ReminderRow(r: ReminderItem, highlight: Boolean = false, faded: Boolean = false, actions: @Composable RowScope.() -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
            .background(if (highlight) DilarionRedSoft else SurfaceWhite)
            .padding(start = 14.dp, end = 6.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(38.dp).clip(CircleShape).background(if (highlight) DilarionRed else DilarionRedSoft), contentAlignment = Alignment.Center) {
            Icon(if (r.source == "ai_agent") Icons.Default.AutoAwesome else Icons.Default.Alarm, null,
                tint = if (highlight) SurfaceWhite else DilarionRed, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(r.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = if (faded) TextMuted else TextPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(formatReminderTime(r.remindAt), fontSize = 13.sp, color = TextSecondary)
                if (r.recurrence != null) {
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Default.Repeat, null, tint = TextSecondary, modifier = Modifier.size(14.dp))
                    Text(" " + (RECURRENCES.firstOrNull { it.first == r.recurrence }?.second ?: r.recurrence), fontSize = 13.sp, color = TextSecondary)
                }
            }
            r.note?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
        actions()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CreateReminderDialog(
    busy: Boolean, error: String?,
    onDismiss: () -> Unit,
    onSave: (String, Instant, String?, String?) -> Unit,
) {
    val context = LocalContext.current
    var title by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var at by remember { mutableStateOf(LocalDateTime.now().plusHours(1).withMinute(0).withSecond(0).withNano(0)) }
    var recurrence by remember { mutableStateOf<String?>(null) }
    val zone = ZoneId.systemDefault()
    val inPast = at.atZone(zone).toInstant().isBefore(Instant.now())

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("New reminder") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("Remind me to…") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    QuickChip("In 10 min") { at = LocalDateTime.now().plusMinutes(10).withSecond(0).withNano(0) }
                    QuickChip("In 1 hour") { at = LocalDateTime.now().plusHours(1).withSecond(0).withNano(0) }
                    QuickChip("Tomorrow 9 AM") { at = LocalDate.now().plusDays(1).atTime(9, 0) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PickerField(Icons.Default.CalendarMonth, at.format(DateTimeFormatter.ofPattern("EEE, MMM d", Locale.getDefault())), Modifier.weight(1f)) {
                        DatePickerDialog(context, { _, y, m, d -> at = LocalDateTime.of(LocalDate.of(y, m + 1, d), at.toLocalTime()) },
                            at.year, at.monthValue - 1, at.dayOfMonth).apply { datePicker.minDate = System.currentTimeMillis() - 1000 }.show()
                    }
                    PickerField(Icons.Default.Schedule, at.format(DateTimeFormatter.ofPattern("h:mm a", Locale.getDefault())), Modifier.weight(1f)) {
                        TimePickerDialog(context, { _, h, min -> at = LocalDateTime.of(at.toLocalDate(), LocalTime.of(h, min)) },
                            at.hour, at.minute, android.text.format.DateFormat.is24HourFormat(context)).show()
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    RECURRENCES.forEach { (value, label) ->
                        FilterChip(selected = recurrence == value, onClick = { recurrence = value }, label = { Text(label) },
                            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = DilarionRedSoft, selectedLabelColor = DilarionRedDark))
                    }
                }
                OutlinedTextField(note, { note = it }, label = { Text("Note (optional)") }, modifier = Modifier.fillMaxWidth(), maxLines = 3)
                if (inPast) Text("Pick a time in the future.", color = DilarionRed, fontSize = 13.sp)
                error?.let { Text(it, color = DilarionRed, fontSize = 13.sp) }
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(title, at.atZone(zone).toInstant(), note, recurrence) },
                enabled = !busy && title.isNotBlank() && !inPast,
                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
            ) { Text(if (busy) "Saving…" else "Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}

@Composable
private fun QuickChip(label: String, onClick: () -> Unit) {
    AssistChip(onClick = onClick, label = { Text(label, fontSize = 12.sp) })
}

@Composable
private fun PickerField(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, modifier: Modifier, onClick: () -> Unit) {
    Row(
        modifier.clip(RoundedCornerShape(10.dp)).background(InputGrey).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = DilarionRed, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, fontSize = 14.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

