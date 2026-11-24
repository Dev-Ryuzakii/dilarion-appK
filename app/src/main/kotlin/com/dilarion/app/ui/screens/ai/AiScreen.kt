package com.dilarion.app.ui.screens.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.AiChatMessage
import com.dilarion.app.ui.theme.*

private val SUGGESTIONS = listOf(
    "Remind me to send the budget tomorrow at 9",
    "Create a task for the team to review the Q1 report by Friday",
    "Draft a meeting with the design group next week",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiScreen(onBack: () -> Unit, viewModel: AiViewModel = hiltViewModel()) {
    val ui by viewModel.ui.collectAsState()
    var showChats by remember { mutableStateOf(false) }

    ui.error?.let { err ->
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Something went wrong") }, text = { Text(err) },
            confirmButton = { TextButton(onClick = viewModel::clearError) { Text("OK", color = DilarionRed) } },
        )
    }

    if (showChats) {
        ModalBottomSheet(onDismissRequest = { showChats = false }, containerColor = SurfaceWhite) {
            Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Chats", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary, modifier = Modifier.weight(1f))
                    TextButton(onClick = { viewModel.newChat(); showChats = false }) {
                        Icon(Icons.Default.Add, null, tint = DilarionRed); Text(" New chat", color = DilarionRed)
                    }
                }
                if (ui.conversations.isEmpty()) Text("No chats yet", color = TextSecondary, modifier = Modifier.padding(20.dp))
                LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    items(ui.conversations, key = { it.id }) { c ->
                        Row(
                            Modifier.fillMaxWidth().clickable { viewModel.open(c.id); showChats = false }
                                .background(if (c.id == ui.currentId) DilarionRedSoft else SurfaceWhite)
                                .padding(start = 20.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(Icons.Default.ChatBubbleOutline, null, tint = TextSecondary, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(12.dp))
                            Text(c.title, color = TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                            IconButton(onClick = { viewModel.delete(c.id) }) { Icon(Icons.Default.DeleteOutline, "Delete chat", tint = TextMuted) }
                        }
                    }
                }
            }
        }
    }

    Column(Modifier.fillMaxSize().background(BackgroundGrey).statusBarsPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 6.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = TextPrimary) }
            Box(Modifier.size(30.dp).clip(CircleShape).background(DilarionRed), contentAlignment = Alignment.Center) {
                Icon(Icons.Default.AutoAwesome, null, tint = SurfaceWhite, modifier = Modifier.size(17.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("Dilarion AI", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
                if (ui.tab == AiTab.CHAT) Text(ui.currentTitle, fontSize = 12.sp, color = TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = { showChats = true }) { Icon(Icons.Default.History, "Chats", tint = TextSecondary) }
            IconButton(onClick = viewModel::newChat) { Icon(Icons.Default.Edit, "New chat", tint = TextSecondary) }
        }
        Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(InputGrey).padding(3.dp)) {
            val awaiting = ui.runs.values.count { it.status == "awaiting_approval" }
            TabPill("Chat", ui.tab == AiTab.CHAT, Modifier.weight(1f)) { viewModel.setTab(AiTab.CHAT) }
            TabPill(if (awaiting > 0) "Agents ($awaiting)" else "Agents", ui.tab == AiTab.AGENTS, Modifier.weight(1f)) { viewModel.setTab(AiTab.AGENTS) }
        }
        when (ui.tab) {
            AiTab.CHAT -> ChatPane(ui, viewModel, Modifier.weight(1f))
            AiTab.AGENTS -> AgentsPane(ui, viewModel, Modifier.weight(1f))
        }
    }
}

@Composable
private fun TabPill(label: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.clip(RoundedCornerShape(10.dp)).background(if (selected) SurfaceWhite else InputGrey).clickable(onClick = onClick).padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (selected) DilarionRed else TextSecondary) }
}

@Composable
private fun ChatPane(ui: AiUiState, vm: AiViewModel, modifier: Modifier) {
    var text by remember { mutableStateOf("") }
    val list = rememberLazyListState()
    LaunchedEffect(ui.messages.size, ui.sending) { if (ui.messages.isNotEmpty()) list.animateScrollToItem(ui.messages.size - 1 + if (ui.sending) 1 else 0) }

    Column(modifier) {
        if (ui.messages.isEmpty() && !ui.loading) {
            Column(Modifier.weight(1f).fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Default.AutoAwesome, null, tint = DilarionRed, modifier = Modifier.size(36.dp))
                Spacer(Modifier.height(10.dp))
                Text("Ask anything, or tell it to get something done", fontWeight = FontWeight.SemiBold, color = TextPrimary, fontSize = 16.sp)
                Spacer(Modifier.height(4.dp))
                Text("Agents can set reminders, create tasks, draft meetings and find people in your organization.", color = TextSecondary, fontSize = 13.sp)
                Spacer(Modifier.height(16.dp))
                SUGGESTIONS.forEach { s ->
                    Text(s, fontSize = 13.sp, color = TextPrimary, modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)
                        .clip(RoundedCornerShape(10.dp)).background(SurfaceWhite).clickable { vm.send(s) }.padding(12.dp))
                }
            }
        } else {
            LazyColumn(Modifier.weight(1f), state = list, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ui.messages, key = { "${it.id}-${it.role}-${it.content.hashCode()}" }) { m ->
                    Bubble(m)
                    m.agentRunId?.let { id -> ui.runs[id]?.let { run ->
                        Spacer(Modifier.height(6.dp))
                        AgentRunCard(run, onApprove = { vm.approve(run.id) }, onCancel = { vm.cancel(run.id) })
                    } }
                }
                if (ui.sending) item { Text("Thinking…", color = TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(start = 4.dp)) }
            }
        }
        Composer(text, { text = it }, "Message Dilarion AI", ui.sending) { vm.send(text); text = "" }
    }
}

@Composable
private fun Bubble(m: AiChatMessage) {
    val mine = m.role == "user"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Text(
            m.content, fontSize = 15.sp, color = if (mine) SurfaceWhite else TextPrimary,
            modifier = Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(16.dp))
                .background(if (mine) DilarionRed else SurfaceWhite).padding(horizontal = 14.dp, vertical = 10.dp),
        )
    }
}

@Composable
private fun AgentsPane(ui: AiUiState, vm: AiViewModel, modifier: Modifier) {
    var text by remember { mutableStateOf("") }
    val runs = ui.runs.values.sortedByDescending { it.id }
    Column(modifier) {
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item {
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(SurfaceWhite).padding(start = 14.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Bolt, null, tint = DilarionRed)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Full control", fontWeight = FontWeight.SemiBold, color = TextPrimary)
                        Text(if (ui.autoApprove) "Agents run their plans without asking" else "You approve every plan before it runs", fontSize = 12.sp, color = TextSecondary)
                    }
                    Switch(checked = ui.autoApprove, onCheckedChange = vm::setAutoApprove,
                        colors = SwitchDefaults.colors(checkedTrackColor = DilarionRed, checkedThumbColor = SurfaceWhite))
                }
            }
            if (runs.isEmpty()) item { Text("No agent runs yet. Describe a job below and an agent will plan it.", color = TextSecondary, fontSize = 14.sp, modifier = Modifier.padding(8.dp)) }
            items(runs, key = { it.id }) { run -> AgentRunCard(run, onApprove = { vm.approve(run.id) }, onCancel = { vm.cancel(run.id) }) }
        }
        Composer(text, { text = it }, "Ask an agent to…", ui.sending) { vm.startAgent(text); text = "" }
    }
}

@Composable
private fun Composer(text: String, onText: (String) -> Unit, hint: String, busy: Boolean, onSend: () -> Unit) {
    Row(Modifier.fillMaxWidth().background(SurfaceWhite).navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        TextField(
            value = text, onValueChange = onText, placeholder = { Text(hint) }, maxLines = 4,
            modifier = Modifier.weight(1f).clip(RoundedCornerShape(22.dp)),
            colors = TextFieldDefaults.colors(focusedContainerColor = InputGrey, unfocusedContainerColor = InputGrey,
                focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent, unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent),
        )
        Spacer(Modifier.width(8.dp))
        IconButton(
            onClick = onSend, enabled = text.isNotBlank() && !busy,
            modifier = Modifier.size(44.dp).clip(CircleShape).background(if (text.isNotBlank() && !busy) DilarionRed else InputGrey),
        ) { Icon(Icons.AutoMirrored.Filled.Send, "Send", tint = if (text.isNotBlank() && !busy) SurfaceWhite else TextMuted) }
    }
}
