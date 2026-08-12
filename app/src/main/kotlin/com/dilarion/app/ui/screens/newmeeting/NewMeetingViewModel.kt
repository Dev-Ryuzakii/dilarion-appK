package com.dilarion.app.ui.screens.newmeeting

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

data class NewMeetingUiState(
    val users: List<UserInfo> = emptyList(),
    val isLoading: Boolean = true,
    val query: String = "",
    val selected: Set<String> = emptySet(),
    val error: String? = null,
    val starting: Boolean = false,
)

@HiltViewModel
class NewMeetingViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(NewMeetingUiState())
    val uiState: StateFlow<NewMeetingUiState> = _uiState

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

    fun toggle(username: String) {
        _uiState.value = _uiState.value.copy(
            selected = _uiState.value.selected.let {
                if (it.contains(username)) it - username else it + username
            }
        )
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    /**
     * Creates a standalone conference (no prior 1:1 call) and invites everyone
     * selected. Renders via GalleryScreen (LiveKit), not mesh WebRTC - mesh's
     * O(n^2) cost capped group calls at 4 people, LiveKit doesn't have that
     * ceiling. onResult gets the new conferenceId, or an error message.
     */
    fun startMeeting(onResult: (conferenceId: Int?, error: String?) -> Unit) {
        val invitees = _uiState.value.selected.toList()
        if (invitees.isEmpty() || _uiState.value.starting) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(starting = true, error = null)
            runCatching {
                val resp = apiService.createConference("Bearer $token", emptyMap())
                val confId = resp.body()?.get("conference_id")?.asInt
                    ?: throw IllegalStateException("Failed to start meeting")
                invitees.forEach { username ->
                    apiService.conferenceInvite("Bearer $token", confId, mapOf("username" to username))
                }
                confId
            }.onSuccess { confId ->
                _uiState.value = _uiState.value.copy(starting = false)
                onResult(confId, null)
            }.onFailure { e ->
                val msg = e.message ?: "Failed to start meeting"
                _uiState.value = _uiState.value.copy(starting = false, error = msg)
                onResult(null, msg)
            }
        }
    }

    fun filteredUsers(): List<UserInfo> {
        val q = _uiState.value.query.trim().lowercase()
        return if (q.isEmpty()) _uiState.value.users
        else _uiState.value.users.filter { it.username?.lowercase()?.contains(q) == true }
    }
}
