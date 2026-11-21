package com.dilarion.app.ui.screens.gallery

import android.content.Context
import android.content.Intent
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.calls.notifyConferenceLeft
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.BreakoutGroupInput
import com.dilarion.app.data.model.BreakoutStartRequest
import com.dilarion.app.data.model.CaptionLanguage
import com.dilarion.app.data.model.CaptionSegment
import com.dilarion.app.data.model.CaptionsResponse
import com.dilarion.app.data.model.CaptionsStartRequest
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
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import io.livekit.android.room.track.VideoCaptureParameter
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import com.dilarion.app.utils.toUserMessage

data class GalleryTile(
    val identity: String,
    val displayName: String,
    val isLocal: Boolean,
    val isSpeaking: Boolean = false,
    val micOn: Boolean,
    val camOn: Boolean,
    val videoTrack: VideoTrack?,
    val screenTrack: VideoTrack? = null,
)

/** Live meeting transcript, mirrored from desktop's LiveCaptions.tsx. */
data class CaptionsUi(
    /** False when the server has captions turned off or predates them. */
    val available: Boolean = false,
    val enabled: Boolean = false,
    /** "off" | "starting" | "running" */
    val status: String = "off",
    val startedBy: String? = null,
    /** Spoken language code, or "auto". */
    val language: String = "auto",
    val segments: List<CaptionSegment> = emptyList(),
    val languages: List<CaptionLanguage> = DEFAULT_CAPTION_LANGUAGES,
    val busy: Boolean = false,
    val error: String? = null,
    /** Server-side failure of the last run (worker crashed, etc.). */
    val serverError: String? = null,
    /** Show the last lines over the call. Local choice only. */
    val showOverlay: Boolean = true,
    val showTranscript: Boolean = false,
)

/** Used until the server sends its own list. */
val DEFAULT_CAPTION_LANGUAGES = listOf(
    CaptionLanguage("auto", "Detect automatically"),
    CaptionLanguage("en", "English"),
    CaptionLanguage("fr", "French"),
    CaptionLanguage("es", "Spanish"),
    CaptionLanguage("pt", "Portuguese"),
    CaptionLanguage("de", "German"),
    CaptionLanguage("ar", "Arabic"),
    CaptionLanguage("zh", "Chinese"),
    CaptionLanguage("hi", "Hindi"),
    CaptionLanguage("sw", "Swahili"),
    CaptionLanguage("yo", "Yoruba"),
    CaptionLanguage("ha", "Hausa"),
)

private const val MAX_CAPTION_SEGMENTS = 1000

data class GalleryUiState(
    val connecting: Boolean = true,
    val error: String? = null,
    val tiles: List<GalleryTile> = emptyList(),
    val micOn: Boolean = true,
    val camOn: Boolean = true,
    val sharingScreen: Boolean = false,
    val screenShareBusy: Boolean = false,
    val screenShareError: String? = null,
    val cameraError: String? = null,
    val cameraBusy: Boolean = false,
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
    // A 1:1 call that picked up a third participant, or any room whose server
    // kind is not "meeting". Same transport, without meeting-only chrome.
    val isAdHocCall: Boolean = false,
    /** "voice" | "video" from the server, for the call title and camera. */
    val callType: String? = null,
    val captions: CaptionsUi = CaptionsUi(),
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
    // Server call_type is applied once, on the first join. A breakout hop
    // must keep whatever the user did to the camera after that.
    private var appliedServerCallType = false
    /** Left the call. Later LiveKit track events must not put their tile back. */
    private val departed = mutableSetOf<String>()
    private val gson = com.google.gson.Gson()
    private var lastCaptionId = 0

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
                    "conference_participant_left" -> {
                        val data = msg.data ?: return@collect
                        val confId = data.get("conference_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                        if (confId != currentConferenceId && confId != parentConferenceId) return@collect
                        val who = data.get("username")?.takeIf { !it.isJsonNull }?.asString ?: return@collect
                        departed.add(who)
                        removeTile(who)
                        reconcileTiles()
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
                    "meeting_caption" -> {
                        val data = msg.data ?: return@collect
                        val confId = data.get("conference_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                        if (confId != currentConferenceId) return@collect
                        runCatching { gson.fromJson(data, CaptionSegment::class.java) }.getOrNull()
                            ?.let { mergeCaptions(listOf(it)) }
                    }
                    "meeting_captions_state" -> {
                        val data = msg.data ?: return@collect
                        val confId = data.get("conference_id")?.takeIf { !it.isJsonNull }?.asInt ?: return@collect
                        if (confId != currentConferenceId) return@collect
                        val st = runCatching { gson.fromJson(data, CaptionsResponse::class.java) }.getOrNull() ?: return@collect
                        applyCaptionsState(st)
                        if (st.enabled) refreshCaptions()
                    }
                    // Socket came back: catch up on lines missed while it was away.
                    "connected" -> if (currentConferenceId > 0 && !_uiState.value.isAdHocCall) refreshCaptions()
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
        _uiState.value = _uiState.value.copy(tiles = emptyList(), connecting = true, sharingScreen = false)
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
                .onFailure { e -> _uiState.value = _uiState.value.copy(breakoutError = e.toUserMessage("Couldn't start breakout rooms. Please try again.")) }
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
                .onFailure { e -> _uiState.value = _uiState.value.copy(breakoutError = e.toUserMessage("Couldn't start breakout rooms. Please try again.")) }
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
                .onFailure { e -> _uiState.value = _uiState.value.copy(breakoutError = e.toUserMessage("Couldn't end breakout rooms. Please try again.")) }
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
                        val list = if (_uiState.value.isAdHocCall) emptyList() else resp.body()?.waiting.orEmpty()
                        _uiState.value = _uiState.value.copy(waiting = list, isHost = true)
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

    private fun participantKey(p: Participant): String {
        p.identity?.value?.takeIf { it.isNotBlank() }?.let { return it }
        return p.sid.value.takeIf { it.isNotBlank() }?.let { "sid:$it" } ?: ""
    }

    private fun cameraTrack(p: Participant): VideoTrack? {
        val pubs = p.videoTrackPublications
        return pubs.firstOrNull { it.first.source == Track.Source.CAMERA }?.second as? VideoTrack
    }

    private fun tileFrom(p: Participant, isLocal: Boolean): GalleryTile {
        val videoTrack = cameraTrack(p)
        val identity = participantKey(p)
        return GalleryTile(
            identity = identity,
            displayName = p.name?.takeIf { it.isNotBlank() } ?: identity,
            isLocal = isLocal,
            micOn = p.isMicrophoneEnabled,
            camOn = p.isCameraEnabled,
            videoTrack = videoTrack,
            screenTrack = p.videoTrackPublications.firstOrNull { it.first.source == Track.Source.SCREEN_SHARE }?.second as? VideoTrack,
        )
    }

    private fun upsertTile(p: Participant, isLocal: Boolean) {
        val tile = tileFrom(p, isLocal)
        if (tile.identity.isBlank() || tile.identity in departed) return
        val prevSpeaking = _uiState.value.tiles.find { it.identity == tile.identity }?.isSpeaking ?: false
        _uiState.value = _uiState.value.copy(
            tiles = _uiState.value.tiles.filterNot { it.identity == tile.identity } + tile.copy(isSpeaking = prevSpeaking),
        )
        reconcileTiles()
    }

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

    private fun removeTile(identity: String) {
        _uiState.value = _uiState.value.copy(tiles = _uiState.value.tiles.filterNot { it.identity == identity })
    }

    private fun updateActiveSpeakers(speakers: List<Participant>) {
        val speakingIds = speakers.mapNotNull { it.identity?.value }.toSet()
        _uiState.value = _uiState.value.copy(
            tiles = _uiState.value.tiles.map { it.copy(isSpeaking = speakingIds.contains(it.identity)) },
        )
    }

    fun connect(conferenceId: Int, initialMicOn: Boolean = true, initialCamOn: Boolean = true, displayName: String? = null, isAdHocCall: Boolean = false) {
        parentConferenceId = conferenceId
        lastMicOn = initialMicOn
        lastCamOn = initialCamOn
        lastDisplayName = displayName
        _uiState.value = _uiState.value.copy(isAdHocCall = isAdHocCall)
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

                val kind = body.kind ?: if (_uiState.value.isAdHocCall) "call" else "meeting"
                val adHoc = kind != "meeting"
                var cam = initialCamOn
                if (adHoc && !appliedServerCallType && (body.callType == "voice" || body.callType == "video")) {
                    appliedServerCallType = true
                    cam = body.callType == "video"
                    lastCamOn = cam
                }
                _uiState.value = _uiState.value.copy(
                    isAdHocCall = adHoc,
                    callType = body.callType ?: _uiState.value.callType,
                    camOn = cam,
                    isHost = if (adHoc) body.isHost else _uiState.value.isHost,
                    waiting = if (adHoc) emptyList() else _uiState.value.waiting,
                )
                if (!adHoc) {
                    loadWaitingRoom(parentConferenceId.takeIf { it > 0 } ?: conferenceId)
                    resetCaptions()
                    refreshCaptions()
                }

                // Keep subscriptions active while Android creates or replaces its
                // TextureView. Adaptive streaming can pause the track before the
                // renderer has a measured size, leaving a black remote tile.
                // Screen share defaults to the phone's native resolution (e.g.
                // 1080x2400). Desktop browsers decode that, but many phone
                // hardware decoders reject frames that large and render black,
                // so mobile-to-mobile sharing showed a blank screen. Cap it.
                val r = LiveKit.create(
                    context,
                    RoomOptions(
                        adaptiveStream = false,
                        dynacast = false,
                        screenShareTrackCaptureDefaults = LocalVideoTrackOptions(
                            isScreencast = true,
                            captureParams = screenShareCaptureParams(),
                        ),
                    ),
                    LiveKitOverrides(),
                )
                room = r

                viewModelScope.launch {
                    // Room.events is an EventListenable<RoomEvent>, not the Flow itself -
                    // its own .events property is the SharedFlow to collect.
                    r.events.events.collect { event ->
                        when (event) {
                            is RoomEvent.ParticipantConnected -> {
                                departed.remove(participantKey(event.participant))
                                upsertTile(event.participant, false)
                            }
                            is RoomEvent.ParticipantDisconnected -> {
                                val key = participantKey(event.participant)
                                if (key.isNotBlank()) departed.add(key)
                                removeTile(key)
                                reconcileTiles()
                            }
                            is RoomEvent.TrackSubscribed -> upsertTile(event.participant, false)
                            is RoomEvent.TrackUnsubscribed -> upsertTile(event.participant, false)
                            is RoomEvent.TrackPublished -> refreshParticipant(event.participant)
                            is RoomEvent.TrackUnpublished -> refreshParticipant(event.participant)
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
                r.localParticipant.setCameraEnabled(cam)
                val actualCamOn = r.localParticipant.isCameraEnabled
                _uiState.value = _uiState.value.copy(camOn = actualCamOn)
                lastCamOn = actualCamOn

                upsertTile(r.localParticipant, true)
                r.remoteParticipants.values.forEach { upsertTile(it, false) }

                _uiState.value = _uiState.value.copy(connecting = false)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(connecting = false, error = e.toUserMessage("Couldn't join the group video call. Check your connection and retry."))
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
            // Own tile follows the button straight away; others get it from
            // LiveKit's TrackMuted/TrackUnmuted on their side.
            if (room === r) upsertTile(r.localParticipant, true)
            // Without this, a breakout-room hop reconnects with the stale
            // lastMicOn from connect() and silently re-enables a muted mic.
            lastMicOn = next
        }
    }

    fun toggleCam() {
        val r = room ?: return
        if (_uiState.value.cameraBusy) return
        val next = !_uiState.value.camOn
        _uiState.value = _uiState.value.copy(cameraBusy = true)
        viewModelScope.launch {
            runCatching { r.localParticipant.setCameraEnabled(next) }
                .onSuccess {
                    if (room === r) {
                        val actual = r.localParticipant.isCameraEnabled
                        _uiState.value = _uiState.value.copy(
                            camOn = actual,
                            cameraError = if (actual == next) null else "Could not change the camera. Please try again.",
                        )
                        lastCamOn = actual
                        upsertTile(r.localParticipant, true)
                    }
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(cameraError = error.toUserMessage("Could not change the camera. Please try again."))
                    if (room === r) upsertTile(r.localParticipant, true)
                }
            _uiState.value = _uiState.value.copy(cameraBusy = false)
        }
    }

    fun clearCameraError() {
        _uiState.value = _uiState.value.copy(cameraError = null)
    }

    /**
     * Capture size for screen share that every phone's hardware decoder can
     * handle: keeps the display's aspect ratio, long side <= 1920 and short
     * side <= 1080, rounded down to a multiple of 16. Width is the LONG side —
     * LiveKit swaps width/height itself when the display is in portrait.
     */
    private fun screenShareCaptureParams(): VideoCaptureParameter {
        val metrics = context.resources.displayMetrics
        val long = maxOf(metrics.widthPixels, metrics.heightPixels).coerceAtLeast(16)
        val short = minOf(metrics.widthPixels, metrics.heightPixels).coerceAtLeast(16)
        val scale = minOf(1.0, 1920.0 / long, 1080.0 / short)
        fun even16(v: Double) = ((v.toInt() / 16) * 16).coerceAtLeast(16)
        return VideoCaptureParameter(even16(long * scale), even16(short * scale), 15)
    }

    fun startScreenShare(permissionData: Intent) {
        val activeRoom = room ?: return
        if (_uiState.value.screenShareBusy || _uiState.value.sharingScreen) return
        _uiState.value = _uiState.value.copy(screenShareBusy = true, screenShareError = null)
        viewModelScope.launch {
            runCatching {
                activeRoom.localParticipant.setScreenShareEnabled(
                    true,
                    ScreenCaptureParams(permissionData, onStop = {
                        viewModelScope.launch {
                            _uiState.value = _uiState.value.copy(sharingScreen = false)
                            if (room === activeRoom) upsertTile(activeRoom.localParticipant, true)
                        }
                    }),
                )
            }.onSuccess { enabled ->
                if (room === activeRoom) {
                    _uiState.value = _uiState.value.copy(
                        sharingScreen = enabled,
                        screenShareError = if (enabled) null else "Could not start screen sharing. Please try again.",
                    )
                    upsertTile(activeRoom.localParticipant, true)
                }
            }.onFailure { error ->
                _uiState.value = _uiState.value.copy(screenShareError = error.toUserMessage("Could not start screen sharing. Please try again."))
            }
            _uiState.value = _uiState.value.copy(screenShareBusy = false)
        }
    }

    fun stopScreenShare() {
        val activeRoom = room ?: return
        if (_uiState.value.screenShareBusy) return
        _uiState.value = _uiState.value.copy(screenShareBusy = true, screenShareError = null)
        viewModelScope.launch {
            runCatching { activeRoom.localParticipant.setScreenShareEnabled(false) }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(screenShareError = error.toUserMessage("Could not stop screen sharing."))
                }
            if (room === activeRoom) {
                _uiState.value = _uiState.value.copy(sharingScreen = false)
                upsertTile(activeRoom.localParticipant, true)
            }
            _uiState.value = _uiState.value.copy(screenShareBusy = false)
        }
    }

    fun clearScreenShareError() {
        _uiState.value = _uiState.value.copy(screenShareError = null)
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
                _uiState.value = _uiState.value.copy(addError = e.toUserMessage("Couldn't invite $username. Please try again."))
            }
            _uiState.value = _uiState.value.copy(inviting = null)
        }
    }

    // ── Live transcript ──────────────────────────────────────────────────

    private fun resetCaptions() {
        lastCaptionId = 0
        val keep = _uiState.value.captions
        _uiState.value = _uiState.value.copy(
            captions = CaptionsUi(showOverlay = keep.showOverlay, languages = keep.languages),
        )
    }

    private fun mergeCaptions(incoming: List<CaptionSegment>) {
        if (incoming.isEmpty()) return
        val cur = _uiState.value.captions
        val seen = cur.segments.mapTo(HashSet()) { it.id }
        val merged = (cur.segments + incoming.filter { it.id !in seen }).sortedBy { it.id }.takeLast(MAX_CAPTION_SEGMENTS)
        merged.lastOrNull()?.let { lastCaptionId = it.id }
        _uiState.value = _uiState.value.copy(captions = _uiState.value.captions.copy(segments = merged))
    }

    private fun applyCaptionsState(st: CaptionsResponse) {
        val c = _uiState.value.captions
        _uiState.value = _uiState.value.copy(
            captions = c.copy(
                enabled = st.enabled,
                status = st.status,
                startedBy = st.startedBy,
                language = if (st.enabled) (st.language ?: "auto") else c.language,
                serverError = st.error,
                available = st.available ?: c.available,
                languages = st.languages?.takeIf { it.isNotEmpty() } ?: c.languages,
                showOverlay = if (st.enabled && !c.enabled) true else c.showOverlay,
            ),
        )
    }

    private fun refreshCaptions() {
        val confId = currentConferenceId
        if (confId <= 0) return
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            val resp = runCatching { apiService.getLiveCaptions("Bearer $token", confId, lastCaptionId) }.getOrNull()
            if (confId != currentConferenceId) return@launch
            val body = resp?.takeIf { it.isSuccessful }?.body()
            if (body == null) {
                // Older servers have no captions route: hide the feature quietly.
                if (resp != null && resp.code() == 404) {
                    _uiState.value = _uiState.value.copy(captions = _uiState.value.captions.copy(available = false))
                }
                return@launch
            }
            applyCaptionsState(body.copy(available = body.available ?: true))
            mergeCaptions(body.segments.orEmpty())
        }
    }

    private fun serverDetail(resp: retrofit2.Response<*>, fallback: String): String =
        runCatching {
            gson.fromJson(resp.errorBody()?.string(), com.google.gson.JsonObject::class.java)
                ?.get("detail")?.takeIf { it.isJsonPrimitive }?.asString
        }.getOrNull()?.takeIf { it.isNotBlank() } ?: fallback

    private fun captionsCall(fallback: String, call: suspend (String) -> retrofit2.Response<CaptionsResponse>) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(captions = _uiState.value.captions.copy(busy = true, error = null))
            runCatching { call("Bearer $token") }
                .onSuccess { resp ->
                    val body = resp.body()
                    if (resp.isSuccessful && body != null) applyCaptionsState(body)
                    else _uiState.value = _uiState.value.copy(
                        captions = _uiState.value.captions.copy(error = serverDetail(resp, fallback)),
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(captions = _uiState.value.captions.copy(error = e.toUserMessage(fallback)))
                }
            _uiState.value = _uiState.value.copy(captions = _uiState.value.captions.copy(busy = false))
        }
    }

    /** Anyone in the meeting. [language] is a code like "en", or "auto". */
    fun startCaptions(language: String) {
        val confId = currentConferenceId
        _uiState.value = _uiState.value.copy(captions = _uiState.value.captions.copy(showOverlay = true))
        captionsCall("Couldn't start the live transcript.") { bearer ->
            apiService.startLiveCaptions(bearer, confId, CaptionsStartRequest(language))
        }
    }

    /** While it runs: switch the spoken language. */
    fun setCaptionsLanguage(language: String) {
        val confId = currentConferenceId
        captionsCall("Couldn't change the transcript language.") { bearer ->
            apiService.startLiveCaptions(bearer, confId, CaptionsStartRequest(language))
        }
    }

    fun stopCaptions() {
        val confId = currentConferenceId
        captionsCall("Couldn't stop the live transcript.") { bearer ->
            apiService.stopLiveCaptions(bearer, confId)
        }
    }

    fun toggleCaptionsOverlay() {
        val c = _uiState.value.captions
        _uiState.value = _uiState.value.copy(captions = c.copy(showOverlay = !c.showOverlay))
    }

    fun showTranscript(show: Boolean) {
        val c = _uiState.value.captions
        _uiState.value = _uiState.value.copy(captions = c.copy(showTranscript = show, error = null))
    }

    fun leave() {
        val id = currentConferenceId
        val parent = parentConferenceId
        room?.disconnect()
        room?.release()
        room = null
        _uiState.value = _uiState.value.copy(sharingScreen = false)
        if (id > 0) notifyConferenceLeft(sessionManager, apiService, id)
        if (parent > 0 && parent != id) notifyConferenceLeft(sessionManager, apiService, parent)
    }

    override fun onCleared() {
        super.onCleared()
        room?.disconnect()
        room?.release()
        room = null
    }
}
