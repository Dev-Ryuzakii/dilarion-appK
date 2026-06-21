package com.dilarion.app.ui.screens.calls

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.model.IncomingCallData
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.CallActionRequest
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MinimizedCallInfo(
    val callId: Int,
    val partner: String,
    val durationSeconds: Int = 0,
)

@HiltViewModel
class CallOverlayViewModel @Inject constructor(
    private val presenceService: PresenceService,
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _incomingCall = MutableStateFlow<IncomingCallData?>(null)
    val incomingCall: StateFlow<IncomingCallData?> = _incomingCall

    private val _minimizedCall = MutableStateFlow<MinimizedCallInfo?>(null)
    val minimizedCall: StateFlow<MinimizedCallInfo?> = _minimizedCall

    private var durationJob: Job? = null

    init {
        viewModelScope.launch {
            presenceService.events.collect { event ->
                if (event.type == "incoming_call") {
                    val data = event.data ?: return@collect
                    val callId = data.get("call_id")?.asInt ?: return@collect
                    val caller = data.get("caller_username")?.asString ?: ""
                    val callType = data.get("call_type")?.asString ?: "voice"
                    val offerSdp = data.get("offer_sdp")?.asString
                    _incomingCall.value = IncomingCallData(callId, caller, callType, offerSdp)
                }
            }
        }
    }

    fun clear() { _incomingCall.value = null }

    fun setFromNotification(call: IncomingCallData) {
        _incomingCall.value = call
    }

    fun setMinimized(callId: Int, partner: String) {
        _minimizedCall.value = MinimizedCallInfo(callId, partner, 0)
        durationJob?.cancel()
        durationJob = viewModelScope.launch {
            while (isActive) {
                delay(1000)
                val cur = _minimizedCall.value ?: break
                _minimizedCall.value = cur.copy(durationSeconds = cur.durationSeconds + 1)
            }
        }
    }

    fun clearMinimized() {
        durationJob?.cancel()
        _minimizedCall.value = null
    }

    fun endMinimizedCall() {
        val info = _minimizedCall.value ?: return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.callAction("Bearer $token", CallActionRequest(info.callId, "end"))
            }
            clearMinimized()
        }
    }
}
