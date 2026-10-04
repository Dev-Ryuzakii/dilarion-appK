package com.dilarion.app.ui.screens.groupcall

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.delay

private val CallBg = Color(0xFF0B141A)
private val TileBg = Color(0xFF1F2937)
private val SpeakingGreen = Color(0xFF25D366)
private val AvatarColors = listOf(
    Color(0xFF7C3AED), Color(0xFF0891B2), Color(0xFF059669), Color(0xFFD97706),
    Color(0xFFC0392B), Color(0xFFDB2777), Color(0xFF2563EB),
)

private fun colorFor(name: String): Color {
    var h = 0
    name.forEach { h = h * 31 + it.code }
    return AvatarColors[Math.floorMod(h, AvatarColors.size)]
}

private fun initials(name: String): String =
    name.split(Regex("\\s+")).filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }

private fun fmtDur(totalSec: Long): String {
    val h = totalSec / 3600
    val m = (totalSec % 3600) / 60
    val s = totalSec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/**
 * WhatsApp-style group call screen — a call, not a meeting. conferenceId < 0
 * starts a new call to the group; otherwise joins one already accepted.
 */
@Composable
fun GroupCallScreen(
    conferenceId: Int,
    groupId: Int,
    groupName: String,
    callType: String,
    onClose: () -> Unit,
    viewModel: GroupCallViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val isVideo = callType == "video"
    com.dilarion.app.security.HoldIdleLogoutWhileVisible()

    val permissions = if (isVideo) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
    else arrayOf(Manifest.permission.RECORD_AUDIO)
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        viewModel.start(conferenceId, groupId, callType)
    }
    LaunchedEffect(Unit) { permissionLauncher.launch(permissions) }

    // Close shortly after the call ends so the reason ("No answer") is readable.
    LaunchedEffect(state.status) {
        if (state.status == GroupCallStatus.ENDED) {
            delay(if (state.endReason != null) 1500 else 0)
            onClose()
        }
    }
    DisposableEffect(Unit) { onDispose { viewModel.finish(null) } }

    var nowMs by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(state.status) {
        while (state.status == GroupCallStatus.ACTIVE) {
            nowMs = System.currentTimeMillis()
            delay(1000)
        }
    }

    val statusText = when (state.status) {
        GroupCallStatus.CONNECTING -> "Connecting…"
        GroupCallStatus.RINGING -> "Ringing…"
        GroupCallStatus.ACTIVE -> state.startedAtMs?.let { fmtDur((nowMs - it).coerceAtLeast(0) / 1000) } ?: ""
        GroupCallStatus.ENDED -> state.endReason ?: "Call ended"
    }
    val label = if (isVideo) "Group video call" else "Group voice call"
    val room = viewModel.room

    Box(Modifier.fillMaxSize().background(CallBg)) {
        Column(Modifier.fillMaxSize().systemBarsPadding()) {
            // Header
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
            ) {
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(colorFor(groupName)),
                    contentAlignment = Alignment.Center,
                ) { Text(initials(groupName), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(groupName, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val count = state.tiles.size
                    Text(
                        "$label · $statusText" + if (state.status == GroupCallStatus.ACTIVE) " · $count in call" else "",
                        color = Color(0xFF9CA3AF), fontSize = 12.sp,
                    )
                }
            }

            // Body
            Box(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 10.dp)) {
                val others = state.tiles.count { !it.isLocal }
                if (state.status == GroupCallStatus.ACTIVE && others > 0 && room != null) {
                    val cols = if (state.tiles.size <= 2) 1 else 2
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(cols),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(state.tiles, key = { it.identity }) { tile ->
                            val h = if (state.tiles.size <= 2) 300.dp else 220.dp
                            CallTile(room, tile, Modifier.fillMaxWidth().height(h))
                        }
                    }
                } else {
                    Column(
                        Modifier.fillMaxSize(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Box(
                            Modifier.size(140.dp).clip(CircleShape).background(colorFor(groupName)),
                            contentAlignment = Alignment.Center,
                        ) { Text(initials(groupName), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 48.sp) }
                        Spacer(Modifier.height(18.dp))
                        Text(groupName, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 22.sp)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            if (state.status == GroupCallStatus.RINGING) "Ringing group members…" else statusText,
                            color = Color(0xFF9CA3AF), fontSize = 15.sp,
                        )
                    }
                    // Own camera preview while waiting on a video call
                    val me = state.tiles.firstOrNull { it.isLocal }
                    if (room != null && me != null && state.camOn && state.status != GroupCallStatus.ENDED) {
                        CallTile(
                            room, me,
                            Modifier.align(Alignment.BottomEnd).padding(8.dp).width(120.dp).height(160.dp),
                        )
                    }
                }
            }

            // Controls
            Row(
                horizontalArrangement = Arrangement.spacedBy(22.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 28.dp),
            ) {
                RoundButton(
                    if (state.camOn) Icons.Default.Videocam else Icons.Default.VideocamOff,
                    if (state.camOn) "Turn camera off" else "Turn camera on",
                    active = state.camOn,
                ) { viewModel.toggleCam() }
                RoundButton(
                    if (state.micOn) Icons.Default.Mic else Icons.Default.MicOff,
                    if (state.micOn) "Mute" else "Unmute",
                    active = !state.micOn,
                ) { viewModel.toggleMic() }
                RoundButton(Icons.Default.CallEnd, "End call", danger = true) { viewModel.finish(null) }
            }
        }

        state.notice?.let { notice ->
            Snackbar(
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 80.dp, start = 16.dp, end = 16.dp),
                action = { TextButton(onClick = viewModel::clearNotice) { Text("OK") } },
            ) { Text(notice) }
        }
    }
}

@Composable
private fun CallTile(room: Room, tile: GroupCallTile, modifier: Modifier) {
    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(TileBg)
            .border(3.dp, if (tile.isSpeaking) SpeakingGreen else Color.Transparent, RoundedCornerShape(14.dp)),
        contentAlignment = Alignment.Center,
    ) {
        val track = tile.videoTrack
        if (tile.camOn && track != null) {
            TrackView(room, track)
        } else {
            Box(
                Modifier.size(72.dp).clip(CircleShape).background(colorFor(tile.displayName)),
                contentAlignment = Alignment.Center,
            ) { Text(initials(tile.displayName), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 26.sp) }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(8.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Color.Black.copy(alpha = 0.55f))
                .padding(horizontal = 8.dp, vertical = 3.dp),
        ) {
            if (!tile.micOn) {
                Icon(Icons.Default.MicOff, null, tint = Color(0xFFEF4444), modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(4.dp))
            }
            Text(if (tile.isLocal) "You" else tile.displayName, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun TrackView(room: Room, videoTrack: VideoTrack) {
    val context = LocalContext.current
    val renderer = remember(context) { TextureViewRenderer(context).also { room.initVideoRenderer(it) } }
    DisposableEffect(videoTrack) {
        videoTrack.addRenderer(renderer)
        onDispose { videoTrack.removeRenderer(renderer) }
    }
    DisposableEffect(Unit) { onDispose { renderer.release() } }
    AndroidView(factory = { renderer }, modifier = Modifier.fillMaxSize())
}

@Composable
private fun RoundButton(
    icon: ImageVector,
    description: String,
    active: Boolean = false,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val bg = when {
        danger -> Color(0xFFEF4444)
        active -> Color.White
        else -> Color.White.copy(alpha = 0.14f)
    }
    val fg = if (active && !danger) Color(0xFF111111) else Color.White
    FilledIconButton(
        onClick = onClick,
        modifier = Modifier.size(60.dp),
        colors = IconButtonDefaults.filledIconButtonColors(containerColor = bg, contentColor = fg),
    ) { Icon(icon, description, modifier = Modifier.size(26.dp)) }
}
