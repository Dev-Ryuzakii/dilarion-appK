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

/** A conference someone is trying to add us to, waiting to be answered. */
data class ConferenceInviteData(
    val conferenceId: Int,
    val invitedBy: String,
    val existingParticipants: List<String>,
)

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

    private val _conferenceInvite = MutableStateFlow<ConferenceInviteData?>(null)
    val conferenceInvite: StateFlow<ConferenceInviteData?> = _conferenceInvite

    private val _minimizedCall = MutableStateFlow<MinimizedCallInfo?>(null)
    val minimizedCall: StateFlow<MinimizedCallInfo?> = _minimizedCall

    private var durationJob: Job? = null

    init {
        viewModelScope.launch {
            presenceService.events.collect { event ->
                val data = event.data ?: return@collect
                when (event.type) {
                    "incoming_call" -> {
                        val callId = data.get("call_id")?.asInt ?: return@collect
                        val caller = data.get("caller_username")?.asString ?: ""
                        val callType = data.get("call_type")?.asString ?: "voice"
                        val offerSdp = data.get("offer_sdp")?.asString
                        _incomingCall.value = IncomingCallData(callId, caller, callType, offerSdp)
                    }
                    // Being added to a live call rings like any other call: the
                    // invitee has to answer before their microphone joins it.
                    "conference_invite" -> {
                        val confId = data.get("conference_id")?.asInt ?: return@collect
                        val invitedBy = data.get("invited_by")?.asString ?: ""
                        val existing = data.getAsJsonArray("existing_participants")
                            ?.map { it.asString } ?: emptyList()
                        _conferenceInvite.value = ConferenceInviteData(confId, invitedBy, existing)
                    }
                }
            }
        }
    }

    fun clear() { _incomingCall.value = null }

    fun clearConferenceInvite() { _conferenceInvite.value = null }

    fun declineConferenceInvite() {
        val invite = _conferenceInvite.value ?: return
        _conferenceInvite.value = null
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.conferenceDecline("Bearer $token", invite.conferenceId) }
        }
    }

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
