package com.dilarion.app.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.Group
import com.dilarion.app.data.model.Message
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
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
    val currentUsername: String = "",
    val error: String? = null,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState

    init {
        viewModelScope.launch {
            val username = sessionManager.username.first() ?: ""
            _uiState.value = _uiState.value.copy(currentUsername = username)
            loadData()
            observeWebSocket()
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
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = e.message,
                )
            }
        }
    }

    private fun observeWebSocket() {
        viewModelScope.launch {
            presenceService.events.collect { event ->
                if (event.type == "new_message" || event.type == "message") {
                    loadData()
                }
            }
        }
    }

    suspend fun getBearer(): String {
        return "Bearer ${sessionManager.sessionToken.first() ?: ""}"
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }
}
