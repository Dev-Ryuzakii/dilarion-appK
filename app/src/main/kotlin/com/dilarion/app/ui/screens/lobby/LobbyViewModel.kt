package com.dilarion.app.ui.screens.lobby

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.MeetingJoinRequest
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LobbyUiState(
    val micOn: Boolean = true,
    val camOn: Boolean = true,
    val displayName: String = "",
    val joining: Boolean = false,
    val error: String? = null,
)

/**
 * Device-setup lobby shown before actually connecting to a group call, and
 * (for scheduled meetings with a waiting room) the join_by_code call that
 * decides whether the caller lands straight in the call or in a waiting
 * screen until the host admits them.
 */
@HiltViewModel
class LobbyViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    presenceService: PresenceService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LobbyUiState())
    val uiState: StateFlow<LobbyUiState> = _uiState

    val events: SharedFlow<com.dilarion.app.data.model.WsMessage> = presenceService.events

    init {
        viewModelScope.launch {
            val me = sessionManager.username.first() ?: return@launch
            if (_uiState.value.displayName.isBlank()) {
                _uiState.value = _uiState.value.copy(displayName = me)
            }
        }
    }

    fun toggleMic() { _uiState.value = _uiState.value.copy(micOn = !_uiState.value.micOn) }
    fun toggleCam() { _uiState.value = _uiState.value.copy(camOn = !_uiState.value.camOn) }
    fun setDisplayName(name: String) { _uiState.value = _uiState.value.copy(displayName = name) }

    fun joinByCode(joinCode: String, onResult: (conferenceId: Int?, status: String?, error: String?) -> Unit) {
        if (_uiState.value.joining) return
        _uiState.value = _uiState.value.copy(joining = true, error = null)
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val resp = apiService.joinMeetingByCode("Bearer $token", MeetingJoinRequest(joinCode = joinCode))
                if (!resp.isSuccessful) {
                    val detail = resp.errorBody()?.string()
                    throw IllegalStateException(detail?.takeIf { it.isNotBlank() } ?: "Could not join the meeting (${resp.code()})")
                }
                resp.body() ?: throw IllegalStateException("Could not join the meeting")
            }.onSuccess { body ->
                _uiState.value = _uiState.value.copy(joining = false)
                onResult(body.conferenceId, body.status, null)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(joining = false, error = e.message)
                onResult(null, null, e.message)
            }
        }
    }
}
