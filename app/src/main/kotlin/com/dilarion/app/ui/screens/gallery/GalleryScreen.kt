package com.dilarion.app.ui.screens.gallery

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Draw
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.VideoTrack

/**
 * Group video via LiveKit — the "home" for all in-call tools: gallery grid,
 * mute/camera, participants list, adding someone new mid-call, and leaving.
 * Mirrors desktop's GalleryView.tsx. Breakout rooms / together-mode /
 * recording / captions are explicitly out of scope for this round.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GalleryScreen(
    conferenceId: Int,
    initialMicOn: Boolean = true,
    initialCamOn: Boolean = true,
    displayName: String? = null,
    onClose: () -> Unit,
    onOpenWhiteboard: (Int) -> Unit = {},
    viewModel: GalleryViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(conferenceId) { viewModel.connect(conferenceId, initialMicOn, initialCamOn, displayName) }

    Scaffold(
        containerColor = Color(0xFF0B0B10),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        if (state.tiles.isNotEmpty()) "Group Video · ${state.tiles.size}" else "Group Video",
                        color = SurfaceWhite,
                    )
                },
                actions = {
                    BadgedBox(badge = {
                        if (state.waiting.isNotEmpty()) Badge { Text("${state.waiting.size}") }
                    }) {
                        TextButton(onClick = { viewModel.openParticipants() }) { Text("Participants", color = SurfaceWhite) }
                    }
                    IconButton(onClick = { onOpenWhiteboard(conferenceId) }) {
                        Icon(Icons.Default.Draw, "Whiteboard", tint = SurfaceWhite)
                    }
                    IconButton(onClick = { viewModel.leave(); onClose() }) {
                        Icon(Icons.Default.Close, "Close", tint = SurfaceWhite)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        bottomBar = {
            if (!state.connecting && state.error == null) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally),
                ) {
                    CtrlButton(icon = if (state.micOn) Icons.Default.Mic else Icons.Default.MicOff, onClick = { viewModel.toggleMic() })
                    CtrlButton(icon = if (state.camOn) Icons.Default.Videocam else Icons.Default.VideocamOff, onClick = { viewModel.toggleCam() })
                    CtrlButton(icon = Icons.Default.PersonAdd, onClick = { viewModel.openParticipants() })
                    CtrlButton(icon = Icons.Default.Close, onClick = { viewModel.leave(); onClose() }, danger = true)
                }
            }
        },
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            when {
                state.connecting -> Text("Connecting…", color = SurfaceWhite, modifier = Modifier.align(Alignment.Center))
                state.error != null -> Text(state.error ?: "", color = Color(0xFFEF4444), modifier = Modifier.align(Alignment.Center).padding(20.dp))
                else -> {
                    val room = viewModel.room
                    when (state.tiles.size) {
                        // Solo: one big card filling the screen.
                        0, 1 -> state.tiles.firstOrNull()?.let {
                            Box(modifier = Modifier.fillMaxSize().padding(12.dp)) {
                                GalleryTileView(tile = it, room = room)
                            }
                        }
                        // Two people: even split, not a giant-card-plus-tiny-strip -
                        // that reads as broken with exactly one other participant.
                        2 -> Column(
                            modifier = Modifier.fillMaxSize().padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            state.tiles.forEach { tile ->
                                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                                    GalleryTileView(tile = tile, room = room)
                                }
                            }
                        }
                        // 3+: thumbnail strip across the top, active speaker (or
                        // first remote participant) large below - Meet/Teams'
                        // adaptive layout. Mirrors desktop's GalleryView.tsx.
                        else -> {
                            val mainTile = state.tiles.firstOrNull { it.isSpeaking && !it.isLocal }
                                ?: state.tiles.firstOrNull { !it.isLocal }
                                ?: state.tiles.firstOrNull()
                            val sideTiles = state.tiles.filterNot { it.identity == mainTile?.identity }

                            Column(modifier = Modifier.fillMaxSize().padding(12.dp)) {
                                LazyRow(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                                ) {
                                    items(sideTiles, key = { it.identity }) { tile ->
                                        Box(modifier = Modifier.width(110.dp)) {
                                            GalleryTileView(tile = tile, room = room, compact = true)
                                        }
                                    }
                                }
                                mainTile?.let {
                                    Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                                        GalleryTileView(tile = it, room = room)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (state.showParticipants) {
        ParticipantsSheet(
            state = state,
            conferenceId = conferenceId,
            onDismiss = { viewModel.closeParticipants() },
            onSearchChange = { viewModel.setAddSearch(it) },
            onInvite = { viewModel.invite(conferenceId, it) },
            onAdmit = { viewModel.admitGuest(conferenceId, it) },
            onDeny = { viewModel.denyGuest(conferenceId, it) },
        )
    }
}

@Composable
private fun CtrlButton(icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit, danger: Boolean = false) {
    FilledIconButton(
        onClick = onClick,
        colors = IconButtonDefaults.filledIconButtonColors(
            containerColor = if (danger) Color(0xFFEF4444) else Color.White.copy(alpha = 0.15f),
        ),
    ) {
        Icon(icon, null, tint = SurfaceWhite)
    }
}

@Composable
private fun GalleryTileView(tile: GalleryTile, room: Room?, compact: Boolean = false) {
    val avatarSize = if (compact) 30.dp else 56.dp
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFF1A1A22))
            .then(
                if (tile.isSpeaking) Modifier.border(2.dp, Color(0xFF25D366), RoundedCornerShape(12.dp))
                else Modifier
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (tile.camOn && tile.videoTrack != null && room != null) {
            VideoRenderer(room = room, videoTrack = tile.videoTrack)
        } else {
            Box(
                modifier = Modifier.size(avatarSize).clip(CircleShape).background(DilarionRed),
                contentAlignment = Alignment.Center,
            ) {
                Text(tile.displayName.take(1).uppercase(), color = SurfaceWhite, fontWeight = FontWeight.Bold)
            }
        }
        if (!tile.micOn) {
            Box(
                modifier = Modifier.align(Alignment.TopEnd).padding(6.dp)
                    .size(if (compact) 16.dp else 22.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.MicOff, null, tint = SurfaceWhite, modifier = Modifier.size(if (compact) 9.dp else 12.dp))
            }
        }
        if (!compact) {
            Text(
                tile.displayName + if (tile.isLocal) " (you)" else "",
                color = SurfaceWhite,
                fontSize = 12.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.align(Alignment.BottomStart).padding(8.dp),
            )
        }
    }
}

@Composable
private fun VideoRenderer(room: Room, videoTrack: VideoTrack) {
    val context = LocalContext.current
    val renderer = remember(context) {
        TextureViewRenderer(context).also { room.initVideoRenderer(it) }
    }
    DisposableEffect(videoTrack) {
        videoTrack.addRenderer(renderer)
        onDispose { videoTrack.removeRenderer(renderer) }
    }
    DisposableEffect(Unit) {
        onDispose { renderer.release() }
    }
    AndroidView(factory = { renderer }, modifier = Modifier.fillMaxSize())
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ParticipantsSheet(
    state: GalleryUiState,
    conferenceId: Int,
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

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            if (state.waiting.isNotEmpty()) {
                Text(
                    "Waiting to join (${state.waiting.size})",
                    color = Color(0xFFEF4444),
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
                state.waiting.forEach { guest ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(guest.username, modifier = Modifier.weight(1f))
                        TextButton(onClick = { onAdmit(guest.userId) }, enabled = state.admitting == null) {
                            Text("Admit")
                        }
                        TextButton(onClick = { onDeny(guest.userId) }, enabled = state.admitting == null) {
                            Text("Deny")
                        }
                    }
                }
                Divider(modifier = Modifier.padding(vertical = 10.dp))
            }
            Text(
                "Participants (${state.tiles.size})",
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
            state.tiles.forEach { tile ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(tile.displayName + if (tile.isLocal) " (you)" else "")
                    if (!tile.micOn) Text("muted", color = Color.Gray, fontSize = 12.sp)
                }
            }
            Divider(modifier = Modifier.padding(vertical = 10.dp))
            OutlinedTextField(
                value = state.addSearch,
                onValueChange = onSearchChange,
                label = { Text("Add people to this call") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                singleLine = true,
            )
            state.addError?.let {
                Text(it, color = Color(0xFFEF4444), fontSize = 12.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
            }
            Spacer(Modifier.height(8.dp))
            invitable.forEach { user: UserInfo ->
                val username = user.username ?: return@forEach
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(username)
                    TextButton(onClick = { onInvite(username) }, enabled = state.inviting == null) {
                        Text(if (state.inviting == username) "Inviting…" else "Invite")
                    }
                }
            }
        }
    }
}
