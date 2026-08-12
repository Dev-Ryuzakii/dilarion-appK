package com.dilarion.app.ui.screens.gallery

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.data.model.WaitingParticipant
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
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class GalleryTile(
    val identity: String,
    val displayName: String,
    val isLocal: Boolean,
    val isSpeaking: Boolean = false,
    val micOn: Boolean,
    val camOn: Boolean,
    val videoTrack: VideoTrack?,
)

data class GalleryUiState(
    val connecting: Boolean = true,
    val error: String? = null,
    val tiles: List<GalleryTile> = emptyList(),
    val micOn: Boolean = true,
    val camOn: Boolean = true,
    val showParticipants: Boolean = false,
    val allUsers: List<UserInfo> = emptyList(),
    val addSearch: String = "",
    val inviting: String? = null,
    val addError: String? = null,
    val waiting: List<WaitingParticipant> = emptyList(),
    val admitting: Int? = null,
)

/**
 * Group video via self-hosted LiveKit — the SFU room every group call (2+
 * people) now renders through, replacing the old mesh-WebRTC conference path
 * (mesh's O(n^2) cost capped calls at 4; LiveKit doesn't have that ceiling).
 * Mirrors desktop's GalleryView.tsx.
 */
@HiltViewModel
class GalleryViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GalleryUiState())
    val uiState: StateFlow<GalleryUiState> = _uiState

    var room: Room? = null
        private set

    init {
        // Host-only in practice — the backend 403s admit/deny for non-hosts.
        viewModelScope.launch {
            presenceService.events.collect { msg ->
                if (msg.type != "conference_join_request") return@collect
                val data = msg.data ?: return@collect
                val uid = data.get("user_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                val uname = data.get("username")?.takeIf { !it.isJsonNull }?.asString ?: return@collect
                if (_uiState.value.waiting.none { it.userId == uid }) {
                    _uiState.value = _uiState.value.copy(waiting = _uiState.value.waiting + WaitingParticipant(uid, uname))
                }
            }
        }
    }

    fun loadWaitingRoom(conferenceId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.getWaitingRoom("Bearer $token", conferenceId).body()?.waiting.orEmpty() }
                .onSuccess { _uiState.value = _uiState.value.copy(waiting = it) }
        }
    }

    fun admitGuest(conferenceId: Int, userId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(admitting = userId)
            runCatching { apiService.admitFromWaitingRoom("Bearer $token", conferenceId, userId) }
            _uiState.value = _uiState.value.copy(
                admitting = null,
                waiting = _uiState.value.waiting.filterNot { it.userId == userId },
            )
        }
    }

    fun denyGuest(conferenceId: Int, userId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(admitting = userId)
            runCatching { apiService.denyFromWaitingRoom("Bearer $token", conferenceId, userId) }
            _uiState.value = _uiState.value.copy(
                admitting = null,
                waiting = _uiState.value.waiting.filterNot { it.userId == userId },
            )
        }
    }

    private fun tileFrom(p: Participant, isLocal: Boolean): GalleryTile {
        val videoTrack = p.videoTrackPublications.firstOrNull()?.second as? VideoTrack
        val identity = p.identity?.value ?: ""
        return GalleryTile(
            identity = identity,
            displayName = p.name?.takeIf { it.isNotBlank() } ?: identity,
            isLocal = isLocal,
            micOn = p.isMicrophoneEnabled,
            camOn = p.isCameraEnabled,
            videoTrack = videoTrack,
        )
    }

    private fun upsertTile(p: Participant, isLocal: Boolean) {
        val prevSpeaking = _uiState.value.tiles.find { it.identity == (p.identity?.value ?: "") }?.isSpeaking ?: false
        val tile = tileFrom(p, isLocal).copy(isSpeaking = prevSpeaking)
        _uiState.value = _uiState.value.copy(
            tiles = _uiState.value.tiles.filterNot { it.identity == tile.identity } + tile,
        )
    }

    private fun removeTile(identity: String) {
        _uiState.value = _uiState.value.copy(tiles = _uiState.value.tiles.filterNot { it.identity == identity })
    }

    private fun updateActiveSpeakers(speakers: List<Participant>) {
        val speakingIds = speakers.mapNotNull { it.identity?.value }.toSet()
        _uiState.value = _uiState.value.copy(
            tiles = _uiState.value.tiles.map { it.copy(isSpeaking = speakingIds.contains(it.identity)) },
        )
    }

    fun connect(conferenceId: Int, initialMicOn: Boolean = true, initialCamOn: Boolean = true, displayName: String? = null) {
        _uiState.value = _uiState.value.copy(micOn = initialMicOn, camOn = initialCamOn)
        loadWaitingRoom(conferenceId)
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val resp = apiService.getLiveKitToken("Bearer $token", conferenceId, displayName)
                if (!resp.isSuccessful) throw IllegalStateException(
                    if (resp.code() == 503) "Group video is not set up on this server yet"
                    else "Failed to get video token (${resp.code()})"
                )
                val body = resp.body() ?: throw IllegalStateException("Failed to get video token")

                val r = LiveKit.create(context, RoomOptions(), LiveKitOverrides())
                room = r

                viewModelScope.launch {
                    // Room.events is an EventListenable<RoomEvent>, not the Flow itself -
                    // its own .events property is the SharedFlow to collect.
                    r.events.events.collect { event ->
                        when (event) {
                            is RoomEvent.ParticipantConnected -> upsertTile(event.participant, false)
                            is RoomEvent.ParticipantDisconnected -> removeTile(event.participant.identity?.value ?: "")
                            is RoomEvent.TrackSubscribed -> upsertTile(event.participant, false)
                            is RoomEvent.TrackMuted -> refreshParticipant(event.participant)
                            is RoomEvent.TrackUnmuted -> refreshParticipant(event.participant)
                            is RoomEvent.ActiveSpeakersChanged -> updateActiveSpeakers(event.speakers)
                            else -> {}
                        }
                    }
                }

                // Direct UDP fails on plenty of real-world networks (restrictive
                // NATs, some corporate/mobile networks) - the same TURN relay the
                // 1:1 mesh calls already use lets LiveKit fall back to it.
                val iceServers = runCatching {
                    apiService.getIceServers("Bearer $token").body()?.iceServers.orEmpty().map { s ->
                        val builder = livekit.org.webrtc.PeerConnection.IceServer.builder(s.urls)
                        if (!s.username.isNullOrBlank()) builder.setUsername(s.username)
                        if (!s.credential.isNullOrBlank()) builder.setPassword(s.credential)
                        builder.createIceServer()
                    }
                }.getOrElse { emptyList() }

                r.connect(body.url, body.token, ConnectOptions(iceServers = iceServers))
                r.localParticipant.setMicrophoneEnabled(initialMicOn)
                r.localParticipant.setCameraEnabled(initialCamOn)

                upsertTile(r.localParticipant, true)
                r.remoteParticipants.values.forEach { upsertTile(it, false) }

                _uiState.value = _uiState.value.copy(connecting = false)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(connecting = false, error = e.message ?: "Failed to join group video")
            }
        }
    }

    private fun refreshParticipant(p: Participant) {
        val isLocal = p.identity == room?.localParticipant?.identity
        upsertTile(p, isLocal)
    }

    fun toggleMic() {
        val r = room ?: return
        val next = !_uiState.value.micOn
        viewModelScope.launch {
            runCatching { r.localParticipant.setMicrophoneEnabled(next) }
            _uiState.value = _uiState.value.copy(micOn = next)
        }
    }

    fun toggleCam() {
        val r = room ?: return
        val next = !_uiState.value.camOn
        viewModelScope.launch {
            runCatching { r.localParticipant.setCameraEnabled(next) }
            _uiState.value = _uiState.value.copy(camOn = next)
        }
    }

    fun openParticipants() {
        _uiState.value = _uiState.value.copy(showParticipants = true, addError = null)
        if (_uiState.value.allUsers.isEmpty()) {
            viewModelScope.launch {
                val token = sessionManager.sessionToken.first() ?: return@launch
                runCatching { apiService.getUsers("Bearer $token") }
                    .getOrNull()?.body()?.let { users ->
                        _uiState.value = _uiState.value.copy(allUsers = users)
                    }
            }
        }
    }

    fun closeParticipants() {
        _uiState.value = _uiState.value.copy(showParticipants = false)
    }

    fun setAddSearch(q: String) {
        _uiState.value = _uiState.value.copy(addSearch = q)
    }

    fun invite(conferenceId: Int, username: String) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(inviting = username, addError = null)
            runCatching {
                apiService.conferenceInvite("Bearer $token", conferenceId, mapOf("username" to username))
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(addError = e.message ?: "Could not invite $username")
            }
            _uiState.value = _uiState.value.copy(inviting = null)
        }
    }

    fun leave() {
        room?.disconnect()
        room?.release()
        room = null
    }

    override fun onCleared() {
        super.onCleared()
        room?.disconnect()
        room?.release()
        room = null
    }
}
