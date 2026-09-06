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
import androidx.compose.material.icons.filled.ArrowBack
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
import com.dilarion.app.security.BiometricAuth
import com.dilarion.app.security.BiometricLockPrefs
import com.dilarion.app.ui.theme.*
import kotlinx.coroutines.launch

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

    fun gateThen(action: () -> Unit) {
        val act = activity
        if (act == null) { action(); return }
        scope.launch { if (BiometricAuth.gateSensitiveAction(act)) action() }
    }

    var showLogoutDialog by remember { mutableStateOf(false) }
    var showEnable2FA by remember { mutableStateOf(false) }
    var enable2FAMasterToken by remember { mutableStateOf("") }
    var enable2FAPassword by remember { mutableStateOf("") }
    var showDisable2FA by remember { mutableStateOf(false) }
    var disable2FAPassword by remember { mutableStateOf("") }
    var showDeleteConfirm by remember { mutableStateOf(false) }
    var deleteReason by remember { mutableStateOf("") }

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
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite)
                    }
                },
                title = { Text("Settings", color = SurfaceWhite) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        containerColor = BackgroundGrey,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {

            // ── Profile header ────────────────────────────────────────────────
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(SurfaceWhite)
                    .padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .clip(CircleShape)
                            .background(DilarionRed),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            uiState.username.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                            color = SurfaceWhite,
                            fontSize = 32.sp,
                            fontWeight = FontWeight.ExtraBold,
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        uiState.username,
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── Master token section ──────────────────────────────────────────
            SettingsSectionHeader("Master Token")

            SettingsCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { gateThen(onMasterToken) }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Shield, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(16.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            if (uiState.hasMasterToken) "Change Master Token" else "Set Master Token",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            if (uiState.hasMasterToken) "Update token used to reveal messages" else "Required to decrypt and read messages",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                        )
                    }
                    Icon(Icons.Default.ChevronRight, null, tint = TextSecondary, modifier = Modifier.size(20.dp))
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── Master token 2FA section ──────────────────────────────────────
            SettingsSectionHeader("Master Token 2FA")

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
                        TextButton(onClick = { gateThen { showEnable2FA = true } }) { Text("Enable 2FA", color = DilarionRed) }
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
                        TextButton(onClick = { gateThen { showDisable2FA = true } }) { Text("Disable 2FA", color = TextSecondary) }
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

            Spacer(Modifier.height(12.dp))

            // ── Biometric Lock section ────────────────────────────────────────
            SettingsSectionHeader("Biometric Lock")

            SettingsCard {
                var biometricEnabled by remember { mutableStateOf(BiometricLockPrefs.isEnabled(context)) }
                var biometricUnavailable by remember { mutableStateOf(false) }
                LaunchedEffect(Unit) {
                    biometricUnavailable = activity?.let { !BiometricAuth.isAvailable(it) } ?: true
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Fingerprint, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(16.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "Biometric Lock",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            if (biometricUnavailable) "Not available — set up a fingerprint/face or screen lock first"
                            else "Fingerprint/face to open Dilarion and before security changes",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                        )
                    }
                    Switch(
                        checked = biometricEnabled,
                        enabled = !biometricUnavailable,
                        onCheckedChange = {
                            biometricEnabled = it
                            BiometricLockPrefs.setEnabled(context, it)
                        },
                        colors = SwitchDefaults.colors(checkedThumbColor = DilarionRed, checkedTrackColor = DilarionRedLight),
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── AI Voice Decoy section ────────────────────────────────────────
            SettingsSectionHeader("AI Voice Decoy")

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
                                "Record a short sample once; used only to generate decoy voice notes",
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
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── Linked devices section ────────────────────────────────────────
            SettingsSectionHeader("Devices")

            SettingsCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onLinkedDevices() }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Devices, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(16.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "Linked devices",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            "Scan a QR to link your desktop; unlink devices",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                        )
                    }
                    Icon(Icons.Default.ChevronRight, null, tint = TextSecondary, modifier = Modifier.size(20.dp))
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── Account section ───────────────────────────────────────────────
            SettingsSectionHeader("Account")

            SettingsCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showLogoutDialog = true }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.ExitToApp,
                        null,
                        tint = DilarionRed,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(Modifier.width(16.dp))
                    Text(
                        "Log out",
                        color = DilarionRed,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── Danger zone: account deletion request ───────────────────────────
            SettingsSectionHeader("Danger Zone")

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

            // App version
            Text(
                "Dilarion v1.0.0 · Secure · Private · Encrypted",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary.copy(alpha = 0.6f),
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(bottom = 16.dp),
            )
        }
    }
}

@Composable
private fun SettingsSectionHeader(title: String) {
    Text(
        title.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = TextSecondary,
        fontSize = 11.sp,
        modifier = Modifier.padding(start = 16.dp, bottom = 6.dp, top = 4.dp),
    )
}

@Composable
private fun SettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 0.dp),
        shape = RoundedCornerShape(0.dp),
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
        Icon(icon, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
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
