package com.dilarion.app.ui.screens.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dilarion.app.data.model.Message
import com.dilarion.app.ui.theme.*
import java.text.SimpleDateFormat
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    username: String,
    groupId: Int?,
    groupName: String?,
    onBack: () -> Unit,
    viewModel: ChatViewModel = hiltViewModel(),
) {
    LaunchedEffect(username, groupId) {
        viewModel.init(username, groupId)
    }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    var inputText by remember { mutableStateOf("") }

    val displayName = if (groupId != null) (groupName ?: "Group") else username

    // Scroll to bottom on new messages
    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
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
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(DilarionRedDark),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                displayName.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                                color = SurfaceWhite,
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(
                                displayName,
                                style = MaterialTheme.typography.titleMedium,
                                color = SurfaceWhite,
                            )
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.Lock,
                                    null,
                                    modifier = Modifier.size(9.dp),
                                    tint = SurfaceWhite.copy(alpha = 0.7f),
                                )
                                Spacer(Modifier.width(3.dp))
                                Text(
                                    "end-to-end encrypted",
                                    fontSize = 10.sp,
                                    color = SurfaceWhite.copy(alpha = 0.7f),
                                )
                            }
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        containerColor = BackgroundGrey,
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .imePadding(),
        ) {

            // Messages list
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
                    items(uiState.messages, key = { it.id }) { message ->
                        val isMine = message.sender == uiState.currentUsername
                        val decrypted = uiState.decryptedMap[message.id]

                        LaunchedEffect(message.id) {
                            if (!message.read && !isMine) viewModel.markRead(message.id)
                            if (message.encryptedKey != null && message.iv != null && decrypted == null) {
                                viewModel.decryptMessage(
                                    message.id,
                                    message.content,
                                    message.encryptedKey,
                                    message.iv,
                                )
                            }
                        }

                        MessageBubble(
                            message   = message,
                            isMine    = isMine,
                            decrypted = decrypted,
                        )
                    }
                }
            }

            // Input bar
            Surface(
                color = SurfaceWhite,
                shadowElevation = 4.dp,
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        placeholder = { Text("Message", color = TextSecondary) },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(24.dp),
                        maxLines = 5,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor   = DilarionRed,
                            unfocusedBorderColor = BorderGrey,
                        ),
                    )
                    Spacer(Modifier.width(8.dp))
                    IconButton(
                        onClick = {
                            viewModel.sendMessage(inputText)
                            inputText = ""
                        },
                        enabled = inputText.isNotBlank() && !uiState.isSending,
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                            .background(if (inputText.isNotBlank()) DilarionRed else BorderGrey),
                    ) {
                        if (uiState.isSending) {
                            CircularProgressIndicator(Modifier.size(20.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Send, "Send", tint = SurfaceWhite)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: Message,
    isMine: Boolean,
    decrypted: String?,
) {
    val bubbleColor  = if (isMine) ChatBubbleSelf else ChatBubbleOther
    val bubbleShape  = if (isMine) {
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
                .widthIn(max = 280.dp)
                .clip(bubbleShape)
                .background(bubbleColor)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            val displayContent = decrypted ?: message.decoyContent
            Text(
                text  = displayContent,
                color = TextPrimary,
                style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(2.dp))
            Row(
                horizontalArrangement = Arrangement.End,
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (decrypted != null) {
                    Icon(
                        Icons.Default.Lock,
                        null,
                        modifier = Modifier.size(9.dp),
                        tint = TextSecondary,
                    )
                    Spacer(Modifier.width(2.dp))
                }
                Text(
                    text  = formatTimestamp(message.timestamp),
                    style = MaterialTheme.typography.labelSmall,
                    color = TextSecondary,
                )
            }
        }
    }
}

private fun formatTimestamp(iso: String): String = runCatching {
    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(sdf.parse(iso)!!)
}.getOrElse { "" }
