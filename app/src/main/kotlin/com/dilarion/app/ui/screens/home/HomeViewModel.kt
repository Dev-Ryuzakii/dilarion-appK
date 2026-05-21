package com.dilarion.app.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.CallHistoryItem
import com.dilarion.app.data.model.Group
import com.dilarion.app.data.model.Message
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.dilarion.app.webrtc.WebRtcManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val isLoading: Boolean = true,
    val messages: List<Message> = emptyList(),
    val groups: List<Group> = emptyList(),
    val callHistory: List<CallHistoryItem> = emptyList(),
    val isCallHistoryLoading: Boolean = false,
    val currentUsername: String = "",
    val error: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
    private val webRtcManager: WebRtcManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState

    init {
        viewModelScope.launch {
            val username = sessionManager.username.first() ?: ""
            _uiState.value = _uiState.value.copy(currentUsername = username)
            loadData()
            observeWebSocket()
            // Pre-initialize WebRTC factory so first call is fast
            runCatching { webRtcManager.initialize() }
        }
    }

    fun loadData() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(isLoading = true)
            runCatching {
                val bearer = "Bearer $token"
                val messagesResp = apiService.getInbox(bearer)
                val groupsResp   = apiService.getMyGroups(bearer)
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    messages  = messagesResp.body()?.messages ?: emptyList(),
                    groups    = groupsResp.body() ?: emptyList(),
                )
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.message)
            }
        }
    }

    fun loadCallHistory() {
        if (_uiState.value.isCallHistoryLoading) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(isCallHistoryLoading = true)
            runCatching {
                val resp = apiService.getCallHistory("Bearer $token")
                val history = resp.body()?.calls ?: emptyList()
                _uiState.value = _uiState.value.copy(callHistory = history, isCallHistoryLoading = false)
            }.onFailure {
                _uiState.value = _uiState.value.copy(isCallHistoryLoading = false, error = it.message)
            }
        }
    }

    private fun observeWebSocket() {
        viewModelScope.launch {
            presenceService.events.collect { event ->
                if (event.type == "new_message" || event.type == "message") loadData()
            }
        }
    }

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first()
            if (token != null) runCatching { apiService.logout("Bearer $token") }
            presenceService.disconnect()
            sessionManager.clearSession()
            onDone()
        }
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }
}
