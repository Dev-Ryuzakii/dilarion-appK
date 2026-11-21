package com.dilarion.app.ui.screens.lobby

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.ToneGenerator
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.dilarion.app.ui.theme.DilarionRed
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlin.math.sqrt

// In-call palette, same as GalleryScreen.
private val Stage = Color(0xFF0D0A0A)
private val Card = Color(0xFF211919)
private val Line = Color.White.copy(alpha = 0.10f)
private val TextMain = Color(0xFFF6F1F0)
private val TextMuted = Color(0xFFA39A98)
private val Good = Color(0xFF22C55E)
private val Warn = Color(0xFFF59E0B)
private val SoftRed = Color(0xFFFF9B91)

private enum class Perm { GRANTED, NOT_ASKED, DENIED, BLOCKED }

/**
 * Setup room shown before every meeting — matches desktop's MeetingLobby:
 * check camera and microphone access (asking again, or sending the user to
 * Settings when Android won't ask any more), watch a live mic level, play a
 * test sound through the speaker, preview the front camera (CameraX, separate
 * from LiveKit's capture which only starts once the call is joined) and set
 * the display name.
 *
 * "instant" mode: the conference already exists (a new meeting, or an invite
 * to one in progress) — Join just carries the device choice into
 * GalleryScreen. "join" mode: join_by_code hasn't happened yet — Join makes
 * that call here and branches to GalleryScreen (admitted) or the waiting
 * screen (host has a waiting room on).
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
    val activity = context as? Activity
    val lifecycleOwner = LocalLifecycleOwner.current

    // Android stops showing the prompt after the user says no (twice, or with
    // "don't ask again"). Once we've asked, a denial with no rationale means
    // only Settings can turn it back on.
    var asked by remember { mutableStateOf(setOf<String>()) }
    fun permOf(p: String): Perm = when {
        ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED -> Perm.GRANTED
        p !in asked -> Perm.NOT_ASKED
        activity != null && !ActivityCompat.shouldShowRequestPermissionRationale(activity, p) -> Perm.BLOCKED
        else -> Perm.DENIED
    }
    var camPerm by remember { mutableStateOf(permOf(Manifest.permission.CAMERA)) }
    var micPerm by remember { mutableStateOf(permOf(Manifest.permission.RECORD_AUDIO)) }
    fun recheck() {
        camPerm = permOf(Manifest.permission.CAMERA)
        micPerm = permOf(Manifest.permission.RECORD_AUDIO)
    }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        asked = asked + result.keys
        recheck()
    }
    fun request(vararg perms: String) {
        launcher.launch(perms.toList().toTypedArray())
    }
    fun openSettings() {
        runCatching {
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }

    // Ask for whatever is missing as soon as the room opens.
    LaunchedEffect(Unit) {
        val missing = listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
            .filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) request(*missing.toTypedArray())
    }
    // Coming back from Settings: pick up whatever the user changed there.
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) recheck() }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val camGranted = camPerm == Perm.GRANTED
    val micGranted = micPerm == Perm.GRANTED

    // ── Mic level ──────────────────────────────────────────────────────
    var level by remember { mutableFloatStateOf(0f) }
    var heardMic by remember { mutableStateOf(false) }
    LaunchedEffect(micGranted, state.micOn) {
        level = 0f
        if (!micGranted || !state.micOn) return@LaunchedEffect
        withContext(Dispatchers.IO) { meterMic { v -> level = v; if (v > 0.15f) heardMic = true } }
    }

    // ── Speaker test ───────────────────────────────────────────────────
    var playing by remember { mutableStateOf(false) }
    LaunchedEffect(playing) {
        if (!playing) return@LaunchedEffect
        playTestTone()
        playing = false
    }

    fun confirm() {
        // No access means joining with that device off; they can still listen.
        val mic = state.micOn && micGranted
        val cam = state.camOn && camGranted
        if (mode == "join" && joinCode != null) {
            viewModel.joinByCode(joinCode) { confId, status, error ->
                if (error == null && confId != null) {
                    if (status == "waiting") onWaiting(confId, mic, cam, state.displayName)
                    else onGalleryReady(confId, mic, cam, state.displayName)
                }
            }
        } else if (conferenceId != null) {
            onGalleryReady(conferenceId, mic, cam, state.displayName)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF2A1210), Stage, Stage)))
            .systemBarsPadding(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column {
                Text("SETUP ROOM", color = SoftRed, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Spacer(Modifier.height(4.dp))
                Text(title, color = TextMain, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                Text("Check your camera, microphone and speaker before joining", color = TextMuted, fontSize = 13.sp)
            }

            // Preview with the two toggles over it.
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(3f / 4f)
                    .clip(RoundedCornerShape(22.dp))
                    .background(Brush.linearGradient(listOf(Color(0xFF241B1B), Color(0xFF141010))))
                    .border(1.dp, Line, RoundedCornerShape(22.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (state.camOn && camGranted) {
                    CameraPreview()
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            Modifier.size(84.dp).clip(CircleShape)
                                .background(Brush.linearGradient(listOf(DilarionRed, Color(0xFF6E1A12)))),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                state.displayName.trim().take(1).uppercase().ifEmpty { "?" },
                                color = Color.White, fontWeight = FontWeight.Bold, fontSize = 30.sp,
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(
                            when {
                                !state.camOn -> "Camera is off"
                                camPerm == Perm.BLOCKED -> "Camera access is blocked"
                                else -> "Camera access needed"
                            },
                            color = TextMuted, fontSize = 13.sp,
                        )
                    }
                }
                Row(
                    Modifier.align(Alignment.BottomCenter).padding(bottom = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    RoundToggle(state.micOn, Icons.Default.Mic, Icons.Default.MicOff, if (state.micOn) "Mute" else "Unmute", viewModel::toggleMic)
                    RoundToggle(state.camOn, Icons.Default.Videocam, Icons.Default.VideocamOff, if (state.camOn) "Turn camera off" else "Turn camera on", viewModel::toggleCam)
                }
            }

            // Mic level: proves the mic picks you up before anyone else hears it.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Mic, null, tint = TextMuted, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Box(Modifier.weight(1f).height(8.dp).clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f))) {
                    Box(
                        Modifier.fillMaxHeight().fillMaxWidth(if (state.micOn) level.coerceIn(0f, 1f) else 0f)
                            .clip(RoundedCornerShape(50)).background(Good),
                    )
                }
                Spacer(Modifier.width(10.dp))
                Text(
                    when {
                        !micGranted -> "Mic not ready"
                        !state.micOn -> "Muted"
                        heardMic -> "We hear you"
                        else -> "Say something"
                    },
                    color = TextMuted, fontSize = 12.sp,
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PermRow("Camera", camPerm, onAllow = { request(Manifest.permission.CAMERA) }, onSettings = ::openSettings)
                PermRow("Microphone", micPerm, onAllow = { request(Manifest.permission.RECORD_AUDIO) }, onSettings = ::openSettings)
                if (camPerm == Perm.BLOCKED || micPerm == Perm.BLOCKED) {
                    Text(
                        "Android won't ask again. Tap Open settings, then Permissions, allow Camera and Microphone, and come back.",
                        color = SoftRed, fontSize = 12.sp, lineHeight = 17.sp,
                    )
                }
            }

            // Speaker test.
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Card)
                    .border(1.dp, Line, RoundedCornerShape(14.dp))
                    .clickable(enabled = !playing) { playing = true }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.VolumeUp, null, tint = TextMain, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("Speaker", color = TextMain, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                    Text("Play a short sound to check you can hear", color = TextMuted, fontSize = 12.sp)
                }
                Text(if (playing) "Playing…" else "Test", color = SoftRed, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("YOUR NAME IN THIS CALL", color = TextMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color(0xFF0F0B0B))
                        .border(1.dp, Color.White.copy(alpha = 0.14f), RoundedCornerShape(14.dp))
                        .padding(horizontal = 14.dp, vertical = 13.dp),
                ) {
                    if (state.displayName.isEmpty()) Text("Add your name", color = TextMuted, fontSize = 14.sp)
                    BasicTextField(
                        value = state.displayName,
                        onValueChange = { viewModel.setDisplayName(it.take(50)) },
                        singleLine = true,
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(DilarionRed),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            if (!camGranted || !micGranted) {
                Text(
                    "You can still join; anything without access stays off until you allow it.",
                    color = TextMuted, fontSize = 12.sp,
                )
            }
            state.error?.let { Text(it, color = Color(0xFFEF4444), fontSize = 12.sp) }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier.height(50.dp).clip(RoundedCornerShape(14.dp)).background(Color.White.copy(alpha = 0.08f))
                        .clickable(onClick = onBack).padding(horizontal = 22.dp),
                    contentAlignment = Alignment.Center,
                ) { Text("Cancel", color = TextMain, fontWeight = FontWeight.Bold) }
                Box(
                    Modifier.weight(1f).height(50.dp).clip(RoundedCornerShape(14.dp))
                        .background(if (state.joining) DilarionRed.copy(alpha = 0.5f) else DilarionRed)
                        .clickable(enabled = !state.joining, onClick = ::confirm),
                    contentAlignment = Alignment.Center,
                ) { Text(if (state.joining) "Joining…" else "Join now", color = Color.White, fontWeight = FontWeight.Bold) }
            }
        }
    }
}

@Composable
private fun PermRow(label: String, perm: Perm, onAllow: () -> Unit, onSettings: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Card)
            .border(1.dp, Line, RoundedCornerShape(12.dp))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(8.dp).clip(CircleShape).background(
                when (perm) {
                    Perm.GRANTED -> Good
                    Perm.NOT_ASKED -> Warn
                    else -> DilarionRed
                },
            ),
        )
        Spacer(Modifier.width(10.dp))
        Text(label, color = TextMain, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Text(
            when (perm) {
                Perm.GRANTED -> "Allowed"
                Perm.NOT_ASKED -> "Not allowed yet"
                Perm.DENIED -> "Not allowed"
                Perm.BLOCKED -> "Blocked"
            },
            color = TextMuted, fontSize = 12.sp,
        )
        if (perm != Perm.GRANTED) {
            Spacer(Modifier.width(10.dp))
            Text(
                if (perm == Perm.BLOCKED) "Open settings" else "Allow",
                color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(DilarionRed)
                    .clickable(onClick = if (perm == Perm.BLOCKED) onSettings else onAllow)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
            )
        }
    }
}

@Composable
private fun RoundToggle(active: Boolean, onIcon: ImageVector, offIcon: ImageVector, description: String, onClick: () -> Unit) {
    Box(
        Modifier.size(52.dp).clip(CircleShape)
            .background(if (active) Color(0xFF0A0808).copy(alpha = 0.6f) else Color(0xFFE5392B).copy(alpha = 0.9f))
            .border(1.dp, if (active) Color.White.copy(alpha = 0.2f) else Color.Transparent, CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(if (active) onIcon else offIcon, description, tint = Color.White, modifier = Modifier.size(24.dp)) }
}

/** Reads the mic and reports a 0..1 level until the coroutine is cancelled. */
@SuppressLint("MissingPermission") // Only started once RECORD_AUDIO is granted.
private suspend fun meterMic(onLevel: (Float) -> Unit) {
    val rate = 16_000
    val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minBuf <= 0) return
    val recorder = runCatching {
        AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, minBuf * 2)
    }.getOrNull() ?: return
    if (recorder.state != AudioRecord.STATE_INITIALIZED) { recorder.release(); return }
    val buf = ShortArray(minBuf)
    try {
        recorder.startRecording()
        while (kotlin.coroutines.coroutineContext.isActive) {
            val n = recorder.read(buf, 0, buf.size)
            if (n > 0) {
                var sum = 0.0
                for (i in 0 until n) { val x = buf[i] / 32768.0; sum += x * x }
                val rms = sqrt(sum / n)
                withContext(Dispatchers.Main) { onLevel((rms * 4).toFloat().coerceIn(0f, 1f)) }
            }
        }
    } finally {
        runCatching { recorder.stop() }
        recorder.release()
    }
}

/** A short three-beep chime on the media stream. */
private suspend fun playTestTone() {
    val tone = runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, 80) }.getOrNull() ?: return
    try {
        repeat(3) {
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, 180)
            delay(300)
        }
    } finally {
        tone.release()
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
