package com.dilarion.app.ui.screens.calls

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.CallActionRequest
import com.dilarion.app.data.model.CallInitiateRequest
import com.dilarion.app.data.model.IceCandidateRequest
import com.dilarion.app.data.model.IncomingCallData
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.NotificationHelper
import com.dilarion.app.services.PresenceService
import com.dilarion.app.webrtc.WebRtcManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.VideoTrack
import javax.inject.Inject

enum class CallState { IDLE, CALLING, RINGING, CONNECTED, INCOMING, ENDED }
enum class CallType { VOICE, VIDEO }

data class ConferenceUiState(
    val conferenceId: Int? = null,
    val participants: List<String> = emptyList(),
    val isActive: Boolean = false,
)

data class CallUiState(
    val state: CallState = CallState.IDLE,
    val peerUsername: String = "",
    val callId: Int? = null,
    val callType: CallType = CallType.VOICE,
    val durationSeconds: Int = 0,
    val isMuted: Boolean = false,
    val isSpeaker: Boolean = false,
    val networkQuality: Int = 4,  // 0=poor … 4=excellent
    val error: String? = null,
)

@HiltViewModel
class CallViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
    private val webRtcManager: WebRtcManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CallUiState())
    val uiState: StateFlow<CallUiState> = _uiState

    private val _conferenceState = MutableStateFlow(ConferenceUiState())
    val conferenceState: StateFlow<ConferenceUiState> = _conferenceState

    val localVideo: StateFlow<VideoTrack?> = webRtcManager.localVideo
    val remoteVideo: StateFlow<VideoTrack?> = webRtcManager.remoteVideo
    val conferenceRemoteVideos = webRtcManager.conferenceRemoteVideos
    val eglBaseContext: EglBase.Context get() = webRtcManager.eglBaseContext

    private val _users = MutableStateFlow<List<UserInfo>>(emptyList())
    val users: StateFlow<List<UserInfo>> = _users

    private var timerJob: kotlinx.coroutines.Job? = null
    private var wsObserverJob: kotlinx.coroutines.Job? = null
    private var pendingCandidates = mutableListOf<IceCandidate>()
    private var storedOfferSdp: String? = null
    // Buffer ICE candidates from remote until we set remote description (handleOffer)
    private var remoteDescSet = false
    private val pendingRemoteCandidates = mutableListOf<Triple<String, Int, String>>()

    fun startOutgoingCall(peerUsername: String, type: CallType) {
        remoteDescSet = false
        pendingRemoteCandidates.clear()
        _uiState.value = CallUiState(state = CallState.CALLING, peerUsername = peerUsername, callType = type)
        observeWsEvents()
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                webRtcManager.initialize()
                webRtcManager.startLocalStream(withVideo = type == CallType.VIDEO)
                webRtcManager.createPeerConnection(onIce = { candidate ->
                    viewModelScope.launch { sendIceCandidate(peerUsername, candidate) }
                })
                val offerSdp = webRtcManager.createOffer()
                val resp = apiService.initiateCall(
                    "Bearer $token",
                    CallInitiateRequest(peerUsername, if (type == CallType.VIDEO) "video" else "voice", offerSdp),
                )
                val callId = resp.body()?.callId
                if (callId != null) {
                    // Stay CALLING until WS confirms callee received; state → RINGING via WS "calling" event
                    _uiState.value = _uiState.value.copy(callId = callId)
                    flushPendingCandidates(token, peerUsername, callId)
                } else {
                    _uiState.value = _uiState.value.copy(error = "Failed to initiate call", state = CallState.ENDED)
                }
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.message, state = CallState.ENDED)
            }
        }
    }

    fun setIncoming(incoming: IncomingCallData) {
        remoteDescSet = false
        pendingRemoteCandidates.clear()
        storedOfferSdp = incoming.offerSdp
        _uiState.value = CallUiState(
            state = CallState.INCOMING,
            peerUsername = incoming.callerUsername,
            callId = incoming.callId,
            callType = if (incoming.callType == "video") CallType.VIDEO else CallType.VOICE,
        )
        observeWsEvents()
        viewModelScope.launch {
            runCatching {
                webRtcManager.initialize()
                webRtcManager.startLocalStream(withVideo = incoming.callType == "video")
                webRtcManager.createPeerConnection(onIce = { candidate ->
                    viewModelScope.launch { sendIceCandidate(incoming.callerUsername, candidate) }
                })
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
        // Tell caller our device is ringing
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.callAction("Bearer $token", CallActionRequest(incoming.callId, "ringing"))
            }
        }
    }

    fun acceptCall(masterToken: String) {
        NotificationHelper.stopRingtone()
        val callId = _uiState.value.callId ?: return
        val peerUsername = _uiState.value.peerUsername
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val offerSdp = storedOfferSdp
                val answerSdp = if (offerSdp != null) webRtcManager.handleOffer(offerSdp) else null
                // Remote desc is now set — apply any ICE candidates that arrived before accept
                remoteDescSet = true
                pendingRemoteCandidates.forEach { (mid, idx, cand) ->
                    webRtcManager.addIceCandidate(mid, idx, cand)
                }
                pendingRemoteCandidates.clear()
                apiService.callAction(
                    "Bearer $token",
                    CallActionRequest(callId, "accept", answerSdp = answerSdp, mastertoken = masterToken),
                )
                flushPendingCandidates(token, peerUsername, callId)
                _uiState.value = _uiState.value.copy(state = CallState.CONNECTED)
                startTimer()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(error = e.message)
            }
        }
    }

    fun declineCall() {
        NotificationHelper.stopRingtone()
        val callId = _uiState.value.callId ?: run {
            _uiState.value = _uiState.value.copy(state = CallState.ENDED)
            return
        }
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.callAction("Bearer $token", CallActionRequest(callId, "decline")) }
            _uiState.value = _uiState.value.copy(state = CallState.ENDED)
        }
    }

    fun endCall() {
        timerJob?.cancel()
        val callId = _uiState.value.callId
        viewModelScope.launch {
            if (callId != null) {
                val token = sessionManager.sessionToken.first() ?: return@launch
                runCatching { apiService.callAction("Bearer $token", CallActionRequest(callId, "end")) }
            }
            _uiState.value = _uiState.value.copy(state = CallState.ENDED)
        }
    }

    fun toggleMute() {
        val muted = !_uiState.value.isMuted
        _uiState.value = _uiState.value.copy(isMuted = muted)
        webRtcManager.setMuted(muted)
    }

    fun toggleSpeaker() {
        val speaker = !_uiState.value.isSpeaker
        _uiState.value = _uiState.value.copy(isSpeaker = speaker)
        webRtcManager.setSpeaker(speaker)
    }

    fun flipCamera() { webRtcManager.flipCamera() }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    fun fetchUsers() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val resp = apiService.getUsers("Bearer $token")
                if (resp.isSuccessful) _users.value = resp.body() ?: emptyList()
            }
        }
    }

    fun resetToIdle() {
        timerJob?.cancel()
        wsObserverJob?.cancel()
        wsObserverJob = null
        _uiState.value = CallUiState()
        _conferenceState.value = ConferenceUiState()
        remoteDescSet = false
        pendingRemoteCandidates.clear()
        pendingCandidates.clear()
        storedOfferSdp = null
    }

    private fun observeWsEvents() {
        if (wsObserverJob?.isActive == true) return
        wsObserverJob = viewModelScope.launch {
            presenceService.events.collect { event ->
                val data = event.data ?: return@collect
                when (event.type) {
                    "call_status_update" -> {
                        val callId = data.get("call_id")?.asInt ?: return@collect
                        if (callId != _uiState.value.callId) return@collect
                        when (data.get("status")?.asString) {
                            "accept", "accepted" -> {
                                val answerSdp = data.get("answer_sdp")?.asString
                                if (answerSdp != null) webRtcManager.handleAnswer(answerSdp)
                                // Caller: remote desc now set — flush any buffered remote ICE candidates
                                remoteDescSet = true
                                pendingRemoteCandidates.forEach { (mid, idx, cand) ->
                                    webRtcManager.addIceCandidate(mid, idx, cand)
                                }
                                pendingRemoteCandidates.clear()
                                _uiState.value = _uiState.value.copy(state = CallState.CONNECTED)
                                startTimer()
                            }
                            "calling" -> _uiState.value = _uiState.value.copy(state = CallState.RINGING)
                            "ringing" -> _uiState.value = _uiState.value.copy(state = CallState.RINGING)
                            "decline", "declined", "end", "busy" -> {
                                timerJob?.cancel()
                                _uiState.value = _uiState.value.copy(state = CallState.ENDED)
                            }
                        }
                    }
                    "ice_candidate" -> {
                        val callIdEvt = data.get("call_id")?.asInt ?: return@collect
                        if (callIdEvt != _uiState.value.callId) return@collect
                        val candidateObj = runCatching { data.getAsJsonObject("candidate") }.getOrNull() ?: return@collect
                        val sdpMid = candidateObj.get("sdpMid")?.asString ?: return@collect
                        val sdpMLineIndex = candidateObj.get("sdpMLineIndex")?.asInt ?: 0
                        val candidateStr = candidateObj.get("candidate")?.asString ?: return@collect
                        if (!remoteDescSet) {
                            pendingRemoteCandidates.add(Triple(sdpMid, sdpMLineIndex, candidateStr))
                        } else {
                            webRtcManager.addIceCandidate(sdpMid, sdpMLineIndex, candidateStr)
                        }
                    }

                    // ── Conference signaling ──────────────────────────────────
                    "conference_invite" -> {
                        val confId = data.get("conference_id")?.asInt ?: return@collect
                        val invitedBy = data.get("invited_by")?.asString ?: return@collect
                        val existing = data.getAsJsonArray("existing_participants")
                            ?.map { it.asString } ?: emptyList()
                        _conferenceState.value = ConferenceUiState(
                            conferenceId = confId,
                            participants = existing,
                            isActive = true,
                        )
                        // Create peer connections to all existing participants
                        val token = sessionManager.sessionToken.first() ?: return@collect
                        existing.forEach { peerUsername ->
                            webRtcManager.createConferencePeer(peerUsername) { candidate ->
                                viewModelScope.launch {
                                    sendConferenceSignal(token, confId, peerUsername, "ice_candidate", mapOf(
                                        "sdpMid" to candidate.sdpMid,
                                        "sdpMLineIndex" to candidate.sdpMLineIndex,
                                        "candidate" to candidate.sdp,
                                    ))
                                }
                            }
                        }
                    }

                    "conference_peer_connect" -> {
                        val confId = data.get("conference_id")?.asInt ?: return@collect
                        val peerUsername = data.get("peer_username")?.asString ?: return@collect
                        val role = data.get("role")?.asString ?: "offer"
                        val token = sessionManager.sessionToken.first() ?: return@collect
                        webRtcManager.createConferencePeer(peerUsername) { candidate ->
                            viewModelScope.launch {
                                sendConferenceSignal(token, confId, peerUsername, "ice_candidate", mapOf(
                                    "sdpMid" to candidate.sdpMid,
                                    "sdpMLineIndex" to candidate.sdpMLineIndex,
                                    "candidate" to candidate.sdp,
                                ))
                            }
                        }
                        if (role == "offer") {
                            val offerSdp = webRtcManager.createConferenceOffer(peerUsername) ?: return@collect
                            sendConferenceSignal(token, confId, peerUsername, "offer", mapOf("sdp" to offerSdp))
                        }
                        val prev = _conferenceState.value
                        _conferenceState.value = prev.copy(
                            conferenceId = confId,
                            participants = (prev.participants + peerUsername).distinct(),
                            isActive = true,
                        )
                    }

                    "conference_signal" -> {
                        val confId = data.get("conference_id")?.asInt ?: return@collect
                        val fromUser = data.get("from")?.asString ?: return@collect
                        val signalType = data.get("signal_type")?.asString ?: return@collect
                        val signalData = runCatching { data.getAsJsonObject("data") }.getOrNull() ?: return@collect
                        val token = sessionManager.sessionToken.first() ?: return@collect
                        when (signalType) {
                            "offer" -> {
                                val sdp = signalData.get("sdp")?.asString ?: return@collect
                                val answer = webRtcManager.handleConferenceOffer(fromUser, sdp) ?: return@collect
                                sendConferenceSignal(token, confId, fromUser, "answer", mapOf("sdp" to answer))
                            }
                            "answer" -> {
                                val sdp = signalData.get("sdp")?.asString ?: return@collect
                                webRtcManager.handleConferenceAnswer(fromUser, sdp)
                            }
                            "ice_candidate" -> {
                                val mid = signalData.get("sdpMid")?.asString ?: return@collect
                                val idx = signalData.get("sdpMLineIndex")?.asInt ?: 0
                                val cand = signalData.get("candidate")?.asString ?: return@collect
                                webRtcManager.addConferenceIceCandidate(fromUser, mid, idx, cand)
                            }
                        }
                    }

                    "conference_participant_left" -> {
                        val peerUsername = data.get("username")?.asString ?: return@collect
                        webRtcManager.removeConferencePeer(peerUsername)
                        val prev = _conferenceState.value
                        val updated = prev.participants.filter { it != peerUsername }
                        _conferenceState.value = prev.copy(
                            participants = updated,
                            isActive = updated.isNotEmpty(),
                        )
                    }
                }
            }
        }
    }

    fun startConference(callId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val resp = apiService.createConference("Bearer $token", mapOf("call_id" to callId))
                if (resp.isSuccessful) {
                    val confId = resp.body()?.get("conference_id")?.asInt
                    if (confId != null) {
                        _conferenceState.value = ConferenceUiState(
                            conferenceId = confId,
                            participants = listOf(_uiState.value.peerUsername),
                            isActive = true,
                        )
                    }
                }
            }
        }
    }

    fun startConferenceAndInvite(callId: Int, username: String) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val existingConfId = _conferenceState.value.conferenceId
                val confId = if (existingConfId != null) {
                    existingConfId
                } else {
                    val resp = apiService.createConference("Bearer $token", mapOf("call_id" to callId))
                    if (resp.isSuccessful) {
                        val id = resp.body()?.get("conference_id")?.asInt
                        if (id != null) {
                            _conferenceState.value = ConferenceUiState(
                                conferenceId = id,
                                participants = listOf(_uiState.value.peerUsername),
                                isActive = true,
                            )
                        }
                        id
                    } else null
                }
                if (confId != null) {
                    apiService.conferenceInvite("Bearer $token", confId, mapOf("username" to username))
                }
            }
        }
    }

    fun inviteToConference(username: String) {
        val confId = _conferenceState.value.conferenceId ?: return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.conferenceInvite("Bearer $token", confId, mapOf("username" to username))
            }
        }
    }

    fun leaveConference() {
        val confId = _conferenceState.value.conferenceId ?: return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.conferenceLeave("Bearer $token", confId) }
            webRtcManager.closeConference()
            _conferenceState.value = ConferenceUiState()
        }
    }

    private suspend fun sendConferenceSignal(token: String, confId: Int, to: String, signalType: String, data: Any) {
        runCatching {
            apiService.conferenceSignal("Bearer $token", confId, mapOf(
                "to" to to,
                "signal_type" to signalType,
                "data" to data,
            ))
        }
    }

    private suspend fun sendIceCandidate(peerUsername: String, candidate: IceCandidate) {
        val callId = _uiState.value.callId
        if (callId == null) {
            pendingCandidates.add(candidate)
            return
        }
        val token = sessionManager.sessionToken.first() ?: return
        runCatching {
            apiService.sendIceCandidate(
                "Bearer $token",
                IceCandidateRequest(
                    callId = callId,
                    recipientUsername = peerUsername,
                    candidate = mapOf(
                        "sdpMid" to candidate.sdpMid,
                        "sdpMLineIndex" to candidate.sdpMLineIndex,
                        "candidate" to candidate.sdp,
                    ),
                ),
            )
        }
    }

    private suspend fun flushPendingCandidates(token: String, peerUsername: String, callId: Int) {
        pendingCandidates.forEach { candidate ->
            runCatching {
                apiService.sendIceCandidate(
                    "Bearer $token",
                    IceCandidateRequest(
                        callId = callId,
                        recipientUsername = peerUsername,
                        candidate = mapOf(
                            "sdpMid" to candidate.sdpMid,
                            "sdpMLineIndex" to candidate.sdpMLineIndex,
                            "candidate" to candidate.sdp,
                        ),
                    ),
                )
            }
        }
        pendingCandidates.clear()
    }

    private fun startTimer() {
        timerJob = viewModelScope.launch {
            var tick = 0
            while (true) {
                kotlinx.coroutines.delay(1000)
                tick++
                val update = _uiState.value.copy(durationSeconds = _uiState.value.durationSeconds + 1)
                _uiState.value = update
                // Poll network quality every 2s
                if (tick % 2 == 0) {
                    webRtcManager.getNetworkQuality { quality ->
                        _uiState.value = _uiState.value.copy(networkQuality = quality)
                    }
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        timerJob?.cancel()
        webRtcManager.closeCall()
    }
}
