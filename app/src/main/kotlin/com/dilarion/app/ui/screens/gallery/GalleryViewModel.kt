package com.dilarion.app.ui.screens.gallery

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.BreakoutGroupInput
import com.dilarion.app.data.model.BreakoutStartRequest
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.data.model.WaitingParticipant
import com.dilarion.app.data.model.WhiteboardOpenRequest
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
    val myUsername: String = "",
    // Who's presenting the whiteboard to the room — null means nobody. Sharing
    // announces + auto-surfaces it for everyone, stopping hides it for
    // everyone, matching screen share's semantics.
    val whiteboardOwner: String? = null,
    // Breakout rooms — host-gated in the UI same as admit/deny (backend also
    // 403s non-hosts, so this is UX only, not the real boundary).
    val isHost: Boolean = false,
    val inBreakoutName: String? = null,
    val breakoutActive: Boolean = false,
    val showBreakoutPanel: Boolean = false,
    val breakoutBusy: Boolean = false,
    val breakoutError: String? = null,
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

    // currentConferenceId is whichever LiveKit room we're actually connected
    // to right now (the parent meeting, or a breakout room after being
    // assigned into one). parentConferenceId never changes for the life of
    // this screen — breakout start/auto/end orchestration calls always
    // target it, never wherever we currently happen to be connected.
    private var currentConferenceId: Int = 0
    private var parentConferenceId: Int = 0
    private var lastMicOn: Boolean = true
    private var lastCamOn: Boolean = true
    private var lastDisplayName: String? = null

    init {
        viewModelScope.launch {
            val me = sessionManager.username.first() ?: ""
            _uiState.value = _uiState.value.copy(myUsername = me)
        }
        // Host-only in practice — the backend 403s admit/deny for non-hosts.
        viewModelScope.launch {
            presenceService.events.collect { msg ->
                when (msg.type) {
                    "conference_join_request" -> {
                        val data = msg.data ?: return@collect
                        val uid = data.get("user_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                        val uname = data.get("username")?.takeIf { !it.isJsonNull }?.asString ?: return@collect
                        if (_uiState.value.waiting.none { it.userId == uid }) {
                            _uiState.value = _uiState.value.copy(waiting = _uiState.value.waiting + WaitingParticipant(uid, uname))
                        }
                    }
                    "whiteboard_opened" -> {
                        val data = msg.data ?: return@collect
                        val confId = data.get("conference_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                        if (confId != currentConferenceId) return@collect
                        val from = data.get("from")?.takeIf { !it.isJsonNull }?.asString ?: return@collect
                        _uiState.value = _uiState.value.copy(whiteboardOwner = from)
                    }
                    "whiteboard_closed" -> {
                        val data = msg.data ?: return@collect
                        val confId = data.get("conference_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                        if (confId != currentConferenceId) return@collect
                        _uiState.value = _uiState.value.copy(whiteboardOwner = null)
                    }
                    "breakout_assigned" -> {
                        val data = msg.data ?: return@collect
                        val parentId = data.get("parent_conference_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                        if (parentId != parentConferenceId) return@collect
                        val breakoutId = data.get("breakout_conference_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                        val name = data.get("name")?.takeIf { !it.isJsonNull }?.asString ?: "Breakout room"
                        switchRoom(breakoutId)
                        _uiState.value = _uiState.value.copy(inBreakoutName = name)
                    }
                    "breakout_ended" -> {
                        val data = msg.data ?: return@collect
                        val parentId = data.get("parent_conference_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                        if (parentId != parentConferenceId) return@collect
                        switchRoom(parentConferenceId)
                        _uiState.value = _uiState.value.copy(inBreakoutName = null, breakoutActive = false)
                    }
                }
            }
        }
    }

    /** Disconnects the current LiveKit room and reconnects to a different one
     *  (the parent meeting or a breakout room) — used for breakout switching,
     *  never called for the initial join (that's connect()). */
    private fun switchRoom(targetConferenceId: Int) {
        room?.disconnect()
        room?.release()
        room = null
        _uiState.value = _uiState.value.copy(tiles = emptyList(), connecting = true)
        connectRoom(targetConferenceId, lastMicOn, lastCamOn, lastDisplayName)
    }

    fun toggleBreakoutPanel(show: Boolean) {
        _uiState.value = _uiState.value.copy(showBreakoutPanel = show, breakoutError = null)
    }

    /** Manual assignment — orchestration always targets parentConferenceId,
     *  never wherever the host happens to currently be connected. */
    fun startBreakoutRooms(groups: List<BreakoutGroupInput>) {
        val nonEmpty = groups.filter { it.usernames.isNotEmpty() }
        if (nonEmpty.isEmpty()) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(breakoutBusy = true, breakoutError = null)
            runCatching { apiService.startBreakoutRooms("Bearer $token", parentConferenceId, BreakoutStartRequest(nonEmpty)) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(breakoutActive = true, showBreakoutPanel = false)
                    } else {
                        _uiState.value = _uiState.value.copy(breakoutError = "Failed to start breakout rooms")
                    }
                }
                .onFailure { e -> _uiState.value = _uiState.value.copy(breakoutError = e.message ?: "Failed to start breakout rooms") }
            _uiState.value = _uiState.value.copy(breakoutBusy = false)
        }
    }

    fun autoBreakoutRooms(numRooms: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(breakoutBusy = true, breakoutError = null)
            runCatching { apiService.autoBreakoutRooms("Bearer $token", parentConferenceId, numRooms) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(breakoutActive = true, showBreakoutPanel = false)
                    } else {
                        _uiState.value = _uiState.value.copy(breakoutError = "Failed to start breakout rooms")
                    }
                }
                .onFailure { e -> _uiState.value = _uiState.value.copy(breakoutError = e.message ?: "Failed to start breakout rooms") }
            _uiState.value = _uiState.value.copy(breakoutBusy = false)
        }
    }

    /** Host-only: ends every breakout room and pulls all participants (host
     *  included, if they'd manually hopped into one) back to the parent. */
    fun endBreakoutRooms() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(breakoutBusy = true, breakoutError = null)
            runCatching { apiService.endBreakoutRooms("Bearer $token", parentConferenceId) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(breakoutActive = false)
                        if (currentConferenceId != parentConferenceId) {
                            switchRoom(parentConferenceId)
                            _uiState.value = _uiState.value.copy(inBreakoutName = null)
                        }
                    } else {
                        _uiState.value = _uiState.value.copy(breakoutError = "Failed to end breakout rooms")
                    }
                }
                .onFailure { e -> _uiState.value = _uiState.value.copy(breakoutError = e.message ?: "Failed to end breakout rooms") }
            _uiState.value = _uiState.value.copy(breakoutBusy = false)
        }
    }

    fun shareWhiteboard(conferenceId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.whiteboardOpen("Bearer $token", WhiteboardOpenRequest(conferenceId)) }
            _uiState.value = _uiState.value.copy(whiteboardOwner = _uiState.value.myUsername)
        }
    }

    fun stopSharingWhiteboard(conferenceId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.whiteboardClose("Bearer $token", WhiteboardOpenRequest(conferenceId)) }
            _uiState.value = _uiState.value.copy(whiteboardOwner = null)
        }
    }

    fun loadWaitingRoom(conferenceId: Int) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            // 403s for a non-host (the backend is the real boundary) — a
            // successful response is also how we learn we ARE the host, same
            // as desktop's .then(... setIsHost(true)).catch(() => {}).
            runCatching { apiService.getWaitingRoom("Bearer $token", conferenceId) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(waiting = resp.body()?.waiting.orEmpty(), isHost = true)
                    }
                }
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
        parentConferenceId = conferenceId
        lastMicOn = initialMicOn
        lastCamOn = initialCamOn
        lastDisplayName = displayName
        // Waiting room / host status is always about the parent meeting, even
        // after switching into a breakout room — mirrors desktop, which keys
        // this effect on [token, conferenceId] (the prop), not activeConferenceId.
        loadWaitingRoom(conferenceId)
        connectRoom(conferenceId, initialMicOn, initialCamOn, displayName)
    }

    private fun connectRoom(conferenceId: Int, initialMicOn: Boolean, initialCamOn: Boolean, displayName: String?) {
        currentConferenceId = conferenceId
        _uiState.value = _uiState.value.copy(micOn = initialMicOn, camOn = initialCamOn, connecting = true, error = null)
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                val resp = apiService.getLiveKitToken("Bearer $token", conferenceId, displayName)
                if (!resp.isSuccessful) throw IllegalStateException(
                    if (resp.code() == 503) "Group video is not set up on this server yet"
                    else "Failed to get video token (${resp.code()})"
                )
                val body = resp.body() ?: throw IllegalStateException("Failed to get video token")

                // Both default to false in the SDK — unlike desktop (which passes
                // {adaptiveStream:true, dynacast:true} explicitly), so without this
                // Android never downgrades subscriptions on bad bandwidth and never
                // pauses unwatched layers server-side.
                val r = LiveKit.create(context, RoomOptions(adaptiveStream = true, dynacast = true), LiveKitOverrides())
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
