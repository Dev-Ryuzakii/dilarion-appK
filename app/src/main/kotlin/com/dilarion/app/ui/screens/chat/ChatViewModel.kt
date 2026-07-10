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

sealed class ChatItem {
    abstract val timestamp: String?

    data class TextMessage(val message: Message) : ChatItem() {
        override val timestamp: String? = message.timestamp
    }

    data class MediaMessage(val item: MediaItem) : ChatItem() {
        override val timestamp: String? = item.timestamp
    }
}

data class ChatUiState(
    val messages: List<Message> = emptyList(),
    val mediaItems: List<MediaItem> = emptyList(),
    val localFilePaths: Map<String, String> = emptyMap(),
    val isLoading: Boolean = true,
    val isSending: Boolean = false,
    val isUploadingMedia: Boolean = false,
    val currentUsername: String = "",
    val error: String? = null,
    val isUnlocked: Boolean = false,
    val savedMasterToken: String? = null,
    val isRecording: Boolean = false,
    val recordingSeconds: Int = 0,
    val playingMediaId: String? = null,
    val groupMembers: List<GroupMember> = emptyList(),
    val taggedUser: String? = null,
    val mentionQuery: String? = null,
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

    fun unlock(enteredToken: String): Boolean {
        val saved = _uiState.value.savedMasterToken
        return if (saved != null && enteredToken == saved) {
            _uiState.value = _uiState.value.copy(isUnlocked = true)
            loadMessages()
            true
        } else false
    }

    fun loadMessages() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val bearer = "Bearer $token"
            val privKey = sessionManager.privateKey.first()
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
                
                val decrypted = rawMessages.map { msg ->
                    if (_uiState.value.isUnlocked && msg.content != null && msg.encryptedKey != null && msg.iv != null && privKey != null && privKey.isNotBlank()) {
                        try {
                            var encKey = msg.encryptedKey
                            if (encKey.startsWith("{")) {
                                val mapType = object : com.google.gson.reflect.TypeToken<Map<String, String>>() {}.type
                                val keysMap: Map<String, String> = com.google.gson.Gson().fromJson(encKey, mapType)
                                encKey = keysMap[me] ?: encKey
                            }
                            val plain = cryptoManager.decryptMessage(msg.content, encKey, msg.iv, privKey)
                            msg.copy(content = plain)
                        } catch (e: Exception) {
                            msg.copy(content = "[Decryption Failed]")
                        }
                    } else {
                        msg
                    }
                }

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
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val bearer = "Bearer $token"
            val me = _uiState.value.currentUsername
            _uiState.value = _uiState.value.copy(isSending = true, taggedUser = null, mentionQuery = null)

            val optimistic = Message(
                id = -System.currentTimeMillis().toInt(),
                sender = me,
                recipient = if (groupId == null) peerUsername else (tagged ?: "group"),
                content = text.trim(),
                groupId = groupId,
                timestamp = java.time.Instant.now().toString(),
            )
            _uiState.value = _uiState.value.copy(
                messages = (_uiState.value.messages + optimistic).sortedBy { it.timestamp }
            )

            runCatching {
                val decoys = listOf("hey are you free tonight", "what are you up to later", "just wanted to check in with you", "hope everything is going well with you", "did you eat anything yet today", "have so much work piled up right now")
                val decoy = decoys.random()

                if (groupId != null) {
                    val pubKeys = mutableMapOf<String, String>()
                    for (member in _uiState.value.groupMembers) {
                        if (member.username != me) {
                            val pk = apiService.getPublicKey(bearer, member.username).body()?.get("public_key")
                            if (pk != null) pubKeys[member.username] = pk
                        }
                    }
                    val myPk = apiService.getPublicKey(bearer, me).body()?.get("public_key")
                    if (myPk != null) pubKeys[me] = myPk

                    val (ciphertext, encKeysMap, iv) = cryptoManager.encryptGroupMessage(text.trim(), pubKeys)
                    val encryptedKeyJson = com.google.gson.Gson().toJson(encKeysMap)
                    apiService.sendGroupMessage(bearer, SendGroupMessageRequest(groupId!!, ciphertext, tagged, encryptedKeyJson, iv, decoy))
                } else {
                    val pubKeyResponse = apiService.getPublicKey(bearer, peerUsername)
                    val pubKeyB64 = pubKeyResponse.body()?.get("public_key") ?: throw Exception("Recipient public key not found")
                    val (ciphertext, encryptedKey, iv) = cryptoManager.encryptMessage(text.trim(), pubKeyB64)
                    apiService.sendDm(bearer, SendDmRequest(peerUsername, ciphertext, encryptedKey, iv, decoy))
                }
                loadMessages()
            }.onFailure {
                _uiState.value = _uiState.value.copy(
                    messages = _uiState.value.messages.filter { it.id >= 0 },
                    error = it.message,
                )
            }
            _uiState.value = _uiState.value.copy(isSending = false)
        }
    }

    fun sendImage(uri: Uri, context: Context) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(isUploadingMedia = true)
            runCatching {
                val bytes = context.contentResolver.openInputStream(uri)?.readBytes() ?: return@launch
                val tempFile = File(context.cacheDir, "upload_${System.currentTimeMillis()}.jpg")
                tempFile.writeBytes(bytes)
                val requestFile = tempFile.asRequestBody("image/jpeg".toMediaTypeOrNull())
                val filePart = MultipartBody.Part.createFormData("file", tempFile.name, requestFile)
                val usernamePart = peerUsername.toRequestBody("text/plain".toMediaTypeOrNull())
                apiService.uploadMedia("Bearer $token", usernamePart, filePart)
                tempFile.delete()
                loadMedia()
            }.onFailure {
                _uiState.value = _uiState.value.copy(error = it.message)
            }
            _uiState.value = _uiState.value.copy(isUploadingMedia = false)
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
            _uiState.value = _uiState.value.copy(isUploadingMedia = true)
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
            _uiState.value = _uiState.value.copy(isUploadingMedia = false)
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
                s.mediaItems.map { ChatItem.MediaMessage(it) })
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
