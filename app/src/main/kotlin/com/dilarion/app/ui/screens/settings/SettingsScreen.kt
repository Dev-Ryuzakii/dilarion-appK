package com.dilarion.app.ui.screens.settings

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.activity.compose.BackHandler
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Restore
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil.compose.SubcomposeAsyncImageContent
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.platform.LocalContext
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.ui.theme.*
import kotlinx.coroutines.launch

/** Settings is one main list; each row opens its own page inside this screen. */
private enum class SettingsPage(val title: String) {
    HUB("Settings"),
    AVAILABILITY("Status"),
    NOTIFICATIONS("Notifications"),
    TWO_FA("Two-factor (2FA)"),
    VOICE("AI voice decoy"),
    USERNAME("Username"),
    RECOVERY("Recovery code"),
    DANGER("Delete account"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onMasterToken: () -> Unit = {},
    onLinkedDevices: () -> Unit = {},
    onLogout: (() -> Unit)? = null,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val activity = context as? FragmentActivity
    val scope = rememberCoroutineScope()


    var page by rememberSaveable { mutableStateOf(SettingsPage.HUB) }
    BackHandler(enabled = page != SettingsPage.HUB) { page = SettingsPage.HUB }
    var showLogoutDialog by remember { mutableStateOf(false) }
    var showEnable2FA by remember { mutableStateOf(false) }
    var enable2FAMasterToken by remember { mutableStateOf("") }
    var enable2FAPassword by remember { mutableStateOf("") }
    var showDisable2FA by remember { mutableStateOf(false) }
    var disable2FAPassword by remember { mutableStateOf("") }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var deleteReason by remember { mutableStateOf("") }
    var speechText by remember { mutableStateOf("") }

    val voiceIdentityAudioPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) viewModel.startVoiceIdentityRecording(context)
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Log out") },
            text = { Text("Are you sure you want to log out?") },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    viewModel.logout { onLogout?.invoke() }
                }) {
                    Text("Log out", color = DilarionRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) { Text("Cancel") }
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(
                        onClick = { if (page != SettingsPage.HUB) page = SettingsPage.HUB else onBack() },
                        modifier = Modifier.padding(start = 8.dp).size(40.dp).clip(CircleShape).background(InputGrey),
                    ) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = TextPrimary, modifier = Modifier.size(20.dp))
                    }
                },
                title = { Text(page.title, color = TextPrimary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp)) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SettingsBg),
            )
        },
        containerColor = SettingsBg,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(key(page) { rememberScrollState() }),
        ) {

            when (page) {
                SettingsPage.HUB -> {
                    // ── Hub: profile card, then grouped rows that open sub-pages ─────
                    // ── Profile header ────────────────────────────────────────────────
                    val pfpPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
                        if (uri != null) viewModel.uploadProfilePicture(context, uri)
                    }
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(SurfaceWhite)
                            .padding(24.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                modifier = Modifier
                                    .size(84.dp)
                                    .clip(RoundedCornerShape(26.dp))
                                    .background(DilarionRed)
                                    .clickable { pfpPicker.launch("image/*") },
                                contentAlignment = Alignment.Center,
                            ) {
                                coil.compose.SubcomposeAsyncImage(
                                    model = coil.request.ImageRequest.Builder(context)
                                        .data("${com.dilarion.app.BuildConfig.BASE_URL}users/${uiState.username}/profile-picture?v=${uiState.profilePictureVersion}")
                                        .build(),
                                    contentDescription = "Profile picture",
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize(),
                                ) {
                                    val state = painter.state
                                    if (state is coil.compose.AsyncImagePainter.State.Success) {
                                        SubcomposeAsyncImageContent()
                                    } else {
                                        // Centred initial while there is no photo (or it fails to load).
                                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                            Text(
                                                uiState.username.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                                                color = SurfaceWhite,
                                                fontSize = 34.sp,
                                                fontWeight = FontWeight.ExtraBold,
                                            )
                                        }
                                    }
                                }
                                if (uiState.profilePictureBusy) {
                                    Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.4f)), contentAlignment = Alignment.Center) {
                                        CircularProgressIndicator(modifier = Modifier.size(24.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                    }
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                            Row {
                                TextButton(onClick = { pfpPicker.launch("image/*") }) { Text("Change photo", fontSize = 12.sp) }
                                TextButton(onClick = { viewModel.removeProfilePicture() }) { Text("Remove", fontSize = 12.sp, color = DilarionRed) }
                            }
                            uiState.profilePictureError?.let {
                                Text(it, color = DilarionRed, style = MaterialTheme.typography.bodySmall)
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(
                                uiState.username,
                                style = MaterialTheme.typography.headlineSmall,
                                fontWeight = FontWeight.Bold,
                            )
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier
                                    .padding(top = 6.dp)
                                    .clip(RoundedCornerShape(50))
                                    .background(InputGrey)
                                    .clickable { page = SettingsPage.AVAILABILITY }
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                            ) {
                                Box(Modifier.size(8.dp).clip(CircleShape).background(availabilityColor(uiState.availabilityStatus)))
                                Spacer(Modifier.width(6.dp))
                                Text(availabilityLabel(uiState.availabilityStatus), fontSize = 12.sp, color = TextPrimary, fontWeight = FontWeight.Medium)
                            }
                        }
                    }


                    Spacer(Modifier.height(20.dp))
                    SettingsSectionHeader("You")
                    SettingsCard {
                        HubRow(Icons.Default.Circle, "Status", availabilityLabel(uiState.availabilityStatus) + (uiState.statusText.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""), iconTint = availabilityColor(uiState.availabilityStatus)) { page = SettingsPage.AVAILABILITY }
                        HubDivider()
                        HubRow(Icons.Default.Person, "Username", uiState.username) { page = SettingsPage.USERNAME }
                        HubDivider()
                        HubRow(Icons.Default.Notifications, "Notifications", when {
                            uiState.notifMuteAll -> "Paused"
                            uiState.notifQuietEnabled -> String.format("Quiet %02d:00–%02d:00", uiState.notifQuietStart, uiState.notifQuietEnd)
                            else -> "On"
                        }) { page = SettingsPage.NOTIFICATIONS }
                    }

                    Spacer(Modifier.height(20.dp))
                    SettingsSectionHeader("Security")
                    SettingsCard {
                        HubRow(Icons.Default.Key, if (uiState.hasMasterToken) "Master token" else "Set master token",
                            if (uiState.hasMasterToken) "Change the token that reveals messages" else "Required to read messages") { onMasterToken() }
                        HubDivider()
                        HubRow(Icons.Default.Shield, "Two-factor (2FA)", if (uiState.twoFaEnabled) "On" else "Off") { page = SettingsPage.TWO_FA }
                        HubDivider()
                        HubRow(Icons.Default.Restore, "Recovery code", "Reset your access token without an admin") { page = SettingsPage.RECOVERY }
                        HubDivider()
                        HubRow(Icons.Default.Devices, "Linked devices", "Link your desktop by QR, unlink devices") { onLinkedDevices() }
                    }

                    Spacer(Modifier.height(20.dp))
                    SettingsSectionHeader("Privacy")
                    SettingsCard {
                        HubRow(Icons.Default.GraphicEq, "AI voice decoy", if (uiState.voiceIdentityEnrolled) "Enrolled — decoys use your voice" else "Not set up") { page = SettingsPage.VOICE }
                    }

                    Spacer(Modifier.height(20.dp))
                    SettingsCard {
                        HubRow(Icons.Default.ExitToApp, "Log out", null, danger = true, chevron = false) { showLogoutDialog = true }
                        HubDivider()
                        HubRow(Icons.Default.Warning, "Delete account", when (uiState.deletionStatus) {
                            "pending" -> "Request pending review"
                            "approved" -> "Request approved"
                            "denied" -> "Last request denied"
                            else -> null
                        }, danger = true) { page = SettingsPage.DANGER }
                    }

                    Spacer(Modifier.height(24.dp))
                    // App version — reads the real build version so OTA bumps show here.
                    Text(
                        "Dilarion v${com.dilarion.app.BuildConfig.VERSION_NAME} · Secure · Private · Encrypted",
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary.copy(alpha = 0.6f),
                        modifier = Modifier
                            .align(Alignment.CenterHorizontally)
                            .padding(bottom = 16.dp),
                    )
                }
                SettingsPage.AVAILABILITY -> {
                    SettingsIntro("Let people know if you can talk right now.")
                    var statusTextInput by remember { mutableStateOf(uiState.statusText) }
                    SettingsCard {
                        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                            val statuses = listOf("available" to "Available", "busy" to "Busy", "dnd" to "Do Not Disturb", "away" to "Away", "offline" to "Appear Offline")
                            @OptIn(ExperimentalLayoutApi::class)
                            FlowRow(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                statuses.forEach { (value, label) ->
                                    val selected = uiState.availabilityStatus == value
                                    FilterChip(
                                        selected = selected,
                                        onClick = { viewModel.setAvailability(value, statusTextInput) },
                                        label = { Text(label, fontSize = 11.sp) },
                                    )
                                }
                            }
                            OutlinedTextField(
                                value = statusTextInput,
                                onValueChange = { statusTextInput = it },
                                placeholder = { Text("Custom status (optional)") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                                shape = RoundedCornerShape(14.dp),
                                trailingIcon = {
                                    TextButton(onClick = { viewModel.setAvailability(uiState.availabilityStatus, statusTextInput) }) {
                                        Text("Save", fontSize = 12.sp)
                                    }
                                },
                            )
                            uiState.availabilityError?.let {
                                Text(it, color = DilarionRed, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                            }
                        }
                    }

                    Spacer(Modifier.height(24.dp))
                }
                SettingsPage.NOTIFICATIONS -> {
                    SettingsIntro("Choose when Dilarion can interrupt you.")
                    SettingsCard {
                        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text("Pause all notifications", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    Text("Silence messages, tasks and reminders. Calls still ring.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                                }
                                Switch(checked = uiState.notifMuteAll, onCheckedChange = { viewModel.setNotifMuteAll(it) })
                            }
                            HorizontalDivider(color = BorderGrey, modifier = Modifier.padding(start = 64.dp))
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text("Quiet hours", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    Text("Mute non-urgent notifications during a daily window.", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                                }
                                Switch(checked = uiState.notifQuietEnabled, onCheckedChange = { viewModel.setNotifQuietEnabled(it) })
                            }
                            if (uiState.notifQuietEnabled) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    modifier = Modifier.padding(vertical = 8.dp),
                                ) {
                                    Text("From", style = MaterialTheme.typography.bodySmall)
                                    HourStepper(uiState.notifQuietStart) { viewModel.setNotifQuietWindow(it, uiState.notifQuietEnd) }
                                    Text("to", style = MaterialTheme.typography.bodySmall)
                                    HourStepper(uiState.notifQuietEnd) { viewModel.setNotifQuietWindow(uiState.notifQuietStart, it) }
                                    Text("local time", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(24.dp))
                }
                SettingsPage.TWO_FA -> {
                    SettingsIntro("Ask for a second password before anyone can create or reset your master token.")

                    SettingsCard {
                        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Shield, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
                                Spacer(Modifier.width(16.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        if (uiState.twoFaEnabled) "2FA enabled" else "2FA disabled",
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Medium,
                                    )
                                    Text(
                                        "Requires a second password to create or reset your master token",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextSecondary,
                                    )
                                }
                            }

                            if (!uiState.twoFaEnabled && !showEnable2FA) {
                                Spacer(Modifier.height(10.dp))
                                TextButton(onClick = { showEnable2FA = true }) { Text("Enable 2FA", color = DilarionRed) }
                            }

                            if (!uiState.twoFaEnabled && showEnable2FA) {
                                Spacer(Modifier.height(10.dp))
                                OutlinedTextField(
                                    value = enable2FAMasterToken,
                                    onValueChange = { enable2FAMasterToken = it },
                                    label = { Text("Current master token") },
                                    singleLine = true,
                                    visualTransformation = PasswordVisualTransformation(),
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DilarionRed),
                                )
                                Spacer(Modifier.height(8.dp))
                                OutlinedTextField(
                                    value = enable2FAPassword,
                                    onValueChange = { enable2FAPassword = it },
                                    label = { Text("New 2FA password (min 6 chars)") },
                                    singleLine = true,
                                    visualTransformation = PasswordVisualTransformation(),
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DilarionRed),
                                )
                                Spacer(Modifier.height(8.dp))
                                Row {
                                    Button(
                                        onClick = { viewModel.enableTwoFa(enable2FAMasterToken, enable2FAPassword) },
                                        enabled = !uiState.twoFaLoading && enable2FAMasterToken.isNotBlank() && enable2FAPassword.length >= 6,
                                        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                                    ) {
                                        if (uiState.twoFaLoading) CircularProgressIndicator(Modifier.size(16.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                        else Text("Confirm")
                                    }
                                    Spacer(Modifier.width(8.dp))
                                    TextButton(onClick = {
                                        showEnable2FA = false
                                        enable2FAMasterToken = ""
                                        enable2FAPassword = ""
                                        viewModel.clearTwoFaError()
                                    }) { Text("Cancel") }
                                }
                            }

                            if (uiState.twoFaEnabled && !showDisable2FA) {
                                Spacer(Modifier.height(10.dp))
                                TextButton(onClick = { showDisable2FA = true }) { Text("Disable 2FA", color = TextSecondary) }
                            }

                            if (uiState.twoFaEnabled && showDisable2FA) {
                                Spacer(Modifier.height(10.dp))
                                OutlinedTextField(
                                    value = disable2FAPassword,
                                    onValueChange = { disable2FAPassword = it },
                                    label = { Text("Current 2FA password") },
                                    singleLine = true,
                                    visualTransformation = PasswordVisualTransformation(),
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                    modifier = Modifier.fillMaxWidth(),
                                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DilarionRed),
                                )
                                Spacer(Modifier.height(8.dp))
                                Row {
                                    Button(
                                        onClick = { viewModel.disableTwoFa(disable2FAPassword) },
                                        enabled = !uiState.twoFaLoading && disable2FAPassword.isNotBlank(),
                                        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                                    ) {
                                        if (uiState.twoFaLoading) CircularProgressIndicator(Modifier.size(16.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                        else Text("Confirm")
                                    }
                                    Spacer(Modifier.width(8.dp))
                                    TextButton(onClick = {
                                        showDisable2FA = false
                                        disable2FAPassword = ""
                                        viewModel.clearTwoFaError()
                                    }) { Text("Cancel") }
                                }
                            }

                            uiState.twoFaError?.let { err ->
                                Spacer(Modifier.height(6.dp))
                                Text(err, style = MaterialTheme.typography.bodySmall, color = DilarionRed)
                            }
                        }
                    }

                    Spacer(Modifier.height(24.dp))
                }
                SettingsPage.VOICE -> {
                    SettingsIntro("Record your own voice so decoy voice notes sound like you.")

                    SettingsCard {
                        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.GraphicEq, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
                                Spacer(Modifier.width(16.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        if (uiState.voiceIdentityEnrolled) "Enrolled — decoys use your voice" else "Not set — voice notes get a generic decoy",
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Medium,
                                    )
                                    Text(
                                        "Record your own voice for decoys, then type text to preview speech. Only this account can play it.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextSecondary,
                                    )
                                }
                            }

                            Spacer(Modifier.height(10.dp))
                            if (uiState.isRecordingVoiceIdentity) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("${uiState.voiceIdentityRecordingSeconds}s", color = TextSecondary, style = MaterialTheme.typography.bodySmall)
                                    Spacer(Modifier.width(12.dp))
                                    Button(
                                        onClick = { viewModel.stopAndUploadVoiceIdentity() },
                                        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                                    ) { Text("Stop & Save") }
                                }
                            } else {
                                Row {
                                    TextButton(onClick = { voiceIdentityAudioPermission.launch(Manifest.permission.RECORD_AUDIO) }) {
                                        Text(if (uiState.voiceIdentityEnrolled) "Re-record" else "Record sample (8s+)", color = DilarionRed)
                                    }
                                    if (uiState.voiceIdentityUploading) {
                                        Spacer(Modifier.width(8.dp))
                                        CircularProgressIndicator(Modifier.size(16.dp), color = DilarionRed, strokeWidth = 2.dp)
                                    }
                                }
                            }

                            uiState.voiceIdentityError?.let { err ->
                                Spacer(Modifier.height(6.dp))
                                Text(err, style = MaterialTheme.typography.bodySmall, color = DilarionRed)
                            }

                            if (uiState.voiceIdentityEnrolled) {
                                Spacer(Modifier.height(10.dp))
                                OutlinedTextField(
                                    value = speechText,
                                    onValueChange = { if (it.length <= 400) speechText = it },
                                    modifier = Modifier.fillMaxWidth(),
                                    minLines = 2,
                                    label = { Text("Text to speak") },
                                )
                                Spacer(Modifier.height(8.dp))
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Button(
                                        onClick = { viewModel.generateVoiceSpeech(speechText) },
                                        enabled = !uiState.voiceSpeechBusy && speechText.isNotBlank(),
                                        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                                    ) { Text(if (uiState.voiceSpeechBusy) "Generating…" else "Generate") }
                                    Spacer(Modifier.width(8.dp))
                                    TextButton(onClick = { viewModel.deleteVoiceEnrollment() }) {
                                        Text("Delete enrollment and clips", color = DilarionRed)
                                    }
                                }
                                uiState.voiceSpeechError?.let { err ->
                                    Spacer(Modifier.height(6.dp))
                                    Text(err, style = MaterialTheme.typography.bodySmall, color = DilarionRed)
                                }
                                uiState.voiceClips.forEach { clip ->
                                    Spacer(Modifier.height(8.dp))
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(clip.text, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, maxLines = 2)
                                        TextButton(onClick = { viewModel.playVoiceSpeech(context, clip.id) }) {
                                            Text(if (uiState.voiceSpeechPlayingId == clip.id) "Playing" else "Play")
                                        }
                                        TextButton(onClick = { viewModel.deleteVoiceSpeech(clip.id) }) { Text("Delete") }
                                    }
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(24.dp))
                }
                SettingsPage.USERNAME -> {
                    SettingsIntro("Changing your username signs you out on every device.")

                    var newUsername by remember { mutableStateOf("") }
                    LaunchedEffect(uiState.usernameChanged) {
                        if (uiState.usernameChanged) {
                            kotlinx.coroutines.delay(1500)
                            viewModel.logout { onLogout?.invoke() }
                        }
                    }
                    SettingsCard {
                        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                            if (uiState.usernameChanged) {
                                Text("Username updated — signing you out to apply everywhere…", color = OnlineGreen)
                            } else {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    OutlinedTextField(
                                        value = newUsername,
                                        onValueChange = { newUsername = it },
                                        placeholder = { Text(uiState.username) },
                                        singleLine = true,
                                        modifier = Modifier.weight(1f),
                                        shape = RoundedCornerShape(14.dp),
                                    )
                                    Spacer(Modifier.width(10.dp))
                                    Button(
                                        onClick = { viewModel.updateUsername(newUsername) },
                                        enabled = !uiState.usernameSaving && newUsername.isNotBlank() && newUsername != uiState.username,
                                        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                                    ) {
                                        if (uiState.usernameSaving) {
                                            CircularProgressIndicator(modifier = Modifier.size(16.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                        } else {
                                            Text("Save")
                                        }
                                    }
                                }
                                uiState.usernameError?.let {
                                    Text(it, color = DilarionRed, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                                }
                            }
                        }
                    }

                    Spacer(Modifier.height(24.dp))
                }
                SettingsPage.RECOVERY -> {
                    SettingsIntro("Your way back in if you forget your access token.")

                    SettingsCard {
                        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                            Text(
                                "Lets you reset your access token yourself if you forget it, without an admin. " +
                                    "Generating a new one invalidates any earlier code.",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondary,
                                modifier = Modifier.padding(bottom = 10.dp),
                            )
                            if (uiState.revealedRecoveryCode != null) {
                                var ack by remember { mutableStateOf(false) }
                                Text(
                                    uiState.revealedRecoveryCode!!,
                                    fontWeight = FontWeight.Bold,
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .background(BackgroundGrey, RoundedCornerShape(10.dp))
                                        .padding(vertical = 12.dp),
                                )
                                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                                    Checkbox(checked = ack, onCheckedChange = { ack = it })
                                    Text("I've saved this code somewhere safe", style = MaterialTheme.typography.bodySmall)
                                }
                                TextButton(
                                    onClick = { viewModel.clearRevealedRecoveryCode(); ack = false },
                                    enabled = ack,
                                ) { Text("Done") }
                            } else {
                                OutlinedButton(onClick = { viewModel.regenerateRecoveryCode() }, enabled = !uiState.recoveryCodeBusy) {
                                    if (uiState.recoveryCodeBusy) {
                                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                    } else {
                                        Text("Generate new recovery code")
                                    }
                                }
                            }
                            uiState.recoveryCodeError?.let {
                                Text(it, color = DilarionRed, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                            }
                        }
                    }

                    Spacer(Modifier.height(24.dp))
                }
                SettingsPage.DANGER -> {
                    SettingsIntro("Ask an admin to delete your account and its data.")

                    SettingsCard {
                        Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
                            when (uiState.deletionStatus) {
                                "pending" -> Text(
                                    "Your account deletion request is pending admin review.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextSecondary,
                                )
                                "approved" -> Text(
                                    "Your account deletion request was approved.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextSecondary,
                                )
                                "denied" -> Text(
                                    "Your previous request was denied. You can request again below.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextSecondary,
                                )
                                else -> {}
                            }

                            if (uiState.deletionStatus == null || uiState.deletionStatus == "denied") {
                                if (!showDeleteConfirm) {
                                    if (uiState.deletionStatus == "denied") Spacer(Modifier.height(10.dp))
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clickable { showDeleteConfirm = true },
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Icon(Icons.Default.Warning, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
                                        Spacer(Modifier.width(16.dp))
                                        Text(
                                            "Request Account Deletion",
                                            color = DilarionRed,
                                            style = MaterialTheme.typography.bodyLarge,
                                            fontWeight = FontWeight.Medium,
                                        )
                                    }
                                } else {
                                    Spacer(Modifier.height(10.dp))
                                    OutlinedTextField(
                                        value = deleteReason,
                                        onValueChange = { deleteReason = it },
                                        label = { Text("Reason (optional)") },
                                        modifier = Modifier.fillMaxWidth(),
                                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DilarionRed),
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    Row {
                                        Button(
                                            onClick = { viewModel.requestAccountDeletion(deleteReason) },
                                            enabled = !uiState.deletionLoading,
                                            colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                                        ) {
                                            if (uiState.deletionLoading) CircularProgressIndicator(Modifier.size(16.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                            else Text("Submit Request")
                                        }
                                        Spacer(Modifier.width(8.dp))
                                        TextButton(onClick = {
                                            showDeleteConfirm = false
                                            deleteReason = ""
                                            viewModel.clearDeletionError()
                                        }) { Text("Cancel") }
                                    }
                                }
                            }

                            uiState.deletionError?.let { err ->
                                Spacer(Modifier.height(6.dp))
                                Text(err, style = MaterialTheme.typography.bodySmall, color = DilarionRed)
                            }
                        }
                    }

                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

/** Page background: a hair lighter than BackgroundGrey so white cards read as cards. */
private val SettingsBg = androidx.compose.ui.graphics.Color(0xFFF6F7F9)

private fun availabilityLabel(status: String?) = when (status) {
    "busy" -> "Busy"
    "dnd" -> "Do Not Disturb"
    "away" -> "Away"
    "offline" -> "Appear Offline"
    else -> "Available"
}

private fun availabilityColor(status: String?) = when (status) {
    "busy", "dnd" -> DilarionRed
    "away" -> androidx.compose.ui.graphics.Color(0xFFF59E0B)
    "offline" -> TextMuted
    else -> OnlineGreen
}

/** One-line explanation at the top of a sub-page. */
@Composable
private fun SettingsIntro(text: String) {
    Text(
        text,
        fontSize = 14.sp,
        color = TextSecondary,
        modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 4.dp, bottom = 16.dp),
    )
}

/** Tappable row on the main Settings list: icon tile, title, value, chevron. */
@Composable
private fun HubRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    value: String?,
    iconTint: androidx.compose.ui.graphics.Color = DilarionRed,
    danger: Boolean = false,
    chevron: Boolean = true,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(if (danger) DilarionRedSoft else InputGrey),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = if (danger) DilarionRed else iconTint, modifier = Modifier.size(if (icon == Icons.Default.Circle) 12.dp else 20.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = if (danger) DilarionRed else TextPrimary)
            if (!value.isNullOrBlank()) {
                Text(value, fontSize = 13.sp, color = TextSecondary, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            }
        }
        if (chevron) Icon(Icons.Default.ChevronRight, null, tint = TextMuted, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun HubDivider() = HorizontalDivider(color = BorderGrey, thickness = 0.5.dp, modifier = Modifier.padding(start = 66.dp))

@Composable
private fun SettingsSectionHeader(title: String) {
    Text(
        title,
        fontWeight = FontWeight.Bold,
        color = TextPrimary,
        fontSize = 15.sp,
        modifier = Modifier.padding(start = 24.dp, bottom = 8.dp, top = 4.dp),
    )
}

@Composable
private fun HourStepper(hour: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = { onChange((hour + 23) % 24) }, contentPadding = PaddingValues(4.dp)) { Text("–", style = MaterialTheme.typography.titleMedium) }
        Text(String.format("%02d:00", hour), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        TextButton(onClick = { onChange((hour + 1) % 24) }, contentPadding = PaddingValues(4.dp)) { Text("+", style = MaterialTheme.typography.titleMedium) }
    }
}

@Composable
private fun SettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Column(content = content)
    }
}

@Composable
private fun SettingsRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    trailing: @Composable (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(DilarionRedSoft),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = DilarionRed, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(14.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = TextPrimary)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                fontFamily = if (subtitle.length > 20) FontFamily.Monospace else FontFamily.Default,
                maxLines = 2,
            )
        }
        trailing?.invoke()
    }
}
