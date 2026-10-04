package com.dilarion.app.ui.screens.groupcall

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.GroupCallStartRequest
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.RoomOptions
import io.livekit.android.events.RoomEvent
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class GroupCallTile(
    val identity: String,
    val displayName: String,
    val isLocal: Boolean,
    val isSpeaking: Boolean = false,
    val micOn: Boolean,
    val camOn: Boolean,
    val videoTrack: VideoTrack?,
)

enum class GroupCallStatus { CONNECTING, RINGING, ACTIVE, ENDED }

data class GroupCallUiState(
    val status: GroupCallStatus = GroupCallStatus.CONNECTING,
    val endReason: String? = null,
    val tiles: List<GroupCallTile> = emptyList(),
    val micOn: Boolean = true,
    val camOn: Boolean = false,
    val startedAtMs: Long? = null,
    val notice: String? = null,
)

/**
 * WhatsApp-style group call — deliberately NOT the meeting gallery: no
 * waiting room, recording, breakouts, whiteboard or meeting chat. Just the
 * group's members, their faces or avatars, and mute / camera / end. Runs on
 * the LiveKit conference room the server stands up for the group.
 */
@HiltViewModel
class GroupCallViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GroupCallUiState())
    val uiState: StateFlow<GroupCallUiState> = _uiState

    var room: Room? = null
        private set

    private var conferenceId: Int = 0
    private var started = false
    private var everHadOthers = false
    private var noAnswerJob: Job? = null

    companion object {
        private const val NO_ANSWER_MS = 60_000L
    }

    /** conferenceId < 0 means "start a new call to this group" (caller side). */
    fun start(existingConferenceId: Int, groupId: Int, callType: String) {
        if (started) return
        started = true
        _uiState.value = _uiState.value.copy(camOn = callType == "video")
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch finish("Not signed in")
            val bearer = "Bearer $token"
            conferenceId = if (existingConferenceId > 0) existingConferenceId else {
                val resp = runCatching { apiService.startGroupCall(bearer, groupId, GroupCallStartRequest(callType)) }.getOrNull()
                val body = resp?.body()
                if (resp == null || !resp.isSuccessful || body == null) return@launch finish("Couldn't start the call")
                if (body.notRung > 0) {
                    _uiState.value = _uiState.value.copy(notice = "Call is full — ${body.notRung} member(s) couldn't be rung")
                }
                body.conferenceId
            }
            connect(bearer, callType == "video")
        }
    }

    private suspend fun connect(bearer: String, camOn: Boolean) {
        runCatching {
            val me = sessionManager.username.first()
            val resp = apiService.getLiveKitToken(bearer, conferenceId, me)
            if (!resp.isSuccessful) throw IllegalStateException(
                if (resp.code() == 503) "Group calls are not set up on this server yet" else "Couldn't connect the call"
            )
            val body = resp.body() ?: throw IllegalStateException("Couldn't connect the call")
            val r = LiveKit.create(context, RoomOptions(adaptiveStream = true, dynacast = true), LiveKitOverrides())
            room = r

            viewModelScope.launch {
                r.events.events.collect { event ->
                    when (event) {
                        is RoomEvent.ParticipantConnected -> { upsertTile(event.participant, false); othersChanged() }
                        is RoomEvent.ParticipantDisconnected -> { removeTile(event.participant.identity?.value ?: ""); othersChanged() }
                        is RoomEvent.TrackSubscribed -> upsertTile(event.participant, false)
                        is RoomEvent.TrackUnsubscribed -> upsertTile(event.participant, false)
                        is RoomEvent.TrackMuted -> refresh(event.participant)
                        is RoomEvent.TrackUnmuted -> refresh(event.participant)
                        is RoomEvent.TrackPublished -> refresh(event.participant)
                        is RoomEvent.TrackUnpublished -> refresh(event.participant)
                        is RoomEvent.ActiveSpeakersChanged -> {
                            val ids = event.speakers.mapNotNull { it.identity?.value }.toSet()
                            _uiState.value = _uiState.value.copy(tiles = _uiState.value.tiles.map { it.copy(isSpeaking = ids.contains(it.identity)) })
                        }
                        is RoomEvent.Disconnected -> if (_uiState.value.status != GroupCallStatus.ENDED) finish("Disconnected")
                        else -> {}
                    }
                }
            }

            val iceServers = runCatching {
                apiService.getIceServers(bearer).body()?.iceServers.orEmpty().map { s ->
                    val builder = livekit.org.webrtc.PeerConnection.IceServer.builder(s.urls)
                    if (!s.username.isNullOrBlank()) builder.setUsername(s.username)
                    if (!s.credential.isNullOrBlank()) builder.setPassword(s.credential)
                    builder.createIceServer()
                }
            }.getOrElse { emptyList() }

            r.connect(body.url, body.token, ConnectOptions(iceServers = iceServers))
            r.localParticipant.setMicrophoneEnabled(true)
            r.localParticipant.setCameraEnabled(camOn)
            upsertTile(r.localParticipant, true)
            r.remoteParticipants.values.forEach { upsertTile(it, false) }
            if (r.remoteParticipants.isEmpty()) {
                _uiState.value = _uiState.value.copy(status = GroupCallStatus.RINGING)
                noAnswerJob = viewModelScope.launch {
                    delay(NO_ANSWER_MS)
                    if (!everHadOthers) finish("No answer")
                }
            }
            othersChanged()
        }.onFailure { e -> finish(e.message ?: "Couldn't connect the call") }
    }

    private fun othersChanged() {
        val others = room?.remoteParticipants?.size ?: 0
        if (others > 0) {
            everHadOthers = true
            noAnswerJob?.cancel()
            _uiState.value = _uiState.value.copy(
                status = GroupCallStatus.ACTIVE,
                startedAtMs = _uiState.value.startedAtMs ?: System.currentTimeMillis(),
            )
        } else if (everHadOthers) {
            // Everyone else hung up — end it, like WhatsApp.
            finish("Call ended")
        }
    }

    private fun tileFrom(p: Participant, isLocal: Boolean): GroupCallTile {
        val videoTrack = p.videoTrackPublications.firstOrNull()?.second as? VideoTrack
        val identity = p.identity?.value ?: ""
        return GroupCallTile(
            identity = identity,
            displayName = p.name?.takeIf { it.isNotBlank() } ?: identity,
            isLocal = isLocal,
            micOn = p.isMicrophoneEnabled,
            camOn = p.isCameraEnabled,
            videoTrack = videoTrack,
        )
    }

    private fun upsertTile(p: Participant, isLocal: Boolean) {
        val tile = tileFrom(p, isLocal)
        val prevSpeaking = _uiState.value.tiles.find { it.identity == tile.identity }?.isSpeaking ?: false
        val others = _uiState.value.tiles.filterNot { it.identity == tile.identity }
        _uiState.value = _uiState.value.copy(
            // Keep "you" first so the grid order is stable.
            tiles = (others + tile.copy(isSpeaking = prevSpeaking)).sortedBy { if (it.isLocal) 0 else 1 },
        )
    }

    private fun refresh(p: Participant) {
        upsertTile(p, p.identity == room?.localParticipant?.identity)
    }

    private fun removeTile(identity: String) {
        _uiState.value = _uiState.value.copy(tiles = _uiState.value.tiles.filterNot { it.identity == identity })
    }

    fun toggleMic() {
        val r = room ?: return
        val next = !_uiState.value.micOn
        viewModelScope.launch {
            runCatching { r.localParticipant.setMicrophoneEnabled(next) }
            _uiState.value = _uiState.value.copy(micOn = next)
            upsertTile(r.localParticipant, true)
        }
    }

    fun toggleCam() {
        val r = room ?: return
        val next = !_uiState.value.camOn
        viewModelScope.launch {
            runCatching { r.localParticipant.setCameraEnabled(next) }
            _uiState.value = _uiState.value.copy(camOn = next)
            upsertTile(r.localParticipant, true)
        }
    }

    fun clearNotice() { _uiState.value = _uiState.value.copy(notice = null) }

    /** Hang up (reason null) or end for a reason shown briefly before closing. */
    fun finish(reason: String? = null) {
        if (_uiState.value.status == GroupCallStatus.ENDED) return
        noAnswerJob?.cancel()
        room?.disconnect()
        room?.release()
        room = null
        val confId = conferenceId
        if (confId > 0) {
            viewModelScope.launch {
                val token = sessionManager.sessionToken.first() ?: return@launch
                runCatching { apiService.conferenceLeave("Bearer $token", confId) }
            }
        }
        _uiState.value = _uiState.value.copy(status = GroupCallStatus.ENDED, endReason = reason)
    }

    override fun onCleared() {
        super.onCleared()
        if (_uiState.value.status != GroupCallStatus.ENDED) finish(null)
    }
}
