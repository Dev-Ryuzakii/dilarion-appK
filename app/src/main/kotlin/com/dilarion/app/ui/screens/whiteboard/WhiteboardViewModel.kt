package com.dilarion.app.ui.screens.whiteboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.WhiteboardClearRequest
import com.dilarion.app.data.model.WhiteboardOpenRequest
import com.dilarion.app.data.model.WhiteboardStroke
import com.dilarion.app.data.model.WhiteboardStrokeRequest
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Ephemeral for v1 — strokes relay live via WS, nothing persisted server-side. */
@HiltViewModel
class WhiteboardViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    presenceService: PresenceService,
) : ViewModel() {

    val events: SharedFlow<com.dilarion.app.data.model.WsMessage> = presenceService.events

    fun sendStroke(username: String?, groupId: Int?, conferenceId: Int?, stroke: WhiteboardStroke) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.whiteboardStroke("Bearer $token", WhiteboardStrokeRequest(username, groupId, conferenceId, stroke))
            }
        }
    }

    fun sendClear(username: String?, groupId: Int?, conferenceId: Int?) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.whiteboardClear("Bearer $token", WhiteboardClearRequest(username, groupId, conferenceId))
            }
        }
    }

    fun sendClose(conferenceId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.whiteboardClose("Bearer $token", WhiteboardOpenRequest(conferenceId))
            }
        }
    }
}
