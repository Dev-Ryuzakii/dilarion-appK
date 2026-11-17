package com.dilarion.app.ui.screens.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.TaskBreakoutGroupCreate
import com.dilarion.app.data.model.TaskItem
import androidx.compose.foundation.border
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import com.dilarion.app.ui.theme.BorderGrey
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.DilarionRedSoft
import com.dilarion.app.ui.theme.InputGrey
import com.dilarion.app.ui.theme.SurfaceWhite
import com.dilarion.app.ui.theme.TextMuted
import com.dilarion.app.ui.theme.TextPrimary
import com.dilarion.app.ui.theme.TextSecondary

private val STATUS_COLORS = mapOf(
    "open" to Color(0xFF9CA3AF),
    "in_progress" to Color(0xFF0891B2),
    "completed" to Color(0xFF16A34A),
    "cancelled" to Color(0xFFD83428),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(viewModel: TasksViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(uiState.exportedReport) {
        val file = uiState.exportedReport ?: return@LaunchedEffect
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            putExtra(android.content.Intent.EXTRA_STREAM, uri)
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(android.content.Intent.createChooser(send, "Save or share report"))
        viewModel.consumeExportedReport()
    }

    var query by rememberSaveable { mutableStateOf("") }
    fun matches(task: TaskItem, f: TaskStatusFilter) = when (f) {
        TaskStatusFilter.ALL -> true
        TaskStatusFilter.OPEN -> task.status == "open"
        TaskStatusFilter.IN_PROGRESS -> task.status == "in_progress"
        TaskStatusFilter.COMPLETED -> task.status == "completed"
        TaskStatusFilter.CANCELLED -> task.status == "cancelled"
    }
    val searched = uiState.tasks.filter { t ->
        query.isBlank() || t.title.contains(query.trim(), true) || (t.description ?: "").contains(query.trim(), true)
    }
    val filtered = searched.filter { matches(it, uiState.filter) }
    val activeCount = uiState.tasks.count { it.status == "open" || it.status == "in_progress" }
    val doneCount = uiState.tasks.count { it.status == "completed" }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            Text(
                "$activeCount active · $doneCount done",
                fontSize = 13.sp, color = TextSecondary,
                modifier = Modifier.padding(start = 20.dp, bottom = 10.dp),
            )
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                textStyle = TextStyle(fontSize = 15.sp, color = TextPrimary),
                cursorBrush = SolidColor(DilarionRed),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                decorationBox = { inner ->
                    Row(
                        Modifier.clip(RoundedCornerShape(14.dp)).background(InputGrey)
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Default.Search, null, tint = TextMuted, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Box(Modifier.weight(1f)) {
                            if (query.isEmpty()) Text("Search tasks", color = TextMuted, fontSize = 15.sp)
                            inner()
                        }
                    }
                },
            )
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(
                    listOf(
                        TaskStatusFilter.ALL to "All",
                        TaskStatusFilter.OPEN to "Open",
                        TaskStatusFilter.IN_PROGRESS to "In progress",
                        TaskStatusFilter.COMPLETED to "Done",
                        TaskStatusFilter.CANCELLED to "Cancelled",
                    ),
                ) { (f, label) ->
                    val selected = uiState.filter == f
                    val count = searched.count { matches(it, f) }
                    Row(
                        Modifier.clip(RoundedCornerShape(50))
                            .background(if (selected) DilarionRed else SurfaceWhite)
                            .border(1.dp, if (selected) DilarionRed else BorderGrey, RoundedCornerShape(50))
                            .clickable { viewModel.setFilter(f) }
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = if (selected) SurfaceWhite else TextPrimary)
                        Spacer(Modifier.width(6.dp))
                        Text("$count", fontSize = 12.sp, color = if (selected) Color.White.copy(alpha = 0.8f) else TextMuted)
                    }
                }
            }

            if (uiState.loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DilarionRed, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
                }
            } else if (filtered.isEmpty()) {
                Column(
                    Modifier.fillMaxSize().padding(horizontal = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Box(
                        Modifier.size(56.dp).clip(CircleShape).background(DilarionRedSoft),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Default.TaskAlt, null, tint = DilarionRed, modifier = Modifier.size(28.dp)) }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        if (uiState.tasks.isEmpty()) "No tasks yet" else "Nothing here",
                        fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 16.sp,
                    )
                    Text(
                        if (uiState.tasks.isEmpty()) "Tap + to create a task and assign it to people or teams."
                        else "Try another filter or search.",
                        color = TextSecondary, fontSize = 13.sp, textAlign = TextAlign.Center,
                    )
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(filtered, key = { it.taskId }) { task ->
                        TaskRow(task, uiState.currentUsername, onClick = { viewModel.selectTask(task.taskId) })
                    }
                }
            }
        }

        FloatingActionButton(
            onClick = { viewModel.openCreate() },
            containerColor = DilarionRed,
            shape = CircleShape,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
        ) {
            Icon(Icons.Default.Add, "New task", tint = Color.White)
        }
    }

    uiState.error?.let {
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Error") },
            text = { Text(it) },
            confirmButton = { TextButton(onClick = viewModel::clearError) { Text("OK") } },
        )
    }

    if (uiState.showCreate) {
        CreateTaskDialog(
            users = uiState.users,
            groups = uiState.groups,
            busy = uiState.busy,
            error = uiState.createError,
            onCreate = { title, desc, groupId, isBreakout, assignees, breakoutGroups, recurrence ->
                viewModel.createTask(title, desc, groupId, isBreakout, assignees, breakoutGroups, recurrence)
            },
            onDismiss = { viewModel.closeCreate() },
        )
    }

    uiState.selectedTaskId?.let { id ->
        val task = uiState.tasks.find { it.taskId == id }
        if (task != null) {
            LaunchedEffect(task.taskId) { viewModel.ensureDirectoryLoaded() }
            TaskDetailDialog(
                task = task,
                currentUsername = uiState.currentUsername,
                busy = uiState.busy,
                users = uiState.users,
                onStatusChange = { status -> viewModel.updateTaskStatus(task.taskId, status) },
                onMyStatusChange = { status -> viewModel.updateMyStatus(task.taskId, status) },
                onSubmitReport = { groupId, text -> viewModel.submitBreakoutReport(task.taskId, groupId, text) },
                onSubmitMyReport = { text -> viewModel.submitMyReport(task.taskId, text) },
                onAddPeople = { usernames, groupName -> viewModel.addAssignees(task.taskId, usernames, groupName) },
                onDelete = { viewModel.deleteTask(task.taskId) },
                onCompile = { viewModel.compileTask(task.taskId) },
                onExport = { viewModel.exportReport(task) },
                onDismiss = { viewModel.selectTask(null) },
            )
        }
    }
}

private val AVATAR_TINTS = listOf(
    Color(0xFFD83428), Color(0xFF7C3AED), Color(0xFF0891B2), Color(0xFF16A34A), Color(0xFFEA580C), Color(0xFFDB2777),
)

private fun tintFor(name: String) = AVATAR_TINTS[(name.hashCode() and 0x7fffffff) % AVATAR_TINTS.size]

private fun dueDate(raw: String?): java.time.LocalDate? = try {
    raw?.take(10)?.let(java.time.LocalDate::parse)
} catch (e: Exception) { null }

@Composable
private fun TaskRow(task: TaskItem, currentUsername: String, onClick: () -> Unit) {
    val statusColor = STATUS_COLORS[task.status] ?: Color.Gray
    val done = task.status == "completed"
    val cancelled = task.status == "cancelled"
    val due = dueDate(task.dueAt)
    val overdue = due != null && due.isBefore(java.time.LocalDate.now()) && !done && !cancelled
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(SurfaceWhite)
            .border(1.dp, BorderGrey, RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(14.dp),
    ) {
        Box(
            Modifier.padding(top = 1.dp).size(22.dp).clip(CircleShape)
                .background(if (done) statusColor else Color.Transparent)
                .border(2.dp, statusColor, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            when {
                done -> Icon(Icons.Default.Check, null, tint = SurfaceWhite, modifier = Modifier.size(14.dp))
                task.status == "in_progress" -> Box(Modifier.size(8.dp).clip(CircleShape).background(statusColor))
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                task.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
                color = if (done || cancelled) TextMuted else TextPrimary,
                textDecoration = if (done || cancelled) TextDecoration.LineThrough else null,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            if (!task.description.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(task.description, color = TextSecondary, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Chip(task.status.replace("_", " ").replaceFirstChar { it.uppercase() }, statusColor)
                if (task.isBreakout) { Spacer(Modifier.width(6.dp)); Chip("Teams", Color(0xFF7C3AED)) }
                if (due != null) {
                    Spacer(Modifier.width(6.dp))
                    Chip(
                        (if (overdue) "Overdue · " else "Due ") + due.format(java.time.format.DateTimeFormatter.ofPattern("MMM d")),
                        if (overdue) DilarionRed else Color(0xFF6B7280),
                    )
                }
                Spacer(Modifier.weight(1f))
                AssigneeStack(task.assignees.map { it.username }, currentUsername)
            }
        }
    }
}

@Composable
private fun Chip(text: String, color: Color) {
    Text(
        text, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = color, maxLines = 1,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
private fun AssigneeStack(names: List<String>, currentUsername: String) {
    if (names.isEmpty()) return
    val shown = names.sortedByDescending { it == currentUsername }.take(3)
    Row {
        shown.forEachIndexed { i, name ->
            Box(
                Modifier.offset(x = (-6 * i).dp).size(24.dp).clip(CircleShape).background(SurfaceWhite).padding(1.5.dp)
                    .clip(CircleShape).background(tintFor(name)),
                contentAlignment = Alignment.Center,
            ) {
                Text(name.firstOrNull()?.uppercaseChar()?.toString() ?: "?", color = SurfaceWhite, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }
        if (names.size > 3) {
            Text(
                "+${names.size - 3}", fontSize = 11.sp, color = TextSecondary,
                modifier = Modifier.offset(x = (-6 * shown.size + 8).dp).align(Alignment.CenterVertically),
            )
        }
    }
}
