package com.dilarion.app.ui.screens.groupcall

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.calls.notifyConferenceLeft
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.GroupCallStartRequest
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.RoomOptions
import io.livekit.android.events.RoomEvent
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.RemoteTrackPublication
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.yield
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import com.dilarion.app.utils.toUserMessage

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
    private val presenceService: PresenceService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GroupCallUiState())
    val uiState: StateFlow<GroupCallUiState> = _uiState

    var room: Room? = null
        private set

    private var conferenceId: Int = 0
    private var started = false
    private var cameraChangeInProgress = false
    private var everHadOthers = false
    private var noAnswerJob: Job? = null
    /** Left the call. Later LiveKit track events must not put their tile back. */
    private val departed = mutableSetOf<String>()

    init {
        viewModelScope.launch {
            presenceService.events.collect { event ->
                if (event.type != "conference_participant_left") return@collect
                val data = event.data ?: return@collect
                val confId = data.get("conference_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                if (confId != conferenceId) return@collect
                val who = data.get("username")?.takeIf { !it.isJsonNull }?.asString ?: return@collect
                // Still in the room: the leave was the upgrade screen disposing,
                // not a hangup. Hiding them here is how two phones lost the
                // other faces and kept only their own tile.
                val stillThere = room?.remoteParticipants?.values?.any { participantKey(it) == who } == true
                if (stillThere) return@collect
                departed.add(who)
                removeTile(who)
                reconcileTiles()
                othersChanged()
            }
        }
    }

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
            // dynacast pauses a camera nobody's renderer has measured yet.
            // On a phone that meant two of the three people only ever saw
            // their own tile.
            val r = LiveKit.create(context, RoomOptions(adaptiveStream = false, dynacast = false), LiveKitOverrides())
            room = r

            viewModelScope.launch {
                r.events.events.collect { event ->
                    when (event) {
                        is RoomEvent.TrackPublished -> {
                            val pub = event.publication
                            if (pub is RemoteTrackPublication && pub.source == Track.Source.CAMERA) {
                                pub.setSubscribed(true)
                            }
                            syncFromRoom()
                        }
                        is RoomEvent.ParticipantConnected -> {
                            departed.remove(participantKey(event.participant))
                            subscribeCameras()
                            syncFromRoom()
                        }
                        is RoomEvent.ParticipantDisconnected -> {
                            val key = participantKey(event.participant)
                            if (key.isNotBlank()) departed.add(key)
                            syncFromRoom()
                        }
                        is RoomEvent.TrackSubscribed,
                        is RoomEvent.TrackUnsubscribed,
                        is RoomEvent.TrackMuted,
                        is RoomEvent.TrackUnmuted,
                        is RoomEvent.TrackUnpublished -> syncFromRoom()
                        is RoomEvent.ActiveSpeakersChanged -> {
                            val ids = event.speakers.mapNotNull { it.identity?.value }.toSet()
                            _uiState.value = _uiState.value.copy(tiles = _uiState.value.tiles.map { it.copy(isSpeaking = ids.contains(it.identity)) })
                        }
                        is RoomEvent.Disconnected -> if (_uiState.value.status != GroupCallStatus.ENDED) {
                            // Not a hangup. Ending here was closing the call for
                            // everyone else when a video track renegotiated.
                            _uiState.value = _uiState.value.copy(notice = "Reconnecting…")
                        }
                        else -> {}
                    }
                }
            }
            // Start listening before connect, or the tracks that subscribe
            // during connect are missed and those faces never appear.
            yield()

            var connected = false
            var lastError: Throwable? = null
            repeat(4) { attempt ->
                val tokenResp = runCatching { apiService.getLiveKitToken(bearer, conferenceId, me) }.getOrNull()
                if (tokenResp == null || !tokenResp.isSuccessful || tokenResp.body() == null) {
                    lastError = IllegalStateException(
                        if (tokenResp?.code() == 503) "Group calls are not set up on this server yet"
                        else "Couldn't connect the call",
                    )
                    delay(700L * (attempt + 1))
                    return@repeat
                }
                val body = tokenResp.body()!!
                val iceServers = runCatching {
                    apiService.getIceServers(bearer).body()?.iceServers.orEmpty().map { s ->
                        val builder = livekit.org.webrtc.PeerConnection.IceServer.builder(s.urls)
                        if (!s.username.isNullOrBlank()) builder.setUsername(s.username)
                        if (!s.credential.isNullOrBlank()) builder.setPassword(s.credential)
                        builder.createIceServer()
                    }
                }.getOrElse { emptyList() }
                val joined = runCatching {
                    r.connect(body.url, body.token, ConnectOptions(autoSubscribe = true, iceServers = iceServers))
                }
                if (joined.isFailure) {
                    lastError = joined.exceptionOrNull()
                    runCatching { r.disconnect() }
                    delay(700L * (attempt + 1))
                    return@repeat
                }
                connected = true
                return@repeat
            }
            if (!connected) {
                throw lastError ?: IllegalStateException("Couldn't connect the call")
            }
            runCatching { r.localParticipant.setMicrophoneEnabled(true) }
            if (camOn) runCatching { r.localParticipant.setCameraEnabled(true) }
            _uiState.value = _uiState.value.copy(camOn = r.localParticipant.isCameraEnabled)
            subscribeCameras()
            syncFromRoom()
            if (r.remoteParticipants.isEmpty()) {
                _uiState.value = _uiState.value.copy(status = GroupCallStatus.RINGING)
                noAnswerJob = viewModelScope.launch {
                    delay(NO_ANSWER_MS)
                    if (!everHadOthers) finish("No answer")
                }
            }
            // Tracks often arrive a beat after connect. Read the room again
            // so a face that subscribed during that beat is still drawn.
            delay(500)
            subscribeCameras()
            syncFromRoom()
        }.onFailure { e ->
            // A 403 from the room token is not a signed-out session. Saying
            // it was ended the call and sent people to sign in again.
            val msg = if (e is java.io.IOException) {
                e.toUserMessage("Couldn't connect to the call. Check your connection and retry.")
            } else {
                "Couldn't connect to the call. Check your connection and retry."
            }
            finish(msg)
        }
    }

    /** Room membership is the list of tiles. Events only nudge this. */
    private fun syncFromRoom() {
        val r = room ?: return
        val remotes = r.remoteParticipants.values.toList()
        remotes.forEach { departed.remove(participantKey(it)) }
        upsertTile(r.localParticipant, true)
        remotes.forEach { upsertTile(it, false) }
        othersChanged()
    }

    private fun subscribeCameras() {
        val r = room ?: return
        r.remoteParticipants.values.forEach { p ->
            p.videoTrackPublications.forEach { (pub, _) ->
                if (pub.source == Track.Source.CAMERA && pub is RemoteTrackPublication) {
                    pub.setSubscribed(true)
                }
            }
        }
    }

    private var aloneJob: Job? = null

    private fun othersChanged() {
        val others = room?.remoteParticipants?.size ?: 0
        if (others > 0) {
            aloneJob?.cancel()
            everHadOthers = true
            noAnswerJob?.cancel()
            _uiState.value = _uiState.value.copy(
                status = GroupCallStatus.ACTIVE,
                startedAtMs = _uiState.value.startedAtMs ?: System.currentTimeMillis(),
            )
        } else if (everHadOthers) {
            // A video publish can drop the other person for a moment. Wait
            // before deciding the call is over.
            aloneJob?.cancel()
            aloneJob = viewModelScope.launch {
                delay(8000)
                if ((room?.remoteParticipants?.size ?: 0) == 0) finish("Call ended")
            }
        }
    }

    private fun participantKey(p: Participant): String {
        p.identity?.value?.takeIf { it.isNotBlank() }?.let { return it }
        return p.sid.value.takeIf { it.isNotBlank() }?.let { "sid:$it" } ?: ""
    }

    /** Camera, not screen share. The first publication is often the wrong one. */
    private fun cameraTrack(p: Participant): VideoTrack? {
        val pubs = p.videoTrackPublications
        return pubs.firstOrNull { it.first.source == Track.Source.CAMERA }?.second as? VideoTrack
    }

    private fun tileFrom(p: Participant, isLocal: Boolean): GroupCallTile {
        val videoTrack = cameraTrack(p)
        val identity = participantKey(p)
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
        if (tile.identity.isBlank() || tile.identity in departed) return
        val prevSpeaking = _uiState.value.tiles.find { it.identity == tile.identity }?.isSpeaking ?: false
        val others = _uiState.value.tiles.filterNot { it.identity == tile.identity }
        _uiState.value = _uiState.value.copy(
            // Keep "you" first so the grid order is stable.
            tiles = (others + tile.copy(isSpeaking = prevSpeaking)).sortedBy { if (it.isLocal) 0 else 1 },
        )
        reconcileTiles()
    }

    /** Drop anyone no longer in the room, even if the disconnect event had no identity. */
    private fun reconcileTiles() {
        val r = room ?: return
        val live = buildSet {
            participantKey(r.localParticipant).takeIf { it.isNotBlank() }?.let { add(it) }
            r.remoteParticipants.values.forEach { p ->
                participantKey(p).takeIf { it.isNotBlank() }?.let { add(it) }
            }
        }
        if (live.isEmpty()) return
        val current = _uiState.value.tiles
        val next = current.filter { it.identity in live }
        if (next.size != current.size) {
            _uiState.value = _uiState.value.copy(tiles = next)
        }
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
        if (cameraChangeInProgress) return
        val next = !_uiState.value.camOn
        cameraChangeInProgress = true
        viewModelScope.launch {
            runCatching { r.localParticipant.setCameraEnabled(next) }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(notice = error.toUserMessage("Could not change the camera. Please try again."))
                }
            if (room === r) {
                _uiState.value = _uiState.value.copy(camOn = r.localParticipant.isCameraEnabled)
                upsertTile(r.localParticipant, true)
            }
            cameraChangeInProgress = false
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
        if (confId > 0) notifyConferenceLeft(sessionManager, apiService, confId)
        _uiState.value = _uiState.value.copy(status = GroupCallStatus.ENDED, endReason = reason)
    }

    override fun onCleared() {
        super.onCleared()
        if (_uiState.value.status != GroupCallStatus.ENDED) finish(null)
    }
}
