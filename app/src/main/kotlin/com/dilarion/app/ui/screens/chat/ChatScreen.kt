package com.dilarion.app.ui.screens.chat

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
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
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.dilarion.app.data.model.MediaItem
import com.dilarion.app.data.model.Message
import com.dilarion.app.ui.theme.*
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

private fun isVoiceMedia(item: MediaItem): Boolean =
    item.contentType?.contains("voice", ignoreCase = true) == true ||
            item.mediaType.contains("voice", ignoreCase = true) ||
            item.filename.endsWith(".mp4") && item.mediaType.contains("audio", ignoreCase = true)

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
    var showUnlockDialog by remember { mutableStateOf(false) }
    var unlockError by remember { mutableStateOf<String?>(null) }
    var viewerImagePath by remember { mutableStateOf<String?>(null) }

    val combinedItems = remember(uiState.messages, uiState.mediaItems) {
        viewModel.getCombinedItems()
    }

    val displayName = if (groupId != null) (groupName ?: "Group") else username

    LaunchedEffect(combinedItems.size) {
        if (combinedItems.isNotEmpty()) listState.animateScrollToItem(combinedItems.size - 1)
    }

    // Image picker
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) viewModel.sendImage(uri, context)
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

    if (showUnlockDialog) {
        UnlockDialog(
            error = unlockError,
            onDismiss = { showUnlockDialog = false; unlockError = null },
            onConfirm = { token ->
                val ok = viewModel.unlock(token)
                if (ok) { showUnlockDialog = false; unlockError = null }
                else unlockError = "Incorrect master token"
            },
        )
    }

    viewerImagePath?.let { path ->
        FullScreenImageViewer(imagePath = path, onDismiss = { viewerImagePath = null })
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
                    IconButton(onClick = { if (!uiState.isUnlocked) showUnlockDialog = true }) {
                        Icon(
                            if (uiState.isUnlocked) Icons.Default.LockOpen else Icons.Default.Lock,
                            contentDescription = if (uiState.isUnlocked) "Unlocked" else "Unlock",
                            tint = SurfaceWhite,
                        )
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
            if (!uiState.isUnlocked && combinedItems.isNotEmpty()) {
                Surface(color = DilarionRed.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier.clickable { showUnlockDialog = true }.padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        Icon(Icons.Default.Lock, null, modifier = Modifier.size(14.dp), tint = DilarionRed)
                        Spacer(Modifier.width(6.dp))
                        Text("Tap to unlock messages with master token", fontSize = 12.sp, color = DilarionRed, fontWeight = FontWeight.Medium)
                    }
                }
            }

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
                            }
                        }
                    ) { index, item ->
                        val curTs = when (item) {
                            is ChatItem.TextMessage -> item.message.timestamp
                            is ChatItem.MediaMessage -> item.item.timestamp
                        }
                        val prevTs = if (index > 0) when (val prev = combinedItems[index - 1]) {
                            is ChatItem.TextMessage -> prev.message.timestamp
                            is ChatItem.MediaMessage -> prev.item.timestamp
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
                                    isUnlocked = uiState.isUnlocked,
                                    onTapLocked = { showUnlockDialog = true },
                                    currentUsername = uiState.currentUsername,
                                    isGroup = groupId != null,
                                    senderName = if (groupId != null && !isMine) message.sender else null,
                                )
                            }
                            is ChatItem.MediaMessage -> {
                                val mediaItem = item.item
                                val isMine = mediaItem.sender != null && mediaItem.sender == uiState.currentUsername
                                val isVoice = isVoiceMedia(mediaItem)
                                val imgKey = "img_${mediaItem.mediaId}"
                                val localPath = uiState.localFilePaths[imgKey]
                                if (!isVoice && localPath == null && uiState.isUnlocked) {
                                    LaunchedEffect(mediaItem.mediaId) {
                                        viewModel.downloadImageForDisplay(mediaItem.mediaId, context)
                                    }
                                }
                                MediaBubble(
                                    item = mediaItem,
                                    isMine = isMine,
                                    isVoice = isVoice,
                                    isUnlocked = uiState.isUnlocked,
                                    isPlaying = uiState.playingMediaId == mediaItem.mediaId,
                                    localImagePath = if (!isVoice) localPath else null,
                                    onPlayTap = {
                                        if (uiState.playingMediaId == mediaItem.mediaId) {
                                            viewModel.stopPlayback()
                                        } else {
                                            viewModel.playMedia(mediaItem.mediaId, uiState.isUnlocked, context)
                                        }
                                    },
                                    onImageTap = { path -> viewerImagePath = path },
                                    onLockTap = { showUnlockDialog = true },
                                )
                            }
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
                                onClick = { imagePicker.launch("image/*") },
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

@Composable
private fun MediaBubble(
    item: MediaItem,
    isMine: Boolean,
    isVoice: Boolean,
    isUnlocked: Boolean,
    isPlaying: Boolean,
    localImagePath: String?,
    onPlayTap: () -> Unit,
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
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
                    IconButton(onClick = onPlayTap, modifier = Modifier.size(36.dp)) {
                        Icon(
                            if (isPlaying) Icons.Default.Stop else Icons.Default.PlayArrow,
                            "Play",
                            tint = DilarionRed,
                            modifier = Modifier.size(24.dp),
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                    // Simple waveform placeholder
                    Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically) {
                        repeat(12) { i ->
                            val h = ((i * 7 + 3) % 16 + 8).dp
                            Box(Modifier.width(3.dp).height(h).clip(RoundedCornerShape(2.dp)).background(DilarionRed.copy(alpha = 0.6f)))
                        }
                    }
                    Spacer(Modifier.width(4.dp))
                    if (!isUnlocked) {
                        IconButton(onClick = onLockTap, modifier = Modifier.size(28.dp)) {
                            Icon(Icons.Default.Lock, "Unlock real audio", tint = TextSecondary, modifier = Modifier.size(16.dp))
                        }
                    }
                }
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

@Composable
private fun MessageBubble(
    message: Message,
    isMine: Boolean,
    isUnlocked: Boolean,
    onTapLocked: () -> Unit,
    currentUsername: String = "",
    isGroup: Boolean = false,
    senderName: String? = null,
) {
    val isPrivateTagged = message.contentType == "private_tagged"
    val isEncrypted = message.contentType == "encrypted"
    val hasRecipient = !message.recipient.isNullOrBlank() && message.recipient != "group"
    val isForMe = hasRecipient && message.recipient == currentUsername
    val privatePurple = Color(0xFFA78BFA)
    val showDecoy = isEncrypted && !isUnlocked

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
                Column(
                    modifier = Modifier
                        .widthIn(max = 260.dp)
                        .clip(bubbleShape)
                        .background(bubbleColor)
                        .then(
                            if (!isPrivateTagged && isEncrypted)
                                Modifier.clickable(enabled = !isUnlocked) { onTapLocked() }
                            else Modifier
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
                            decoyFor(message.id),
                            color = TextPrimary.copy(alpha = 0.65f),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    } else {
                        Text(message.content ?: "", color = TextPrimary, style = MaterialTheme.typography.bodyMedium)
                    }
                    Spacer(Modifier.height(2.dp))
                    Row(
                        modifier = Modifier.align(Alignment.End),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
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
