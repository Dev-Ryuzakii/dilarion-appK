package com.dilarion.app.ui.screens.ai

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.AgentRun
import com.dilarion.app.data.model.AiPreferences
import com.dilarion.app.data.model.AiStep
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.dilarion.app.ui.screens.reminders.formatReminderTime
import com.dilarion.app.ui.theme.*
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

// ── Plan step presentation ────────────────────────────────────────────────────

fun stepIcon(tool: String): ImageVector = when (tool) {
    "create_reminder" -> Icons.Default.Alarm
    "create_task" -> Icons.Default.Checklist
    "draft_meeting" -> Icons.Default.Event
    "find_people" -> Icons.Default.PersonSearch
    "add_whiteboard_note" -> Icons.Default.StickyNote2
    else -> Icons.Default.AutoAwesome
}

fun stepLabel(tool: String): String = when (tool) {
    "create_reminder" -> "Set reminder"
    "create_task" -> "Create task"
    "draft_meeting" -> "Draft meeting"
    "find_people" -> "Find people"
    "add_whiteboard_note" -> "Add whiteboard note"
    else -> tool.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

fun stepDetail(step: AiStep): String {
    val a = step.args ?: return step.why.orEmpty()
    fun s(k: String) = a.get(k)?.takeIf { it.isJsonPrimitive }?.asString
    fun list(k: String) = a.get(k)?.takeIf { it.isJsonArray }?.asJsonArray?.mapNotNull { e -> e.takeIf { it.isJsonPrimitive }?.asString }
    val parts = mutableListOf<String>()
    (s("title") ?: s("text") ?: s("query"))?.let { parts += "“$it”" }
    (s("remind_at") ?: s("start_time") ?: s("due_at"))?.let { parts += formatReminderTime(it) }
    (list("assignees") ?: list("participants"))?.takeIf { it.isNotEmpty() }?.let { parts += "→ " + it.joinToString(", ") }
    return parts.joinToString(" · ").ifBlank { step.why.orEmpty() }
}

fun statusLabel(status: String): String = when (status) {
    "planning" -> "Planning…"
    "awaiting_approval" -> "Needs your approval"
    "running" -> "Running…"
    "completed" -> "Done"
    "failed" -> "Failed"
    "cancelled" -> "Cancelled"
    else -> status
}

@Composable
fun PlanSteps(run: AgentRun) {
    val steps = if (run.steps.isNotEmpty()) run.steps else run.plan
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        steps.forEachIndexed { i, step ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(BackgroundGrey).padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val icon = when (step.status) { "done" -> Icons.Default.CheckCircle; "failed" -> Icons.Default.ErrorOutline; else -> stepIcon(step.tool) }
                val tint = when (step.status) { "done" -> OnlineGreen; "failed" -> DilarionRed; else -> DilarionRed }
                Text("${i + 1}", fontSize = 12.sp, color = TextMuted, modifier = Modifier.width(16.dp))
                Icon(icon, null, tint = tint, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(stepLabel(step.tool), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    val detail = step.error ?: stepDetail(step)
                    if (detail.isNotBlank()) Text(detail, fontSize = 12.sp, color = if (step.error != null) DilarionRed else TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
fun AgentRunCard(run: AgentRun, onApprove: () -> Unit, onCancel: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(SurfaceWhite).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(30.dp).clip(CircleShape).background(DilarionRedSoft), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.SmartToy, null, tint = DilarionRed, modifier = Modifier.size(17.dp))
            }
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(run.title ?: run.instruction, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(statusLabel(run.status), fontSize = 12.sp, color = if (run.status == "awaiting_approval") DilarionRed else TextSecondary)
            }
            if (run.status == "planning" || run.status == "running") CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = DilarionRed)
        }
        if (run.plan.isNotEmpty() || run.steps.isNotEmpty()) PlanSteps(run)
        run.summary?.takeIf { it.isNotBlank() && run.status == "completed" }?.let { Text(it, fontSize = 13.sp, color = TextPrimary) }
        run.error?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = DilarionRed) }
        if (run.status == "awaiting_approval") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onApprove, colors = ButtonDefaults.buttonColors(containerColor = DilarionRed), modifier = Modifier.weight(1f)) { Text("Approve & run") }
                OutlinedButton(onClick = onCancel) { Text("Cancel", color = TextPrimary) }
            }
        }
    }
}

// ── Approval prompt over any screen ───────────────────────────────────────────

@HiltViewModel
class AgentApprovalViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val presence: PresenceService,
    private val api: ApiService,
    private val session: SessionManager,
) : ViewModel() {
    private val gson = Gson()
    private val _queue = MutableStateFlow<List<AgentRun>>(emptyList())
    val queue: StateFlow<List<AgentRun>> = _queue
    private val _outcome = MutableStateFlow<AgentRun?>(null)
    val outcome: StateFlow<AgentRun?> = _outcome
    private val watching = mutableSetOf<Int>()

    init {
        viewModelScope.launch {
            presence.events.collect { e ->
                if (e.type != "ai_agent_progress" && e.type != "ai_agent_finished") return@collect
                val run = agentRunFrom(gson, e.data) ?: return@collect
                if (run.status == "awaiting_approval") {
                    if (_queue.value.none { it.id == run.id }) _queue.value = _queue.value + run
                } else {
                    _queue.value = _queue.value.filterNot { it.id == run.id }
                    if (run.id in watching && run.status in setOf("completed", "failed")) {
                        watching -= run.id
                        _outcome.value = run
                        launch { delay(4000); if (_outcome.value?.id == run.id) _outcome.value = null }
                    }
                }
            }
        }
    }

    private suspend fun bearer() = session.sessionToken.first()?.let { "Bearer $it" }

    fun approve(run: AgentRun, alwaysAllow: Boolean) {
        _queue.value = _queue.value.filterNot { it.id == run.id }
        watching += run.id
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            if (alwaysAllow) runCatching { api.setAiPreferences(b, AiPreferences(true)) }
            runCatching { api.approveAgent(b, run.id) }
        }
    }

    fun cancel(run: AgentRun) {
        _queue.value = _queue.value.filterNot { it.id == run.id }
        viewModelScope.launch { bearer()?.let { b -> runCatching { api.cancelAgent(b, run.id) } } }
    }

    /** Leave it for the AI page; stop prompting here. */
    fun later(run: AgentRun) { _queue.value = _queue.value.filterNot { it.id == run.id } }
    fun clearOutcome() { _outcome.value = null }
}

/** Approve an agent's plan wherever you are; hidden while the AI page is open. */
@Composable
fun AgentApprovalPrompt(hidden: Boolean, onReview: () -> Unit, viewModel: AgentApprovalViewModel = hiltViewModel()) {
    val queue by viewModel.queue.collectAsState()
    val outcome by viewModel.outcome.collectAsState()
    if (hidden) return
    val run = queue.firstOrNull()
    if (run != null) {
        var always by remember(run.id) { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { viewModel.later(run) },
            icon = { Icon(Icons.Default.SmartToy, null, tint = DilarionRed) },
            title = {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Agent needs your approval", fontSize = 13.sp, color = DilarionRed, fontWeight = FontWeight.SemiBold)
                    Text(run.title ?: run.instruction, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    PlanSteps(run)
                    Row(Modifier.fillMaxWidth().clickable { always = !always }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = always, onCheckedChange = { always = it }, colors = CheckboxDefaults.colors(checkedColor = DilarionRed))
                        Text("Always allow: give agents full control from now on", fontSize = 13.sp, color = TextSecondary)
                    }
                }
            },
            confirmButton = {
                Button(onClick = { viewModel.approve(run, always) }, colors = ButtonDefaults.buttonColors(containerColor = DilarionRed)) { Text("Approve & run") }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { viewModel.cancel(run) }) { Text("Cancel", color = TextSecondary) }
                    TextButton(onClick = { viewModel.later(run); onReview() }) { Text("Review", color = DilarionRed) }
                }
            },
        )
    } else outcome?.let { done ->
        AlertDialog(
            onDismissRequest = viewModel::clearOutcome,
            icon = { Icon(if (done.status == "completed") Icons.Default.CheckCircle else Icons.Default.ErrorOutline, null, tint = if (done.status == "completed") OnlineGreen else DilarionRed) },
            title = { Text(if (done.status == "completed") "Agent finished" else "Agent failed") },
            text = { Text(done.summary ?: done.error ?: (done.title ?: done.instruction)) },
            confirmButton = { TextButton(onClick = viewModel::clearOutcome) { Text("OK", color = DilarionRed) } },
        )
    }
}
