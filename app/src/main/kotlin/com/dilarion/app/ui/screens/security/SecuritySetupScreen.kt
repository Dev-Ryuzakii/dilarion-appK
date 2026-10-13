package com.dilarion.app.ui.screens.security

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.R
import com.dilarion.app.ui.theme.*

/**
 * First-run security setup: voice sample, master token, master-token 2FA.
 * Styled to match AuthScreen/OnboardingScreen (gradient background, logo,
 * card). Steps already completed server-side are auto-skipped; when nothing is
 * left it calls onComplete() immediately.
 */
@Composable
fun SecuritySetupScreen(onComplete: () -> Unit, viewModel: SecuritySetupViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(state.done) { if (state.done) onComplete() }

    val bg = Modifier
        .fillMaxSize()
        .background(
            Brush.verticalGradient(
                listOf(
                    DilarionRed.copy(alpha = 0.06f),
                    BackgroundGrey,
                    MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                )
            )
        )

    if (state.loading || state.done) {
        Box(bg, contentAlignment = Alignment.Center) { CircularProgressIndicator(color = DilarionRed) }
        return
    }

    Box(bg.imePadding(), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painter = painterResource(R.drawable.dilarion_logo),
                contentDescription = "Dilarion",
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(84.dp).clip(CircleShape),
            )
            Spacer(Modifier.height(20.dp))
            Text("Secure your account", style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
            Text(
                "Step ${state.stepNumber} of ${state.total}",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                modifier = Modifier.padding(top = 6.dp),
            )
            Spacer(Modifier.height(28.dp))

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    when (state.current) {
                        SetupStep.VOICE -> VoiceStep(state, viewModel)
                        SetupStep.MASTER -> MasterStep(state, viewModel)
                        SetupStep.TWOFA -> TwoFaStep(state, viewModel)
                        null -> {}
                    }
                    state.error?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun RedButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
    ) { Text(text, color = SurfaceWhite, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun StepHeader(title: String, desc: String) {
    Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    Text(desc, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
}

@Composable
private fun VoiceStep(state: SecuritySetupUiState, vm: SecuritySetupViewModel) {
    val context = LocalContext.current
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.startRecording(context)
    }
    StepHeader("Set up your voice", "Record a short voice sample (normal speech). It powers Dilarion's voice features and decoy protection.")
    Spacer(Modifier.height(4.dp))
    Box(
        Modifier.fillMaxWidth().height(96.dp).clip(RoundedCornerShape(14.dp))
            .background(BackgroundGrey),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            when {
                state.recording -> "🔴  Recording…  ${state.recordSeconds}s"
                state.uploading -> "Saving…"
                else -> "🎙  Not recorded yet"
            },
            style = MaterialTheme.typography.bodyLarge,
        )
    }
    if (state.recording) {
        RedButton("Stop & save", true) { vm.stopAndUpload() }
    } else {
        RedButton("Start recording", !state.uploading) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                vm.startRecording(context)
            } else {
                permLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }
    Text(
        "Speak a sentence or two — at least 8 seconds (auto-stops at 12s).",
        style = MaterialTheme.typography.bodySmall, color = TextSecondary,
    )
    TextButton(onClick = { vm.cancelRecording(); vm.skip() }, modifier = Modifier.fillMaxWidth()) {
        Text("Skip for now", color = DilarionRed)
    }
}

@Composable
private fun MasterStep(state: SecuritySetupUiState, vm: SecuritySetupViewModel) {
    var value by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    StepHeader("Set your master token", "A separate secret used to answer calls and unlock locked chats. Keep it private.")
    OutlinedTextField(value, { value = it }, label = { Text("Master token") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    OutlinedTextField(confirm, { confirm = it }, label = { Text("Confirm master token") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    RedButton(if (state.busy) "Saving…" else "Save & continue", !state.busy) { vm.setMasterToken(value, confirm) }
    TextButton(onClick = { vm.skip() }, modifier = Modifier.fillMaxWidth()) { Text("Skip for now", color = DilarionRed) }
}

@Composable
private fun TwoFaStep(state: SecuritySetupUiState, vm: SecuritySetupViewModel) {
    val preset = vm.presetMaster()
    var master by remember { mutableStateOf(preset ?: "") }
    var pw by remember { mutableStateOf("") }
    var pw2 by remember { mutableStateOf("") }
    StepHeader("Protect your master token (2FA)", "Add a second password required to change your master token, so a stolen session alone can't reset it. Optional but recommended.")
    if (preset == null) {
        OutlinedTextField(master, { master = it }, label = { Text("Your master token") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    }
    OutlinedTextField(pw, { pw = it }, label = { Text("2FA password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
    OutlinedTextField(pw2, { pw2 = it }, label = { Text("Confirm 2FA password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    RedButton(if (state.busy) "Enabling…" else "Enable 2FA & finish", !state.busy) { vm.enable2fa(master, pw, pw2) }
    TextButton(onClick = { vm.skip() }, modifier = Modifier.fillMaxWidth()) { Text("Skip for now", color = DilarionRed) }
}
