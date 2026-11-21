package com.dilarion.app.ui.screens.gallery

import android.app.Activity
import android.content.Context
import android.media.projection.MediaProjectionManager
import android.view.WindowManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.ClosedCaptionDisabled
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import com.dilarion.app.data.model.CaptionSegment
import kotlinx.coroutines.delay
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.CallSplit
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Draw
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ScreenShare
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.BreakoutGroupInput
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.ui.components.PipController
import com.dilarion.app.ui.theme.DilarionRed
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.VideoTrack

// In-call palette: dark stage, brand red for leave and active states.
private val Stage = Color(0xFF0D0A0A)
private val Panel = Color(0xFF171212)
private val Card = Color(0xFF211919)
private val Line = Color.White.copy(alpha = 0.10f)
private val TextMain = Color(0xFFF6F1F0)
private val TextMuted = Color(0xFFA39A98)
private val Speaking = Color(0xFF22C55E)
private val LeaveRed = Color(0xFFE5392B)
private val SoftRed = Color(0xFFFF9B91)

/**
 * Group video via LiveKit. The screen keeps only the controls people reach
 * for constantly (mic, camera, people, leave); everything else lives in the
 * "More" bottom sheet so the call itself stays uncluttered. Mirrors desktop's
 * GalleryView.tsx.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GalleryScreen(
    conferenceId: Int,
    initialMicOn: Boolean = true,
    initialCamOn: Boolean = true,
    displayName: String? = null,
    isAdHocCall: Boolean = false,
    onClose: () -> Unit,
    onOpenWhiteboard: (Int, Boolean) -> Unit = { _, _ -> },
    viewModel: GalleryViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    com.dilarion.app.security.HoldIdleLogoutWhileVisible()
    var showChat by remember { mutableStateOf(false) }
    var showMore by remember { mutableStateOf(false) }
    val isInPip by PipController.isInPip
    val context = LocalContext.current
    val window = (context as? Activity)?.window
    val secureFlag = WindowManager.LayoutParams.FLAG_SECURE
    val wasSecure = remember(window) { window != null && (window.attributes.flags and secureFlag) != 0 }
    // MediaProjection starts capturing inside setScreenShareEnabled. Clear the
    // secure flag before that call; clearing it after publish leaves the first
    // captured surface black on some phones.
    LaunchedEffect(window, state.sharingScreen, state.screenShareBusy) {
        if (state.sharingScreen || state.screenShareBusy) window?.clearFlags(secureFlag)
        else if (wasSecure) window?.addFlags(secureFlag)
    }
    DisposableEffect(window) {
        onDispose { if (wasSecure) window?.addFlags(secureFlag) }
    }
    val captureLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            window?.clearFlags(secureFlag)
            viewModel.startScreenShare(result.data!!)
        }
    }
    val toggleScreenShare = {
        if (state.sharingScreen) {
            viewModel.stopScreenShare()
        } else if (!state.screenShareBusy) {
            val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            captureLauncher.launch(manager.createScreenCaptureIntent())
        }
    }

    LaunchedEffect(conferenceId) { viewModel.connect(conferenceId, initialMicOn, initialCamOn, displayName, isAdHocCall) }

    DisposableEffect(Unit) {
        PipController.meetingActive.value = true
        onDispose { PipController.meetingActive.value = false }
    }

    // PiP: system has shrunk the window to a small floating overlay — show just
    // the active tile, no chrome (toolbar/sheets don't make sense that small).
    if (isInPip) {
        Box(modifier = Modifier.fillMaxSize().background(Color.Black)) {
            val mainTile = state.tiles.firstOrNull { it.isSpeaking && !it.isLocal }
                ?: state.tiles.firstOrNull { !it.isLocal }
                ?: state.tiles.firstOrNull()
            mainTile?.let { GalleryTileView(tile = it, room = viewModel.room, fill = true) }
        }
        return
    }

    if (showChat && !state.isAdHocCall) {
        MeetingChatSheet(
            conferenceId = conferenceId,
            participantUsernames = state.tiles.filter { !it.isLocal }.map { it.identity },
            onDismiss = { showChat = false },
        )
    }

    state.screenShareError?.let { message ->
        AlertDialog(
            onDismissRequest = { viewModel.clearScreenShareError() },
            title = { Text("Screen sharing") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { viewModel.clearScreenShareError() }) { Text("OK") } },
        )
    }
    state.cameraError?.let { message ->
        AlertDialog(
            onDismissRequest = { viewModel.clearCameraError() },
            title = { Text("Camera") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { viewModel.clearCameraError() }) { Text("OK") } },
        )
    }

    val leave = { viewModel.leave(); onClose() }
    val openWhiteboard = {
        if (state.whiteboardOwner == null) {
            viewModel.shareWhiteboard(conferenceId)
            onOpenWhiteboard(conferenceId, true)
        } else {
            onOpenWhiteboard(conferenceId, state.whiteboardOwner == state.myUsername)
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF2A1210), Stage, Stage)))
            .systemBarsPadding(),
    ) {
        Column(Modifier.fillMaxSize()) {
            CallHeader(state = state, onMinimize = { PipController.enter?.invoke() })

            if (state.whiteboardOwner != null && state.whiteboardOwner != state.myUsername && !state.isAdHocCall) {
                Row(
                    modifier = Modifier
                        .padding(horizontal = 12.dp, vertical = 4.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(DilarionRed.copy(alpha = 0.18f))
                        .border(1.dp, DilarionRed.copy(alpha = 0.45f), RoundedCornerShape(14.dp))
                        .padding(start = 14.dp, end = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Draw, null, tint = SoftRed, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "${state.whiteboardOwner} is sharing a whiteboard",
                        color = TextMain, fontSize = 13.sp, modifier = Modifier.weight(1f),
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    TextButton(onClick = { onOpenWhiteboard(conferenceId, false) }) {
                        Text("View", color = SoftRed, fontWeight = FontWeight.Bold)
                    }
                }
            }

            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                when {
                    state.connecting -> Column(
                        Modifier.align(Alignment.Center),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        CircularProgressIndicator(color = DilarionRed, strokeWidth = 3.dp, modifier = Modifier.size(32.dp))
                        Spacer(Modifier.height(12.dp))
                        Text("Connecting…", color = TextMuted, fontSize = 14.sp)
                    }
                    state.error != null -> Text(
                        state.error ?: "", color = SoftRed, textAlign = TextAlign.Center,
                        modifier = Modifier.align(Alignment.Center).padding(24.dp),
                    )
                    else -> TileGrid(state = state, room = viewModel.room)
                }
                if (!state.connecting && state.error == null && !state.isAdHocCall &&
                    state.captions.enabled && state.captions.showOverlay
                ) {
                    CaptionsOverlay(
                        segments = state.captions.segments,
                        starting = state.captions.status == "starting",
                        modifier = Modifier.align(Alignment.BottomCenter),
                    )
                }
            }

            if (!state.connecting && state.error == null) {
                ControlDock(
                    state = state,
                    onMic = { viewModel.toggleMic() },
                    onCam = { viewModel.toggleCam() },
                    onPeople = { viewModel.openParticipants() },
                    onMore = { showMore = true },
                    onLeave = leave,
                )
            }
        }
    }

    if (showMore) {
        MoreSheet(
            state = state,
            onDismiss = { showMore = false },
            onChat = { showMore = false; showChat = true },
            onWhiteboard = { showMore = false; openWhiteboard() },
            onStopWhiteboard = { showMore = false; viewModel.stopSharingWhiteboard(conferenceId) },
            onScreenShare = { showMore = false; toggleScreenShare() },
            onBreakout = {
                showMore = false
                if (state.breakoutActive) viewModel.endBreakoutRooms() else viewModel.toggleBreakoutPanel(true)
            },
            onPeople = { showMore = false; viewModel.openParticipants() },
            onMinimize = { showMore = false; PipController.enter?.invoke() },
            onLeave = { showMore = false; leave() },
            onTranscript = { showMore = false; viewModel.showTranscript(true) },
            onToggleCaptions = { showMore = false; viewModel.toggleCaptionsOverlay() },
        )
    }

    if (state.captions.showTranscript && !state.isAdHocCall) {
        TranscriptSheet(
            state = state,
            onDismiss = { viewModel.showTranscript(false) },
            onStart = { viewModel.startCaptions(it) },
            onStop = { viewModel.stopCaptions() },
            onLanguage = { viewModel.setCaptionsLanguage(it) },
        )
    }

    if (state.showParticipants) {
        ParticipantsSheet(
            state = state,
            onDismiss = { viewModel.closeParticipants() },
            onSearchChange = { viewModel.setAddSearch(it) },
            onInvite = { viewModel.invite(conferenceId, it) },
            onAdmit = { viewModel.admitGuest(conferenceId, it) },
            onDeny = { viewModel.denyGuest(conferenceId, it) },
        )
    }

    if (state.showBreakoutPanel && !state.isAdHocCall) {
        BreakoutSheet(
            state = state,
            onDismiss = { viewModel.toggleBreakoutPanel(false) },
            onAuto = { n -> viewModel.autoBreakoutRooms(n) },
            onManual = { groups -> viewModel.startBreakoutRooms(groups) },
        )
    }
}

// ── Header ─────────────────────────────────────────────────────────────

@Composable
private fun CallHeader(state: GalleryUiState, onMinimize: () -> Unit) {
    val title = state.inBreakoutName
        ?: if (state.isAdHocCall) {
            if ((state.callType ?: if (state.camOn) "video" else "voice") == "voice") "Voice call" else "Video call"
        } else "Meeting"
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 18.dp, end = 8.dp, top = 8.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                title, color = TextMain, fontSize = 18.sp, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(Speaking))
                Spacer(Modifier.width(6.dp))
                val n = state.tiles.size
                Text("$n ${if (n == 1) "person" else "people"}", color = TextMuted, fontSize = 12.sp)
                if (state.inBreakoutName != null) {
                    Spacer(Modifier.width(8.dp))
                    Chip("Breakout room")
                }
                if (state.breakoutActive && state.inBreakoutName == null) {
                    Spacer(Modifier.width(8.dp))
                    Chip("Rooms open")
                }
            }
        }
        IconButton(onClick = onMinimize) {
            Box(
                Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.08f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.PictureInPictureAlt, "Minimize", tint = TextMain, modifier = Modifier.size(19.dp))
            }
        }
    }
}

@Composable
private fun Chip(text: String) {
    Text(
        text,
        color = SoftRed, fontSize = 11.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(DilarionRed.copy(alpha = 0.2f))
            .border(1.dp, DilarionRed.copy(alpha = 0.5f), RoundedCornerShape(50))
            .padding(horizontal = 9.dp, vertical = 2.dp),
    )
}

// ── Tiles ──────────────────────────────────────────────────────────────

@Composable
private fun TileGrid(state: GalleryUiState, room: Room?) {
    val gap = 10.dp
    val pad = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 6.dp)
    val presenter = state.tiles.firstOrNull { it.screenTrack != null }
    if (presenter != null && room != null) {
        Column(pad, verticalArrangement = Arrangement.spacedBy(gap)) {
            Box(Modifier.weight(1f).fillMaxWidth().background(Color.Black, RoundedCornerShape(18.dp))) {
                VideoRenderer(room, presenter.screenTrack!!)
                Text(
                    "${presenter.displayName} is sharing screen",
                    color = Color.White,
                    modifier = Modifier.align(Alignment.TopStart).padding(12.dp)
                        .background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth().height(110.dp).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(gap),
            ) {
                state.tiles.forEach { tile ->
                    Box(Modifier.width(150.dp).fillMaxHeight()) {
                        GalleryTileView(tile = tile, room = room, fill = true, compact = true)
                    }
                }
            }
        }
        return
    }
    when (state.tiles.size) {
        0 -> Unit
        // Solo: one big card filling the screen.
        1 -> Box(pad) { GalleryTileView(tile = state.tiles[0], room = room, fill = true) }
        // Two people: even split, not a giant-card-plus-tiny-strip.
        2 -> Column(pad, verticalArrangement = Arrangement.spacedBy(gap)) {
            state.tiles.forEach { tile ->
                Box(Modifier.weight(1f).fillMaxWidth()) { GalleryTileView(tile = tile, room = room, fill = true) }
            }
        }
        // 3+: every face shares the screen, two per row.
        else -> Column(pad, verticalArrangement = Arrangement.spacedBy(gap)) {
            state.tiles.chunked(2).forEach { row ->
                Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    row.forEach { tile ->
                        Box(Modifier.weight(1f).fillMaxHeight()) {
                            GalleryTileView(tile = tile, room = room, fill = true, compact = state.tiles.size > 4)
                        }
                    }
                    if (row.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun GalleryTileView(tile: GalleryTile, room: Room?, compact: Boolean = false, fill: Boolean = false) {
    val shape = RoundedCornerShape(if (compact) 16.dp else 22.dp)
    val avatarSize = if (compact) 52.dp else 84.dp
    Box(
        modifier = (if (fill) Modifier.fillMaxSize() else Modifier.fillMaxWidth().aspectRatio(16f / 9f))
            .then(if (tile.camOn && tile.videoTrack != null) Modifier else Modifier.clip(shape))
            .background(Brush.linearGradient(listOf(Color(0xFF241B1B), Color(0xFF141010))))
            .border(
                if (tile.isSpeaking) 2.dp else 1.dp,
                if (tile.isSpeaking) Speaking else Line,
                shape,
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (tile.camOn && tile.videoTrack != null && room != null) {
            VideoRenderer(room = room, videoTrack = tile.videoTrack)
        } else {
            Box(
                modifier = Modifier
                    .size(avatarSize + 12.dp)
                    .clip(CircleShape)
                    .background((if (tile.isSpeaking) Speaking else DilarionRed).copy(alpha = 0.16f)),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier = Modifier
                        .size(avatarSize)
                        .clip(CircleShape)
                        .background(Brush.linearGradient(listOf(DilarionRed, Color(0xFF6E1A12)))),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        tile.displayName.take(1).uppercase(), color = Color.White,
                        fontWeight = FontWeight.Bold, fontSize = if (compact) 20.sp else 30.sp,
                    )
                }
            }
        }
        if (!tile.micOn) {
            Box(
                modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)
                    .size(26.dp).clip(CircleShape).background(LeaveRed.copy(alpha = 0.9f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.MicOff, "Muted", tint = Color.White, modifier = Modifier.size(14.dp))
            }
        }
        Text(
            tile.displayName + if (tile.isLocal) " (You)" else "",
            color = Color.White,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(10.dp)
                .clip(RoundedCornerShape(50))
                .background(Color(0xFF0A0808).copy(alpha = 0.65f))
                .padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

@Composable
private fun VideoRenderer(room: Room, videoTrack: VideoTrack) {
    val context = LocalContext.current
    val renderer = remember(context, room) {
        TextureViewRenderer(context).also { room.initVideoRenderer(it) }
    }
    DisposableEffect(videoTrack, renderer) {
        videoTrack.addRenderer(renderer)
        onDispose { videoTrack.removeRenderer(renderer) }
    }
    DisposableEffect(renderer) {
        onDispose { renderer.release() }
    }
    key(renderer) {
        AndroidView(factory = { renderer }, modifier = Modifier.fillMaxSize())
    }
}

// ── Control dock ───────────────────────────────────────────────────────

@Composable
private fun ControlDock(
    state: GalleryUiState,
    onMic: () -> Unit,
    onCam: () -> Unit,
    onPeople: () -> Unit,
    onMore: () -> Unit,
    onLeave: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .clip(RoundedCornerShape(26.dp))
            .background(Color(0xFF181212).copy(alpha = 0.95f))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(26.dp))
            .padding(horizontal = 10.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DockButton(
            icon = if (state.micOn) Icons.Default.Mic else Icons.Default.MicOff,
            label = if (state.micOn) "Mute" else "Unmute",
            off = !state.micOn, onClick = onMic,
        )
        DockButton(
            icon = if (state.camOn) Icons.Default.Videocam else Icons.Default.VideocamOff,
            label = if (state.camOn) "Stop video" else "Start video",
            off = !state.camOn, onClick = onCam,
        )
        DockButton(
            icon = Icons.Default.Groups, label = "People", onClick = onPeople,
            badge = if (!state.isAdHocCall) state.waiting.size else 0,
        )
        DockButton(icon = Icons.Default.MoreHoriz, label = "More", onClick = onMore)
        Box(
            modifier = Modifier
                .size(width = 64.dp, height = 52.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(LeaveRed)
                .clickable(onClick = onLeave),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.CallEnd, "Leave", tint = Color.White, modifier = Modifier.size(26.dp))
        }
    }
}

@Composable
private fun DockButton(icon: ImageVector, label: String, onClick: () -> Unit, off: Boolean = false, badge: Int = 0) {
    Box {
        Box(
            modifier = Modifier
                .size(52.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (off) LeaveRed.copy(alpha = 0.22f) else Color.White.copy(alpha = 0.08f))
                .border(1.dp, if (off) LeaveRed.copy(alpha = 0.5f) else Color.Transparent, RoundedCornerShape(18.dp))
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, label, tint = if (off) SoftRed else Color.White, modifier = Modifier.size(24.dp))
        }
        if (badge > 0) {
            Box(
                Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-4).dp)
                    .size(20.dp).clip(CircleShape).background(Stage).padding(2.dp)
                    .clip(CircleShape).background(DilarionRed),
                contentAlignment = Alignment.Center,
            ) {
                Text("$badge", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

// ── Sheets ─────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DarkSheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Panel,
        contentColor = TextMain,
        scrimColor = Color.Black.copy(alpha = 0.55f),
        dragHandle = {
            Box(
                Modifier.padding(top = 10.dp, bottom = 6.dp).size(width = 40.dp, height = 4.dp)
                    .clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.22f)),
            )
        },
    ) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp), content = content)
    }
}

@Composable
private fun SheetHeader(title: String, subtitle: String? = null, icon: ImageVector? = null) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(13.dp)).background(DilarionRed.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, tint = SoftRed, modifier = Modifier.size(20.dp)) }
            Spacer(Modifier.width(12.dp))
        }
        Column {
            Text(title, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = TextMain)
            if (subtitle != null) Text(subtitle, fontSize = 12.sp, color = TextMuted)
        }
    }
}

@Composable
private fun SectionLabel(text: String, color: Color = TextMuted) {
    Text(
        text.uppercase(), color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MoreSheet(
    state: GalleryUiState,
    onDismiss: () -> Unit,
    onChat: () -> Unit,
    onWhiteboard: () -> Unit,
    onStopWhiteboard: () -> Unit,
    onScreenShare: () -> Unit,
    onBreakout: () -> Unit,
    onPeople: () -> Unit,
    onMinimize: () -> Unit,
    onLeave: () -> Unit,
    onTranscript: () -> Unit,
    onToggleCaptions: () -> Unit,
) {
    val meeting = !state.isAdHocCall
    val iShareBoard = state.whiteboardOwner != null && state.whiteboardOwner == state.myUsername
    DarkSheet(onDismiss) {
        SheetHeader("More options")
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp),
            maxItemsInEachRow = 3,
        ) {
            val cell = Modifier.weight(1f).padding(6.dp)
            ActionTile(
                Icons.Default.ScreenShare,
                if (state.sharingScreen) "Stop sharing" else if (state.screenShareBusy) "Starting…" else "Share screen",
                active = state.sharingScreen,
                onClick = onScreenShare,
                modifier = cell,
            )
            if (meeting) {
                ActionTile(Icons.Default.Chat, "Chat", onClick = onChat, modifier = cell)
                ActionTile(
                    Icons.Default.Draw,
                    when {
                        state.whiteboardOwner == null -> "Whiteboard"
                        iShareBoard -> "Open board"
                        else -> "View board"
                    },
                    active = state.whiteboardOwner != null, onClick = onWhiteboard, modifier = cell,
                )
                if (iShareBoard) {
                    ActionTile(Icons.Default.Close, "Stop board", onClick = onStopWhiteboard, modifier = cell)
                }
                val cap = state.captions
                if (cap.available || cap.segments.isNotEmpty()) {
                    ActionTile(
                        Icons.Default.Subtitles,
                        if (cap.enabled) "Transcript" else "Live transcript",
                        active = cap.enabled, onClick = onTranscript, modifier = cell,
                    )
                }
                if (cap.enabled) {
                    ActionTile(
                        if (cap.showOverlay) Icons.Default.ClosedCaptionDisabled else Icons.Default.ClosedCaption,
                        if (cap.showOverlay) "Hide captions" else "Show captions",
                        onClick = onToggleCaptions, modifier = cell,
                    )
                }
                if (state.isHost) {
                    ActionTile(
                        Icons.Default.CallSplit,
                        if (state.breakoutActive) "End rooms" else "Breakout rooms",
                        active = state.breakoutActive, onClick = onBreakout, modifier = cell,
                    )
                }
            }
            ActionTile(
                Icons.Default.PersonAdd, "Add people", onClick = onPeople, modifier = cell,
                badge = if (meeting) state.waiting.size else 0,
            )
            ActionTile(Icons.Default.PictureInPictureAlt, "Minimize", onClick = onMinimize, modifier = cell)
        }
        Spacer(Modifier.height(6.dp))
        Box(
            Modifier.padding(horizontal = 20.dp).fillMaxWidth().height(50.dp)
                .clip(RoundedCornerShape(16.dp)).background(LeaveRed).clickable(onClick = onLeave),
            contentAlignment = Alignment.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.CallEnd, null, tint = Color.White)
                Spacer(Modifier.width(8.dp))
                Text(if (meeting) "Leave meeting" else "Leave call", color = Color.White, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun ActionTile(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = false,
    badge: Int = 0,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(18.dp))
            .background(if (active) DilarionRed.copy(alpha = 0.2f) else Card)
            .border(1.dp, if (active) DilarionRed.copy(alpha = 0.55f) else Line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 16.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box {
            Icon(icon, null, tint = if (active) SoftRed else TextMain, modifier = Modifier.size(26.dp))
            if (badge > 0) {
                Box(
                    Modifier.align(Alignment.TopEnd).offset(x = 10.dp, y = (-6).dp)
                        .size(18.dp).clip(CircleShape).background(DilarionRed),
                    contentAlignment = Alignment.Center,
                ) { Text("$badge", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold) }
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            label, fontSize = 12.sp, color = TextMain, fontWeight = FontWeight.Medium,
            maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun SmallButton(text: String, onClick: () -> Unit, primary: Boolean = false, danger: Boolean = false, enabled: Boolean = true) {
    val bg = when {
        primary -> DilarionRed
        danger -> LeaveRed.copy(alpha = 0.16f)
        else -> Color.White.copy(alpha = 0.08f)
    }
    Text(
        text,
        color = when {
            danger -> SoftRed
            else -> Color.White
        },
        fontSize = 12.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (enabled) bg else bg.copy(alpha = 0.4f))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    )
}

@Composable
private fun PrimaryButton(text: String, onClick: () -> Unit, enabled: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier
            .height(48.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (enabled) DilarionRed else DilarionRed.copy(alpha = 0.4f))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
}

@Composable
private fun Avatar(name: String, size: Dp = 34.dp, highlighted: Boolean = true) {
    Box(
        Modifier.size(size).clip(CircleShape).background(
            if (highlighted) Brush.linearGradient(listOf(DilarionRed, Color(0xFF6E1A12)))
            else SolidColor(Color(0xFF3A2C2B)),
        ),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold,
            fontSize = (size.value * 0.4f).sp,
        )
    }
}

@Composable
private fun DarkField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, leading: ImageVector? = null) {
    Row(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xFF0F0B0B))
            .border(1.dp, Color.White.copy(alpha = 0.14f), RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            Icon(leading, null, tint = TextMuted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, color = TextMuted, fontSize = 14.sp)
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                cursorBrush = SolidColor(DilarionRed),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun ParticipantsSheet(
    state: GalleryUiState,
    onDismiss: () -> Unit,
    onSearchChange: (String) -> Unit,
    onInvite: (String) -> Unit,
    onAdmit: (Int) -> Unit,
    onDeny: (Int) -> Unit,
) {
    val inCallNames = remember(state.tiles) { state.tiles.map { it.identity }.toSet() }
    val invitable = state.allUsers.filter {
        it.username != null && !inCallNames.contains(it.username) &&
            it.username.contains(state.addSearch, ignoreCase = true)
    }

    DarkSheet(onDismiss) {
        SheetHeader("People", "${state.tiles.size} in this ${if (state.isAdHocCall) "call" else "meeting"}")
        Column(Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState())) {
            if (!state.isAdHocCall && state.waiting.isNotEmpty()) {
                SectionLabel("Waiting to join · ${state.waiting.size}", SoftRed)
                state.waiting.forEach { guest ->
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(guest.username, highlighted = false)
                        Spacer(Modifier.width(12.dp))
                        Text(guest.username, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        SmallButton("Deny", { onDeny(guest.userId) }, enabled = state.admitting == null)
                        Spacer(Modifier.width(6.dp))
                        SmallButton("Admit", { onAdmit(guest.userId) }, primary = true, enabled = state.admitting == null)
                    }
                }
            }

            SectionLabel("In the ${if (state.isAdHocCall) "call" else "meeting"}")
            state.tiles.forEach { tile ->
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(tile.displayName)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        tile.displayName + if (tile.isLocal) " (You)" else "",
                        fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    if (tile.isSpeaking) Box(Modifier.size(8.dp).clip(CircleShape).background(Speaking))
                    if (!tile.micOn) {
                        Spacer(Modifier.width(8.dp))
                        Icon(Icons.Default.MicOff, "Muted", tint = TextMuted, modifier = Modifier.size(18.dp))
                    }
                }
            }

            SectionLabel("Add people")
            DarkField(
                value = state.addSearch, onChange = onSearchChange, placeholder = "Search by name",
                leading = Icons.Default.Search, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            )
            state.addError?.let {
                Text(it, color = SoftRed, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
            }
            Spacer(Modifier.height(6.dp))
            invitable.forEach { user: UserInfo ->
                val username = user.username ?: return@forEach
                Row(
                    Modifier.fillMaxWidth()
                        .clickable(enabled = state.inviting == null) { onInvite(username) }
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Avatar(username, highlighted = false)
                    Spacer(Modifier.width(12.dp))
                    Text(username, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        if (state.inviting == username) "Inviting…" else "Invite",
                        color = SoftRed, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                    )
                }
            }
            if (state.addSearch.isNotEmpty() && invitable.isEmpty()) {
                Text(
                    "No one matches “${state.addSearch}”", color = TextMuted, fontSize = 13.sp,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BreakoutSheet(
    state: GalleryUiState,
    onDismiss: () -> Unit,
    onAuto: (Int) -> Unit,
    onManual: (List<BreakoutGroupInput>) -> Unit,
) {
    val others = remember(state.tiles) { state.tiles.filter { !it.isLocal } }
    val maxRooms = maxOf(2, state.tiles.size)
    var numRooms by remember { mutableStateOf(2) }
    var groups by remember {
        mutableStateOf(
            if (others.size >= 2) listOf("Room 1" to setOf<String>(), "Room 2" to setOf<String>())
            else emptyList()
        )
    }
    val assigned = groups.flatMap { it.second }.toSet()
    val unassigned = others.count { it.identity !in assigned }

    DarkSheet(onDismiss) {
        SheetHeader(
            "Breakout rooms",
            "Split people into smaller groups. Bring everyone back any time.",
            Icons.Default.CallSplit,
        )
        Column(
            Modifier.fillMaxWidth().heightIn(max = 600.dp).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Spacer(Modifier.height(2.dp))
            // Quick start
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Card)
                    .border(1.dp, Line, RoundedCornerShape(18.dp)).padding(16.dp),
            ) {
                Text("Shuffle everyone", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Text("We split people evenly at random.", color = TextMuted, fontSize = 12.sp)
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Row(
                        Modifier.clip(RoundedCornerShape(12.dp)).border(1.dp, Color.White.copy(alpha = 0.14f), RoundedCornerShape(12.dp)),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = { numRooms = (numRooms - 1).coerceAtLeast(2) }, modifier = Modifier.size(44.dp)) {
                            Icon(Icons.Default.Remove, "Fewer rooms", tint = TextMain)
                        }
                        Text("$numRooms", fontWeight = FontWeight.Bold, fontSize = 16.sp, modifier = Modifier.widthIn(min = 28.dp), textAlign = TextAlign.Center)
                        IconButton(onClick = { numRooms = (numRooms + 1).coerceAtMost(maxRooms) }, modifier = Modifier.size(44.dp)) {
                            Icon(Icons.Default.Add, "More rooms", tint = TextMain)
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    PrimaryButton(
                        if (state.breakoutBusy) "Opening…" else "Open $numRooms rooms",
                        onClick = { onAuto(numRooms) },
                        enabled = !state.breakoutBusy && others.isNotEmpty(),
                        modifier = Modifier.weight(1f),
                    )
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "OR CHOOSE WHO GOES WHERE", color = TextMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp, modifier = Modifier.weight(1f),
                )
                if (others.isNotEmpty()) {
                    Text(if (unassigned == 0) "Everyone placed" else "$unassigned not placed", color = TextMuted, fontSize = 12.sp)
                }
            }
            if (others.isEmpty()) {
                Text(
                    "Rooms need at least one other person in the meeting.",
                    color = TextMuted, fontSize = 13.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Card).padding(16.dp),
                )
            }

            groups.forEachIndexed { gi, (name, members) ->
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Card)
                        .border(1.dp, Line, RoundedCornerShape(18.dp)).padding(14.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        BasicTextField(
                            value = name,
                            onValueChange = { v -> groups = groups.toMutableList().also { it[gi] = v to members } },
                            singleLine = true,
                            textStyle = TextStyle(color = TextMain, fontSize = 15.sp, fontWeight = FontWeight.Bold),
                            cursorBrush = SolidColor(DilarionRed),
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "${members.size} ${if (members.size == 1) "person" else "people"}",
                            color = TextMuted, fontSize = 12.sp,
                        )
                        if (groups.size > 1) {
                            IconButton(
                                onClick = { groups = groups.filterIndexed { i, _ -> i != gi } },
                                modifier = Modifier.size(32.dp),
                            ) { Icon(Icons.Default.Close, "Remove room", tint = TextMuted, modifier = Modifier.size(16.dp)) }
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        others.forEach { tile ->
                            val checked = members.contains(tile.identity)
                            Row(
                                Modifier
                                    .clip(RoundedCornerShape(50))
                                    .background(if (checked) DilarionRed.copy(alpha = 0.25f) else Color.White.copy(alpha = 0.05f))
                                    .border(
                                        1.dp,
                                        if (checked) DilarionRed.copy(alpha = 0.7f) else Color.White.copy(alpha = 0.14f),
                                        RoundedCornerShape(50),
                                    )
                                    .clickable {
                                        val next = if (checked) members - tile.identity else members + tile.identity
                                        groups = groups.toMutableList().also { it[gi] = name to next }
                                    }
                                    .padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Avatar(tile.displayName, size = 24.dp, highlighted = checked)
                                Spacer(Modifier.width(6.dp))
                                Text(tile.displayName, fontSize = 13.sp, color = if (checked) Color.White else TextMain)
                            }
                        }
                    }
                }
            }

            Box(
                Modifier.fillMaxWidth().height(46.dp).clip(RoundedCornerShape(14.dp))
                    .border(1.dp, Color.White.copy(alpha = 0.18f), RoundedCornerShape(14.dp))
                    .clickable { groups = groups + ("Room ${groups.size + 1}" to emptySet()) },
                contentAlignment = Alignment.Center,
            ) { Text("+ Add a room", color = TextMuted, fontWeight = FontWeight.SemiBold) }

            state.breakoutError?.let { Text(it, color = SoftRed, fontSize = 12.sp) }

            PrimaryButton(
                if (state.breakoutBusy) "Opening…" else "Open these rooms",
                onClick = { onManual(groups.map { (n, u) -> BreakoutGroupInput(n, u.toList()) }) },
                enabled = !state.breakoutBusy && groups.any { it.second.isNotEmpty() },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(6.dp))
        }
    }
}

// ── Live transcript ────────────────────────────────────────────────────

private const val OVERLAY_LINES = 2
private const val OVERLAY_TTL_MS = 9_000L

/** The last couple of lines over the call, fading out when people stop talking. */
@Composable
private fun CaptionsOverlay(segments: List<CaptionSegment>, starting: Boolean, modifier: Modifier = Modifier) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) { delay(1000); now = System.currentTimeMillis() }
    }
    // Age lines by when they reached this phone, so a server clock difference
    // can't hide captions.
    val arrived = remember { mutableMapOf<Int, Long>() }
    val last = segments.takeLast(OVERLAY_LINES)
    last.forEach { arrived.getOrPut(it.id) { System.currentTimeMillis() } }
    val visible = last.filter { now - (arrived[it.id] ?: now) < OVERLAY_TTL_MS }
    if (visible.isEmpty() && !starting) return
    Column(
        modifier
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color.Black.copy(alpha = 0.72f))
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (visible.isEmpty()) {
            Text("Live transcript is starting…", color = TextMuted, fontSize = 13.sp)
        } else visible.forEach { s ->
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    pushStyle(androidx.compose.ui.text.SpanStyle(color = SoftRed, fontWeight = FontWeight.Bold))
                    append(s.speakerName ?: s.speakerUsername)
                    pop()
                    append("  ")
                    append(s.text)
                },
                color = Color.White, fontSize = 15.sp, lineHeight = 20.sp,
            )
        }
    }
}

private fun captionTime(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return runCatching {
        java.time.Instant.parse(iso).atZone(java.time.ZoneId.systemDefault())
            .format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
    }.getOrDefault("")
}

/** Full transcript: search, copy, and the host's language and on/off controls. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TranscriptSheet(
    state: GalleryUiState,
    onDismiss: () -> Unit,
    onStart: (String) -> Unit,
    onStop: () -> Unit,
    onLanguage: (String) -> Unit,
) {
    val cap = state.captions
    var query by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf("auto") }
    var copied by remember { mutableStateOf(false) }
    var langMenu by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val current = if (cap.enabled) cap.language else chosen
    fun nameOf(code: String) = cap.languages.firstOrNull { it.code == code }?.name ?: code

    val shown = remember(cap.segments, query) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) cap.segments
        else cap.segments.filter { it.text.lowercase().contains(q) || (it.speakerName ?: "").lowercase().contains(q) }
    }
    val listState = rememberLazyListState()
    // Follow new lines unless the reader scrolled up.
    LaunchedEffect(shown.size) {
        if (shown.isEmpty()) return@LaunchedEffect
        val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
        if (lastVisible >= shown.size - 3) listState.animateScrollToItem(shown.size - 1)
    }
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }

    val status = when {
        !cap.enabled -> "Off"
        cap.status == "starting" -> "Starting…"
        else -> "On" + (cap.startedBy?.let { " · turned on by $it" } ?: "")
    } + if (cap.enabled && cap.language != "auto") " · ${nameOf(cap.language)}" else ""

    DarkSheet(onDismiss) {
        SheetHeader("Live transcript", status, Icons.Default.Subtitles)

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            DarkField(query, { query = it }, "Search the transcript", Modifier.weight(1f), Icons.Default.Search)
            IconButton(
                onClick = {
                    val text = cap.segments.joinToString("\n") {
                        "[${captionTime(it.startedAt)}] ${it.speakerName ?: it.speakerUsername}: ${it.text}"
                    }
                    clipboard.setText(AnnotatedString(text))
                    copied = true
                },
                enabled = cap.segments.isNotEmpty(),
            ) {
                Icon(Icons.Default.ContentCopy, if (copied) "Copied" else "Copy transcript", tint = if (copied) Speaking else TextMain)
            }
        }

        Box(Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 380.dp)) {
            if (shown.isEmpty()) {
                Text(
                    when {
                        query.isNotBlank() -> "Nothing matches \"$query\"."
                        cap.enabled -> "Lines appear here a moment after each person finishes speaking."
                        !cap.available -> "Live transcript isn't available on this server yet."
                        state.isHost -> "Turn on the live transcript so everyone can follow along in text."
                        else -> "The host hasn't turned on the live transcript."
                    },
                    color = TextMuted, fontSize = 13.sp, textAlign = TextAlign.Center, lineHeight = 19.sp,
                    modifier = Modifier.align(Alignment.Center).padding(horizontal = 32.dp),
                )
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                ) {
                    itemsIndexed(shown, key = { _, s -> s.id }) { i, s ->
                        val same = i > 0 && shown[i - 1].speakerUsername == s.speakerUsername
                        Column(Modifier.fillMaxWidth().padding(top = if (same) 2.dp else 12.dp)) {
                            if (!same) {
                                Row(verticalAlignment = Alignment.Bottom) {
                                    Text(s.speakerName ?: s.speakerUsername, color = TextMain, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                    Spacer(Modifier.width(8.dp))
                                    Text(captionTime(s.startedAt), color = TextMuted, fontSize = 11.sp)
                                }
                                Spacer(Modifier.height(2.dp))
                            }
                            Text(s.text, color = Color(0xFFE9E2E1), fontSize = 14.sp, lineHeight = 20.sp)
                        }
                    }
                }
            }
        }

        (cap.error ?: cap.serverError?.takeIf { !cap.enabled })?.let {
            Text(it, color = SoftRed, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
        }

        if (state.isHost && cap.available) {
            Spacer(Modifier.height(6.dp))
            SectionLabel("Spoken language")
            Box(Modifier.padding(horizontal = 20.dp).fillMaxWidth()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(Color(0xFF0F0B0B))
                        .border(1.dp, Color.White.copy(alpha = 0.14f), RoundedCornerShape(14.dp))
                        .clickable(enabled = !cap.busy) { langMenu = true }
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(nameOf(current), color = TextMain, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Icon(Icons.Default.ArrowDropDown, "Choose language", tint = TextMuted)
                }
                DropdownMenu(
                    expanded = langMenu,
                    onDismissRequest = { langMenu = false },
                    modifier = Modifier.background(Card).heightIn(max = 320.dp),
                ) {
                    cap.languages.forEach { l ->
                        DropdownMenuItem(
                            text = {
                                Text(
                                    l.name,
                                    color = if (l.code == current) SoftRed else TextMain,
                                    fontWeight = if (l.code == current) FontWeight.Bold else FontWeight.Normal,
                                )
                            },
                            onClick = {
                                langMenu = false
                                if (cap.enabled) { if (l.code != cap.language) onLanguage(l.code) } else chosen = l.code
                            },
                        )
                    }
                }
            }
            Text(
                "Transcribed on your organization's server. Everyone in the meeting can see it.",
                color = TextMuted, fontSize = 11.sp, lineHeight = 15.sp,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            if (cap.enabled) {
                Box(
                    Modifier.padding(horizontal = 20.dp).fillMaxWidth().height(48.dp)
                        .clip(RoundedCornerShape(14.dp)).background(LeaveRed.copy(alpha = 0.16f))
                        .clickable(enabled = !cap.busy, onClick = onStop),
                    contentAlignment = Alignment.Center,
                ) { Text(if (cap.busy) "…" else "Turn off", color = SoftRed, fontWeight = FontWeight.Bold) }
            } else {
                PrimaryButton(
                    if (cap.busy) "Turning on…" else "Turn on",
                    onClick = { onStart(chosen) },
                    enabled = !cap.busy,
                    modifier = Modifier.padding(horizontal = 20.dp).fillMaxWidth(),
                )
            }
        }
    }
}
