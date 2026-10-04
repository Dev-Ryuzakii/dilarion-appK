package com.dilarion.app.ui.screens.groups

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.GROUP_DISAPPEAR_OPTIONS
import com.dilarion.app.data.model.Group
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.data.model.formatDisappear
import com.dilarion.app.ui.screens.devices.PortraitCaptureActivity
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite
import com.dilarion.app.ui.theme.TextSecondary
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeEncoder
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

// Self-service groups on Android — mirrors desktop's GroupDialogs.tsx.

private fun initials(name: String): String =
    name.split(Regex("\\s+")).filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }

@Composable
private fun SectionLabel(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            Icon(icon, null, tint = TextSecondary, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
        }
        Text(text.uppercase(), color = TextSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DisappearPicker(value: Int?, enabled: Boolean = true, onChange: (Int?) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        GROUP_DISAPPEAR_OPTIONS.forEach { (label, hours) ->
            FilterChip(
                selected = hours == value,
                enabled = enabled,
                onClick = { onChange(hours) },
                label = { Text(label) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = DilarionRed,
                    selectedLabelColor = Color.White,
                ),
            )
        }
    }
}

@Composable
private fun UserPicker(
    users: List<UserInfo>,
    exclude: Set<String>,
    selected: List<String>,
    onToggle: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val shown = users
        .mapNotNull { it.username }
        .filter { it !in exclude && it.contains(query.trim(), ignoreCase = true) }
        .take(100)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Search people") },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (shown.isEmpty()) {
            Text("No people found", color = TextSecondary, fontSize = 13.sp, modifier = Modifier.padding(8.dp))
        }
        shown.forEach { u ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onToggle(u) }
                    .padding(vertical = 4.dp),
            ) {
                Checkbox(checked = u in selected, onCheckedChange = { onToggle(u) })
                Box(
                    Modifier.size(30.dp).clip(CircleShape).background(DilarionRed),
                    contentAlignment = Alignment.Center,
                ) { Text(u.take(2).uppercase(), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.width(10.dp))
                Text(u, fontSize = 15.sp)
            }
        }
    }
}

// ── Create group ──────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateGroupScreen(
    onBack: () -> Unit,
    onCreated: (Group) -> Unit,
    viewModel: GroupManageViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var timer by remember { mutableStateOf<Int?>(null) }
    val members = remember { mutableStateListOf<String>() }

    LaunchedEffect(Unit) { viewModel.loadUsers() }
    LaunchedEffect(state.openedGroup) { state.openedGroup?.let(onCreated) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("New group", color = SurfaceWhite) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { viewModel.createGroup(name, description, members.toList(), timer) },
                containerColor = DilarionRed,
                contentColor = Color.White,
                icon = { if (state.busy) CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp) else Icon(Icons.Default.Check, null) },
                text = { Text("Create group") },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            OutlinedTextField(name, { if (it.length <= 100) name = it }, label = { Text("Group name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                description, { if (it.length <= 500) description = it },
                label = { Text("Description (optional)") }, minLines = 2, modifier = Modifier.fillMaxWidth(),
            )
            SectionLabel("Disappearing messages", Icons.Default.Timer)
            DisappearPicker(timer) { timer = it }
            Text("New messages in this group disappear for everyone after the chosen time.", color = TextSecondary, fontSize = 12.sp)
            SectionLabel("Add members" + if (members.isNotEmpty()) " (${members.size})" else "")
            UserPicker(state.users, setOf(state.me), members) { u -> if (u in members) members.remove(u) else members.add(u) }
            Text("You can also add people later or share an invite link.", color = TextSecondary, fontSize = 12.sp)
            state.error?.let { Text(it, color = Color(0xFFEF4444), fontSize = 13.sp) }
            Spacer(Modifier.height(72.dp))
        }
    }
}

// ── Join via link / QR ────────────────────────────────────────────────────────

@Composable
fun JoinGroupDialog(
    onDismiss: () -> Unit,
    onJoined: (Group) -> Unit,
    viewModel: GroupManageViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var code by remember { mutableStateOf("") }

    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { scanned -> code = scanned; viewModel.previewInvite(scanned) }
    }
    LaunchedEffect(state.openedGroup) { state.openedGroup?.let(onJoined) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Join a group") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    label = { Text("Invite link or code") },
                    placeholder = { Text("dilarion://join/…") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        scanLauncher.launch(
                            ScanOptions()
                                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                                .setPrompt("Scan the group's invite QR code")
                                .setBeepEnabled(false)
                                .setOrientationLocked(true)
                                .setCaptureActivity(PortraitCaptureActivity::class.java)
                        )
                    }) {
                        Icon(Icons.Default.QrCodeScanner, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Scan QR")
                    }
                    OutlinedButton(onClick = { viewModel.previewInvite(code) }, enabled = code.isNotBlank() && !state.busy) { Text("Check") }
                }
                state.preview?.let { p ->
                    Surface(shape = RoundedCornerShape(12.dp), tonalElevation = 2.dp) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(p.name, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Text(
                                "${p.memberCount} members" + if (p.disappearAfterHours != null) " · Disappearing: ${formatDisappear(p.disappearAfterHours)}" else "",
                                color = TextSecondary, fontSize = 12.sp,
                            )
                            p.description?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp) }
                        }
                    }
                }
                state.error?.let { Text(it, color = Color(0xFFEF4444), fontSize = 13.sp) }
            }
        },
        confirmButton = {
            val p = state.preview
            if (p != null) {
                TextButton(onClick = { viewModel.joinInvite(code) }, enabled = !state.busy) {
                    Text(if (p.alreadyMember) "Open group" else if (state.busy) "Joining…" else "Join group")
                }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ── Group info ────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupInfoScreen(
    groupId: Int,
    onBack: () -> Unit,
    onGroupGone: () -> Unit,
    viewModel: GroupManageViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val group = state.group
    val clipboard = LocalClipboardManager.current

    LaunchedEffect(groupId) { viewModel.load(groupId) }
    LaunchedEffect(state.gone) { if (state.gone) onGroupGone() }

    var editing by remember { mutableStateOf(false) }
    var name by remember(group?.name) { mutableStateOf(group?.name ?: "") }
    var description by remember(group?.description) { mutableStateOf(group?.description ?: "") }
    var tab by remember { mutableIntStateOf(0) }
    var adding by remember { mutableStateOf(false) }
    val toAdd = remember { mutableStateListOf<String>() }
    var confirm by remember { mutableStateOf<Pair<String, () -> Unit>?>(null) }

    confirm?.let { (msg, action) ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            text = { Text(msg) },
            confirmButton = { TextButton(onClick = { action(); confirm = null }) { Text("OK", color = DilarionRed) } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Group info", color = SurfaceWhite) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            // Identity
            item {
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        Modifier.size(84.dp).clip(CircleShape).background(DilarionRed),
                        contentAlignment = Alignment.Center,
                    ) { Text(initials(group?.name ?: "?"), color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold) }
                    Spacer(Modifier.height(10.dp))
                    if (editing) {
                        OutlinedTextField(name, { if (it.length <= 100) name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(description, { if (it.length <= 500) description = it }, label = { Text("Description") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { editing = false; name = group?.name ?: ""; description = group?.description ?: "" }) { Text("Cancel") }
                            TextButton(onClick = { viewModel.saveInfo(name, description); editing = false }, enabled = name.isNotBlank()) { Text("Save") }
                        }
                    } else {
                        Text(group?.name ?: "", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Text("Group · ${state.members.size.takeIf { it > 0 } ?: group?.memberCount ?: 0} members", color = TextSecondary, fontSize = 13.sp)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            group?.description?.takeIf { it.isNotBlank() } ?: if (state.iAmAdmin) "No description yet" else "No description",
                            fontStyle = if (group?.description.isNullOrBlank()) FontStyle.Italic else FontStyle.Normal,
                            color = if (group?.description.isNullOrBlank()) TextSecondary else Color.Unspecified,
                            textAlign = TextAlign.Center, fontSize = 14.sp,
                        )
                        if (state.iAmAdmin) {
                            TextButton(onClick = { editing = true }) {
                                Icon(Icons.Default.Edit, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Edit name & description")
                            }
                        }
                    }
                }
            }

            state.error?.let { err ->
                item { Text(err, color = Color(0xFFEF4444), fontSize = 13.sp, modifier = Modifier.clickable { viewModel.clearError() }) }
            }

            // Disappearing messages
            item {
                Surface(shape = RoundedCornerShape(12.dp), tonalElevation = 1.dp) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SectionLabel("Disappearing messages", Icons.Default.Timer)
                        if (state.iAmAdmin) {
                            DisappearPicker(group?.disappearAfterHours) { viewModel.setTimer(it) }
                            Text("Applies to new messages from everyone in the group.", color = TextSecondary, fontSize = 12.sp)
                        } else {
                            Text(formatDisappear(group?.disappearAfterHours), fontSize = 15.sp)
                            Text("Only group admins can change this.", color = TextSecondary, fontSize = 12.sp)
                        }
                    }
                }
            }

            if (state.iAmAdmin) {
                item {
                    TabRow(selectedTabIndex = tab) {
                        Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Members") })
                        Tab(selected = tab == 1, onClick = { tab = 1; if (state.invite == null) viewModel.loadInvite() }, text = { Text("Invite link / QR") })
                    }
                }
            }

            if (state.iAmAdmin && tab == 1) {
                item {
                    val invite = state.invite
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (invite == null) {
                            CircularProgressIndicator(color = DilarionRed)
                        } else {
                            val qr: Bitmap? = remember(invite.qrPayload) {
                                runCatching { BarcodeEncoder().encodeBitmap(invite.qrPayload, BarcodeFormat.QR_CODE, 600, 600) }.getOrNull()
                            }
                            qr?.let {
                                Box(Modifier.clip(RoundedCornerShape(12.dp)).background(Color.White).padding(10.dp)) {
                                    Image(it.asImageBitmap(), "Group invite QR code", modifier = Modifier.size(220.dp))
                                }
                            }
                            Text(invite.inviteLink, fontFamily = FontFamily.Monospace, fontSize = 13.sp, textAlign = TextAlign.Center)
                            Text("Anyone with this link or QR code can join the group.", color = TextSecondary, fontSize = 12.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                OutlinedButton(onClick = { clipboard.setText(AnnotatedString(invite.inviteLink)) }) {
                                    Icon(Icons.Default.ContentCopy, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Copy link")
                                }
                                OutlinedButton(onClick = {
                                    confirm = "Reset the invite link? The current link and QR code will stop working." to { viewModel.loadInvite(reset = true) }
                                }) { Text("Reset link", color = DilarionRed) }
                            }
                        }
                    }
                }
            } else {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        SectionLabel("Members (${state.members.size})")
                        Spacer(Modifier.weight(1f))
                        if (state.iAmAdmin && !adding) {
                            TextButton(onClick = { adding = true; viewModel.loadUsers() }) {
                                Icon(Icons.Default.PersonAdd, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("Add")
                            }
                        }
                    }
                }
                if (adding) {
                    item {
                        Column {
                            UserPicker(state.users, state.members.map { it.username }.toSet(), toAdd) { u -> if (u in toAdd) toAdd.remove(u) else toAdd.add(u) }
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                TextButton(onClick = { adding = false; toAdd.clear() }) { Text("Cancel") }
                                TextButton(onClick = { viewModel.addMembers(toAdd.toList()); toAdd.clear(); adding = false }, enabled = toAdd.isNotEmpty()) {
                                    Text("Add ${toAdd.size.takeIf { it > 0 } ?: ""}")
                                }
                            }
                        }
                    }
                }
                val sorted = state.members.sortedWith(compareBy({ if (it.role == "admin") 0 else 1 }, { it.username }))
                items(sorted, key = { it.userId }) { m ->
                    val isMe = m.username == state.me
                    val isAdmin = m.role == "admin"
                    var menu by remember { mutableStateOf(false) }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Box(
                            Modifier.size(38.dp).clip(CircleShape).background(DilarionRed),
                            contentAlignment = Alignment.Center,
                        ) { Text(m.username.take(2).uppercase(), color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold) }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(m.username + if (isMe) " (you)" else "", fontSize = 15.sp)
                            if (isAdmin) Text("Group admin", color = DilarionRed, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                        if (state.iAmAdmin && !isMe) {
                            Box {
                                IconButton(onClick = { menu = true }, enabled = !state.busy) { Icon(Icons.Default.MoreVert, "Member options") }
                                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                    DropdownMenuItem(
                                        text = { Text(if (isAdmin) "Dismiss as admin" else "Make group admin") },
                                        onClick = { menu = false; if (isAdmin) viewModel.demote(m.username) else viewModel.promote(m.username) },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Remove ${m.username}", color = DilarionRed) },
                                        onClick = { menu = false; confirm = "Remove ${m.username} from the group?" to { viewModel.remove(m.username) } },
                                    )
                                }
                            }
                        }
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                    OutlinedButton(
                        onClick = { confirm = "Leave \"${group?.name ?: "this group"}\"?" to { viewModel.leave() } },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.ExitToApp, null, tint = DilarionRed); Spacer(Modifier.width(8.dp)); Text("Leave group", color = DilarionRed)
                    }
                    if (state.iAmAdmin) {
                        Button(
                            onClick = {
                                confirm = "Delete \"${group?.name ?: "this group"}\" for everyone? All messages in it will be removed. This can't be undone." to { viewModel.deleteGroup() }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Icon(Icons.Default.Delete, null); Spacer(Modifier.width(8.dp)); Text("Delete group for everyone")
                        }
                    }
                }
            }
        }
    }
}
