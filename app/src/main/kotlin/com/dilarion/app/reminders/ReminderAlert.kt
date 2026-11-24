package com.dilarion.app.reminders

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.ReminderSnoozeRequest
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.dilarion.app.ui.screens.reminders.formatReminderTime
import com.dilarion.app.ui.theme.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RingingReminder(val id: Int, val title: String, val note: String?, val remindAt: String?)

/** Rings over whatever screen is showing when the server says a reminder is due. */
@HiltViewModel
class ReminderAlertViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val presence: PresenceService,
    private val api: ApiService,
    private val session: SessionManager,
) : ViewModel() {
    private val _queue = MutableStateFlow<List<RingingReminder>>(emptyList())
    val queue: StateFlow<List<RingingReminder>> = _queue

    init {
        viewModelScope.launch {
            presence.events.collect { e ->
                if (e.type != "reminder_due") return@collect
                val d = e.data ?: return@collect
                fun str(k: String) = d.get(k)?.takeIf { !it.isJsonNull }?.asString
                val id = d.get("id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                val r = RingingReminder(id, str("title") ?: "Reminder", str("note"), str("remind_at"))
                if (_queue.value.none { it.id == id }) _queue.value = _queue.value + r
                ReminderAlarms.showNotification(context, id, r.title, r.note)
            }
        }
    }

    private fun resolve(id: Int, call: suspend (String) -> Unit) {
        _queue.value = _queue.value.filterNot { it.id == id }
        ReminderAlarms.cancel(context, id)
        viewModelScope.launch {
            val token = session.sessionToken.first() ?: return@launch
            runCatching { call("Bearer $token") }
        }
    }

    fun snooze(id: Int) = resolve(id) { api.snoozeReminder(it, id, ReminderSnoozeRequest(10)) }
    fun done(id: Int) = resolve(id) { api.completeReminder(it, id) }
    fun dismiss(id: Int) = resolve(id) { api.dismissReminder(it, id) }
}

@Composable
fun ReminderAlert(viewModel: ReminderAlertViewModel = hiltViewModel()) {
    val queue by viewModel.queue.collectAsState()
    val r = queue.firstOrNull() ?: return
    AlertDialog(
        onDismissRequest = {},
        icon = {
            Box(Modifier.size(52.dp).clip(CircleShape).background(DilarionRedSoft), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.Alarm, null, tint = DilarionRed, modifier = Modifier.size(28.dp))
            }
        },
        title = { Text(r.title, fontWeight = FontWeight.Bold) },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                r.remindAt?.let { Text(formatReminderTime(it), color = TextSecondary, fontSize = 14.sp) }
                r.note?.takeIf { it.isNotBlank() }?.let { Spacer(Modifier.height(6.dp)); Text(it, color = TextPrimary, fontSize = 14.sp) }
            }
        },
        confirmButton = {
            Button(onClick = { viewModel.done(r.id) }, colors = ButtonDefaults.buttonColors(containerColor = DilarionRed)) { Text("Done") }
        },
        dismissButton = {
            Row {
                TextButton(onClick = { viewModel.dismiss(r.id) }) { Text("Dismiss", color = TextSecondary) }
                TextButton(onClick = { viewModel.snooze(r.id) }) { Text("Snooze 10m", color = DilarionRed) }
            }
        },
    )
}
