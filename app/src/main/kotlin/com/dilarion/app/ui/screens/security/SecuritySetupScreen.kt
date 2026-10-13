package com.dilarion.app.ui.screens.security

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * First-run security setup: voice sample, master token, master-token 2FA.
 * Steps already completed server-side are auto-skipped; when nothing is left
 * it calls onComplete() straight away (returning users pass through).
 */
@Composable
fun SecuritySetupScreen(onComplete: () -> Unit, viewModel: SecuritySetupViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    LaunchedEffect(state.done) { if (state.done) onComplete() }

    if (state.loading || state.done) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    Column(
        Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("STEP ${state.stepNumber} OF ${state.total}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        when (state.current) {
            SetupStep.VOICE -> VoiceStep(state, viewModel)
            SetupStep.MASTER -> MasterStep(state, viewModel)
            SetupStep.TWOFA -> TwoFaStep(state, viewModel)
            null -> {}
        }
        state.error?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }
    }
}

@Composable
private fun VoiceStep(state: SecuritySetupUiState, vm: SecuritySetupViewModel) {
    val context = LocalContext.current
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.startRecording(context)
    }
    Text("Set up your voice", fontSize = 20.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(8.dp))
    Text(
        "Record a short voice sample (normal speech). It powers Dilarion's voice features and decoy protection.",
        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(20.dp))
    Text(
        when {
            state.recording -> "🔴 Recording… ${state.recordSeconds}s"
            state.uploading -> "Saving…"
            else -> "🎙️ Not recorded yet"
        },
        fontSize = 16.sp,
    )
    Spacer(Modifier.height(20.dp))
    if (state.recording) {
        Button(onClick = { vm.stopAndUpload() }, Modifier.fillMaxWidth()) { Text("Stop & save") }
    } else {
        Button(
            onClick = {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    vm.startRecording(context)
                } else {
                    permLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            },
            Modifier.fillMaxWidth(),
            enabled = !state.uploading,
        ) { Text("Start recording") }
    }
    Spacer(Modifier.height(6.dp))
    Text("Speak a sentence or two — at least 8 seconds (auto-stops at 12s).", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(Modifier.height(4.dp))
    TextButton(onClick = { vm.cancelRecording(); vm.skip() }) { Text("Skip for now") }
}

@Composable
private fun MasterStep(state: SecuritySetupUiState, vm: SecuritySetupViewModel) {
    var value by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    Text("Set your master token", fontSize = 20.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(8.dp))
    Text(
        "A separate secret used to answer calls and unlock locked chats. Keep it private.",
        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(16.dp))
    OutlinedTextField(value, { value = it }, label = { Text("Master token") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(10.dp))
    OutlinedTextField(confirm, { confirm = it }, label = { Text("Confirm master token") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(16.dp))
    Button(onClick = { vm.setMasterToken(value, confirm) }, Modifier.fillMaxWidth(), enabled = !state.busy) {
        Text(if (state.busy) "Saving…" else "Save & continue")
    }
    TextButton(onClick = { vm.skip() }) { Text("Skip for now") }
}

@Composable
private fun TwoFaStep(state: SecuritySetupUiState, vm: SecuritySetupViewModel) {
    val preset = vm.presetMaster()
    var master by remember { mutableStateOf(preset ?: "") }
    var pw by remember { mutableStateOf("") }
    var pw2 by remember { mutableStateOf("") }
    Text("Protect your master token (2FA)", fontSize = 20.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(8.dp))
    Text(
        "Add a second password required to change your master token, so a stolen session alone can't reset it. Optional but recommended.",
        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(16.dp))
    if (preset == null) {
        OutlinedTextField(master, { master = it }, label = { Text("Your master token") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
    }
    OutlinedTextField(pw, { pw = it }, label = { Text("2FA password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(10.dp))
    OutlinedTextField(pw2, { pw2 = it }, label = { Text("Confirm 2FA password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(16.dp))
    Button(onClick = { vm.enable2fa(master, pw, pw2) }, Modifier.fillMaxWidth(), enabled = !state.busy) {
        Text(if (state.busy) "Enabling…" else "Enable 2FA & finish")
    }
    TextButton(onClick = { vm.skip() }) { Text("Skip for now") }
}
