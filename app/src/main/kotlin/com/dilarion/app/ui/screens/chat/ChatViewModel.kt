package com.dilarion.app.ui.screens.chat

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.GroupMember
import com.dilarion.app.data.model.MediaItem
import com.dilarion.app.data.model.Message
import com.dilarion.app.data.model.MessageEditRequest
import com.dilarion.app.data.model.ReactionRequest
import com.dilarion.app.data.model.SendDmRequest
import com.dilarion.app.data.model.SendGroupMessageRequest
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import javax.inject.Inject

enum class PendingUploadKind { IMAGE, DOCUMENT, VOICE }

// WhatsApp-style optimistic bubble — shown the instant a send starts, in the
// spot the real bubble will land, removed once loadMedia() picks up the real
// MediaItem (or on failure). Never persisted, purely a local placeholder.
data class PendingUpload(
    val id: String = java.util.UUID.randomUUID().toString(),
    val kind: PendingUploadKind,
    val filename: String,
    val previewUri: Uri? = null,
    val timestamp: String = java.time.Instant.now().toString(),
)

sealed class ChatItem {
    abstract val timestamp: String?

    data class TextMessage(val message: Message) : ChatItem() {
        override val timestamp: String? = message.timestamp
    }

    data class MediaMessage(val item: MediaItem) : ChatItem() {
        override val timestamp: String? = item.timestamp
    }

    data class Pending(val upload: PendingUpload) : ChatItem() {
        override val timestamp: String? = upload.timestamp
    }
}

data class ChatUiState(
    val messages: List<Message> = emptyList(),
    val mediaItems: List<MediaItem> = emptyList(),
    val localFilePaths: Map<String, String> = emptyMap(),
    val isLoading: Boolean = true,
    val isSending: Boolean = false,
    val isUploadingMedia: Boolean = false,
    val pendingUploads: List<PendingUpload> = emptyList(),
    val currentUsername: String = "",
    val error: String? = null,
    // Per-item unlock — "msg_<id>" / "media_<mediaId>". Entering the master token
    // reveals only the ONE item that prompted for it, not the whole conversation
    // (matches desktop: masterToken is never retained, each locked bubble prompts
    // and discards it after use).
    val unlockedIds: Set<String> = emptySet(),
    val decryptedTexts: Map<Int, String> = emptyMap(),
    // Non-null while the in-app document viewer is showing; keys documentBytesCache.
    val viewingDocumentKey: String? = null,
    val savedMasterToken: String? = null,
    val isRecording: Boolean = false,
    val recordingSeconds: Int = 0,
    val playingMediaId: String? = null,
    val groupMembers: List<GroupMember> = emptyList(),
    val taggedUser: String? = null,
    val mentionQuery: String? = null,
    val replyTarget: Message? = null,
    val editingMessage: Message? = null,
    val forwardTarget: Message? = null,
    val forwardError: String? = null,
    val starredIds: Set<Int> = emptySet(),
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
    private val cryptoManager: com.dilarion.app.security.CryptoManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState

    private var peerUsername: String = ""
    private var groupId: Int? = null

    private var mediaRecorder: MediaRecorder? = null
    private var recordingFile: File? = null
    private var timerJob: Job? = null
    private var mediaPlayer: MediaPlayer? = null

    fun init(username: String, gId: Int?) {
        peerUsername = username
        groupId = gId
        viewModelScope.launch {
            val me = sessionManager.username.first() ?: ""
            val masterToken = sessionManager.masterToken.first()
            _uiState.value = _uiState.value.copy(currentUsername = me, savedMasterToken = masterToken)
            loadMessages()
            loadStarred()
            if (gId == null) loadMedia()
            else loadGroupMembers(gId)
            observeWebSocket()
        }
    }

    private fun loadGroupMembers(gId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val members = apiService.getGroupMembers("Bearer $token", gId).body() ?: emptyList()
                _uiState.value = _uiState.value.copy(groupMembers = members)
            }
        }
    }

    fun setTaggedUser(username: String?) {
        _uiState.value = _uiState.value.copy(taggedUser = username, mentionQuery = null)
    }

    fun setMentionQuery(query: String?) {
        _uiState.value = _uiState.value.copy(mentionQuery = query)
    }

    /**
     * Reveals exactly one item — [targetKey] is "msg_<id>" for a text message or
     * "media_<mediaId>" for a document/image/voice note. Never unlocks anything
     * else; the caller must ask again for the next locked item.
     */
    fun unlock(enteredToken: String, targetKey: String): Boolean {
        val saved = _uiState.value.savedMasterToken
        if (saved == null || enteredToken != saved) return false
        _uiState.value = _uiState.value.copy(unlockedIds = _uiState.value.unlockedIds + targetKey)
        if (targetKey.startsWith("msg_")) {
            decryptOne(targetKey.removePrefix("msg_").toIntOrNull())
        }
        return true
    }

    private fun decryptOne(messageId: Int?) {
        val id = messageId ?: return
        val msg = _uiState.value.messages.find { it.id == id } ?: return
        if (msg.content == null || msg.encryptedKey == null || msg.iv == null) return
        viewModelScope.launch {
            val privKey = sessionManager.privateKey.first()
            val myDeviceUuid = sessionManager.deviceUuid.first()
            val me = _uiState.value.currentUsername
            if (privKey.isNullOrBlank()) return@launch
            val plain = try {
                var encKey = msg.encryptedKey
                if (encKey.startsWith("{")) {
                    val mapType = object : com.google.gson.reflect.TypeToken<Map<String, String>>() {}.type
                    val keysMap: Map<String, String> = com.google.gson.Gson().fromJson(encKey, mapType)
                    encKey = keysMap[myDeviceUuid] ?: keysMap[me] ?: encKey
                }
                cryptoManager.decryptMessage(msg.content, encKey, msg.iv, privKey)
            } catch (e: Exception) {
                "[Decryption Failed]"
            }
            _uiState.value = _uiState.value.copy(decryptedTexts = _uiState.value.decryptedTexts + (id to plain))
        }
    }

    /** Same decrypt path as decryptOne, but returns the plaintext instead of
     * only stashing it in state — used by edit/forward which need the text
     * itself, not just a UI reveal. */
    private suspend fun decryptMessageText(msg: Message): String? {
        if (msg.content == null || msg.encryptedKey == null || msg.iv == null) return null
        val privKey = sessionManager.privateKey.first()
        val myDeviceUuid = sessionManager.deviceUuid.first()
        val me = _uiState.value.currentUsername
        if (privKey.isNullOrBlank()) return null
        return try {
            var encKey = msg.encryptedKey
            if (encKey.startsWith("{")) {
                val mapType = object : com.google.gson.reflect.TypeToken<Map<String, String>>() {}.type
                val keysMap: Map<String, String> = com.google.gson.Gson().fromJson(encKey, mapType)
                encKey = keysMap[myDeviceUuid] ?: keysMap[me] ?: encKey
            }
            cryptoManager.decryptMessage(msg.content, encKey, msg.iv, privKey)
        } catch (e: Exception) {
            null
        }
    }

    // ── Collaboration actions ────────────────────────────────────────────────────

    fun toggleReaction(messageId: Int, emoji: String) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.toggleReaction("Bearer $token", messageId, ReactionRequest(emoji)) }
            loadMessages()
        }
    }

    fun togglePin(msg: Message) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                if (msg.isPinned) apiService.unpinMessage("Bearer $token", msg.id)
                else apiService.pinMessage("Bearer $token", msg.id)
            }
            loadMessages()
        }
    }

    fun toggleStar(msg: Message) {
        val isStarred = _uiState.value.starredIds.contains(msg.id)
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                if (isStarred) apiService.unstarMessage("Bearer $token", msg.id)
                else apiService.starMessage("Bearer $token", msg.id)
            }.onSuccess {
                val ids = _uiState.value.starredIds
                _uiState.value = _uiState.value.copy(
                    starredIds = if (isStarred) ids - msg.id else ids + msg.id
                )
            }
        }
    }

    private fun loadStarred() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.getStarredMessages("Bearer $token").body()?.messages ?: emptyList()
            }.onSuccess { starred ->
                _uiState.value = _uiState.value.copy(starredIds = starred.map { it.id }.toSet())
            }
        }
    }

    fun deleteMessage(msg: Message) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.deleteMessage("Bearer $token", msg.id) }
            loadMessages()
        }
    }

    fun setReplyTarget(msg: Message?) {
        _uiState.value = _uiState.value.copy(replyTarget = msg, editingMessage = null)
    }

    fun setForwardTarget(msg: Message?) {
        _uiState.value = _uiState.value.copy(forwardTarget = msg, forwardError = null)
    }

    /** Edit requires the plaintext to prefill the composer — uses the device's
     * own private key directly (same as any decrypt), no master-token gate
     * needed since it's not a UI reveal, just recovering text to re-send. */
    fun startEdit(msg: Message, onReady: (String) -> Unit, onFail: (String) -> Unit) {
        viewModelScope.launch {
            val plain = decryptMessageText(msg)
            if (plain == null) {
                onFail("Could not decrypt this message to edit it")
            } else {
                _uiState.value = _uiState.value.copy(editingMessage = msg, replyTarget = null)
                onReady(plain)
            }
        }
    }

    fun cancelComposerAction() {
        _uiState.value = _uiState.value.copy(replyTarget = null, editingMessage = null)
    }

    fun forwardMessage(targetUsername: String) {
        val target = _uiState.value.forwardTarget ?: return
        if (targetUsername.isBlank()) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val bearer = "Bearer $token"
            val me = _uiState.value.currentUsername
            _uiState.value = _uiState.value.copy(forwardError = null)
            val plain = decryptMessageText(target)
            if (plain == null) {
                _uiState.value = _uiState.value.copy(forwardError = "Unlock this message first")
                return@launch
            }
            runCatching {
                val deviceKeys = mutableMapOf<String, String>()
                for (u in setOf(targetUsername, me)) {
                    apiService.getUserDevices(bearer, u).body()?.devices?.forEach { d ->
                        if (d.publicKey.isNotBlank()) deviceKeys[d.deviceUuid] = d.publicKey
                    }
                }
                if (deviceKeys.isEmpty()) throw Exception("$targetUsername has no linked devices with encryption keys yet")
                val (ciphertext, encKeysMap, iv) = cryptoManager.encryptGroupMessage(plain, deviceKeys)
                val encryptedKeyJson = com.google.gson.Gson().toJson(encKeysMap)
                val decoys = listOf("hey are you free tonight", "what are you up to later", "just checking in")
                apiService.sendDm(bearer, SendDmRequest(targetUsername, ciphertext, encryptedKeyJson, iv, decoys.random(), forwardedFromMessageId = target.id))
                _uiState.value = _uiState.value.copy(forwardTarget = null)
            }.onFailure {
                _uiState.value = _uiState.value.copy(forwardError = it.message ?: "Failed to forward message")
            }
        }
    }

    fun loadMessages() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val bearer = "Bearer $token"
            val me = _uiState.value.currentUsername
            runCatching {
                val rawMessages: List<Message> = if (groupId != null) {
                    apiService.getGroupMessages(bearer, groupId!!).body()?.messages ?: emptyList()
                } else {
                    apiService.getInbox(bearer).body()?.messages
                        ?.filter { msg ->
                            (msg.sender == peerUsername && msg.recipient == me) ||
                                    (msg.sender == me && msg.recipient == peerUsername)
                        } ?: emptyList()
                }
                // Messages stay in raw/encrypted form here always now — decryptOne()
                // fills in decryptedTexts lazily, per message, only once its own
                // unlock is confirmed. Re-unlock the same message twice in one
                // session and this list refreshing underneath it won't lose that.
                val decrypted = rawMessages

                _uiState.value = _uiState.value.copy(
                    messages = decrypted.sortedBy { it.timestamp },
                    isLoading = false,
                )
            }.onFailure {
                _uiState.value = _uiState.value.copy(isLoading = false, error = it.message)
            }
        }
    }

    private fun loadMedia() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val me = _uiState.value.currentUsername
                val items = apiService.getMediaInbox("Bearer $token").body()?.mediaFiles
                    ?.filter { item ->
                        (item.sender == peerUsername && item.recipient == me) ||
                                (item.sender == me && item.recipient == peerUsername)
                    } ?: emptyList()
                _uiState.value = _uiState.value.copy(mediaItems = items)
            }
        }
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        val tagged = _uiState.value.taggedUser
        val editTarget = _uiState.value.editingMessage
        val replyId = _uiState.value.replyTarget?.id
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val bearer = "Bearer $token"
            val me = _uiState.value.currentUsername
            _uiState.value = _uiState.value.copy(
                isSending = true, taggedUser = null, mentionQuery = null,
                editingMessage = null, replyTarget = null,
            )

            val optimistic = Message(
                id = -System.currentTimeMillis().toInt(),
                sender = me,
                recipient = if (groupId == null) peerUsername else (tagged ?: "group"),
                content = text.trim(),
                groupId = groupId,
                timestamp = java.time.Instant.now().toString(),
            )
            if (editTarget == null) {
                _uiState.value = _uiState.value.copy(
                    messages = (_uiState.value.messages + optimistic).sortedBy { it.timestamp }
                )
            }

            runCatching {
                val decoys = listOf("hey are you free tonight", "what are you up to later", "just wanted to check in with you", "hope everything is going well with you", "did you eat anything yet today", "have so much work piled up right now")
                val decoy = decoys.random()

                // Wrap the AES key once per active device (keyed by device_uuid) of
                // every recipient and of ourselves, so all of everyone's devices read it.
                val recipients: Set<String> = if (groupId != null) {
                    (_uiState.value.groupMembers.map { it.username } + me).toSet()
                } else {
                    setOf(peerUsername, me)
                }
                val deviceKeys = mutableMapOf<String, String>()
                for (u in recipients) {
                    apiService.getUserDevices(bearer, u).body()?.devices?.forEach { d ->
                        if (d.publicKey.isNotBlank()) deviceKeys[d.deviceUuid] = d.publicKey
                    }
                }
                if (deviceKeys.isEmpty()) throw Exception("No linked devices with encryption keys")

                val (ciphertext, encKeysMap, iv) = cryptoManager.encryptGroupMessage(text.trim(), deviceKeys)
                val encryptedKeyJson = com.google.gson.Gson().toJson(encKeysMap)
                if (editTarget != null) {
                    apiService.editMessage(bearer, editTarget.id, MessageEditRequest(ciphertext, encryptedKeyJson, iv, decoy))
                } else if (groupId != null) {
                    // @mentions are detected from typed @username tokens against known
                    // group members — separate from the existing admin-only "tag one
                    // member privately" feature (taggedUser/addressed_to_username).
                    val mentioned = _uiState.value.groupMembers
                        .map { it.username }
                        .filter { Regex("(^|\\s)@$it\\b").containsMatchIn(text.trim()) }
                    apiService.sendGroupMessage(bearer, SendGroupMessageRequest(groupId!!, ciphertext, tagged, encryptedKeyJson, iv, decoy, replyId, mentions = mentioned.ifEmpty { null }))
                } else {
                    apiService.sendDm(bearer, SendDmRequest(peerUsername, ciphertext, encryptedKeyJson, iv, decoy, replyId))
                }
                loadMessages()
            }.onFailure {
                _uiState.value = _uiState.value.copy(
                    messages = if (editTarget == null) _uiState.value.messages.filter { it.id >= 0 } else _uiState.value.messages,
                    error = it.message,
                    editingMessage = editTarget,
                )
            }
            _uiState.value = _uiState.value.copy(isSending = false)
        }
    }

    /** Picked file's real name via the content resolver; ContentResolver's URI segment is not reliable. */
    private fun queryDisplayName(context: Context, uri: Uri): String? {
        return context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    }

    /**
     * Sends any picked file — image, PDF, or other document — classified by its
     * real MIME type. `decoyKind` (invoice/delivery/minutes/memo) picks which
     * decoy document the server generates for this attachment; null lets the
     * server choose one deterministically from the media_id instead.
     */
    fun sendAttachment(uri: Uri, context: Context, decoyKind: String? = null) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val displayName = queryDisplayName(context, uri) ?: "attachment"
            val kind = if (mime.startsWith("image/")) PendingUploadKind.IMAGE else PendingUploadKind.DOCUMENT
            val pending = PendingUpload(kind = kind, filename = displayName, previewUri = uri)
            _uiState.value = _uiState.value.copy(
                isUploadingMedia = true,
                pendingUploads = _uiState.value.pendingUploads + pending,
            )
            runCatching {
                val bytes = context.contentResolver.openInputStream(uri)?.readBytes() ?: return@launch
                val tempFile = File(context.cacheDir, "upload_${System.currentTimeMillis()}_$displayName")
                tempFile.writeBytes(bytes)
                val requestFile = tempFile.asRequestBody(mime.toMediaTypeOrNull())
                val filePart = MultipartBody.Part.createFormData("file", displayName, requestFile)
                val usernamePart = peerUsername.toRequestBody("text/plain".toMediaTypeOrNull())
                val contentTypePart = mime.toRequestBody("text/plain".toMediaTypeOrNull())
                val decoyKindPart = decoyKind?.toRequestBody("text/plain".toMediaTypeOrNull())
                apiService.uploadMedia("Bearer $token", usernamePart, filePart, contentTypePart, decoyKindPart)
                tempFile.delete()
                loadMedia()
            }.onFailure {
                _uiState.value = _uiState.value.copy(error = it.message)
            }
            _uiState.value = _uiState.value.copy(
                isUploadingMedia = false,
                pendingUploads = _uiState.value.pendingUploads.filterNot { it.id == pending.id },
            )
        }
    }

    fun startRecording(context: Context) {
        if (_uiState.value.isRecording) return
        val outFile = File(context.cacheDir, "voice_${System.currentTimeMillis()}.mp4")
        recordingFile = outFile
        @Suppress("DEPRECATION")
        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            MediaRecorder()
        }
        recorder.apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setOutputFile(outFile.absolutePath)
            prepare()
            start()
        }
        mediaRecorder = recorder
        _uiState.value = _uiState.value.copy(isRecording = true, recordingSeconds = 0)
        timerJob = viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(1000)
                _uiState.value = _uiState.value.copy(recordingSeconds = _uiState.value.recordingSeconds + 1)
            }
        }
    }

    fun stopAndSendRecording() {
        val recorder = mediaRecorder ?: return
        val file = recordingFile ?: return
        timerJob?.cancel()
        timerJob = null
        runCatching { recorder.stop() }
        recorder.release()
        mediaRecorder = null
        _uiState.value = _uiState.value.copy(isRecording = false, recordingSeconds = 0)
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val pending = PendingUpload(kind = PendingUploadKind.VOICE, filename = "Voice message")
            _uiState.value = _uiState.value.copy(
                isUploadingMedia = true,
                pendingUploads = _uiState.value.pendingUploads + pending,
            )
            runCatching {
                val requestFile = file.asRequestBody("audio/mp4".toMediaTypeOrNull())
                val filePart = MultipartBody.Part.createFormData("file", file.name, requestFile)
                val usernamePart = peerUsername.toRequestBody("text/plain".toMediaTypeOrNull())
                val contentTypePart = "media/voice".toRequestBody("text/plain".toMediaTypeOrNull())
                apiService.uploadMedia("Bearer $token", usernamePart, filePart, contentTypePart)
                file.delete()
                loadMedia()
            }.onFailure {
                _uiState.value = _uiState.value.copy(error = it.message)
            }
            _uiState.value = _uiState.value.copy(
                isUploadingMedia = false,
                pendingUploads = _uiState.value.pendingUploads.filterNot { it.id == pending.id },
            )
        }
    }

    fun cancelRecording() {
        timerJob?.cancel()
        timerJob = null
        runCatching { mediaRecorder?.stop() }
        mediaRecorder?.release()
        mediaRecorder = null
        recordingFile?.delete()
        recordingFile = null
        _uiState.value = _uiState.value.copy(isRecording = false, recordingSeconds = 0)
    }

    fun playMedia(mediaId: String, useRealAudio: Boolean, context: Context) {
        val cacheKey = "${if (useRealAudio) "real" else "fake"}_$mediaId"
        val existingPath = _uiState.value.localFilePaths[cacheKey]
        if (existingPath != null) {
            startPlayer(existingPath, mediaId)
            return
        }
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(playingMediaId = mediaId)
            runCatching {
                val resp = if (useRealAudio) {
                    apiService.downloadMedia("Bearer $token", mediaId)
                } else {
                    apiService.downloadDecoyVoice("Bearer $token", mediaId)
                }
                val bytes = resp.body()?.bytes() ?: return@launch
                val file = File(context.cacheDir, "$cacheKey.mp4")
                file.writeBytes(bytes)
                _uiState.value = _uiState.value.copy(
                    localFilePaths = _uiState.value.localFilePaths + (cacheKey to file.absolutePath)
                )
                startPlayer(file.absolutePath, mediaId)
            }.onFailure {
                _uiState.value = _uiState.value.copy(error = it.message, playingMediaId = null)
            }
        }
    }

    fun downloadImageForDisplay(mediaId: String, context: Context) {
        val cacheKey = "img_$mediaId"
        if (_uiState.value.localFilePaths.containsKey(cacheKey)) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val bytes = apiService.downloadMedia("Bearer $token", mediaId).body()?.bytes() ?: return@launch
                val file = File(context.cacheDir, "$cacheKey.jpg")
                file.writeBytes(bytes)
                _uiState.value = _uiState.value.copy(
                    localFilePaths = _uiState.value.localFilePaths + (cacheKey to file.absolutePath)
                )
            }
        }
    }

    /**
     * Opens a document attachment. Locked: fetches and opens the generated decoy
     * (cached server-side, safe to reopen). Unlocked: fetches the real file —
     * a one-time view the server deletes after this single read — and opens that
     * instead. Each state gets its own cache key so an earlier decoy view is never
     * mistaken for the real file once the screen is unlocked.
     */
    // Decoy/real document bytes, in memory only — never written to disk, matching
    // desktop's data:-URL iframe approach. Not exposed via StateFlow: ByteArray
    // isn't something Compose should be diffing on every recomposition; the UI
    // reads it once via getDocumentBytes() when viewingDocumentKey changes.
    private val documentBytesCache = mutableMapOf<String, ByteArray>()

    /**
     * Opens a document attachment in the in-app viewer. Locked: shows the
     * generated decoy. Unlocked (this specific document's key is in
     * unlockedIds): fetches the real file — a one-time view the server deletes
     * after this single read. Each state has its own cache key, kept in memory
     * for the rest of this screen session, so re-tapping after the first real
     * view re-renders from memory instead of hitting the server's 410 wall.
     */
    fun openDocument(mediaId: String) {
        val useReal = _uiState.value.unlockedIds.contains("media_$mediaId")
        val cacheKey = "${if (useReal) "docreal" else "docdecoy"}_$mediaId"
        if (documentBytesCache.containsKey(cacheKey)) {
            _uiState.value = _uiState.value.copy(viewingDocumentKey = cacheKey)
            return
        }
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val resp = if (useReal) {
                    apiService.downloadMedia("Bearer $token", mediaId)
                } else {
                    apiService.downloadDecoyFile("Bearer $token", mediaId)
                }
                val bytes = resp.body()?.bytes() ?: return@launch
                documentBytesCache[cacheKey] = bytes
                _uiState.value = _uiState.value.copy(viewingDocumentKey = cacheKey)
            }.onFailure {
                _uiState.value = _uiState.value.copy(error = it.message)
            }
        }
    }

    fun getDocumentBytes(cacheKey: String): ByteArray? = documentBytesCache[cacheKey]

    fun closeDocumentViewer() {
        val key = _uiState.value.viewingDocumentKey
        _uiState.value = _uiState.value.copy(viewingDocumentKey = null)
        if (key == null || !key.startsWith("docreal_")) return

        // The real file is a one-time view: the server deleted it — and retired
        // the message with it — on that single read. Keeping the bubble (and the
        // decoded bytes) around meant a document never disappeared after being
        // read; it just quietly stopped being the real thing. Drop both.
        val mediaId = key.removePrefix("docreal_")
        val me = _uiState.value.currentUsername
        val item = _uiState.value.mediaItems.firstOrNull { it.mediaId == mediaId }
        if (item != null && item.sender == me) return  // our own attachment, not "read by the recipient"

        documentBytesCache.remove(key)
        documentBytesCache.remove("docdecoy_$mediaId")
        _uiState.value = _uiState.value.copy(
            mediaItems = _uiState.value.mediaItems.filterNot { it.mediaId == mediaId },
        )
    }

    private fun startPlayer(filePath: String, mediaId: String) {
        mediaPlayer?.release()
        mediaPlayer = null
        _uiState.value = _uiState.value.copy(playingMediaId = mediaId)
        runCatching {
            mediaPlayer = MediaPlayer().apply {
                setDataSource(filePath)
                setOnCompletionListener {
                    _uiState.value = _uiState.value.copy(playingMediaId = null)
                }
                prepare()
                start()
            }
        }.onFailure {
            _uiState.value = _uiState.value.copy(error = it.message, playingMediaId = null)
        }
    }

    fun stopPlayback() {
        mediaPlayer?.release()
        mediaPlayer = null
        _uiState.value = _uiState.value.copy(playingMediaId = null)
    }

    fun markRead(messageId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.markRead("Bearer $token", messageId) }
        }
    }

    fun getCombinedItems(): List<ChatItem> {
        val s = _uiState.value
        return (s.messages.filter { !isMediaFilenameMessage(it, s.mediaItems) }
                    .map { ChatItem.TextMessage(it) } +
                s.mediaItems.map { ChatItem.MediaMessage(it) } +
                s.pendingUploads.map { ChatItem.Pending(it) })
            .sortedBy { it.timestamp ?: "" }
    }

    // Media uploads produce a companion text message whose content is just the
    // stored filename (e.g. "40a98e3e-….jpg") — the media bubble already renders
    // the attachment, so hide these.
    private val mediaFilenameRegex = Regex(
        "^(upload_\\d+|voice_[0-9a-fA-F-]+|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\.(jpg|jpeg|png|gif|heic|mp4|mov|m4a|wav|mp3)$"
    )

    private fun isMediaFilenameMessage(message: Message, mediaItems: List<MediaItem>): Boolean {
        val content = message.content?.trim().orEmpty()
        if (content.isEmpty()) return false
        if (mediaItems.any { it.filename == content }) return true
        return mediaFilenameRegex.matches(content)
    }

    private fun observeWebSocket() {
        viewModelScope.launch {
            presenceService.events.collect { event ->
                val d = event.data
                when (event.type) {
                    "new_message" -> {
                        if (groupId == null && d != null) {
                            val sender = d.get("sender_username")?.asString
                            val recipient = d.get("recipient_username")?.asString
                            val me = _uiState.value.currentUsername
                            if (sender != null &&
                                (sender == peerUsername || (sender == me && recipient == peerUsername))) {
                                // Show optimistic incoming bubble; loadMessages() fills real content
                                val ts = d.get("timestamp")?.asString ?: java.time.Instant.now().toString()
                                val msgId = d.get("message_id")?.asInt ?: 0
                                val existing = _uiState.value.messages
                                if (msgId == 0 || existing.none { it.id == msgId }) {
                                    val placeholder = Message(
                                        id = msgId,
                                        sender = sender,
                                        recipient = recipient,
                                        content = null, // filled by loadMessages()
                                        timestamp = ts,
                                    )
                                    _uiState.value = _uiState.value.copy(
                                        messages = (existing + placeholder).sortedBy { it.timestamp }
                                    )
                                }
                            }
                        }
                        loadMessages()
                    }
                    "new_group_message" -> {
                        if (groupId != null && d != null) {
                            val evtGroupId = d.get("group_id")?.asInt
                            if (evtGroupId == null || evtGroupId == groupId) {
                                val sender = d.get("sender_username")?.asString
                                val ts = d.get("timestamp")?.asString ?: java.time.Instant.now().toString()
                                val msgId = d.get("message_id")?.asInt ?: 0
                                val existing = _uiState.value.messages
                                if (msgId == 0 || existing.none { it.id == msgId }) {
                                    val placeholder = Message(
                                        id = msgId,
                                        sender = sender,
                                        content = null,
                                        groupId = groupId,
                                        timestamp = ts,
                                    )
                                    _uiState.value = _uiState.value.copy(
                                        messages = (existing + placeholder).sortedBy { it.timestamp }
                                    )
                                }
                            }
                        }
                        loadMessages()
                    }
                    "new_media" -> if (groupId == null) loadMedia()
                    // Sent when a message is deleted, and when a one-time media
                    // message is burned after its recipient read it.
                    "message_deleted" -> {
                        val msgId = d?.get("message_id")?.asInt
                        if (msgId != null) {
                            _uiState.value = _uiState.value.copy(
                                messages = _uiState.value.messages.filterNot { it.id == msgId },
                            )
                        }
                        if (groupId == null) loadMedia()
                    }
                }
            }
        }
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    override fun onCleared() {
        super.onCleared()
        timerJob?.cancel()
        runCatching { mediaRecorder?.stop() }
        mediaRecorder?.release()
        mediaPlayer?.release()
    }
}
