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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.TaskBreakoutGroupCreate
import com.dilarion.app.data.model.TaskItem
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.TextSecondary

private val STATUS_COLORS = mapOf(
    "open" to Color(0xFF6B7280),
    "in_progress" to Color(0xFF0891B2),
    "completed" to Color(0xFF25D366),
    "cancelled" to Color(0xFFEF4444),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksScreen(viewModel: TasksViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()

    val filtered = when (uiState.filter) {
        TaskStatusFilter.ALL -> uiState.tasks
        TaskStatusFilter.OPEN -> uiState.tasks.filter { it.status == "open" }
        TaskStatusFilter.IN_PROGRESS -> uiState.tasks.filter { it.status == "in_progress" }
        TaskStatusFilter.COMPLETED -> uiState.tasks.filter { it.status == "completed" }
        TaskStatusFilter.CANCELLED -> uiState.tasks.filter { it.status == "cancelled" }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                listOf(
                    TaskStatusFilter.ALL to "All",
                    TaskStatusFilter.OPEN to "Open",
                    TaskStatusFilter.IN_PROGRESS to "In progress",
                    TaskStatusFilter.COMPLETED to "Completed",
                    TaskStatusFilter.CANCELLED to "Cancelled",
                ).forEach { (f, label) ->
                    FilterChip(selected = uiState.filter == f, onClick = { viewModel.setFilter(f) }, label = { Text(label, fontSize = 11.sp) })
                }
            }

            if (uiState.loading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DilarionRed) }
            } else if (filtered.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("No tasks", color = TextSecondary)
                }
            } else {
                LazyColumn(contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(filtered) { task ->
                        TaskRow(task, uiState.currentUsername, onClick = { viewModel.selectTask(task.taskId) })
                    }
                }
            }
        }

        FloatingActionButton(
            onClick = { viewModel.openCreate() },
            containerColor = DilarionRed,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
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
            TaskDetailDialog(
                task = task,
                currentUsername = uiState.currentUsername,
                busy = uiState.busy,
                onStatusChange = { status -> viewModel.updateTaskStatus(task.taskId, status) },
                onMyStatusChange = { status -> viewModel.updateMyStatus(task.taskId, status) },
                onSubmitReport = { groupId, text -> viewModel.submitBreakoutReport(task.taskId, groupId, text) },
                onCompile = { viewModel.compileTask(task.taskId) },
                onDismiss = { viewModel.selectTask(null) },
            )
        }
    }
}

@Composable
private fun TaskRow(task: TaskItem, currentUsername: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = Color.White,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (task.isBreakout) {
                    Surface(shape = RoundedCornerShape(4.dp), color = Color(0xFF7C3AED)) {
                        Text("breakout", color = Color.White, fontSize = 9.sp, modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp))
                    }
                    Spacer(Modifier.width(6.dp))
                }
                Text(task.title, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Surface(shape = RoundedCornerShape(10.dp), color = (STATUS_COLORS[task.status] ?: Color.Gray).copy(alpha = 0.15f)) {
                    Text(
                        task.status.replace("_", " "),
                        color = STATUS_COLORS[task.status] ?: Color.Gray,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                    )
                }
            }
            if (!task.description.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(task.description, color = TextSecondary, fontSize = 12.sp, maxLines = 2)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "by ${task.createdBy ?: "?"}" + (task.dueAt?.let { " · due ${it.take(10)}" } ?: ""),
                color = TextSecondary,
                fontSize = 11.sp,
            )
        }
    }
}
