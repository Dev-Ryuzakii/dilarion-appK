package com.dilarion.app.ui.screens.chat

import android.Manifest
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.Image
import com.dilarion.app.R
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.runtime.collectAsState
import androidx.compose.foundation.lazy.items
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.dilarion.app.data.model.MediaItem
import com.dilarion.app.data.model.Message
import com.dilarion.app.ui.theme.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale

private val DECOY_PHRASES = listOf(
    "Hey, how are you doing?",
    "Let me know when you're free.",
    "Sounds good to me!",
    "Can we talk later?",
    "I'll send that over shortly.",
    "Got it, thanks!",
    "Sure, that works.",
    "On my way now.",
    "Just checking in.",
    "All good here.",
    "Will do, see you soon.",
    "That makes sense.",
    "Let me check and get back to you.",
    "Okay, perfect.",
    "Noted, thanks!",
)

private fun decoyFor(id: Int): String = DECOY_PHRASES[id.mod(DECOY_PHRASES.size)]

/** Server decoy when present, otherwise a stable local phrase for this message. */
private fun decoyTextFor(message: Message): String =
    message.decoyContent?.takeIf { it.isNotBlank() } ?: decoyFor(message.id)

/**
 * True when [text] is raw ciphertext (base64 / hex blob) rather than readable text.
 * Guards against ever painting an encrypted payload into a bubble when the message
 * was not tagged content_type="encrypted" by the server.
 */
private fun looksLikeCiphertext(text: String?): Boolean {
    if (text.isNullOrBlank() || text.length < 24) return false
    if (text.any { it.isWhitespace() }) return false
    return text.all { it.isLetterOrDigit() || it == '+' || it == '/' || it == '=' || it == '-' || it == '_' }
}

private fun isVoiceMedia(item: MediaItem): Boolean =
    item.contentType?.contains("voice", ignoreCase = true) == true ||
            item.mediaType.contains("voice", ignoreCase = true) ||
            item.filename.endsWith(".mp4") && item.mediaType.contains("audio", ignoreCase = true)

private fun isImageMedia(item: MediaItem): Boolean =
    item.contentType?.startsWith("image/") == true || item.mediaType.contains("photo", ignoreCase = true)

/** Generic files/documents — get a decoy on first open rather than the plain lock icon. */
private fun isDocumentMedia(item: MediaItem): Boolean {
    if (isVoiceMedia(item) || isImageMedia(item)) return false
    val ct = item.contentType
    return ct?.startsWith("application/") == true || ct?.startsWith("media/") == true || item.mediaType == "raw"
}

/** Classifies a picked file's MIME type before upload — documents get a decoy-kind prompt. */
private fun isDocumentMime(mime: String?): Boolean =
    mime != null && !mime.startsWith("image/") && !mime.startsWith("video/") && !mime.startsWith("audio/")

/** Must match DECOY_KINDS in the backend. */
private val DECOY_KIND_LABELS = listOf(
    "invoice" to "Invoice",
    "delivery" to "Delivery note",
    "minutes" to "Meeting minutes",
    "memo" to "Memo",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    username: String,
    groupId: Int?,
    groupName: String?,
    onBack: () -> Unit,
    onCall: ((String) -> Unit)? = null,
    viewModel: ChatViewModel = hiltViewModel(),
) {
    val context = LocalContext.current

    LaunchedEffect(username, groupId) { viewModel.init(username, groupId) }

    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    var inputText by remember { mutableStateOf("") }
    // Which specific message/media key is being unlocked right now — null means
    // no dialog showing. Never a global "unlock everything" toggle.
    var unlockTarget by remember { mutableStateOf<String?>(null) }
    var unlockError by remember { mutableStateOf<String?>(null) }
    var viewerImagePath by remember { mutableStateOf<String?>(null) }
    var pendingDocUri by remember { mutableStateOf<Uri?>(null) }

    val combinedItems = remember(uiState.messages, uiState.mediaItems) {
        viewModel.getCombinedItems()
    }

    val displayName = if (groupId != null) (groupName ?: "Group") else username

    LaunchedEffect(combinedItems.size) {
        if (combinedItems.isNotEmpty()) listState.animateScrollToItem(combinedItems.size - 1)
    }

    // Attachment picker — any file; documents get a decoy-kind prompt before upload
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            val mime = context.contentResolver.getType(uri)
            if (isDocumentMime(mime)) pendingDocUri = uri else viewModel.sendAttachment(uri, context)
        }
    }

    // Audio permission
    val audioPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) viewModel.startRecording(context)
    }

    uiState.error?.let { err ->
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Error") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = viewModel::clearError) { Text("OK") } },
        )
    }

    unlockTarget?.let { target ->
        UnlockDialog(
            error = unlockError,
            onDismiss = { unlockTarget = null; unlockError = null },
            onConfirm = { token ->
                val ok = viewModel.unlock(token, target)
                if (ok) { unlockTarget = null; unlockError = null }
                else unlockError = "Incorrect master token"
            },
        )
    }

    uiState.viewingDocumentKey?.let { key ->
        val bytes = viewModel.getDocumentBytes(key)
        if (bytes != null) {
            DocumentViewerDialog(bytes = bytes, onDismiss = { viewModel.closeDocumentViewer() })
        }
    }

    viewerImagePath?.let { path ->
        FullScreenImageViewer(imagePath = path, onDismiss = { viewerImagePath = null })
    }

    pendingDocUri?.let { uri ->
        DecoyKindDialog(
            onPick = { kind -> viewModel.sendAttachment(uri, context, kind); pendingDocUri = null },
            onDismiss = { pendingDocUri = null },
        )
    }

    if (uiState.forwardTarget != null) {
        var forwardUsername by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { viewModel.setForwardTarget(null) },
            title = { Text("Forward message") },
            text = {
                Column {
                    OutlinedTextField(
                        value = forwardUsername,
                        onValueChange = { forwardUsername = it },
                        placeholder = { Text("Recipient username") },
                        singleLine = true,
                    )
                    uiState.forwardError?.let {
                        Text(it, color = Color(0xFFEF4444), fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.forwardMessage(forwardUsername) }, enabled = forwardUsername.isNotBlank()) { Text("Forward") }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.setForwardTarget(null) }) { Text("Cancel") }
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
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier.size(36.dp).clip(CircleShape).background(DilarionRedDark),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                displayName.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                                color = SurfaceWhite, fontSize = 16.sp, fontWeight = FontWeight.Bold,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(displayName, style = MaterialTheme.typography.titleMedium, color = SurfaceWhite)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Lock, null, modifier = Modifier.size(9.dp), tint = SurfaceWhite.copy(alpha = 0.7f))
                                Spacer(Modifier.width(3.dp))
                                Text("end-to-end encrypted", fontSize = 10.sp, color = SurfaceWhite.copy(alpha = 0.7f))
                            }
                        }
                    }
                },
                actions = {
                    if (groupId == null && onCall != null) {
                        IconButton(onClick = { onCall(username) }) {
                            Icon(Icons.Default.Call, "Call", tint = SurfaceWhite)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        containerColor = Color.Transparent,
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize()) {
            Image(
                painter = painterResource(R.drawable.chat_bg),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize(),
                alpha = 0.45f,
            )
        Column(
            modifier = Modifier.fillMaxSize().padding(innerPadding).imePadding(),
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (uiState.isLoading) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = DilarionRed)
                        }
                    }
                } else {
                    itemsIndexed(
                        combinedItems,
                        key = { _, item ->
                            when (item) {
                                is ChatItem.TextMessage -> "msg_${item.message.id}"
                                is ChatItem.MediaMessage -> "media_${item.item.mediaId}"
                                is ChatItem.Pending -> "pending_${item.upload.id}"
                            }
                        }
                    ) { index, item ->
                        val curTs = when (item) {
                            is ChatItem.TextMessage -> item.message.timestamp
                            is ChatItem.MediaMessage -> item.item.timestamp
                            is ChatItem.Pending -> item.upload.timestamp
                        }
                        val prevTs = if (index > 0) when (val prev = combinedItems[index - 1]) {
                            is ChatItem.TextMessage -> prev.message.timestamp
                            is ChatItem.MediaMessage -> prev.item.timestamp
                            is ChatItem.Pending -> prev.upload.timestamp
                        } else null
                        val showSep = curTs != null && (index == 0 || prevTs == null || !isSameDay(curTs, prevTs))
                        if (showSep && curTs != null) DateSeparator(curTs)

                        when (item) {
                            is ChatItem.TextMessage -> {
                                val message = item.message
                                val isMine = message.sender != null && message.sender == uiState.currentUsername
                                LaunchedEffect(message.id) {
                                    if (!message.read && !isMine) viewModel.markRead(message.id)
                                }
                                MessageBubble(
                                    message = message,
                                    isMine = isMine,
                                    decryptedText = uiState.decryptedTexts[message.id],
                                    onTapLocked = { unlockTarget = "msg_${message.id}" },
                                    currentUsername = uiState.currentUsername,
                                    isGroup = groupId != null,
                                    senderName = if (groupId != null && !isMine) message.sender else null,
                                    replyToMsg = message.replyToMessageId?.let { rid -> uiState.messages.find { it.id == rid } },
                                    onReact = { emoji -> viewModel.toggleReaction(message.id, emoji) },
                                    onReply = { viewModel.setReplyTarget(message) },
                                    onForward = { viewModel.setForwardTarget(message) },
                                    onPinToggle = { viewModel.togglePin(message) },
                                    onStar = { viewModel.toggleStar(message) },
                                    isStarred = uiState.starredIds.contains(message.id),
                                    onEdit = {
                                        viewModel.startEdit(
                                            message,
                                            onReady = { plaintext -> inputText = plaintext },
                                            onFail = { },
                                        )
                                    },
                                    onDelete = { viewModel.deleteMessage(message) },
                                )
                            }
                            is ChatItem.MediaMessage -> {
                                val mediaItem = item.item
                                val isMine = mediaItem.sender != null && mediaItem.sender == uiState.currentUsername
                                val isVoice = isVoiceMedia(mediaItem)
                                val isDocument = isDocumentMedia(mediaItem)
                                val mediaUnlocked = uiState.unlockedIds.contains("media_${mediaItem.mediaId}")
                                if (isDocument) {
                                    DocumentBubble(
                                        isMine = isMine,
                                        timestamp = mediaItem.timestamp,
                                        isUnlocked = mediaUnlocked,
                                        onOpen = { viewModel.openDocument(mediaItem.mediaId) },
                                        onLockTap = { unlockTarget = "media_${mediaItem.mediaId}" },
                                    )
                                } else {
                                    val imgKey = "img_${mediaItem.mediaId}"
                                    val localPath = uiState.localFilePaths[imgKey]
                                    if (!isVoice && localPath == null && mediaUnlocked) {
                                        LaunchedEffect(mediaItem.mediaId) {
                                            viewModel.downloadImageForDisplay(mediaItem.mediaId, context)
                                        }
                                    }
                                    val isThisPlaying = uiState.playingMediaId == mediaItem.mediaId
                                    // Prefer the real waveform once it's actually been fetched (the
                                    // user played it for real at least once); until then, the
                                    // pre-fetched decoy stands in — same as what tapping would show.
                                    val voiceWaveform = uiState.waveforms["real_${mediaItem.mediaId}"]
                                        ?: uiState.waveforms["fake_${mediaItem.mediaId}"]
                                    if (isVoice) {
                                        LaunchedEffect(mediaItem.mediaId) {
                                            viewModel.prefetchVoicePreview(mediaItem.mediaId, context)
                                        }
                                    }
                                    MediaBubble(
                                        item = mediaItem,
                                        isMine = isMine,
                                        isVoice = isVoice,
                                        isUnlocked = mediaUnlocked,
                                        isPlaying = isThisPlaying,
                                        localImagePath = if (!isVoice) localPath else null,
                                        waveform = voiceWaveform?.bars,
                                        positionMs = if (isThisPlaying) uiState.playbackPositionMs else 0,
                                        durationMs = voiceWaveform?.durationMs ?: 0,
                                        speed = uiState.playbackSpeed,
                                        onPlayTap = {
                                            if (isThisPlaying) {
                                                viewModel.stopPlayback()
                                            } else {
                                                viewModel.playMedia(mediaItem.mediaId, mediaUnlocked, context)
                                            }
                                        },
                                        onSeek = { ms -> if (isThisPlaying) viewModel.seekVoice(ms) },
                                        onSpeedTap = { viewModel.cyclePlaybackSpeed() },
                                        onImageTap = { path -> viewerImagePath = path },
                                        onLockTap = { unlockTarget = "media_${mediaItem.mediaId}" },
                                    )
                                }
                            }
                            is ChatItem.Pending -> PendingUploadBubble(item.upload)
                        }
                    }
                }
            }

            // Input area
            Surface(color = SurfaceWhite, shadowElevation = 4.dp) {
                if (uiState.isRecording) {
                    RecordingRow(
                        seconds = uiState.recordingSeconds,
                        onCancel = { viewModel.cancelRecording() },
                        onSend = { viewModel.stopAndSendRecording() },
                    )
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.Bottom,
                    ) {
                        // Attach button
                        if (groupId == null) {
                            IconButton(
                                onClick = { imagePicker.launch("*/*") },
                                modifier = Modifier.size(44.dp),
                            ) {
                                Icon(Icons.Default.AttachFile, "Attach", tint = TextSecondary)
                            }
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            // @mention dropdown
                            val mentionQuery = uiState.mentionQuery
                            if (groupId != null && mentionQuery != null) {
                                val filtered = uiState.groupMembers.filter {
                                    it.username != uiState.currentUsername &&
                                    it.username.contains(mentionQuery, ignoreCase = true)
                                }
                                if (filtered.isNotEmpty()) {
                                    Surface(
                                        shape = RoundedCornerShape(12.dp),
                                        color = Color(0xFF1A1A1A),
                                        shadowElevation = 8.dp,
                                        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
                                    ) {
                                        Column {
                                            filtered.forEach { member ->
                                                Row(
                                                    modifier = Modifier
                                                        .fillMaxWidth()
                                                        .clickable {
                                                            viewModel.setTaggedUser(member.username)
                                                            inputText = inputText.replace(Regex("@\\w*$"), "")
                                                        }
                                                        .padding(horizontal = 14.dp, vertical = 10.dp),
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                                ) {
                                                    Text("@", color = Color(0xFFA78BFA), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                                    Text(member.username, color = Color(0xFFF1F5F9), fontSize = 14.sp)
                                                    Spacer(Modifier.weight(1f))
                                                    Text(member.role, color = TextSecondary, fontSize = 11.sp)
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            // Reply / edit banner
                            if (uiState.replyTarget != null || uiState.editingMessage != null) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(bottom = 6.dp)
                                        .background(Color(0xFF1A1A1A), RoundedCornerShape(8.dp))
                                        .padding(horizontal = 10.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            if (uiState.editingMessage != null) "Editing message" else "Replying to ${uiState.replyTarget?.sender}",
                                            color = DilarionRed, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                                        )
                                        uiState.replyTarget?.let {
                                            Text(it.decoyContent ?: "…", color = TextSecondary, fontSize = 12.sp, maxLines = 1)
                                        }
                                    }
                                    IconButton(onClick = { viewModel.cancelComposerAction(); inputText = "" }, modifier = Modifier.size(20.dp)) {
                                        Icon(Icons.Default.Close, null, tint = TextSecondary, modifier = Modifier.size(14.dp))
                                    }
                                }
                            }
                            // Tagged chip
                            if (uiState.taggedUser != null) {
                                Row(
                                    modifier = Modifier.padding(bottom = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Surface(
                                        color = Color(0xFF1E1A2E),
                                        shape = RoundedCornerShape(8.dp),
                                        border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF4C1D95)),
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                                        ) {
                                            Icon(Icons.Default.Lock, null, tint = Color(0xFFA78BFA), modifier = Modifier.size(10.dp))
                                            Text("Private → @${uiState.taggedUser}", color = Color(0xFFA78BFA), fontSize = 12.sp, fontWeight = FontWeight.Medium)
                                        }
                                    }
                                    IconButton(onClick = { viewModel.setTaggedUser(null) }, modifier = Modifier.size(20.dp)) {
                                        Icon(Icons.Default.Close, null, tint = TextSecondary, modifier = Modifier.size(14.dp))
                                    }
                                }
                            }
                            OutlinedTextField(
                                value = inputText,
                                onValueChange = { v ->
                                    inputText = v
                                    if (groupId != null) {
                                        val match = Regex("@(\\w*)$").find(v)
                                        viewModel.setMentionQuery(match?.groupValues?.get(1)?.lowercase())
                                    }
                                },
                                placeholder = {
                                    Text(
                                        if (uiState.taggedUser != null) "Private to @${uiState.taggedUser}…" else if (groupId != null) "Message or @ to tag…" else "Message",
                                        color = TextSecondary,
                                    )
                                },
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(24.dp),
                                maxLines = 5,
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = if (uiState.taggedUser != null) Color(0xFF7C3AED) else DilarionRed,
                                    unfocusedBorderColor = if (uiState.taggedUser != null) Color(0xFF4C1D95) else BorderGrey,
                                ),
                            )
                        }
                        Spacer(Modifier.width(6.dp))
                        if (inputText.isNotBlank()) {
                            IconButton(
                                onClick = { viewModel.sendMessage(inputText); inputText = ""; viewModel.setMentionQuery(null) },
                                enabled = !uiState.isSending,
                                modifier = Modifier.size(48.dp).clip(CircleShape).background(DilarionRed),
                            ) {
                                if (uiState.isSending) {
                                    CircularProgressIndicator(Modifier.size(20.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                } else {
                                    Icon(Icons.Default.Send, "Send", tint = SurfaceWhite)
                                }
                            }
                        } else if (groupId == null) {
                            IconButton(
                                onClick = { audioPermission.launch(Manifest.permission.RECORD_AUDIO) },
                                modifier = Modifier.size(48.dp).clip(CircleShape).background(BorderGrey),
                            ) {
                                Icon(Icons.Default.Mic, "Record", tint = TextSecondary)
                            }
                        }
                    }
                    if (uiState.isUploadingMedia) {
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth(),
                            color = DilarionRed,
                        )
                    }
                }
            }
        }
        } // Box
    }
}

@Composable
private fun RecordingRow(seconds: Int, onCancel: () -> Unit, onSend: () -> Unit) {
    val infiniteTransition = rememberInfiniteTransition(label = "rec")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = 0.2f,
        animationSpec = infiniteRepeatable(tween(600), RepeatMode.Reverse),
        label = "dot",
    )
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(DilarionRed.copy(alpha = alpha)))
        Spacer(Modifier.width(8.dp))
        Text(
            "Recording %02d:%02d".format(seconds / 60, seconds % 60),
            color = TextPrimary,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onCancel) {
            Icon(Icons.Default.Close, "Cancel", tint = TextSecondary)
        }
        IconButton(
            onClick = onSend,
            modifier = Modifier.size(44.dp).clip(CircleShape).background(DilarionRed),
        ) {
            Icon(Icons.Default.Send, "Send", tint = SurfaceWhite)
        }
    }
}

private fun formatVoiceTime(ms: Int): String {
    val totalSec = (ms / 1000).coerceAtLeast(0)
    val m = totalSec / 60
    val s = totalSec % 60
    return "%d:%02d".format(m, s)
}

/**
 * WhatsApp-style voice message: play/pause circle, a waveform built from the
 * actual recording's amplitude (not decorative bars) with a progress-through-
 * waveform scrubber you can drag to seek, elapsed/total duration, a cyclable
 * playback speed pill, and a small avatar-with-mic badge like WhatsApp uses
 * to show whose voice it is. `waveform`/`durationMs` come from whichever of
 * decoy or real audio has actually been fetched — see ChatViewModel's
 * prefetchVoicePreview/ensureWaveform. Locked bubbles still play (the decoy)
 * on tap; the lock only gates the real audio, never whether something plays.
 */
@Composable
private fun VoiceMessageBubble(
    isMine: Boolean,
    isPlaying: Boolean,
    isUnlocked: Boolean,
    sender: String,
    waveform: List<Float>?,
    positionMs: Int,
    durationMs: Int,
    speed: Float,
    onPlayTap: () -> Unit,
    onSeek: (Int) -> Unit,
    onSpeedTap: () -> Unit,
    onLockTap: () -> Unit,
) {
    val bars = waveform ?: List(40) { 0.3f }
    val progress = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f
    val playedColor = if (isMine) SurfaceWhite else DilarionRed
    val unplayedColor = if (isMine) SurfaceWhite.copy(alpha = 0.4f) else DilarionRed.copy(alpha = 0.3f)

    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp).widthIn(min = 220.dp)) {
        IconButton(onClick = onPlayTap, modifier = Modifier.size(38.dp)) {
            Box(
                Modifier.size(34.dp).clip(CircleShape).background(if (isMine) SurfaceWhite.copy(alpha = 0.25f) else DilarionRed.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    "Play",
                    tint = if (isMine) SurfaceWhite else DilarionRed,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Spacer(Modifier.width(4.dp))

        Column(Modifier.weight(1f)) {
            var boxWidthPx by remember { mutableStateOf(0f) }
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(28.dp)
                    .onGloballyPositioned { boxWidthPx = it.size.width.toFloat() }
                    .pointerInput(durationMs) {
                        if (durationMs <= 0) return@pointerInput
                        detectTapGestures { offset ->
                            onSeek(((offset.x / boxWidthPx).coerceIn(0f, 1f) * durationMs).toInt())
                        }
                    }
                    .pointerInput(durationMs) {
                        if (durationMs <= 0) return@pointerInput
                        detectDragGestures { change, _ ->
                            onSeek(((change.position.x / boxWidthPx).coerceIn(0f, 1f) * durationMs).toInt())
                        }
                    },
                contentAlignment = Alignment.CenterStart,
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                    bars.forEachIndexed { i, amp ->
                        val played = i.toFloat() / bars.size < progress
                        Box(
                            Modifier
                                .weight(1f)
                                .height((6 + amp * 18).dp)
                                .clip(RoundedCornerShape(2.dp))
                                .background(if (played) playedColor else unplayedColor)
                        )
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Text(
                    formatVoiceTime(if (isPlaying || positionMs > 0) positionMs else durationMs),
                    fontSize = 11.sp,
                    color = if (isMine) SurfaceWhite.copy(alpha = 0.85f) else TextSecondary,
                )
                if (durationMs > 0) {
                    Text(
                        "${if (speed == speed.toInt().toFloat()) speed.toInt().toString() else speed.toString()}x",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isMine) SurfaceWhite.copy(alpha = 0.85f) else TextSecondary,
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .clickable(onClick = onSpeedTap)
                            .padding(horizontal = 4.dp),
                    )
                }
            }
        }

        Spacer(Modifier.width(6.dp))
        Box {
            SenderAvatar(sender)
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .size(14.dp)
                    .clip(CircleShape)
                    .background(if (isMine) ChatBubbleSelf else ChatBubbleOther),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Default.Mic, null, tint = DilarionRed, modifier = Modifier.size(9.dp))
            }
        }
        if (!isUnlocked) {
            Spacer(Modifier.width(4.dp))
            IconButton(onClick = onLockTap, modifier = Modifier.size(24.dp)) {
                Icon(Icons.Default.Lock, "Unlock real audio", tint = if (isMine) SurfaceWhite.copy(alpha = 0.85f) else TextSecondary, modifier = Modifier.size(14.dp))
            }
        }
    }
}

@Composable
private fun MediaBubble(
    item: MediaItem,
    isMine: Boolean,
    isVoice: Boolean,
    isUnlocked: Boolean,
    isPlaying: Boolean,
    localImagePath: String?,
    waveform: List<Float>?,
    positionMs: Int,
    durationMs: Int,
    speed: Float,
    onPlayTap: () -> Unit,
    onSeek: (Int) -> Unit,
    onSpeedTap: () -> Unit,
    onImageTap: (String) -> Unit,
    onLockTap: () -> Unit,
) {
    val bubbleColor = if (isMine) ChatBubbleSelf else ChatBubbleOther
    val bubbleShape = if (isMine) {
        RoundedCornerShape(topStart = 18.dp, topEnd = 4.dp, bottomStart = 18.dp, bottomEnd = 18.dp)
    } else {
        RoundedCornerShape(topStart = 4.dp, topEnd = 18.dp, bottomStart = 18.dp, bottomEnd = 18.dp)
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 260.dp)
                .clip(bubbleShape)
                .background(bubbleColor)
                .padding(8.dp),
        ) {
            if (isVoice) {
                VoiceMessageBubble(
                    isMine = isMine,
                    isPlaying = isPlaying,
                    isUnlocked = isUnlocked,
                    sender = item.sender ?: "?",
                    waveform = waveform,
                    positionMs = positionMs,
                    durationMs = durationMs,
                    speed = speed,
                    onPlayTap = onPlayTap,
                    onSeek = onSeek,
                    onSpeedTap = onSpeedTap,
                    onLockTap = onLockTap,
                )
            } else {
                // Image
                if (!isUnlocked) {
                    // Locked — show placeholder icon only, never load real content
                    Box(
                        Modifier
                            .size(width = 160.dp, height = 110.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(BorderGrey)
                            .clickable { onLockTap() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.Image, null, tint = TextSecondary, modifier = Modifier.size(36.dp))
                            Spacer(Modifier.height(4.dp))
                            Icon(Icons.Default.Lock, null, tint = DilarionRed, modifier = Modifier.size(14.dp))
                        }
                    }
                } else if (localImagePath != null) {
                    AsyncImage(
                        model = ImageRequest.Builder(LocalContext.current)
                            .data(File(localImagePath))
                            .crossfade(true)
                            .build(),
                        contentDescription = "Image",
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 200.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { onImageTap(localImagePath) },
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    // Unlocked but still downloading
                    Box(
                        Modifier.size(width = 200.dp, height = 140.dp).clip(RoundedCornerShape(12.dp)).background(BorderGrey),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(Modifier.size(24.dp), color = DilarionRed, strokeWidth = 2.dp)
                    }
                }
            }
            Spacer(Modifier.height(2.dp))
            Text(
                formatTimestamp(item.timestamp ?: ""),
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary,
                modifier = Modifier.align(Alignment.End).padding(end = 4.dp),
            )
        }
    }
}

// ── DocumentBubble ────────────────────────────────────────────────────────────

/**
 * A document attachment. Tapping it always opens something — the generated
 * decoy while locked, the real file once the screen is unlocked — so it must
 * look identical in both states; nothing here may hint that a decoy exists.
 * The small lock icon (matching the voice-note bubble) is the only way to
 * trigger the master-token dialog, kept separate from the open action itself.
 */
@Composable
private fun DocumentBubble(
    isMine: Boolean,
    timestamp: String?,
    isUnlocked: Boolean,
    onOpen: () -> Unit,
    onLockTap: () -> Unit,
) {
    val bubbleColor = if (isMine) ChatBubbleSelf else ChatBubbleOther
    val bubbleShape = if (isMine) {
        RoundedCornerShape(topStart = 18.dp, topEnd = 4.dp, bottomStart = 18.dp, bottomEnd = 18.dp)
    } else {
        RoundedCornerShape(topStart = 4.dp, topEnd = 18.dp, bottomStart = 18.dp, bottomEnd = 18.dp)
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 260.dp)
                .clip(bubbleShape)
                .background(bubbleColor)
                .padding(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
                IconButton(onClick = onOpen, modifier = Modifier.size(36.dp)) {
                    Icon(Icons.Default.Description, "Open document", tint = DilarionRed, modifier = Modifier.size(24.dp))
                }
                Spacer(Modifier.width(4.dp))
                Text("Tap to open", style = MaterialTheme.typography.bodySmall, color = TextSecondary, modifier = Modifier.weight(1f))
                if (!isUnlocked) {
                    IconButton(onClick = onLockTap, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.Lock, "Unlock real document", tint = TextSecondary, modifier = Modifier.size(16.dp))
                    }
                }
            }
            Spacer(Modifier.height(2.dp))
            Text(
                formatTimestamp(timestamp ?: ""),
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary,
                modifier = Modifier.align(Alignment.End).padding(end = 4.dp),
            )
        }
    }
}

// WhatsApp-style optimistic "sending…" bubble — appears the instant an
// upload starts, in the exact spot the real bubble will land.
@Composable
private fun PendingUploadBubble(upload: PendingUpload) {
    val bubbleShape = RoundedCornerShape(topStart = 18.dp, topEnd = 4.dp, bottomStart = 18.dp, bottomEnd = 18.dp)
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .widthIn(min = 160.dp, max = 240.dp)
                .clip(bubbleShape)
                .background(ChatBubbleSelf.copy(alpha = 0.6f))
                .padding(8.dp),
        ) {
            val icon = when (upload.kind) {
                PendingUploadKind.IMAGE -> Icons.Default.Image
                PendingUploadKind.DOCUMENT -> Icons.Default.Description
                PendingUploadKind.VOICE -> Icons.Default.GraphicEq
            }
            Icon(icon, null, tint = TextSecondary, modifier = Modifier.size(28.dp))
            Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(upload.filename, style = MaterialTheme.typography.bodySmall, color = TextPrimary, maxLines = 1)
                Text("Sending…", style = MaterialTheme.typography.labelSmall, color = TextSecondary)
            }
            Spacer(Modifier.width(8.dp))
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = DilarionRed)
        }
    }
}

// ── Document viewer (in-app, no disk) ────────────────────────────────────────

/**
 * Renders a PDF from an in-memory byte array — shown in-app, never handed to an
 * external viewer. android.graphics.pdf.PdfRenderer requires a seekable file
 * descriptor (a plain in-memory pipe isn't seekable, so that's not an option),
 * so this opens a fd on a temp file and unlinks it immediately — the open fd
 * keeps the data readable for PdfRenderer, but no path to it exists on disk
 * beyond the instant between create and delete, so nothing else (other apps,
 * a file browser, a crash dump) can ever see or open it.
 */
@Composable
private fun DocumentViewerDialog(bytes: ByteArray, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var pages by remember { mutableStateOf<List<android.graphics.Bitmap>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(bytes) {
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val tmp = File.createTempFile("docpreview", ".pdf", context.cacheDir)
                tmp.writeBytes(bytes)
                val pfd = try {
                    android.os.ParcelFileDescriptor.open(tmp, android.os.ParcelFileDescriptor.MODE_READ_ONLY)
                } finally {
                    tmp.delete()
                }
                val renderer = android.graphics.pdf.PdfRenderer(pfd)
                val bitmaps = buildList {
                    for (i in 0 until renderer.pageCount) {
                        renderer.openPage(i).use { page ->
                            val bmp = android.graphics.Bitmap.createBitmap(
                                page.width * 2, page.height * 2, android.graphics.Bitmap.Config.ARGB_8888,
                            )
                            bmp.eraseColor(android.graphics.Color.WHITE)
                            page.render(bmp, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            add(bmp)
                        }
                    }
                }
                renderer.close()
                pfd.close()
                bitmaps
            }
        }
        result.onSuccess { pages = it }.onFailure { error = it.message ?: "Could not open document" }
        loading = false
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xFF1C1C1E))) {
            when {
                loading -> CircularProgressIndicator(Modifier.align(Alignment.Center), color = SurfaceWhite)
                error != null -> Text(error ?: "", color = Color(0xFFEF4444), modifier = Modifier.align(Alignment.Center).padding(24.dp))
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(pages) { bmp ->
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = "Document page",
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)),
                            contentScale = ContentScale.FillWidth,
                        )
                    }
                }
            }
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .statusBarsPadding()
                    .padding(12.dp)
                    .background(Color.White.copy(alpha = 0.15f), CircleShape),
            ) {
                Icon(Icons.Default.Close, "Close", tint = Color.White)
            }
        }
    }
}

// ── Full-screen image viewer (WhatsApp-style) ────────────────────────────────

@Composable
private fun FullScreenImageViewer(imagePath: String, onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        var scale by remember { mutableFloatStateOf(1f) }
        var offset by remember { mutableStateOf(Offset.Zero) }

        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black)
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        scale = (scale * zoom).coerceIn(1f, 5f)
                        offset = if (scale > 1f) offset + pan else Offset.Zero
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(
                        onDoubleTap = {
                            if (scale > 1f) { scale = 1f; offset = Offset.Zero }
                            else scale = 2.5f
                        },
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            AsyncImage(
                model = ImageRequest.Builder(LocalContext.current)
                    .data(File(imagePath))
                    .build(),
                contentDescription = "Image",
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer(
                        scaleX = scale,
                        scaleY = scale,
                        translationX = offset.x,
                        translationY = offset.y,
                    ),
                contentScale = ContentScale.Fit,
            )
            IconButton(
                onClick = onDismiss,
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .statusBarsPadding()
                    .padding(12.dp)
                    .background(Color.White.copy(alpha = 0.15f), CircleShape),
            ) {
                Icon(Icons.Default.Close, "Close", tint = Color.White)
            }
        }
    }
}

@Composable
private fun UnlockDialog(
    error: String?,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
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
                    "Enter your master token to reveal real message content.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                )
                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it },
                    label = { Text("Master Token") },
                    leadingIcon = { Icon(Icons.Default.Key, null, tint = DilarionRed) },
                    trailingIcon = {
                        IconButton(onClick = { visible = !visible }) {
                            Icon(if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility, null)
                        }
                    },
                    visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DilarionRed),
                    modifier = Modifier.fillMaxWidth(),
                    isError = error != null,
                    supportingText = error?.let { { Text(it, color = MaterialTheme.colorScheme.error) } },
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(token) },
                enabled = token.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
            ) { Text("Unlock") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun DecoyKindDialog(
    onPick: (String?) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Description, null, tint = DilarionRed) },
        title = { Text("Decoy for this file", textAlign = TextAlign.Center) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                DECOY_KIND_LABELS.forEach { (kind, label) ->
                    TextButton(onClick = { onPick(kind) }, modifier = Modifier.fillMaxWidth()) {
                        Text(label, modifier = Modifier.weight(1f), textAlign = TextAlign.Start)
                    }
                }
                TextButton(onClick = { onPick(null) }, modifier = Modifier.fillMaxWidth()) {
                    Text("Random", modifier = Modifier.weight(1f), textAlign = TextAlign.Start)
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private val AVATAR_COLORS = listOf(
    Color(0xFF7C3AED), Color(0xFF0891B2), Color(0xFF059669),
    Color(0xFFD97706), Color(0xFFC0392B), Color(0xFFDB2777),
)

private fun avatarColorFor(username: String): Color =
    AVATAR_COLORS[username.hashCode().mod(AVATAR_COLORS.size).let { if (it < 0) it + AVATAR_COLORS.size else it }]

private fun usernameInitials(name: String): String =
    name.split(Regex("[\\s_\\-]+"))
        .filter { it.isNotEmpty() }
        .take(2)
        .joinToString("") { it[0].uppercase() }
        .ifEmpty { name.take(2).uppercase() }

@Composable
private fun SenderAvatar(username: String) {
    Box(
        modifier = Modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(avatarColorFor(username)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            usernameInitials(username),
            color = Color.White,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

private val CHAT_REACTION_EMOJIS = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

@Composable
private fun ChatReactionPills(reactions: List<com.dilarion.app.data.model.MessageReaction>?, onToggle: (String) -> Unit) {
    if (reactions.isNullOrEmpty()) return
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(top = 4.dp)) {
        reactions.forEach { r ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (r.reactedByMe) DilarionRed else Color(0xFF2A2A32))
                    .clickable { onToggle(r.emoji) }
                    .padding(horizontal = 7.dp, vertical = 1.dp),
            ) {
                Text(r.emoji, fontSize = 12.sp)
                Spacer(Modifier.width(3.dp))
                Text("${r.count}", fontSize = 11.sp, color = SurfaceWhite)
            }
        }
    }
}

/** Real icon for every action except the reaction choices themselves, which
 * stay actual emoji — matches WhatsApp: the row of emoji is emoji, the menu
 * wrapping it is icons. Long-press shows the reaction row and the menu list
 * together (WhatsApp's mobile pattern), unlike a hover-only chevron trigger
 * which wouldn't make sense on touch. */
@Composable
private fun MessageActionsPopup(
    isMine: Boolean,
    isPinned: Boolean,
    isStarred: Boolean,
    onDismiss: () -> Unit,
    onReact: (String) -> Unit,
    onReply: () -> Unit,
    onForward: () -> Unit,
    onCopy: () -> Unit,
    onInfo: () -> Unit,
    onPinToggle: () -> Unit,
    onStarToggle: () -> Unit,
    onEdit: (() -> Unit)?,
    onDelete: (() -> Unit)?,
) {
    androidx.compose.ui.window.Popup(
        alignment = Alignment.Center,
        onDismissRequest = onDismiss,
        properties = androidx.compose.ui.window.PopupProperties(focusable = true),
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // Reaction row
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color(0xFF2A2A32))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                CHAT_REACTION_EMOJIS.forEach { e ->
                    Text(
                        e, fontSize = 20.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .clickable { onReact(e); onDismiss() }
                            .padding(6.dp),
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            // Action list
            Column(
                modifier = Modifier
                    .width(200.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0xFF1E1E24)),
            ) {
                ActionRow(Icons.Default.Reply, "Reply") { onReply(); onDismiss() }
                ActionRow(Icons.Default.Forward, "Forward") { onForward(); onDismiss() }
                ActionRow(Icons.Default.ContentCopy, "Copy") { onCopy(); onDismiss() }
                ActionRow(Icons.Default.Info, "Info") { onInfo(); onDismiss() }
                ActionRow(if (isStarred) Icons.Default.Star else Icons.Default.StarBorder, if (isStarred) "Unstar" else "Star") { onStarToggle(); onDismiss() }
                ActionRow(Icons.Default.PushPin, if (isPinned) "Unpin" else "Pin") { onPinToggle(); onDismiss() }
                if (isMine && onEdit != null) ActionRow(Icons.Default.Edit, "Edit") { onEdit(); onDismiss() }
                if (isMine && onDelete != null) ActionRow(Icons.Default.Delete, "Delete", danger = true) { onDelete(); onDismiss() }
            }
        }
    }
}

@Composable
private fun ActionRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, danger: Boolean = false, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, null, tint = if (danger) Color(0xFFEF4444) else SurfaceWhite, modifier = Modifier.size(19.dp))
        Text(label, color = if (danger) Color(0xFFEF4444) else SurfaceWhite, fontSize = 14.sp)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageBubble(
    message: Message,
    isMine: Boolean,
    decryptedText: String?,
    onTapLocked: () -> Unit,
    currentUsername: String = "",
    isGroup: Boolean = false,
    senderName: String? = null,
    replyToMsg: Message? = null,
    onReact: (String) -> Unit = {},
    onReply: () -> Unit = {},
    onForward: () -> Unit = {},
    onPinToggle: () -> Unit = {},
    onStar: () -> Unit = {},
    onEdit: () -> Unit = {},
    onDelete: () -> Unit = {},
    isStarred: Boolean = false,
) {
    var showMenu by remember { mutableStateOf(false) }
    var showInfo by remember { mutableStateOf(false) }
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current

    if (showInfo) {
        AlertDialog(
            onDismissRequest = { showInfo = false },
            confirmButton = { TextButton(onClick = { showInfo = false }) { Text("Close") } },
            title = { Text("Message info") },
            text = {
                Column {
                    Text("Sent: ${formatTimestamp(message.timestamp ?: "")}")
                    Text("Delivered: ${if (message.delivered) "Yes" else "No"}")
                    Text("Read: ${if (message.read) "Yes" else "No"}")
                    if (message.isEdited) Text("Edited")
                }
            },
        )
    }

    if (message.isDeleted) {
        Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = if (isMine) Alignment.End else Alignment.Start) {
            Box(
                modifier = Modifier
                    .widthIn(max = 260.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color.Transparent)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text("This message was deleted", color = TextSecondary, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic, style = MaterialTheme.typography.bodySmall)
            }
        }
        return
    }

    val isPrivateTagged = message.contentType == "private_tagged"
    // Older/other backends don't always tag content_type="encrypted"; treat the
    // presence of an encrypted key or an unreadable payload as locked too.
    val isEncrypted = message.contentType == "encrypted" ||
            message.encryptedKey != null ||
            message.iv != null
    val hasRecipient = !message.recipient.isNullOrBlank() && message.recipient != "group"
    val isForMe = hasRecipient && message.recipient == currentUsername
    val privatePurple = Color(0xFFA78BFA)
    val showDecoy = decryptedText == null && (isEncrypted || looksLikeCiphertext(message.content))

    val bubbleColor = when {
        isPrivateTagged -> Color(0xFF1A1020)
        isMine -> ChatBubbleSelf
        else -> ChatBubbleOther
    }
    val bubbleShape = if (isMine) {
        RoundedCornerShape(topStart = 18.dp, topEnd = 4.dp, bottomStart = 18.dp, bottomEnd = 18.dp)
    } else {
        RoundedCornerShape(topStart = 4.dp, topEnd = 18.dp, bottomStart = 18.dp, bottomEnd = 18.dp)
    }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = if (isMine) Alignment.End else Alignment.Start,
    ) {
        if (!isMine && hasRecipient && !isPrivateTagged) {
            Text(
                "→ @${message.recipient}",
                style = MaterialTheme.typography.labelSmall,
                color = privatePurple,
                modifier = Modifier.padding(start = if (isGroup) 44.dp else 4.dp, bottom = 2.dp),
            )
        }
        if (isMine && hasRecipient && !isPrivateTagged) {
            Text(
                "→ @${message.recipient}",
                style = MaterialTheme.typography.labelSmall,
                color = privatePurple,
                modifier = Modifier.padding(end = 4.dp, bottom = 2.dp),
            )
        }
        if (isForMe && !isMine) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(start = if (isGroup) 44.dp else 4.dp, bottom = 2.dp),
            ) {
                Icon(Icons.Default.Lock, null, tint = privatePurple, modifier = Modifier.size(10.dp))
                Spacer(Modifier.width(3.dp))
                Text("Only you can read this", style = MaterialTheme.typography.labelSmall, color = privatePurple)
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
            verticalAlignment = Alignment.Bottom,
        ) {
            // Sender avatar for group received messages
            if (isGroup && !isMine) {
                SenderAvatar(username = senderName ?: "?")
                Spacer(Modifier.width(6.dp))
            } else if (isGroup && isMine) {
                // spacer to align mine bubbles
            }
            Column(horizontalAlignment = if (isMine) Alignment.End else Alignment.Start) {
                // Sender name for group received messages
                if (isGroup && !isMine && senderName != null) {
                    Text(
                        senderName,
                        style = MaterialTheme.typography.labelSmall,
                        color = avatarColorFor(senderName),
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(start = 4.dp, bottom = 2.dp),
                    )
                }
                if (message.forwardedFromMessageId != null) {
                    Text(
                        "Forwarded", style = MaterialTheme.typography.labelSmall,
                        color = TextSecondary, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic,
                        modifier = Modifier.padding(bottom = 2.dp),
                    )
                }
                if (replyToMsg != null) {
                    Column(
                        modifier = Modifier
                            .widthIn(max = 220.dp)
                            .padding(bottom = 3.dp)
                            .background(Color.Transparent),
                    ) {
                        Text(replyToMsg.sender ?: "", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = DilarionRed)
                        Text(
                            if (replyToMsg.isDeleted) "Message deleted" else (replyToMsg.decoyContent ?: "…"),
                            style = MaterialTheme.typography.labelSmall, color = TextSecondary, maxLines = 1,
                        )
                    }
                }
                Box {
                    Column(
                        modifier = Modifier
                            .widthIn(max = 260.dp)
                            .clip(bubbleShape)
                            .background(bubbleColor)
                            .combinedClickable(
                                onClick = { if (!isPrivateTagged && isEncrypted && decryptedText == null) onTapLocked() },
                                onLongClick = { showMenu = true },
                            )
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                    ) {
                    if (isPrivateTagged) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(Icons.Default.Lock, null, tint = privatePurple, modifier = Modifier.size(14.dp))
                            Text(
                                "Private message for @${message.recipient}",
                                color = privatePurple,
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                    } else if (showDecoy) {
                        Text(
                            decoyTextFor(message),
                            color = TextPrimary.copy(alpha = 0.65f),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    } else {
                        Text(decryptedText ?: message.content ?: "", color = TextPrimary, style = MaterialTheme.typography.bodyMedium)
                    }
                    Spacer(Modifier.height(2.dp))
                    Row(
                        modifier = Modifier.align(Alignment.End),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        if (message.isPinned) Text("📌", fontSize = 10.sp)
                        if (message.isEdited) {
                            Text("edited", style = MaterialTheme.typography.labelSmall, color = TextSecondary, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)
                        }
                        Text(
                            formatTimestamp(message.timestamp ?: ""),
                            style = MaterialTheme.typography.labelSmall,
                            color = TextSecondary,
                        )
                        if (isMine) {
                            when {
                                message.id < 0 -> Icon(
                                    Icons.Default.AccessTime, null,
                                    modifier = Modifier.size(11.dp), tint = TextSecondary.copy(alpha = 0.6f),
                                )
                                message.read -> Icon(
                                    Icons.Default.DoneAll, null,
                                    modifier = Modifier.size(14.dp), tint = Color(0xFFEF4444),
                                )
                                else -> Icon(
                                    Icons.Default.Done, null,
                                    modifier = Modifier.size(14.dp), tint = TextSecondary,
                                )
                            }
                        }
                    }
                    }
                    if (showMenu) {
                        MessageActionsPopup(
                            isMine = isMine,
                            isPinned = message.isPinned,
                            isStarred = isStarred,
                            onDismiss = { showMenu = false },
                            onReact = onReact,
                            onReply = onReply,
                            onForward = onForward,
                            onCopy = {
                                val text = decryptedText ?: message.content?.takeIf { !isEncrypted && !looksLikeCiphertext(it) }
                                if (text != null) clipboard.setText(androidx.compose.ui.text.AnnotatedString(text))
                            },
                            onInfo = { showInfo = true },
                            onPinToggle = onPinToggle,
                            onStarToggle = onStar,
                            onEdit = if (isMine) onEdit else null,
                            onDelete = if (isMine) onDelete else null,
                        )
                    }
                }
                ChatReactionPills(message.reactions, onReact)
            }
        }
    }
}

private fun formatTimestamp(iso: String): String = runCatching {
    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(sdf.parse(iso)!!)
}.getOrElse { "" }

private fun isSameDay(iso1: String, iso2: String): Boolean =
    iso1.take(10) == iso2.take(10)

private fun formatDateLabel(iso: String): String = runCatching {
    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
    val date = sdf.parse(iso) ?: return@runCatching ""
    val cal = java.util.Calendar.getInstance().apply { time = date }
    val today = java.util.Calendar.getInstance()
    val yesterday = java.util.Calendar.getInstance().apply { add(java.util.Calendar.DATE, -1) }
    when {
        cal.get(java.util.Calendar.YEAR) == today.get(java.util.Calendar.YEAR) &&
        cal.get(java.util.Calendar.DAY_OF_YEAR) == today.get(java.util.Calendar.DAY_OF_YEAR) -> "Today"
        cal.get(java.util.Calendar.YEAR) == yesterday.get(java.util.Calendar.YEAR) &&
        cal.get(java.util.Calendar.DAY_OF_YEAR) == yesterday.get(java.util.Calendar.DAY_OF_YEAR) -> "Yesterday"
        else -> SimpleDateFormat("EEEE, d MMMM", Locale.getDefault()).format(date)
    }
}.getOrElse { "" }

@Composable
private fun DateSeparator(timestamp: String) {
    val label = remember(timestamp) { formatDateLabel(timestamp) }
    if (label.isEmpty()) return
    Box(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = TextSecondary,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 0.5.sp,
            modifier = Modifier
                .background(BorderGrey.copy(alpha = 0.55f), RoundedCornerShape(12.dp))
                .padding(horizontal = 14.dp, vertical = 5.dp),
        )
    }
}
