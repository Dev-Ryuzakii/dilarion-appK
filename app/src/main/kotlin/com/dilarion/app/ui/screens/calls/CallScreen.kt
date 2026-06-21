package com.dilarion.app.ui.screens.calls

import androidx.compose.animation.core.*
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.runtime.collectAsState
import com.dilarion.app.data.model.IncomingCallData
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite
import org.webrtc.EglBase
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

private val CallBackground = Color(0xFF1A1A2E)
private val EndCallRed = Color(0xFFE53935)
private val AcceptGreen = Color(0xFF43A047)
private val ControlButton = Color(0xFF2C2C54)

// ── Outgoing call screen (navigated from chat) ──────────────────────────────

@Composable
fun CallScreen(
    username: String,
    onCallEnded: () -> Unit,
    onMinimize: ((callId: Int?) -> Unit)? = null,
    viewModel: CallViewModel = hiltViewModel(),
) {
    var showTypeDialog by remember { mutableStateOf(true) }
    val uiState by viewModel.uiState.collectAsState()
    val localVideo by viewModel.localVideo.collectAsState()
    val remoteVideo by viewModel.remoteVideo.collectAsState()

    LaunchedEffect(uiState.state) {
        if (uiState.state == CallState.ENDED) {
            kotlinx.coroutines.delay(1200)
            onCallEnded()
        }
    }

    uiState.error?.let { err ->
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Call error") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = { viewModel.clearError(); onCallEnded() }) { Text("OK") } },
        )
    }

    if (showTypeDialog && uiState.state == CallState.IDLE) {
        CallTypeDialog(
            username = username,
            onVoice = { showTypeDialog = false; viewModel.startOutgoingCall(username, CallType.VOICE) },
            onVideo = { showTypeDialog = false; viewModel.startOutgoingCall(username, CallType.VIDEO) },
            onDismiss = onCallEnded,
        )
    } else {
        CallContent(
            uiState = uiState,
            viewModel = viewModel,
            localVideo = localVideo,
            remoteVideo = remoteVideo,
            eglBaseContext = viewModel.eglBaseContext,
            onMinimize = onMinimize,
        )
    }
}

// ── Incoming call overlay (shown globally over any screen) ──────────────────

@Composable
fun IncomingCallOverlay(
    incoming: IncomingCallData,
    onDismiss: () -> Unit,
) {
    val viewModel: CallViewModel = hiltViewModel()
    val uiState by viewModel.uiState.collectAsState()
    val localVideo by viewModel.localVideo.collectAsState()
    val remoteVideo by viewModel.remoteVideo.collectAsState()
    var showMasterTokenDialog by remember { mutableStateOf(false) }

    LaunchedEffect(incoming) { viewModel.setIncoming(incoming) }

    LaunchedEffect(uiState.state) {
        if (uiState.state == CallState.ENDED) {
            kotlinx.coroutines.delay(800)
            onDismiss()
        }
    }

    if (showMasterTokenDialog) {
        MasterTokenAcceptDialog(
            onDismiss = { showMasterTokenDialog = false },
            onConfirm = { token -> showMasterTokenDialog = false; viewModel.acceptCall(token) },
        )
    }

    if (uiState.state == CallState.CONNECTED &&
        uiState.callType == CallType.VIDEO &&
        remoteVideo != null
    ) {
        VideoCallContent(
            uiState = uiState,
            viewModel = viewModel,
            localVideo = localVideo,
            remoteVideo = remoteVideo,
            eglBaseContext = viewModel.eglBaseContext,
        )
    } else {
        Box(
            modifier = Modifier.fillMaxSize().background(CallBackground),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxSize()) {
                Spacer(Modifier.weight(1f))
                val typeIcon = if (incoming.callType == "video") Icons.Default.Videocam else Icons.Default.Call
                Icon(typeIcon, null, tint = SurfaceWhite.copy(alpha = 0.6f), modifier = Modifier.size(28.dp))
                Spacer(Modifier.height(8.dp))
                Text(
                    "Incoming ${if (incoming.callType == "video") "Video" else "Voice"} Call",
                    color = SurfaceWhite.copy(alpha = 0.7f), fontSize = 14.sp,
                )
                Spacer(Modifier.height(24.dp))
                PulsingAvatar(incoming.callerUsername.firstOrNull()?.uppercaseChar()?.toString() ?: "?", true)
                Spacer(Modifier.height(24.dp))
                Text(incoming.callerUsername, color = SurfaceWhite, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                if (uiState.state == CallState.CONNECTED) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(formatDuration(uiState.durationSeconds), color = SurfaceWhite.copy(alpha = 0.7f), fontSize = 16.sp)
                        SignalBars(uiState.networkQuality)
                    }
                }
                Spacer(Modifier.weight(1f))
                when (uiState.state) {
                    CallState.INCOMING -> {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 48.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly,
                        ) {
                            CallActionButton(Icons.Default.CallEnd, "Decline", EndCallRed) { viewModel.declineCall() }
                            CallActionButton(Icons.Default.Call, "Accept", AcceptGreen) { showMasterTokenDialog = true }
                        }
                    }
                    CallState.CONNECTED -> {
                        CallControls(uiState, viewModel, showFlip = false)
                    }
                    else -> {
                        CallActionButton(Icons.Default.CallEnd, "Cancel", EndCallRed) { viewModel.endCall() }
                    }
                }
                Spacer(Modifier.height(64.dp))
            }
        }
    }
}

// ── Outgoing call content ───────────────────────────────────────────────────

@Composable
private fun CallContent(
    uiState: CallUiState,
    viewModel: CallViewModel,
    localVideo: VideoTrack?,
    remoteVideo: VideoTrack?,
    eglBaseContext: EglBase.Context,
    onMinimize: ((callId: Int?) -> Unit)? = null,
) {
    when {
        uiState.callType == CallType.VIDEO && uiState.state == CallState.CONNECTED && remoteVideo != null -> {
            VideoCallContent(uiState, viewModel, localVideo, remoteVideo, eglBaseContext, onMinimize)
        }
        uiState.callType == CallType.VIDEO && localVideo != null -> {
            // Calling/Ringing for video — show self-view full screen
            Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
                VideoView(videoTrack = localVideo, eglBaseContext = eglBaseContext, modifier = Modifier.fillMaxSize(), mirror = true)
                // Dark gradient overlay top
                Box(Modifier.fillMaxWidth().height(160.dp).align(Alignment.TopCenter).background(
                    Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.6f), Color.Transparent))
                ))
                Column(
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 56.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(uiState.peerUsername, color = SurfaceWhite, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        when (uiState.state) { CallState.CALLING -> "Calling..."; CallState.RINGING -> "Ringing..."; CallState.ENDED -> "Call ended"; else -> "" },
                        color = SurfaceWhite.copy(alpha = 0.8f), fontSize = 14.sp,
                    )
                }
                Box(modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 60.dp)) {
                    CallActionButton(Icons.Default.CallEnd, "End", EndCallRed) { viewModel.endCall() }
                }
            }
        }
        else -> {
            // Voice call or no camera yet
            Box(modifier = Modifier.fillMaxSize().background(CallBackground)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxSize()) {
                    Spacer(Modifier.weight(1f))
                    val typeIcon = if (uiState.callType == CallType.VIDEO) Icons.Default.Videocam else Icons.Default.Call
                    Icon(typeIcon, null, tint = SurfaceWhite.copy(alpha = 0.6f), modifier = Modifier.size(28.dp))
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "${if (uiState.callType == CallType.VIDEO) "Video" else "Voice"} Call",
                        color = SurfaceWhite.copy(alpha = 0.7f), fontSize = 14.sp,
                    )
                    Spacer(Modifier.height(24.dp))
                    PulsingAvatar(
                        letter = uiState.peerUsername.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                        isPulsing = uiState.state == CallState.CALLING || uiState.state == CallState.RINGING,
                    )
                    Spacer(Modifier.height(24.dp))
                    Text(uiState.peerUsername, color = SurfaceWhite, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    if (uiState.state == CallState.CONNECTED) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(formatDuration(uiState.durationSeconds), color = SurfaceWhite.copy(alpha = 0.7f), fontSize = 16.sp)
                            SignalBars(uiState.networkQuality)
                        }
                    } else {
                        Text(
                            when (uiState.state) {
                                CallState.CALLING -> "Calling..."
                                CallState.RINGING -> "Ringing..."
                                CallState.ENDED   -> "Call ended"
                                else -> ""
                            },
                            color = SurfaceWhite.copy(alpha = 0.7f), fontSize = 16.sp,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    if (uiState.state == CallState.CONNECTED) {
                        CallControls(uiState, viewModel, showFlip = false, onMinimize = onMinimize)
                    } else {
                        CallActionButton(Icons.Default.CallEnd, "End", EndCallRed) { viewModel.endCall() }
                    }
                    Spacer(Modifier.height(64.dp))
                }
            }
        }
    }
}

// ── Video call full-screen layout ───────────────────────────────────────────

@Composable
private fun VideoCallContent(
    uiState: CallUiState,
    viewModel: CallViewModel,
    localVideo: VideoTrack?,
    remoteVideo: VideoTrack?,
    eglBaseContext: EglBase.Context,
    onMinimize: ((callId: Int?) -> Unit)? = null,
) {
    Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
        // Remote video full-screen
        if (remoteVideo != null) {
            VideoView(
                videoTrack = remoteVideo,
                eglBaseContext = eglBaseContext,
                modifier = Modifier.fillMaxSize(),
            )
        }

        // Duration top-center
        Text(
            formatDuration(uiState.durationSeconds),
            color = SurfaceWhite,
            fontSize = 14.sp,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 48.dp),
        )

        // Local video small corner
        if (localVideo != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 48.dp, end = 16.dp)
                    .size(width = 100.dp, height = 140.dp)
                    .clip(RoundedCornerShape(12.dp)),
            ) {
                VideoView(
                    videoTrack = localVideo,
                    eglBaseContext = eglBaseContext,
                    modifier = Modifier.fillMaxSize(),
                    mirror = true,
                )
            }
        }

        // Controls bottom
        Box(modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 48.dp)) {
            CallControls(uiState, viewModel, showFlip = true, onMinimize = onMinimize)
        }
    }
}

// ── Video view ──────────────────────────────────────────────────────────────

@Composable
private fun VideoView(
    videoTrack: VideoTrack?,
    eglBaseContext: EglBase.Context,
    modifier: Modifier = Modifier,
    mirror: Boolean = false,
) {
    val rendererRef = remember { mutableStateOf<SurfaceViewRenderer?>(null) }
    val trackRef = remember { mutableStateOf<VideoTrack?>(null) }

    LaunchedEffect(videoTrack) {
        val renderer = rendererRef.value ?: return@LaunchedEffect
        trackRef.value?.removeSink(renderer)
        trackRef.value = videoTrack
        videoTrack?.addSink(renderer)
    }

    DisposableEffect(Unit) {
        onDispose {
            rendererRef.value?.let { r ->
                trackRef.value?.removeSink(r)
                r.release()
            }
        }
    }

    AndroidView(
        factory = { ctx ->
            SurfaceViewRenderer(ctx).apply {
                init(eglBaseContext, null)
                setMirror(mirror)
                setEnableHardwareScaler(true)
            }.also { renderer ->
                rendererRef.value = renderer
                trackRef.value = videoTrack
                videoTrack?.addSink(renderer)
            }
        },
        modifier = modifier,
    )
}

// ── Call controls ───────────────────────────────────────────────────────────

@Composable
private fun CallControls(uiState: CallUiState, viewModel: CallViewModel, showFlip: Boolean, onMinimize: ((callId: Int?) -> Unit)? = null) {
    val conferenceState by viewModel.conferenceState.collectAsState()
    var showAddDialog by remember { mutableStateOf(false) }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        // Participant chips when conference active
        if (conferenceState.isActive && conferenceState.participants.isNotEmpty()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                conferenceState.participants.forEach { p ->
                    Box(
                        modifier = Modifier
                            .padding(horizontal = 4.dp)
                            .clip(RoundedCornerShape(50))
                            .background(ControlButton),
                        contentAlignment = Alignment.Center,
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Box(Modifier.size(6.dp).clip(CircleShape).background(AcceptGreen))
                            Text(p, color = SurfaceWhite, fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        // Main control row
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SmallControl(
                if (uiState.isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                if (uiState.isMuted) DilarionRed else SurfaceWhite,
                viewModel::toggleMute,
            )
            if (showFlip) {
                SmallControl(Icons.Default.FlipCameraAndroid, SurfaceWhite, viewModel::flipCamera)
            }
            // Add to call button
            SmallControl(Icons.Default.PersonAdd, SurfaceWhite) { showAddDialog = true }
            CallActionButton(Icons.Default.CallEnd, "End", EndCallRed) { viewModel.endCall() }
            SmallControl(
                if (uiState.isSpeaker) Icons.Default.VolumeUp else Icons.Default.VolumeOff,
                if (uiState.isSpeaker) DilarionRed else SurfaceWhite,
                viewModel::toggleSpeaker,
            )
            // Minimize button — only when there's a minimizer callback
            if (onMinimize != null) {
                SmallControl(Icons.Default.CloseFullscreen, SurfaceWhite) { onMinimize(uiState.callId) }
            }
        }
    }

    if (showAddDialog) {
        AddToCallDialog(
            onDismiss = { showAddDialog = false },
            onConfirm = { username ->
                showAddDialog = false
                uiState.callId?.let { viewModel.startConferenceAndInvite(it, username) }
            },
        )
    }
}

// ── Add-to-call dialog ──────────────────────────────────────────────────────

@Composable
private fun AddToCallDialog(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var username by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.PersonAdd, null, tint = DilarionRed) },
        title = { Text("Add to Call", textAlign = TextAlign.Center) },
        text = {
            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                label = { Text("Username") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            )
        },
        confirmButton = {
            Button(
                onClick = { if (username.isNotBlank()) onConfirm(username.trim()) },
                enabled = username.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = AcceptGreen),
            ) { Text("Invite") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

@Composable
private fun CallTypeDialog(username: String, onVoice: () -> Unit, onVideo: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Call $username", textAlign = TextAlign.Center) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    onClick = onVoice,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                ) {
                    Icon(Icons.Default.Call, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Voice Call")
                }
                OutlinedButton(onClick = onVideo, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Videocam, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Video Call")
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun MasterTokenAcceptDialog(onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var token by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Key, null, tint = DilarionRed) },
        title = { Text("Enter Master Token", textAlign = TextAlign.Center) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Required to accept encrypted calls.", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it },
                    label = { Text("Master Token") },
                    singleLine = true,
                    visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { visible = !visible }) {
                            Icon(if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility, null)
                        }
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(token) },
                enabled = token.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = AcceptGreen),
            ) { Text("Accept Call") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Decline") } },
    )
}

// ── Reusable components ─────────────────────────────────────────────────────

@Composable
private fun PulsingAvatar(letter: String, isPulsing: Boolean) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val scale1 by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = if (isPulsing) 1.3f else 1f,
        animationSpec = infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "s1",
    )
    val scale2 by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = if (isPulsing) 1.55f else 1f,
        animationSpec = infiniteRepeatable(tween(900, delayMillis = 150, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "s2",
    )
    Box(contentAlignment = Alignment.Center) {
        Box(Modifier.size(120.dp).scale(scale2).clip(CircleShape).background(DilarionRed.copy(alpha = 0.15f)))
        Box(Modifier.size(120.dp).scale(scale1).clip(CircleShape).background(DilarionRed.copy(alpha = 0.25f)))
        Box(Modifier.size(100.dp).clip(CircleShape).background(DilarionRed), contentAlignment = Alignment.Center) {
            Text(letter, color = SurfaceWhite, fontSize = 40.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun CallActionButton(icon: ImageVector, label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(
            onClick = onClick,
            modifier = Modifier.size(72.dp).clip(CircleShape).background(color),
        ) { Icon(icon, label, tint = SurfaceWhite, modifier = Modifier.size(32.dp)) }
        Spacer(Modifier.height(8.dp))
        Text(label, color = SurfaceWhite.copy(alpha = 0.7f), fontSize = 12.sp)
    }
}

@Composable
private fun SmallControl(icon: ImageVector, tint: Color, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(56.dp).clip(CircleShape).background(ControlButton),
    ) { Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp)) }
}

@Composable
private fun SignalBars(quality: Int) {
    val barColor = when {
        quality <= 1 -> Color(0xFFEF4444)
        quality <= 2 -> Color(0xFFF59E0B)
        else         -> Color(0xFF22C55E)
    }
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        listOf(6, 10, 14, 18).forEachIndexed { i, height ->
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(height.dp)
                    .background(
                        color = if (i < quality) barColor else SurfaceWhite.copy(alpha = 0.2f),
                        shape = RoundedCornerShape(1.dp),
                    )
            )
        }
    }
}

private fun formatDuration(seconds: Int) = "%02d:%02d".format(seconds / 60, seconds % 60)

// ── Floating minimized call bar ─────────────────────────────────────────────

@Composable
fun FloatingCallBar(
    info: MinimizedCallInfo,
    onExpand: () -> Unit,
    onEnd: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(bottom = 16.dp, start = 12.dp, end = 12.dp),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(50))
                .background(Color(0xFF1A1A2E))
                .border(1.dp, Color(0xFF2C2C54), RoundedCornerShape(50))
                .clickable { onExpand() }
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Pulsing green dot
            Box(Modifier.size(10.dp).clip(CircleShape).background(AcceptGreen))
            // Avatar
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(DilarionRed),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    info.partner.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                    color = SurfaceWhite, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(info.partner, color = SurfaceWhite, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text(formatDuration(info.durationSeconds), color = Color(0xFF22C55E), fontSize = 12.sp)
            }
            // Expand icon
            IconButton(
                onClick = onExpand,
                modifier = Modifier.size(36.dp).clip(CircleShape).background(Color(0xFF2C2C54)),
            ) {
                Icon(Icons.Default.OpenInFull, null, tint = SurfaceWhite, modifier = Modifier.size(16.dp))
            }
            // End call
            IconButton(
                onClick = onEnd,
                modifier = Modifier.size(36.dp).clip(CircleShape).background(EndCallRed),
            ) {
                Icon(Icons.Default.CallEnd, null, tint = SurfaceWhite, modifier = Modifier.size(16.dp))
            }
        }
    }
}
