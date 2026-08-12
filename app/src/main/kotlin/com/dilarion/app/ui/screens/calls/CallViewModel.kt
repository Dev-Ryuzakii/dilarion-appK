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
import com.dilarion.app.webrtc.CallSession
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
    /** Usernames currently muted, so the UI can show who is not speaking. */
    val mutedParticipants: Set<String> = emptySet(),
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
    /** Server rejected the master token — ask again without dropping the call. */
    val masterTokenRejected: Boolean = false,
    /** Whether the person on the other end has muted their microphone. */
    val peerMuted: Boolean = false,
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
    private var answerPollJob: kotlinx.coroutines.Job? = null
    private var wsObserverJob: kotlinx.coroutines.Job? = null
    private var pendingCandidates = mutableListOf<IceCandidate>()
    private var storedOfferSdp: String? = null
    // Answer kept so a rejected master token can be retried without rebuilding it.
    private var cachedAnswerSdp: String? = null
    // Buffer ICE candidates from remote until we set remote description (handleOffer)
    private var remoteDescSet = false
    private val pendingRemoteCandidates = mutableListOf<Triple<String, Int, String>>()

    fun startOutgoingCall(peerUsername: String, type: CallType) {
        // Drop anything left over from a previous call before building a new one,
        // otherwise the old PeerConnection keeps the mic/audio alive and the new
        // offer is created on a stale connection.
        webRtcManager.closeCall()
        timerJob?.cancel()
        remoteDescSet = false
        pendingCandidates.clear()
        pendingRemoteCandidates.clear()
        storedOfferSdp = null
        cachedAnswerSdp = null
        _uiState.value = CallUiState(state = CallState.CALLING, peerUsername = peerUsername, callType = type)
        observeWsEvents()
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                webRtcManager.initialize()
                refreshIceServers(token)
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
                    rememberSession()
                    flushPendingCandidates(token, peerUsername, callId)
                    pollForAnswer(token, callId)
                } else {
                    teardownMedia()
                    _uiState.value = _uiState.value.copy(error = "Failed to initiate call", state = CallState.ENDED)
                }
            }.onFailure { e ->
                teardownMedia()
                _uiState.value = _uiState.value.copy(error = e.message, state = CallState.ENDED)
            }
        }
    }

    fun setIncoming(incoming: IncomingCallData) {
        webRtcManager.closeCall()
        timerJob?.cancel()
        remoteDescSet = false
        pendingCandidates.clear()
        pendingRemoteCandidates.clear()
        cachedAnswerSdp = null
        storedOfferSdp = incoming.offerSdp
        _uiState.value = CallUiState(
            state = CallState.INCOMING,
            peerUsername = incoming.callerUsername,
            callId = incoming.callId,
            callType = if (incoming.callType == "video") CallType.VIDEO else CallType.VOICE,
        )
        rememberSession()
        observeWsEvents()
        viewModelScope.launch {
            runCatching {
                webRtcManager.initialize()
                sessionManager.sessionToken.first()?.let { refreshIceServers(it) }
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
                    ?: throw Exception("Call offer missing — ask them to call again")

                // Build the answer once. A rejected master token leaves the call
                // alive for a retry, and handleOffer() cannot run twice on the
                // same peer connection — the second call fails on SDP state.
                val answerSdp = cachedAnswerSdp ?: webRtcManager.handleOffer(offerSdp).also {
                    cachedAnswerSdp = it
                    remoteDescSet = true
                    pendingRemoteCandidates.forEach { (mid, idx, cand) ->
                        webRtcManager.addIceCandidate(mid, idx, cand)
                    }
                    pendingRemoteCandidates.clear()
                }

                val resp = apiService.callAction(
                    "Bearer $token",
                    CallActionRequest(
                        callId, "accept",
                        answerSdp = answerSdp,
                        mastertoken = masterToken,
                    ),
                )
                // Retrofit does not throw on 4xx/5xx. Without this check a rejected
                // accept still flipped us to CONNECTED while the caller — never
                // sent the answer — kept ringing.
                if (resp.code() == 401) {
                    // Wrong token is a typo, not a reason to hang up on someone:
                    // keep the call ringing and let them try again.
                    _uiState.value = _uiState.value.copy(masterTokenRejected = true)
                    return@runCatching
                }
                if (!resp.isSuccessful) {
                    throw Exception(
                        when (resp.code()) {
                            404 -> "Call no longer exists"
                            else -> "Could not accept call (${resp.code()})"
                        }
                    )
                }
                flushPendingCandidates(token, peerUsername, callId)
                _uiState.value = _uiState.value.copy(
                    state = CallState.CONNECTED,
                    masterTokenRejected = false,
                )
                rememberSession()
                startTimer()
            }.onFailure { e ->
                // Unrecoverable — the caller was never told, so do not sit in a
                // half-open state pretending to be connected.
                teardownMedia()
                _uiState.value = _uiState.value.copy(state = CallState.ENDED, error = e.message)
            }
        }
    }

    fun clearMasterTokenRejected() {
        _uiState.value = _uiState.value.copy(masterTokenRejected = false)
    }

    fun declineCall() {
        NotificationHelper.stopRingtone()
        val callId = _uiState.value.callId
        // Tear the media down first — the connection must die even if the API call
        // fails or the token read returns null.
        teardownMedia()
        _uiState.value = _uiState.value.copy(state = CallState.ENDED)
        if (callId == null) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.callAction("Bearer $token", CallActionRequest(callId, "decline")) }
        }
    }

    fun endCall() {
        NotificationHelper.stopRingtone()
        val callId = _uiState.value.callId
        teardownMedia()
        _uiState.value = _uiState.value.copy(state = CallState.ENDED)
        if (callId == null) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.callAction("Bearer $token", CallActionRequest(callId, "end")) }
        }
    }

    /**
     * Safety net for the caller: if the accept push never arrives over the
     * WebSocket we would ring forever while the callee sits in a live call.
     * Poll the call until it is answered, ended, or we give up.
     */
    private fun pollForAnswer(token: String, callId: Int) {
        answerPollJob?.cancel()
        answerPollJob = viewModelScope.launch {
            repeat(60) {  // ~2 minutes, matching how long a phone realistically rings
                kotlinx.coroutines.delay(2000)
                val st = _uiState.value
                if (st.callId != callId) return@launch
                if (st.state != CallState.CALLING && st.state != CallState.RINGING) return@launch

                val body = runCatching {
                    apiService.getCallStatus("Bearer $token", callId).body()
                }.getOrNull() ?: return@repeat

                when (body.status) {
                    "accept", "accepted" -> {
                        val sdp = body.answerSdp ?: return@repeat
                        if (remoteDescSet) return@launch  // the WS push already handled it
                        webRtcManager.handleAnswer(sdp)
                        remoteDescSet = true
                        pendingRemoteCandidates.forEach { (mid, idx, cand) ->
                            webRtcManager.addIceCandidate(mid, idx, cand)
                        }
                        pendingRemoteCandidates.clear()
                        _uiState.value = _uiState.value.copy(state = CallState.CONNECTED)
                        rememberSession()
                        startTimer()
                        return@launch
                    }
                    "decline", "declined", "end", "busy" -> {
                        teardownMedia()
                        _uiState.value = _uiState.value.copy(state = CallState.ENDED)
                        return@launch
                    }
                    "ringing" -> _uiState.value = _uiState.value.copy(state = CallState.RINGING)
                }
            }
        }
    }

    /**
     * Pull short-lived TURN credentials from the backend before building the peer
     * connection. Failures are ignored on purpose — WebRtcManager then keeps its
     * built-in server list, so a backend hiccup degrades quality, not availability.
     */
    private suspend fun refreshIceServers(token: String) {
        runCatching {
            val resp = apiService.getIceServers("Bearer $token")
            val servers = resp.body()?.iceServers.orEmpty()
            if (servers.isNotEmpty()) {
                webRtcManager.setIceServers(
                    servers.map { Triple(it.urls, it.username, it.credential) }
                )
            }
        }
    }

    /** Close the peer connection, stop capture/audio and drop all signaling buffers. */
    private fun teardownMedia() {
        timerJob?.cancel()
        timerJob = null
        answerPollJob?.cancel()
        answerPollJob = null
        webRtcManager.closeCall()
        remoteDescSet = false
        pendingCandidates.clear()
        pendingRemoteCandidates.clear()
        storedOfferSdp = null
        cachedAnswerSdp = null
        _conferenceState.value = ConferenceUiState()
    }

    fun toggleMute() {
        val muted = !_uiState.value.isMuted
        _uiState.value = _uiState.value.copy(isMuted = muted)
        webRtcManager.setMuted(muted)
        broadcastMuteState(muted)
    }

    /**
     * Publish our mic state. WebRTC carries no such signal — a muted track is
     * just silence — so the other side has no way to know without being told.
     */
    private fun broadcastMuteState(muted: Boolean) {
        val callId = _uiState.value.callId
        val conf = _conferenceState.value
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            if (callId != null) {
                runCatching {
                    apiService.setCallMediaState("Bearer $token", callId, mapOf("muted" to muted))
                }
            }
            val confId = conf.conferenceId
            if (confId != null) {
                conf.participants.forEach { peer ->
                    sendConferenceSignal(token, confId, peer, "media_state", mapOf("muted" to muted))
                }
            }
        }
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
        timerJob = null
        answerPollJob?.cancel()
        answerPollJob = null
        wsObserverJob?.cancel()
        wsObserverJob = null
        _uiState.value = CallUiState()
        _conferenceState.value = ConferenceUiState()
        remoteDescSet = false
        pendingRemoteCandidates.clear()
        pendingCandidates.clear()
        storedOfferSdp = null
        cachedAnswerSdp = null
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
                                rememberSession()
                                startTimer()
                            }
                            "calling" -> _uiState.value = _uiState.value.copy(state = CallState.RINGING)
                            "ringing" -> _uiState.value = _uiState.value.copy(state = CallState.RINGING)
                            "decline", "declined", "end", "busy" -> {
                                // Remote hung up — kill our side of the media too,
                                // otherwise both peers keep hearing each other.
                                NotificationHelper.stopRingtone()
                                teardownMedia()
                                _uiState.value = _uiState.value.copy(state = CallState.ENDED)
                            }
                        }
                    }
                    "call_media_state" -> {
                        val callIdEvt = data.get("call_id")?.asInt ?: return@collect
                        if (callIdEvt != _uiState.value.callId) return@collect
                        val muted = data.get("muted")?.asBoolean ?: false
                        val who = data.get("username")?.asString
                        _uiState.value = _uiState.value.copy(peerMuted = muted)
                        if (who != null) {
                            val cur = _conferenceState.value
                            _conferenceState.value = cur.copy(
                                mutedParticipants = if (muted) cur.mutedParticipants + who
                                else cur.mutedParticipants - who
                            )
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
                                // A newly joined invitee gets offers without ever
                                // seeing conference_peer_connect, so the peer may
                                // not exist yet — create it before answering.
                                if (!webRtcManager.hasConferencePeer(fromUser)) {
                                    webRtcManager.createConferencePeer(fromUser) { candidate ->
                                        viewModelScope.launch {
                                            sendConferenceSignal(token, confId, fromUser, "ice_candidate", mapOf(
                                                "sdpMid" to candidate.sdpMid,
                                                "sdpMLineIndex" to candidate.sdpMLineIndex,
                                                "candidate" to candidate.sdp,
                                            ))
                                        }
                                    }
                                }
                                val answer = webRtcManager.handleConferenceOffer(fromUser, sdp) ?: return@collect
                                sendConferenceSignal(token, confId, fromUser, "answer", mapOf("sdp" to answer))
                                _conferenceState.value = _conferenceState.value.copy(
                                    conferenceId = confId,
                                    participants = (_conferenceState.value.participants + fromUser).distinct(),
                                    isActive = true,
                                )
                            }
                            "answer" -> {
                                val sdp = signalData.get("sdp")?.asString ?: return@collect
                                webRtcManager.handleConferenceAnswer(fromUser, sdp)
                            }
                            "media_state" -> {
                                val muted = signalData.get("muted")?.asBoolean ?: false
                                val cur = _conferenceState.value
                                _conferenceState.value = cur.copy(
                                    mutedParticipants = if (muted) cur.mutedParticipants + fromUser
                                    else cur.mutedParticipants - fromUser
                                )
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

    /**
     * Join a conference we were rung for. Media only starts here — the invitee
     * has answered and authenticated, so their microphone joins the call at this
     * point and not when the invite arrived.
     *
     * Returns null on success, or a message to show the user.
     */
    suspend fun joinConference(conferenceId: Int, masterToken: String): String? {
        val token = sessionManager.sessionToken.first() ?: return "Not signed in"
        return runCatching {
            // Bring the microphone up and start listening for offers BEFORE
            // accepting. /accept makes the existing participants offer to us at
            // once; if our audio track does not exist yet the peer they build
            // has no inbound track from us and they never hear us.
            webRtcManager.initialize()
            refreshIceServers(token)
            webRtcManager.startLocalStream(withVideo = false)
            observeWsEvents()

            val resp = apiService.conferenceAccept(
                "Bearer $token",
                conferenceId,
                mapOf("mastertoken" to masterToken),
            )
            if (resp.code() == 401) return "Master token rejected"
            if (!resp.isSuccessful) return "Could not join the call (${resp.code()})"

            val participants = resp.body()?.getAsJsonArray("participants")
                ?.map { it.asString } ?: emptyList()

            _uiState.value = CallUiState(
                state = CallState.CONNECTED,
                peerUsername = participants.firstOrNull() ?: "",
                callType = CallType.VOICE,
            )
            _conferenceState.value = ConferenceUiState(
                conferenceId = conferenceId,
                participants = participants,
                isActive = true,
            )
            rememberSession()
            startTimer()
            null
        }.getOrElse { it.message ?: "Could not join the call" }
    }

    /**
     * Accept a group-call invite that will render via GalleryScreen (LiveKit),
     * not this ViewModel's mesh path — no webrtcManager/observeWsEvents here,
     * just the REST accept call so the caller can navigate straight to Gallery.
     */
    suspend fun acceptConferenceForGallery(conferenceId: Int, masterToken: String): String? {
        val token = sessionManager.sessionToken.first() ?: return "Not signed in"
        return runCatching {
            val resp = apiService.conferenceAccept(
                "Bearer $token",
                conferenceId,
                mapOf("mastertoken" to masterToken),
            )
            if (resp.code() == 401) return "Master token rejected"
            if (!resp.isSuccessful) return "Could not join the call (${resp.code()})"
            null
        }.getOrElse { it.message ?: "Could not join the call" }
    }

    /**
     * Starts a fresh meeting with no prior 1:1 call — call_id is omitted, which
     * the backend already treats as "standalone conference" (payload.get returns
     * None either way). Mirrors joinConference's media-before-signaling ordering:
     * mic must be up before invitees accept, or the peer connections built on
     * their side have no inbound track from us.
     */
    fun startStandaloneConference(invitees: List<String>) {
        if (invitees.isEmpty()) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                webRtcManager.initialize()
                refreshIceServers(token)
                webRtcManager.startLocalStream(withVideo = false)
                observeWsEvents()

                val resp = apiService.createConference("Bearer $token", emptyMap())
                val confId = resp.body()?.get("conference_id")?.asInt
                    ?: throw IllegalStateException("Failed to start meeting")

                _uiState.value = CallUiState(
                    state = CallState.CONNECTED,
                    peerUsername = invitees.first(),
                    callType = CallType.VOICE,
                )
                _conferenceState.value = ConferenceUiState(
                    conferenceId = confId,
                    participants = invitees,
                    isActive = true,
                )
                rememberSession()
                startTimer()

                invitees.forEach { username ->
                    apiService.conferenceInvite("Bearer $token", confId, mapOf("username" to username))
                }
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    error = e.message ?: "Could not start meeting",
                    state = CallState.ENDED,
                )
            }
        }
    }

    /**
     * Joins a scheduled meeting by code. join_by_code returns {conference_id,
     * participants} in the exact shape createConference+invite does, so this
     * mirrors startStandaloneConference's media-before-signaling ordering —
     * the only difference is the conference already exists (or gets created on
     * our behalf as the first joiner) instead of being created fresh here.
     */
    fun joinScheduledMeeting(joinCode: String, onError: (String) -> Unit = {}) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                webRtcManager.initialize()
                refreshIceServers(token)
                webRtcManager.startLocalStream(withVideo = false)
                observeWsEvents()

                val resp = apiService.joinMeetingByCode(
                    "Bearer $token",
                    com.dilarion.app.data.model.MeetingJoinRequest(joinCode = joinCode)
                )
                if (!resp.isSuccessful) throw IllegalStateException("Could not join the meeting (${resp.code()})")
                val body = resp.body() ?: throw IllegalStateException("Could not join the meeting")

                _uiState.value = CallUiState(
                    state = CallState.CONNECTED,
                    peerUsername = body.participants.firstOrNull() ?: "",
                    callType = CallType.VOICE,
                )
                _conferenceState.value = ConferenceUiState(
                    conferenceId = body.conferenceId,
                    participants = body.participants,
                    isActive = true,
                )
                rememberSession()
                startTimer()
            }.onFailure { e ->
                onError(e.message ?: "Could not join the meeting")
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

    // Snapshot the live call so a minimized-then-reopened screen can reattach.
    private fun rememberSession() {
        val s = _uiState.value
        webRtcManager.setActiveSession(
            CallSession(s.callId ?: 0, s.peerUsername, s.callType == CallType.VIDEO)
        )
    }

    /**
     * When the call screen reopens (after minimizing) a fresh ViewModel is created.
     * If the singleton still holds a live call, restore CONNECTED state and rewire
     * signaling/timer instead of prompting for a new call. Returns true if reattached.
     */
    fun reattachIfActive(): Boolean {
        // The ViewModel is activity-scoped, so it survives a finished call. A left-over
        // ENDED state must not be mistaken for a live call — reset it so the next call
        // starts from the type dialog instead of an empty "?" call screen.
        if (_uiState.value.state == CallState.ENDED) resetToIdle()
        if (_uiState.value.state != CallState.IDLE) return true  // this VM already owns the call
        val session = webRtcManager.activeSession.value
        if (!webRtcManager.hasActiveCall() || session == null) {
            // Stale snapshot with no live connection behind it.
            if (session != null) webRtcManager.setActiveSession(null)
            return false
        }
        if (session.partner.isBlank() || session.callId == 0) {
            webRtcManager.closeCall()
            return false
        }
        _uiState.value = CallUiState(
            state = CallState.CONNECTED,
            peerUsername = session.partner,
            callId = session.callId,
            callType = if (session.isVideo) CallType.VIDEO else CallType.VOICE,
        )
        remoteDescSet = true
        observeWsEvents()
        startTimer()
        return true
    }

    override fun onCleared() {
        super.onCleared()
        timerJob?.cancel()
        // Only tear down the live connection on an actual end. If a call is still
        // active when this ViewModel is cleared, the screen is going away for a
        // minimize / config change — keep the singleton call alive to reattach.
        val st = _uiState.value.state
        if (st == CallState.ENDED || st == CallState.IDLE) {
            webRtcManager.closeCall()
        }
    }
}
