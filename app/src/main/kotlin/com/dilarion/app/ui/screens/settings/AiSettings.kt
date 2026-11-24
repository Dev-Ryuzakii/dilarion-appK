package com.dilarion.app.ui.screens.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.AiPreferences
import com.dilarion.app.data.model.AiPreferencesUpdate
import com.dilarion.app.data.model.AiToolOption
import com.dilarion.app.security.SessionManager
import com.dilarion.app.ui.theme.*
import com.dilarion.app.utils.toUserMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

private val DEFAULT_TOOLS = listOf(
    AiToolOption("create_reminder", "Set reminders"),
    AiToolOption("create_task", "Create and assign tasks"),
    AiToolOption("add_whiteboard_note", "Add whiteboard notes"),
    AiToolOption("draft_meeting", "Draft meetings"),
    AiToolOption("find_people", "Find people"),
)

data class AiSettingsState(
    val loaded: Boolean = false,
    val autoApprove: Boolean = false,
    val allowFromOthers: Boolean = true,
    val disabledTools: Set<String> = emptySet(),
    val timezone: String = java.util.TimeZone.getDefault().id,
    val tools: List<AiToolOption> = DEFAULT_TOOLS,
    val error: String? = null,
    val cleared: Boolean = false,
    val clearing: Boolean = false,
)

@HiltViewModel
class AiSettingsViewModel @Inject constructor(
    private val api: ApiService,
    private val session: SessionManager,
) : ViewModel() {
    private val _ui = MutableStateFlow(AiSettingsState())
    val ui: StateFlow<AiSettingsState> = _ui

    init { load() }

    private suspend fun bearer() = session.sessionToken.first()?.let { "Bearer $it" }

    private fun apply(p: AiPreferences) {
        _ui.value = _ui.value.copy(
            loaded = true, autoApprove = p.autoApprove, allowFromOthers = p.allowFromOthers ?: true,
            disabledTools = p.disabledTools.orEmpty().toSet(), timezone = p.timezone ?: _ui.value.timezone,
            tools = p.tools?.takeIf { it.isNotEmpty() } ?: DEFAULT_TOOLS,
        )
    }

    private fun load() {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            runCatching { api.getAiPreferences(b) }
                .onSuccess { r -> r.body()?.let(::apply) ?: run { _ui.value = _ui.value.copy(loaded = true, error = "Couldn't load AI settings") } }
                .onFailure { _ui.value = _ui.value.copy(loaded = true, error = it.toUserMessage("Couldn't load AI settings.")) }
        }
    }

    private fun save(update: AiPreferencesUpdate, optimistic: AiSettingsState) {
        val before = _ui.value
        _ui.value = optimistic.copy(error = null)
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            runCatching { api.setAiPreferences(b, update) }
                .onSuccess { r -> r.body()?.let(::apply) ?: run { _ui.value = before.copy(error = "Couldn't save that setting") } }
                .onFailure { _ui.value = before.copy(error = it.toUserMessage("Couldn't save that setting.")) }
        }
    }

    fun setAutoApprove(on: Boolean) = save(AiPreferencesUpdate(autoApprove = on), _ui.value.copy(autoApprove = on))
    fun setAllowFromOthers(on: Boolean) = save(AiPreferencesUpdate(allowFromOthers = on), _ui.value.copy(allowFromOthers = on))
    fun setToolAllowed(id: String, allowed: Boolean) {
        val next = if (allowed) _ui.value.disabledTools - id else _ui.value.disabledTools + id
        save(AiPreferencesUpdate(disabledTools = next.toList()), _ui.value.copy(disabledTools = next))
    }

    fun clearHistory() {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _ui.value = _ui.value.copy(clearing = true)
            runCatching { api.clearAiConversations(b) }
                .onSuccess { r -> _ui.value = _ui.value.copy(clearing = false, cleared = r.isSuccessful, error = if (r.isSuccessful) null else "Couldn't clear the history") }
                .onFailure { _ui.value = _ui.value.copy(clearing = false, error = it.toUserMessage("Couldn't clear the history.")) }
        }
    }
}

@Composable
private fun AiCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Text(title, fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 15.sp, modifier = Modifier.padding(start = 24.dp, bottom = 8.dp, top = 4.dp))
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
    ) { Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), content = content) }
    Spacer(Modifier.height(20.dp))
}

@Composable
private fun ToggleRow(title: String, hint: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = TextSecondary) }
        }
        Switch(checked = checked, onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = DilarionRed, checkedThumbColor = SurfaceWhite))
    }
}

/** Settings → Dilarion AI. Full control is also on the AI screen. */
@Composable
fun AiSettingsContent(viewModel: AiSettingsViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsState()
    var confirmClear by remember { mutableStateOf(false) }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            title = { Text("Clear AI chat history?") },
            text = { Text("Every chat on the AI page is deleted. Agent runs and what they created stay.") },
            confirmButton = { TextButton(onClick = { confirmClear = false; viewModel.clearHistory() }) { Text("Delete all", color = DilarionRed) } },
            dismissButton = { TextButton(onClick = { confirmClear = false }) { Text("Cancel") } },
        )
    }

    Text("Control what Dilarion AI agents can do for you.", fontSize = 14.sp, color = TextSecondary,
        modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 4.dp, bottom = 16.dp))
    ui.error?.let { Text(it, color = DilarionRed, fontSize = 13.sp, modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 12.dp)) }
    if (!ui.loaded) {
        Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DilarionRed) }
        return
    }

    AiCard("Agents") {
        ToggleRow("Full control", "Agents run their plans without asking you first. Off: you approve each plan.", ui.autoApprove, viewModel::setAutoApprove)
    }
    AiCard("Security & permissions") {
        ToggleRow("Let colleagues' agents act for me", "Other members' agents can set reminders and assign tasks to you.", ui.allowFromOthers, viewModel::setAllowFromOthers)
        HorizontalDivider(color = BorderGrey)
        Text("What agents may do for you", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 10.dp))
        Text("Turned-off actions are left out of plans and refused. Your organization role still applies.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
        ui.tools.forEach { t -> ToggleRow(t.label, null, t.id !in ui.disabledTools) { viewModel.setToolAllowed(t.id, it) } }
    }
    AiCard("Time zone") {
        Column(Modifier.padding(vertical = 8.dp)) {
            Text(ui.timezone, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text("Taken from this phone. Agents read times like “Friday at 4pm” in this zone.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
        }
    }
    AiCard("Chat history") {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Clear AI chat history", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(if (ui.cleared) "All your AI chats were deleted." else "Deletes every chat on the AI page.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
            }
            OutlinedButton(onClick = { confirmClear = true }, enabled = !ui.clearing) { Text(if (ui.clearing) "Deleting…" else "Clear", color = TextPrimary) }
        }
    }
}
