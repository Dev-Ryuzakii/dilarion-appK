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
            true
        } else false
    }

    fun loadMessages() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val bearer = "Bearer $token"
            runCatching {
                val messages: List<Message> = if (groupId != null) {
                    apiService.getGroupMessages(bearer, groupId!!).body()?.messages ?: emptyList()
                } else {
                    val me = _uiState.value.currentUsername
                    apiService.getInbox(bearer).body()?.messages
                        ?.filter { msg ->
                            (msg.sender == peerUsername && msg.recipient == me) ||
                                    (msg.sender == me && msg.recipient == peerUsername)
                        } ?: emptyList()
                }
                _uiState.value = _uiState.value.copy(
                    messages = messages.sortedBy { it.timestamp },
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
                if (groupId != null) {
                    apiService.sendGroupMessage(bearer, SendGroupMessageRequest(groupId!!, text.trim(), tagged))
                } else {
                    apiService.sendDm(bearer, SendDmRequest(peerUsername, text.trim()))
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
        return (s.messages.map { ChatItem.TextMessage(it) } +
                s.mediaItems.map { ChatItem.MediaMessage(it) })
            .sortedBy { it.timestamp ?: "" }
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
