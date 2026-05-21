package com.dilarion.app.ui.screens.newchat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class NewChatUiState(
    val users: List<UserInfo> = emptyList(),
    val isLoading: Boolean = true,
    val query: String = "",
    val error: String? = null,
)

@HiltViewModel
class NewChatViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(NewChatUiState())
    val uiState: StateFlow<NewChatUiState> = _uiState

    private var currentUsername: String = ""

    init {
        viewModelScope.launch {
            currentUsername = sessionManager.username.first() ?: ""
            loadUsers()
        }
    }

    fun loadUsers() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                val resp = apiService.getUsers("Bearer $token")
                val users = resp.body()
                    ?.filter { it.username != null && it.username != currentUsername }
                    ?: emptyList()
                _uiState.value = _uiState.value.copy(isLoading = false, users = users)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.message)
            }
        }
    }

    fun setQuery(q: String) { _uiState.value = _uiState.value.copy(query = q) }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    fun filteredUsers(): List<UserInfo> {
        val q = _uiState.value.query.trim().lowercase()
        return if (q.isEmpty()) _uiState.value.users
        else _uiState.value.users.filter { it.username?.lowercase()?.contains(q) == true }
    }
}
