package com.dilarion.app.ui.screens.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.Message
import com.dilarion.app.data.model.SendMessageRequest
import com.dilarion.app.security.CryptoManager
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.dilarion.app.utils.FakeTextGenerator
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ChatUiState(
    val messages: List<Message> = emptyList(),
    val decryptedMap: Map<Int, String> = emptyMap(),
    val isLoading: Boolean = true,
    val isSending: Boolean = false,
    val currentUsername: String = "",
    val error: String? = null,
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val cryptoManager: CryptoManager,
    private val presenceService: PresenceService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState

    private var peerUsername: String = ""
    private var groupId: Int? = null

    fun init(username: String, gId: Int?) {
        peerUsername = username
        groupId = gId
        viewModelScope.launch {
            val me = sessionManager.username.first() ?: ""
            _uiState.value = _uiState.value.copy(currentUsername = me)
            loadMessages()
            observeWebSocket()
        }
    }

    fun loadMessages() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val resp = apiService.getInbox("Bearer $token")
                val all = resp.body()?.messages ?: emptyList()
                val me = _uiState.value.currentUsername
                val filtered = if (groupId != null) {
                    all.filter { it.groupId == groupId }
                } else {
                    all.filter { msg ->
                        (msg.sender == peerUsername && msg.recipient == me) ||
                        (msg.sender == me && msg.recipient == peerUsername)
                    }
                }
                _uiState.value = _uiState.value.copy(
                    messages  = filtered.sortedBy { it.timestamp },
                    isLoading = false,
                )
            }.onFailure {
                _uiState.value = _uiState.value.copy(isLoading = false, error = it.message)
            }
        }
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val privKey = sessionManager.privateKey.first()
            _uiState.value = _uiState.value.copy(isSending = true)
            runCatching {
                val recipient = if (groupId != null) peerUsername else peerUsername
                // Fetch recipient public key for encryption
                val keyResp = apiService.getPublicKey("Bearer $token", recipient)
                val pubKey  = keyResp.body()?.get("public_key")
                val decoy   = FakeTextGenerator.generate()
                val request = if (pubKey != null) {
                    val (ciphertext, encKey, iv) = cryptoManager.encryptMessage(text, pubKey)
                    SendMessageRequest(
                        recipient    = if (groupId != null) "" else peerUsername,
                        content      = ciphertext,
                        decoyContent = decoy,
                        encryptedKey = encKey,
                        iv           = iv,
                        groupId      = groupId,
                    )
                } else {
                    SendMessageRequest(
                        recipient    = peerUsername,
                        content      = text,
                        decoyContent = decoy,
                        groupId      = groupId,
                    )
                }
                apiService.sendMessage("Bearer $token", request)
                loadMessages()
            }.onFailure {
                _uiState.value = _uiState.value.copy(error = it.message)
            }
            _uiState.value = _uiState.value.copy(isSending = false)
        }
    }

    fun decryptMessage(messageId: Int, ciphertext: String, encKey: String, iv: String) {
        viewModelScope.launch {
            val privKey = sessionManager.privateKey.first() ?: return@launch
            runCatching {
                val plain = cryptoManager.decryptMessage(ciphertext, encKey, iv, privKey)
                _uiState.value = _uiState.value.copy(
                    decryptedMap = _uiState.value.decryptedMap + (messageId to plain),
                )
            }
        }
    }

    fun markRead(messageId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.markRead("Bearer $token", messageId) }
        }
    }

    private fun observeWebSocket() {
        viewModelScope.launch {
            presenceService.events.collect { event ->
                if (event.type == "new_message") loadMessages()
            }
        }
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }
}
