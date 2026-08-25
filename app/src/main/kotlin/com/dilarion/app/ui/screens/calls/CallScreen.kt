package com.dilarion.app.ui.screens.calls

import androidx.activity.ComponentActivity
import androidx.compose.animation.core.*
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.runtime.collectAsState
import com.dilarion.app.data.model.IncomingCallData
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite
import org.webrtc.EglBase
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

internal val CallBackground = Color(0xFF1A1A2E)
internal val EndCallRed = Color(0xFFE53935)
internal val AcceptGreen = Color(0xFF43A047)
private val ControlButton = Color(0xFF2C2C54)

// ── Outgoing call screen (navigated from chat) ──────────────────────────────

@Composable
fun CallScreen(
    username: String,
    onCallEnded: () -> Unit,
    /** Adding a third participant moves everyone into the LiveKit conference room. */
    onOpenGallery: ((conferenceId: Int) -> Unit)? = null,
    onMinimize: ((callId: Int?) -> Unit)? = null,
    viewModel: CallViewModel = hiltViewModel(LocalContext.current as ComponentActivity),
) {
    // If we arrived here by reopening a minimized call, reattach to the live call
    // before first paint so we show the call, not the "new call" type dialog.
    val reattached = remember { viewModel.reattachIfActive() }
    var showTypeDialog by remember { mutableStateOf(!reattached) }
    val uiState by viewModel.uiState.collectAsState()
    val localVideo by viewModel.localVideo.collectAsState()
    val remoteVideo by viewModel.remoteVideo.collectAsState()

    // When coming from a previous ended call, reset to IDLE so type dialog shows cleanly
    LaunchedEffect(Unit) {
        if (uiState.state == CallState.ENDED) viewModel.resetToIdle()
    }

    // Only navigate away on ENDED when the call was actually active (not showing
    // type dialog). A call the OTHER side ended stays put: that is the case a
    // call back is for, and the buttons on the ended screen close it instead.
    LaunchedEffect(uiState.state) {
        if (uiState.state == CallState.ENDED && !showTypeDialog && uiState.endedByMe) {
            kotlinx.coroutines.delay(1200)
            onCallEnded()
        }
    }

    // This call was turned into a group call — leave the mesh leg and join the
    // conference room, which is where a group call renders video.
    val conferenceUpgrade by viewModel.conferenceUpgrade.collectAsState()
    LaunchedEffect(conferenceUpgrade) {
        val confId = conferenceUpgrade ?: return@LaunchedEffect
        viewModel.clearConferenceUpgrade()
        viewModel.endCallForConferenceUpgrade()
        if (onOpenGallery != null) onOpenGallery(confId) else onCallEnded()
    }

    uiState.error?.let { err ->
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Call error") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = { viewModel.clearError(); onCallEnded() }) { Text("OK") } },
        )
    }

    // No active call = IDLE or ENDED — show type dialog
    val hasActiveCall = uiState.state != CallState.IDLE && uiState.state != CallState.ENDED
    if (showTypeDialog && !hasActiveCall) {
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
            onCloseEnded = { viewModel.resetToIdle(); onCallEnded() },
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

    // A rejected token reopens the prompt instead of dropping the call.
    LaunchedEffect(uiState.masterTokenRejected) {
        if (uiState.masterTokenRejected) showMasterTokenDialog = true
    }

    if (showMasterTokenDialog) {
        MasterTokenAcceptDialog(
            rejected = uiState.masterTokenRejected,
            onDismiss = { showMasterTokenDialog = false; viewModel.clearMasterTokenRejected() },
            onConfirm = { token ->
                showMasterTokenDialog = false
                viewModel.clearMasterTokenRejected()
                viewModel.acceptCall(token)
            },
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
                            CallActionButton(Icons.Default.Call, "Accept", AcceptGreen) {
                                // Always ask: the token is what proves the owner is
                                // the one answering, so it is never stored or reused.
                                showMasterTokenDialog = true
                            }
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
    onCloseEnded: () -> Unit = {},
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
                if (uiState.state == CallState.CONNECTED) {
                    TopRightCallActions(
                        uiState, viewModel, showFlip = false, onMinimize = onMinimize,
                        modifier = Modifier.align(Alignment.TopEnd).padding(top = 48.dp, end = 16.dp),
                    )
                }
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
                            when {
                                // WebRTC gives no mute signal, so this comes from
                                // the other device telling us.
                                uiState.peerMuted -> "${uiState.peerUsername} is muted"
                                uiState.state == CallState.CALLING -> "Calling..."
                                uiState.state == CallState.RINGING -> "Ringing..."
                                uiState.state == CallState.ENDED   -> "Call ended"
                                else -> ""
                            },
                            color = SurfaceWhite.copy(alpha = 0.7f), fontSize = 16.sp,
                        )
                    }
                    Spacer(Modifier.weight(1f))
                    if (uiState.state == CallState.CONNECTED) {
                        CallControls(uiState, viewModel, showFlip = false, onMinimize = onMinimize)
                    } else if (uiState.state == CallState.ENDED && !uiState.endedByMe) {
                        EndedCallControls(
                            onCallBack = { type -> viewModel.startOutgoingCall(uiState.peerUsername, type) },
                            onClose = onCloseEnded,
                        )
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

        // Top-right vertical actions (below the self-view thumbnail)
        TopRightCallActions(
            uiState, viewModel, showFlip = true, onMinimize = onMinimize,
            modifier = Modifier.align(Alignment.TopEnd).padding(top = 200.dp, end = 16.dp),
        )

        // Controls bottom
        Box(modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 48.dp)) {
            CallControls(uiState, viewModel, showFlip = false, onMinimize = null)
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
    val users by viewModel.users.collectAsState()
    var showPickerDialog by remember { mutableStateOf(false) }

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
                            val isMuted = p in conferenceState.mutedParticipants
                            Box(
                                Modifier.size(6.dp).clip(CircleShape)
                                    .background(if (isMuted) SurfaceWhite.copy(alpha = 0.35f) else AcceptGreen)
                            )
                            Text(
                                p,
                                color = if (isMuted) SurfaceWhite.copy(alpha = 0.55f) else SurfaceWhite,
                                fontSize = 12.sp,
                            )
                            if (isMuted) {
                                Icon(
                                    Icons.Default.MicOff, "muted",
                                    tint = SurfaceWhite.copy(alpha = 0.55f),
                                    modifier = Modifier.size(11.dp),
                                )
                            }
                        }
                    }
                }
            }
        }

        // Main control row — mute, speaker, end (WhatsApp-style, bottom of screen)
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
            CallActionButton(Icons.Default.CallEnd, "End", EndCallRed) { viewModel.endCall() }
            SmallControl(
                if (uiState.isSpeaker) Icons.Default.VolumeUp else Icons.Default.VolumeOff,
                if (uiState.isSpeaker) DilarionRed else SurfaceWhite,
                viewModel::toggleSpeaker,
            )
        }
    }
}

/**
 * WhatsApp-style vertical stack in the top-right corner: minimize, add person,
 * and (on video) flip camera. Kept apart from the bottom row so the primary
 * controls stay reachable at the bottom of the screen.
 */
@Composable
private fun TopRightCallActions(
    uiState: CallUiState,
    viewModel: CallViewModel,
    showFlip: Boolean,
    onMinimize: ((callId: Int?) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val users by viewModel.users.collectAsState()
    var showPickerDialog by remember { mutableStateOf(false) }

    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (onMinimize != null) {
            SmallControl(Icons.Default.CloseFullscreen, SurfaceWhite) { onMinimize(uiState.callId) }
        }
        SmallControl(Icons.Default.PersonAdd, SurfaceWhite) { viewModel.fetchUsers(); showPickerDialog = true }
        if (showFlip) {
            SmallControl(Icons.Default.FlipCameraAndroid, SurfaceWhite, viewModel::flipCamera)
        }
    }

    if (showPickerDialog) {
        UserPickerModal(
            users = users,
            onDismiss = { showPickerDialog = false },
            onSelect = { username ->
                showPickerDialog = false
                uiState.callId?.let { viewModel.startConferenceAndInvite(it, username) }
            },
        )
    }
}

// ── WhatsApp-style user picker modal ────────────────────────────────────────

@Composable
private fun UserPickerModal(
    users: List<UserInfo>,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val filtered = remember(query, users) {
        if (query.isBlank()) users
        else users.filter { it.username?.contains(query, ignoreCase = true) == true }
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.8f),
            shape = RoundedCornerShape(20.dp),
            color = Color(0xFF1A1A2E),
        ) {
            Column {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Add to Call", color = SurfaceWhite, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, null, tint = SurfaceWhite.copy(alpha = 0.7f))
                    }
                }
                // Search bar
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search users…", color = SurfaceWhite.copy(alpha = 0.4f)) },
                    leadingIcon = { Icon(Icons.Default.Search, null, tint = SurfaceWhite.copy(alpha = 0.5f)) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(bottom = 8.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = SurfaceWhite,
                        unfocusedTextColor = SurfaceWhite,
                        focusedBorderColor = DilarionRed,
                        unfocusedBorderColor = Color(0xFF2C2C54),
                        cursorColor = DilarionRed,
                    ),
                    shape = RoundedCornerShape(12.dp),
                    singleLine = true,
                )
                // User list
                if (filtered.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            if (users.isEmpty()) "Loading…" else "No users found",
                            color = SurfaceWhite.copy(alpha = 0.4f),
                            fontSize = 14.sp,
                        )
                    }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(filtered) { user ->
                            val username = user.username ?: return@items
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onSelect(username) }
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Box(
                                    Modifier
                                        .size(42.dp)
                                        .clip(CircleShape)
                                        .background(DilarionRed),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        username.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                                        color = SurfaceWhite,
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Bold,
                                    )
                                }
                                Text(
                                    username,
                                    color = SurfaceWhite,
                                    fontSize = 15.sp,
                                    modifier = Modifier.weight(1f),
                                )
                                Icon(
                                    Icons.Default.PersonAdd,
                                    null,
                                    tint = AcceptGreen,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                            HorizontalDivider(color = Color(0xFF2C2C54), thickness = 0.5.dp)
                        }
                    }
                }
            }
        }
    }
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
private fun MasterTokenAcceptDialog(
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
    rejected: Boolean = false,
) {
    var token by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Key, null, tint = DilarionRed) },
        title = { Text("Enter Master Token", textAlign = TextAlign.Center) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (rejected) "That token was rejected. The call is still ringing — try again."
                    else "Required to accept encrypted calls.",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (rejected) DilarionRed else Color.Gray,
                )
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
internal fun CallActionButton(icon: ImageVector, label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        IconButton(
            onClick = onClick,
            modifier = Modifier.size(72.dp).clip(CircleShape).background(color),
        ) { Icon(icon, label, tint = SurfaceWhite, modifier = Modifier.size(32.dp)) }
        Spacer(Modifier.height(8.dp))
        Text(label, color = SurfaceWhite.copy(alpha = 0.7f), fontSize = 12.sp)
    }
}

/**
 * Shown after the other side ended, declined, or never answered. Redialling from
 * here saves the trip back to the contact list, which is where the user would
 * otherwise have to go to try again.
 */
@Composable
private fun EndedCallControls(
    onCallBack: (CallType) -> Unit,
    onClose: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.CenterVertically) {
        CallActionButton(Icons.Default.Close, "Close", ControlButton, onClose)
        CallActionButton(Icons.Default.Call, "Call back", AcceptGreen) { onCallBack(CallType.VOICE) }
        CallActionButton(Icons.Default.Videocam, "Video", Color(0xFF2563EB)) { onCallBack(CallType.VIDEO) }
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
