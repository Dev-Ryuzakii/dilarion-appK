package com.dilarion.app.ui.screens.gallery

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.Message
import com.dilarion.app.data.model.SendConferenceMessageRequest
import com.dilarion.app.security.CryptoManager
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MeetingChatUiState(
    val messages: List<Message> = emptyList(),
    val currentUsername: String = "",
    val savedMasterToken: String? = null,
    val unlockedIds: Set<Int> = emptySet(),
    val decryptedTexts: Map<Int, String> = emptyMap(),
    val sending: Boolean = false,
    val error: String? = null,
)

/**
 * In-meeting encrypted chat — same per-device RSA key-fanout + master-token
 * decoy/unlock model as DM/group chat (see ChatViewModel), scoped to a
 * conference_id instead of a group. Standalone rather than folded into
 * ChatViewModel since a meeting's participant list (not group membership)
 * decides who the message is wrapped for, and it never touches media/calls.
 */
@HiltViewModel
class MeetingChatViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val cryptoManager: CryptoManager,
    presenceService: PresenceService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MeetingChatUiState())
    val uiState: StateFlow<MeetingChatUiState> = _uiState

    val events = presenceService.events

    private var conferenceId: Int = 0

    fun init(conferenceId: Int) {
        this.conferenceId = conferenceId
        viewModelScope.launch {
            val me = sessionManager.username.first() ?: ""
            val masterToken = sessionManager.masterToken.first()
            _uiState.value = _uiState.value.copy(currentUsername = me, savedMasterToken = masterToken)
        }
        loadMessages()
    }

    fun loadMessages() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.getConferenceMessages("Bearer $token", conferenceId).body()?.messages ?: emptyList()
            }.onSuccess { msgs ->
                _uiState.value = _uiState.value.copy(messages = msgs.sortedBy { it.timestamp })
            }
        }
    }

    fun unlock(enteredToken: String, messageId: Int): Boolean {
        val saved = _uiState.value.savedMasterToken
        if (saved == null || enteredToken != saved) return false
        _uiState.value = _uiState.value.copy(unlockedIds = _uiState.value.unlockedIds + messageId)
        decryptOne(messageId)
        return true
    }

    private fun decryptOne(messageId: Int) {
        val msg = _uiState.value.messages.find { it.id == messageId } ?: return
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
            _uiState.value = _uiState.value.copy(decryptedTexts = _uiState.value.decryptedTexts + (messageId to plain))
        }
    }

    fun sendMessage(text: String, participantUsernames: List<String>) {
        if (text.isBlank()) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val bearer = "Bearer $token"
            val me = _uiState.value.currentUsername
            _uiState.value = _uiState.value.copy(sending = true, error = null)
            runCatching {
                val decoys = listOf("hey are you free tonight", "what are you up to later", "just wanted to check in with you", "hope everything is going well with you", "did you eat anything yet today", "have so much work piled up right now")
                val decoy = decoys.random()

                val recipients = (participantUsernames + me).toSet()
                val deviceKeys = mutableMapOf<String, String>()
                for (u in recipients) {
                    apiService.getUserDevices(bearer, u).body()?.devices?.forEach { d ->
                        if (d.publicKey.isNotBlank()) deviceKeys[d.deviceUuid] = d.publicKey
                    }
                }
                if (deviceKeys.isEmpty()) throw Exception("No linked devices with encryption keys")

                val (ciphertext, encKeysMap, iv) = cryptoManager.encryptGroupMessage(text.trim(), deviceKeys)
                val encryptedKeyJson = com.google.gson.Gson().toJson(encKeysMap)
                apiService.sendConferenceMessage(bearer, SendConferenceMessageRequest(conferenceId, ciphertext, encryptedKeyJson, iv, decoy))
                loadMessages()
            }.onFailure {
                _uiState.value = _uiState.value.copy(error = it.message)
            }
            _uiState.value = _uiState.value.copy(sending = false)
        }
    }
}
