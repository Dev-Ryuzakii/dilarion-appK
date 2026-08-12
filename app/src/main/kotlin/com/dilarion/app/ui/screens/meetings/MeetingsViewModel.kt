package com.dilarion.app.ui.screens.meetings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.MeetingCreateRequest
import com.dilarion.app.data.model.MeetingSummary
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MeetingsUiState(
    val meetings: List<MeetingSummary> = emptyList(),
    val isLoading: Boolean = true,
    val error: String? = null,
    // Schedule form
    val showForm: Boolean = false,
    val users: List<UserInfo> = emptyList(),
    val loadingUsers: Boolean = false,
    val title: String = "",
    val scheduledAtMillis: Long? = null,
    val selected: Set<String> = emptySet(),
    val scheduling: Boolean = false,
    val waitingRoomEnabled: Boolean = false,
)

@HiltViewModel
class MeetingsViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MeetingsUiState())
    val uiState: StateFlow<MeetingsUiState> = _uiState

    private var currentUsername: String = ""

    init {
        viewModelScope.launch {
            currentUsername = sessionManager.username.first() ?: ""
            loadMeetings()
        }
    }

    fun loadMeetings() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                val resp = apiService.getUpcomingMeetings("Bearer $token")
                val meetings = resp.body()?.meetings ?: emptyList()
                _uiState.value = _uiState.value.copy(isLoading = false, meetings = meetings)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.message)
            }
        }
    }

    fun openForm() {
        _uiState.value = _uiState.value.copy(showForm = true, title = "", scheduledAtMillis = null, selected = emptySet())
        if (_uiState.value.users.isEmpty()) loadUsers()
    }

    fun closeForm() {
        _uiState.value = _uiState.value.copy(showForm = false)
    }

    private fun loadUsers() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(loadingUsers = true)
            runCatching {
                val resp = apiService.getUsers("Bearer $token")
                val users = resp.body()
                    ?.filter { it.username != null && it.username != currentUsername }
                    ?: emptyList()
                _uiState.value = _uiState.value.copy(loadingUsers = false, users = users)
            }.onFailure {
                _uiState.value = _uiState.value.copy(loadingUsers = false)
            }
        }
    }

    fun setTitle(t: String) { _uiState.value = _uiState.value.copy(title = t) }

    fun setWaitingRoomEnabled(enabled: Boolean) { _uiState.value = _uiState.value.copy(waitingRoomEnabled = enabled) }

    fun setScheduledAt(millis: Long?) { _uiState.value = _uiState.value.copy(scheduledAtMillis = millis) }

    fun toggle(username: String) {
        _uiState.value = _uiState.value.copy(
            selected = _uiState.value.selected.let {
                if (it.contains(username)) it - username else it + username
            }
        )
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    fun schedule() {
        val when_ = _uiState.value.scheduledAtMillis ?: return
        if (_uiState.value.scheduling) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(scheduling = true, error = null)
            runCatching {
                val isoInstant = java.time.Instant.ofEpochMilli(when_).toString()
                apiService.createMeeting(
                    "Bearer $token",
                    MeetingCreateRequest(
                        title = _uiState.value.title.trim().ifEmpty { null },
                        scheduledAt = isoInstant,
                        inviteeUsernames = _uiState.value.selected.toList(),
                        waitingRoomEnabled = _uiState.value.waitingRoomEnabled,
                    )
                )
                _uiState.value = _uiState.value.copy(scheduling = false, showForm = false, waitingRoomEnabled = false)
                loadMeetings()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(scheduling = false, error = e.message ?: "Failed to schedule meeting")
            }
        }
    }

    fun cancelMeeting(meetingId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.cancelMeeting("Bearer $token", meetingId)
                _uiState.value = _uiState.value.copy(meetings = _uiState.value.meetings.filter { it.id != meetingId })
            }
        }
    }

    fun isMine(meeting: MeetingSummary): Boolean = meeting.creatorUsername == currentUsername
}
