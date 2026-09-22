package com.dilarion.app.ui.screens.tasks

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.dilarion.app.data.model.Group
import com.dilarion.app.data.model.TaskBreakoutGroupCreate
import com.dilarion.app.data.model.TaskItem
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.TextSecondary

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CreateTaskDialog(
    users: List<UserInfo>,
    groups: List<Group>,
    busy: Boolean,
    error: String?,
    onCreate: (title: String, description: String?, groupId: Int?, isBreakout: Boolean, assignees: List<String>, breakoutGroups: List<TaskBreakoutGroupCreate>, recurrence: String?) -> Unit,
    onDismiss: () -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var groupId by remember { mutableStateOf<Int?>(null) }
    var isBreakout by remember { mutableStateOf(false) }
    var assignees by remember { mutableStateOf(setOf<String>()) }
    var breakoutGroups by remember { mutableStateOf(listOf(BreakoutDraft("Team A", setOf()))) }
    var recurrence by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New Task") },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 480.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
                item {
                    OutlinedTextField(value = description, onValueChange = { description = it }, label = { Text("Description (optional)") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                }
                item {
                    Text("Group", style = MaterialTheme.typography.labelMedium, color = TextSecondary)
                    Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        androidx.compose.foundation.lazy.LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            items(groups) { g ->
                                FilterChip(selected = groupId == g.id, onClick = { groupId = if (groupId == g.id) null else g.id }, label = { Text(g.name, fontSize = 11.sp) })
                            }
                        }
                    }
                }
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = isBreakout, onCheckedChange = { isBreakout = it })
                        Text("Breakout task — split into sub-teams", fontSize = 12.sp)
                    }
                }
                if (isBreakout) {
                    items(breakoutGroups.size) { i ->
                        val bg = breakoutGroups[i]
                        Column {
                            OutlinedTextField(
                                value = bg.name,
                                onValueChange = { v -> breakoutGroups = breakoutGroups.toMutableList().also { it[i] = it[i].copy(name = v) } },
                                label = { Text("Team name") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Spacer(Modifier.height(4.dp))
                            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                users.forEach { u ->
                                    val uname = u.username ?: return@forEach
                                    val checked = bg.usernames.contains(uname)
                                    FilterChip(
                                        selected = checked,
                                        onClick = {
                                            val next = if (checked) bg.usernames - uname else bg.usernames + uname
                                            breakoutGroups = breakoutGroups.toMutableList().also { it[i] = it[i].copy(usernames = next) }
                                        },
                                        label = { Text(uname, fontSize = 10.sp) },
                                    )
                                }
                            }
                        }
                    }
                    item {
                        TextButton(onClick = { breakoutGroups = breakoutGroups + BreakoutDraft("Team ${('A' + breakoutGroups.size)}", setOf()) }) {
                            Text("+ Add another group")
                        }
                    }
                } else {
                    item {
                        Text("Assignees", style = MaterialTheme.typography.labelMedium, color = TextSecondary)
                        androidx.compose.foundation.layout.FlowRow(modifier = Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            users.forEach { u ->
                                val uname = u.username ?: return@forEach
                                val checked = assignees.contains(uname)
                                FilterChip(
                                    selected = checked,
                                    onClick = { assignees = if (checked) assignees - uname else assignees + uname },
                                    label = { Text(uname, fontSize = 10.sp) },
                                )
                            }
                        }
                    }
                }
                item {
                    Text("Repeat", style = MaterialTheme.typography.labelMedium, color = TextSecondary)
                    Row(modifier = Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(null to "None", "daily" to "Daily", "weekly" to "Weekly", "monthly" to "Monthly").forEach { (v, label) ->
                            FilterChip(selected = recurrence == v, onClick = { recurrence = v }, label = { Text(label, fontSize = 10.sp) })
                        }
                    }
                }
                error?.let { item { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) } }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onCreate(
                        title, description, groupId, isBreakout,
                        assignees.toList(),
                        breakoutGroups.map { TaskBreakoutGroupCreate(it.name, it.usernames.toList()) },
                        recurrence,
                    )
                },
                enabled = !busy && title.isNotBlank(),
            ) { Text(if (busy) "Creating…" else "Create") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

data class BreakoutDraft(val name: String, val usernames: Set<String>)

@Composable
fun TaskDetailDialog(
    task: TaskItem,
    currentUsername: String,
    busy: Boolean,
    onStatusChange: (String) -> Unit,
    onMyStatusChange: (String) -> Unit,
    onSubmitReport: (groupId: Int, text: String) -> Unit,
    onCompile: () -> Unit,
    onDismiss: () -> Unit,
) {
    val myAssignee = task.assignees.find { it.username == currentUsername }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(task.title) },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 480.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (!task.description.isNullOrBlank()) {
                    item { Text(task.description, fontSize = 13.sp) }
                }
                item {
                    Text("Status: ${task.status.replace("_", " ")}", fontSize = 12.sp, color = TextSecondary)
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("open", "in_progress", "completed", "cancelled").forEach { s ->
                            FilterChip(selected = task.status == s, onClick = { onStatusChange(s) }, label = { Text(s.replace("_", " "), fontSize = 10.sp) })
                        }
                    }
                }
                if (task.isBreakout) {
                    item { Text("Breakout groups", fontWeight = FontWeight.Bold, fontSize = 13.sp) }
                    items(task.breakoutGroups.size) { i ->
                        val g = task.breakoutGroups[i]
                        val amMember = g.memberUsernames.contains(currentUsername)
                        var reportText by remember(g.groupId) { mutableStateOf(g.reportText ?: "") }
                        Column {
                            Text(g.name ?: "Team", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                            Text(g.memberUsernames.joinToString(", "), fontSize = 11.sp, color = TextSecondary)
                            if (g.reportText != null) {
                                Text("Report: ${g.reportText}", fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
                            } else if (amMember) {
                                OutlinedTextField(
                                    value = reportText,
                                    onValueChange = { reportText = it },
                                    label = { Text("Submit report") },
                                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                                    minLines = 2,
                                )
                                TextButton(onClick = { onSubmitReport(g.groupId, reportText) }, enabled = !busy && reportText.isNotBlank()) {
                                    Text("Submit")
                                }
                            } else {
                                Text("No report yet", fontSize = 11.sp, color = TextSecondary, modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                    item {
                        if (task.compiledReport != null) {
                            Column {
                                Text("Compiled report", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                Text(task.compiledReport, fontSize = 12.sp)
                            }
                        } else {
                            Button(
                                onClick = onCompile,
                                enabled = !busy && task.breakoutGroups.any { it.reportText != null },
                                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                            ) {
                                Icon(Icons.Default.AutoAwesome, null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(if (busy) "Compiling…" else "Compile report with AI")
                            }
                        }
                    }
                } else {
                    item { Text("Assignees", fontWeight = FontWeight.Bold, fontSize = 13.sp) }
                    items(task.assignees.size) { i ->
                        val a = task.assignees[i]
                        Text("${a.username} — ${a.status}", fontSize = 12.sp)
                    }
                    if (myAssignee != null) {
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf("assigned", "in_progress", "completed").forEach { s ->
                                    FilterChip(selected = myAssignee.status == s, onClick = { onMyStatusChange(s) }, label = { Text(s.replace("_", " "), fontSize = 10.sp) })
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}
