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

/** Task -> team -> each staffer (• submitted) -> the compiled sections that
 *  cite that person's own report. onPreview shows a staffer's raw report. */
@Composable
private fun ReportTree(task: TaskItem, onPreview: (String, String) -> Unit) {
    val attributed = task.compiledSections.isNotEmpty()
    fun reportOf(groupId: Int, username: String): String? =
        task.breakoutGroups.find { it.groupId == groupId }?.members
            ?.find { it.username == username }?.reportText

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("🗂 ${task.title}", fontWeight = FontWeight.Bold, fontSize = 13.sp)
        task.reportTree.forEach { team ->
            Column(Modifier.padding(start = 10.dp)) {
                Text(
                    "👥 ${team.teamName}" + if (team.hasReport) "" else " · no reports yet",
                    fontWeight = FontWeight.SemiBold, fontSize = 12.sp,
                )
                Column(Modifier.padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    team.staff.forEach { st ->
                        val text = reportOf(team.groupId, st.username)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(if (st.submitted) "●" else "○", fontSize = 10.sp, color = if (st.submitted) DilarionRed else TextSecondary)
                            Text(st.username, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            if (text != null) {
                                TextButton(onClick = { onPreview(st.username, text) }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp)) {
                                    Text("preview", fontSize = 10.sp, color = DilarionRed)
                                }
                            } else {
                                Text("no report", fontSize = 10.sp, color = TextSecondary)
                            }
                        }
                        if (st.sections.isNotEmpty()) {
                            Text(
                                st.sections.joinToString("  ") { "§${it.index + 1} ${it.heading}" },
                                fontSize = 10.sp, color = DilarionRed, modifier = Modifier.padding(start = 16.dp),
                            )
                        }
                    }
                    if (!attributed && team.hasReport) {
                        Text("Compile to see who each section cites.", fontSize = 10.sp, color = TextSecondary)
                    }
                }
            }
        }
    }
}

@Composable
fun TaskDetailDialog(
    task: TaskItem,
    currentUsername: String,
    busy: Boolean,
    users: List<com.dilarion.app.data.model.UserInfo> = emptyList(),
    onStatusChange: (String) -> Unit,
    onMyStatusChange: (String) -> Unit,
    onSubmitReport: (groupId: Int, text: String) -> Unit,
    onSubmitMyReport: (text: String) -> Unit = {},
    onAddPeople: (usernames: List<String>, groupName: String?) -> Unit = { _, _ -> },
    onDelete: () -> Unit = {},
    onCompile: () -> Unit,
    onExport: () -> Unit,
    onDismiss: () -> Unit,
) {
    val myAssignee = task.assignees.find { it.username == currentUsername }
    var showTree by remember(task.taskId) { mutableStateOf(false) }
    var preview by remember(task.taskId) { mutableStateOf<Pair<String, String>?>(null) }
    var confirmDelete by remember(task.taskId) { mutableStateOf(false) }
    // My own breakout team + report.
    val myGroup = task.breakoutGroups.find { it.memberUsernames.contains(currentUsername) }
    val myMember = myGroup?.members?.find { it.username == currentUsername }
    var myReport by remember(task.taskId, myMember?.reportText) { mutableStateOf(myMember?.reportText ?: "") }
    // Usernames already on the task — hidden from the add-people picker.
    val existing = remember(task) {
        if (task.isBreakout) task.breakoutGroups.flatMap { it.memberUsernames }.toSet()
        else task.assignees.map { it.username }.toSet()
    }
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
                item {
                    AddPeopleSection(
                        task = task,
                        candidates = users.filter { it.username != null && it.username !in existing },
                        busy = busy,
                        onAdd = onAddPeople,
                    )
                }
                if (task.isBreakout) {
                    item { Text("Breakout teams", fontWeight = FontWeight.Bold, fontSize = 13.sp) }
                    items(task.breakoutGroups.size) { i ->
                        val g = task.breakoutGroups[i]
                        val submitted = g.members.count { it.submitted }
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("👥 ${g.name ?: "Team"}", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                                Text("$submitted/${g.members.size} reported", fontSize = 10.sp, color = TextSecondary)
                            }
                            // Each staffer + their own report (preview).
                            g.members.forEach { m ->
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(if (m.submitted) "●" else "○", fontSize = 10.sp, color = if (m.submitted) DilarionRed else TextSecondary)
                                    Text(m.username + if (m.username == currentUsername) " (you)" else "", fontSize = 12.sp,
                                        fontWeight = if (m.username == currentUsername) FontWeight.SemiBold else FontWeight.Normal)
                                    val txt = m.reportText
                                    if (m.submitted && txt != null) {
                                        TextButton(onClick = { preview = m.username to txt }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp)) {
                                            Text("preview", fontSize = 10.sp, color = DilarionRed)
                                        }
                                    } else {
                                        Text("no report", fontSize = 10.sp, color = TextSecondary)
                                    }
                                }
                            }
                            // Legacy shared team report, if present.
                            if (g.reportText != null) {
                                Text("Team report: ${g.reportText}", fontSize = 11.sp, color = TextSecondary, modifier = Modifier.padding(top = 2.dp))
                            }
                            // My own report box, only in the team I'm on.
                            if (g.memberUsernames.contains(currentUsername)) {
                                OutlinedTextField(
                                    value = myReport,
                                    onValueChange = { myReport = it },
                                    label = { Text(if (myMember?.submitted == true) "Your report (edit & resubmit)" else "Your report") },
                                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                                    minLines = 2,
                                )
                                TextButton(onClick = { onSubmitMyReport(myReport) }, enabled = !busy && myReport.isNotBlank()) {
                                    Text(if (myMember?.submitted == true) "Update my report" else "Submit my report")
                                }
                            }
                        }
                    }
                    item {
                        if (task.compiledReport != null) {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("Compiled report", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    FilterChip(selected = !showTree, onClick = { showTree = false }, label = { Text("Report", fontSize = 10.sp) })
                                    FilterChip(selected = showTree, onClick = { showTree = true }, label = { Text("Tree", fontSize = 10.sp) })
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    TextButton(onClick = onExport, enabled = !busy) { Text("Download .docx", fontSize = 12.sp) }
                                    TextButton(onClick = onCompile, enabled = !busy) { Text(if (busy) "Working…" else "Recompile", fontSize = 12.sp) }
                                }
                                when {
                                    showTree -> ReportTree(task) { u, t -> preview = u to t }
                                    task.compiledSections.isNotEmpty() -> task.compiledSections.forEachIndexed { i, sec ->
                                        Column(Modifier.padding(bottom = 6.dp)) {
                                            Text("${i + 1}. ${sec.heading}", fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                                            Text(
                                                "From: " + sec.sources.ifEmpty { listOf("unattributed") }.joinToString(", "),
                                                fontSize = 10.sp, color = DilarionRed, fontWeight = FontWeight.SemiBold,
                                            )
                                            Text(sec.body, fontSize = 12.sp)
                                        }
                                    }
                                    else -> Text(task.compiledReport, fontSize = 12.sp)
                                }
                            }
                        } else {
                            Button(
                                onClick = onCompile,
                                enabled = !busy && task.breakoutGroups.any { it.hasReport },
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
        dismissButton = {
            TextButton(onClick = { confirmDelete = true }, enabled = !busy) {
                Text("Delete", color = DilarionRed)
            }
        },
    )

    // Staff report preview
    preview?.let { (uname, text) ->
        AlertDialog(
            onDismissRequest = { preview = null },
            title = { Text("$uname's report") },
            text = { Text(text, fontSize = 13.sp) },
            confirmButton = { TextButton(onClick = { preview = null }) { Text("Close") } },
        )
    }

    // Delete confirmation
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete task?") },
            text = { Text("This removes \"${task.title}\" and all its teams and reports. This cannot be undone.") },
            confirmButton = {
                TextButton(onClick = { confirmDelete = false; onDelete() }) { Text("Delete", color = DilarionRed) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

/** Add more people to an existing task. Collapsed to a button until tapped;
 *  then a chip picker of users not already on the task, plus (for a breakout
 *  task) which sub-team they join. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AddPeopleSection(
    task: TaskItem,
    candidates: List<UserInfo>,
    busy: Boolean,
    onAdd: (usernames: List<String>, groupName: String?) -> Unit,
) {
    var expanded by remember(task.taskId) { mutableStateOf(false) }
    val selected = remember(task.taskId) { mutableStateListOf<String>() }
    var groupName by remember(task.taskId) {
        mutableStateOf(task.breakoutGroups.firstOrNull()?.name ?: if (task.isBreakout) "Team A" else null)
    }
    var creatingNew by remember(task.taskId) { mutableStateOf(task.isBreakout && task.breakoutGroups.isEmpty()) }
    var newTeam by remember(task.taskId) { mutableStateOf("") }
    if (!expanded) {
        TextButton(onClick = { expanded = true }) { Text("+ Add people", fontSize = 12.sp) }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Add people", fontWeight = FontWeight.Bold, fontSize = 13.sp)
        if (task.isBreakout) {
            Text("To team:", fontSize = 11.sp, color = TextSecondary)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                task.breakoutGroups.forEach { g ->
                    val n = g.name ?: "Group ${g.groupId}"
                    FilterChip(selected = !creatingNew && groupName == n, onClick = { creatingNew = false; groupName = n }, label = { Text(n, fontSize = 10.sp) })
                }
                FilterChip(selected = creatingNew, onClick = { creatingNew = true }, label = { Text("➕ New team", fontSize = 10.sp) })
            }
            if (creatingNew) {
                OutlinedTextField(
                    value = newTeam,
                    onValueChange = { newTeam = it },
                    label = { Text("New team name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        if (candidates.isEmpty()) {
            Text("Everyone's already on this task.", fontSize = 11.sp, color = TextSecondary)
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                candidates.forEach { u ->
                    val uname = u.username ?: return@forEach
                    val isSel = selected.contains(uname)
                    FilterChip(
                        selected = isSel,
                        onClick = { if (isSel) selected.remove(uname) else selected.add(uname) },
                        label = { Text(uname, fontSize = 10.sp) },
                    )
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val targetTeam = if (!task.isBreakout) null else if (creatingNew) newTeam.trim() else groupName
            Button(
                onClick = { onAdd(selected.toList(), targetTeam); selected.clear(); expanded = false },
                enabled = !busy && selected.isNotEmpty() && (!creatingNew || newTeam.isNotBlank()),
                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
            ) { Text(if (selected.isEmpty()) "Add" else "Add (${selected.size})") }
            TextButton(onClick = { expanded = false; selected.clear() }) { Text("Cancel") }
        }
    }
}
