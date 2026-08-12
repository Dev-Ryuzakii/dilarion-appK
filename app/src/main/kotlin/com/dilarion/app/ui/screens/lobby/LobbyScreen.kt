package com.dilarion.app.ui.screens.lobby

import android.Manifest
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Pre-join device setup — matches Meet/Teams: a live front-camera preview
 * (CameraX, separate from LiveKit's own capture pipeline which only starts
 * once the call is actually joined), mic/camera toggles, and an editable
 * display name.
 *
 * "instant" mode: the conference already exists (creator+invitees are already
 * set up by NewMeetingViewModel before this screen shows) - Join just carries
 * the device choice into GalleryScreen. "join" mode: join_by_code hasn't
 * happened yet - Join makes that call here and branches to GalleryScreen
 * (admitted) or the waiting screen (host has a waiting room on).
 */
@Composable
fun LobbyScreen(
    mode: String,
    joinCode: String?,
    conferenceId: Int?,
    title: String,
    onGalleryReady: (conferenceId: Int, micOn: Boolean, camOn: Boolean, displayName: String) -> Unit,
    onWaiting: (conferenceId: Int, micOn: Boolean, camOn: Boolean, displayName: String) -> Unit,
    onBack: () -> Unit,
    viewModel: LobbyViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    var hasCameraPermission by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasCameraPermission = granted
    }
    LaunchedEffect(Unit) {
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    fun confirm() {
        if (mode == "join" && joinCode != null) {
            viewModel.joinByCode(joinCode) { confId, status, error ->
                if (error == null && confId != null) {
                    if (status == "waiting") onWaiting(confId, state.micOn, state.camOn, state.displayName)
                    else onGalleryReady(confId, state.micOn, state.camOn, state.displayName)
                }
            }
        } else if (conferenceId != null) {
            onGalleryReady(conferenceId, state.micOn, state.camOn, state.displayName)
        }
    }

    Box(
        modifier = Modifier.fillMaxSize().background(Color(0xFF0B0B10)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)

            Box(
                modifier = Modifier
                    .size(width = 260.dp, height = 220.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color(0xFF1A1A22)),
                contentAlignment = Alignment.Center,
            ) {
                if (state.camOn && hasCameraPermission) {
                    CameraPreview()
                } else if (state.camOn) {
                    Text("Camera permission needed", color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp, modifier = Modifier.padding(16.dp))
                } else {
                    Box(
                        modifier = Modifier.size(72.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Default.VideocamOff, null, tint = Color.White)
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                LobbyToggle(active = state.micOn, onIcon = Icons.Default.Mic, offIcon = Icons.Default.MicOff, onClick = viewModel::toggleMic)
                LobbyToggle(active = state.camOn, onIcon = Icons.Default.Videocam, offIcon = Icons.Default.VideocamOff, onClick = viewModel::toggleCam)
            }

            OutlinedTextField(
                value = state.displayName,
                onValueChange = viewModel::setDisplayName,
                label = { Text("Your name in this call") },
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White, unfocusedTextColor = Color.White,
                    focusedBorderColor = MaterialTheme.colorScheme.primary, unfocusedBorderColor = Color.White.copy(alpha = 0.3f),
                    focusedLabelColor = Color.White.copy(alpha = 0.7f), unfocusedLabelColor = Color.White.copy(alpha = 0.5f),
                ),
                modifier = Modifier.width(260.dp),
            )

            state.error?.let {
                Text(it, color = Color(0xFFEF4444), fontSize = 12.sp)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = onBack) { Text("Cancel", color = Color.White) }
                Button(onClick = ::confirm, enabled = !state.joining) {
                    Text(if (state.joining) "Joining…" else "Join now")
                }
            }
        }
    }
}

@Composable
private fun CameraPreview() {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                runCatching {
                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_FRONT_CAMERA, preview)
                }
            }, ContextCompat.getMainExecutor(ctx))
            previewView
        },
    )

    DisposableEffect(Unit) {
        onDispose {
            runCatching { ProcessCameraProvider.getInstance(context).get().unbindAll() }
        }
    }
}

@Composable
private fun LobbyToggle(
    active: Boolean,
    onIcon: androidx.compose.ui.graphics.vector.ImageVector,
    offIcon: androidx.compose.ui.graphics.vector.ImageVector,
    onClick: () -> Unit,
) {
    FilledIconButton(
        onClick = onClick,
        colors = IconButtonDefaults.filledIconButtonColors(
            containerColor = if (active) Color.White.copy(alpha = 0.15f) else Color.White.copy(alpha = 0.05f),
        ),
    ) {
        Icon(if (active) onIcon else offIcon, null, tint = Color.White)
    }
}
