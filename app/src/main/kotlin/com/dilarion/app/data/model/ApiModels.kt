package com.dilarion.app.data.model

import com.google.gson.annotations.SerializedName

// ─── Auth ─────────────────────────────────────────────────────────────────────

data class LoginRequest(
    val username: String,
    val token: String,
)

data class LoginResponse(
    @SerializedName("token")    val sessionToken: String?,
    val username: String,
    @SerializedName("is_admin") val isAdmin: Boolean = false,
)

data class UpdatePublicKeyRequest(
    @SerializedName("public_key") val publicKey: String,
)

// ─── Multi-device linking ──────────────────────────────────────────────────────

data class DeviceRegisterRequest(
    @SerializedName("public_key") val publicKey: String,
    val platform: String,
    @SerializedName("device_name") val deviceName: String? = null,
)

data class DeviceRegisterResponse(
    @SerializedName("device_uuid") val deviceUuid: String,
    val platform: String? = null,
)

data class DeviceLinkApproveRequest(
    val nonce: String,
)

data class DeviceKey(
    @SerializedName("device_uuid") val deviceUuid: String,
    @SerializedName("public_key") val publicKey: String,
    val platform: String? = null,
)

data class UserDevicesResponse(
    val devices: List<DeviceKey> = emptyList(),
)

data class MyDevice(
    @SerializedName("device_uuid") val deviceUuid: String,
    val platform: String = "",
    @SerializedName("device_name") val deviceName: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("last_seen") val lastSeen: String? = null,
)

data class MyDevicesResponse(
    val devices: List<MyDevice> = emptyList(),
)

// ─── Messages ─────────────────────────────────────────────────────────────────

data class MessageReaction(
    val emoji: String,
    val count: Int = 0,
    @SerializedName("reacted_by_me") val reactedByMe: Boolean = false,
)

data class Message(
    val id: Int = 0,
    val sender: String? = null,
    val recipient: String? = null,
    val content: String? = null,
    @SerializedName("content_type")          val contentType: String? = null,
    val timestamp: String? = null,
    val read: Boolean = false,
    val delivered: Boolean = false,
    @SerializedName("group_id")              val groupId: Int? = null,
    @SerializedName("decoy_content")         val decoyContent: String? = null,
    @SerializedName("encrypted_key")         val encryptedKey: String? = null,
    val iv: String? = null,
    @SerializedName("is_admin_announcement") val isAdminAnnouncement: Boolean = false,
    val reactions: List<MessageReaction>? = null,
    @SerializedName("reply_to_message_id")        val replyToMessageId: Int? = null,
    @SerializedName("forwarded_from_message_id")  val forwardedFromMessageId: Int? = null,
    @SerializedName("is_edited")  val isEdited: Boolean = false,
    @SerializedName("is_deleted") val isDeleted: Boolean = false,
    @SerializedName("is_pinned")  val isPinned: Boolean = false,
    val mentions: List<String>? = null,
)

data class ReactionRequest(val emoji: String)

data class MessageEditRequest(
    val message: String,
    @SerializedName("encrypted_key") val encryptedKey: String? = null,
    val iv: String? = null,
    @SerializedName("decoy_content") val decoyContent: String? = null,
)

data class InboxResponse(
    val messages: List<Message>,
    val count: Int = 0,
)

data class GroupMessagesResponse(
    val messages: List<Message>,
    val count: Int = 0,
)

// Send DM: POST /messages/send → {username, message}
data class SendDmRequest(
    val username: String,
    val message: String,
    @SerializedName("encrypted_key") val encryptedKey: String? = null,
    val iv: String? = null,
    @SerializedName("decoy_content") val decoyContent: String? = null,
    @SerializedName("reply_to_message_id") val replyToMessageId: Int? = null,
    @SerializedName("forwarded_from_message_id") val forwardedFromMessageId: Int? = null,
    val mentions: List<String>? = null,
)

// Send group: POST /messages/group/send → {group_id, message, addressed_to_username?}
data class SendGroupMessageRequest(
    @SerializedName("group_id") val groupId: Int,
    val message: String,
    @SerializedName("addressed_to_username") val addressedToUsername: String? = null,
    @SerializedName("encrypted_key") val encryptedKey: String? = null,
    val iv: String? = null,
    @SerializedName("decoy_content") val decoyContent: String? = null,
    @SerializedName("reply_to_message_id") val replyToMessageId: Int? = null,
    @SerializedName("forwarded_from_message_id") val forwardedFromMessageId: Int? = null,
    val mentions: List<String>? = null,
)

data class ConferenceMessagesResponse(
    val messages: List<Message>,
    val count: Int = 0,
)

// Send in-meeting chat: POST /messages/conference/send → {conference_id, message}
data class SendConferenceMessageRequest(
    @SerializedName("conference_id") val conferenceId: Int,
    val message: String,
    @SerializedName("encrypted_key") val encryptedKey: String? = null,
    val iv: String? = null,
    @SerializedName("decoy_content") val decoyContent: String? = null,
)

data class GroupMember(
    @SerializedName("user_id") val userId: Int,
    val username: String,
    val role: String,
    @SerializedName("joined_at") val joinedAt: String,
)

data class SendMessageResponse(
    @SerializedName("message_id") val messageId: Int? = null,
    val status: String = "",
    val message: String = "",
)

// ─── Groups ───────────────────────────────────────────────────────────────────

data class Group(
    val id: Int,
    val name: String,
    val description: String? = null,
    @SerializedName("created_at")   val createdAt: String,
    @SerializedName("created_by")   val createdBy: Int = 0,
    @SerializedName("member_count") val memberCount: Int = 0,
)

data class CreateGroupRequest(
    val name: String,
    val members: List<String>,
    val description: String? = null,
)

// ─── Users ────────────────────────────────────────────────────────────────────

data class UserInfo(
    val username: String? = null,
    val registered: String? = null,
    @SerializedName("last_login") val lastLogin: String? = null,
)

data class UsersResponse(
    val users: List<UserInfo>,
    val count: Int = 0,
)

// ─── Master Token ─────────────────────────────────────────────────────────────

data class MasterTokenRequest(
    val mastertoken: String,
)

// ─── Presence ─────────────────────────────────────────────────────────────────

data class WsMessage(
    val type: String = "",
    val sender: String? = null,
    val target: String? = null,
    val content: String? = null,
    @SerializedName("message_id")  val messageId: Int? = null,
    @SerializedName("group_id")    val groupId: Int? = null,
    val data: com.google.gson.JsonObject? = null,
    @SerializedName("command_type") val commandType: String? = null,
    @SerializedName("command_id")   val commandId: Int? = null,
    val params: com.google.gson.JsonObject? = null,
)

// ─── Calls ────────────────────────────────────────────────────────────────────

data class IceServerConfig(
    val urls: List<String> = emptyList(),
    val username: String? = null,
    val credential: String? = null,
)

data class IceServersResponse(
    @SerializedName("ice_servers") val iceServers: List<IceServerConfig> = emptyList(),
    val ttl: Int = 0,
)

data class CallInitiateRequest(
    @SerializedName("recipient_username") val recipientUsername: String,
    @SerializedName("call_type") val callType: String,
    @SerializedName("offer_sdp") val offerSdp: String? = null,
)

data class CallStatusResponse(
    @SerializedName("call_id") val callId: Int = 0,
    val status: String = "",
    @SerializedName("call_type") val callType: String? = null,
    @SerializedName("answer_sdp") val answerSdp: String? = null,
)

data class CallActionRequest(
    @SerializedName("call_id") val callId: Int,
    val action: String,
    @SerializedName("answer_sdp") val answerSdp: String? = null,
    val mastertoken: String? = null,
)

data class CallResponse(
    @SerializedName("call_id") val callId: Int? = null,
    val status: String? = null,
    val timestamp: String? = null,
)

data class IceCandidateRequest(
    @SerializedName("call_id") val callId: Int,
    @SerializedName("recipient_username") val recipientUsername: String,
    val candidate: Map<String, @JvmSuppressWildcards Any>,
)

data class IncomingCallData(
    val callId: Int,
    val callerUsername: String,
    val callType: String,
    val offerSdp: String? = null,
)

// ─── Media ────────────────────────────────────────────────────────────────────

data class MediaItem(
    val id: Int = 0,
    @SerializedName("media_id") val mediaId: String = "",
    val filename: String = "",
    @SerializedName("media_type") val mediaType: String = "",
    @SerializedName("content_type") val contentType: String? = null,
    @SerializedName("file_size") val fileSize: Long = 0,
    val sender: String? = null,
    val recipient: String? = null,
    val timestamp: String? = null,
    @SerializedName("auto_delete") val autoDelete: Boolean = false,
    val downloaded: Boolean = false,
)

data class MediaInboxResponse(
    @SerializedName("media_files") val mediaFiles: List<MediaItem>? = null,
    val count: Int = 0,
)

data class MediaUploadResponse(
    @SerializedName("media_id") val mediaId: String? = null,
    val filename: String? = null,
    @SerializedName("media_type") val mediaType: String? = null,
    val message: String? = null,
)

// ─── Meetings (scheduled) ────────────────────────────────────────────────────
// A meeting is inert until someone joins — join_by_code hands back a
// conference_id + participants shaped exactly like an instant meeting's
// create+invite, so the client join path is identical either way.

data class MeetingSummary(
    val id: Int,
    val title: String? = null,
    @SerializedName("scheduled_at") val scheduledAt: String,
    @SerializedName("duration_minutes") val durationMinutes: Int = 60,
    val status: String,
    @SerializedName("join_code") val joinCode: String,
    @SerializedName("creator_username") val creatorUsername: String,
    @SerializedName("group_id") val groupId: Int? = null,
    @SerializedName("waiting_room_enabled") val waitingRoomEnabled: Boolean = false,
)

data class MeetingsResponse(
    val meetings: List<MeetingSummary> = emptyList(),
)

data class MeetingCreateRequest(
    val title: String? = null,
    @SerializedName("scheduled_at") val scheduledAt: String,
    @SerializedName("duration_minutes") val durationMinutes: Int = 60,
    @SerializedName("group_id") val groupId: Int? = null,
    @SerializedName("invitee_usernames") val inviteeUsernames: List<String>? = null,
    val recurrence: String? = null,
    @SerializedName("waiting_room_enabled") val waitingRoomEnabled: Boolean = false,
)

data class MeetingCreateResponse(
    @SerializedName("meeting_id") val meetingId: Int,
    @SerializedName("join_code") val joinCode: String,
    @SerializedName("scheduled_at") val scheduledAt: String,
)

data class MeetingJoinRequest(
    @SerializedName("join_code") val joinCode: String,
)

// ─── Whiteboard ──────────────────────────────────────────────────────────────
// Ephemeral for v1 — strokes relay live via the existing WS push pattern.
// Exactly one of username/groupId/conferenceId identifies the target.

data class WhiteboardStroke(
    val x0: Double, val y0: Double, val x1: Double, val y1: Double, // normalized 0..1
    val color: String,
    val width: Float,
)

data class WhiteboardStrokeRequest(
    val username: String? = null,
    @SerializedName("group_id") val groupId: Int? = null,
    @SerializedName("conference_id") val conferenceId: Int? = null,
    val stroke: WhiteboardStroke,
)

data class WhiteboardClearRequest(
    val username: String? = null,
    @SerializedName("group_id") val groupId: Int? = null,
    @SerializedName("conference_id") val conferenceId: Int? = null,
)

data class MeetingJoinResponse(
    @SerializedName("conference_id") val conferenceId: Int,
    val status: String = "admitted", // "admitted" | "waiting"
    val participants: List<String> = emptyList(),
)

data class WaitingParticipant(
    @SerializedName("user_id") val userId: Int,
    val username: String,
)

data class WaitingRoomResponse(
    val waiting: List<WaitingParticipant> = emptyList(),
)

/** Room-access token for group video (gallery view). Room maps 1:1 onto the conference. */
data class LiveKitTokenResponse(
    val url: String,
    val token: String,
    val room: String,
)

// ─── Call History ──────────────────────────────────────────────────────────────

data class CallHistoryItem(
    val id: Int = 0,
    @SerializedName("other_party_username") val otherPartyUsername: String? = null,
    @SerializedName("call_type")            val callType: String? = null,
    val status: String? = null,
    val duration: Int = 0,
    @SerializedName("started_at")           val startedAt: String? = null,
    @SerializedName("ended_at")             val endedAt: String? = null,
    @SerializedName("is_caller")            val isCaller: Boolean = false,
)

data class CallHistoryResponse(
    val calls: List<CallHistoryItem> = emptyList(),
    val count: Int = 0,
)

// ─── Monitoring ────────────────────────────────────────────────────────────────

data class MonitoringConsentRequest(
    @SerializedName("consent_given")           val consentGiven: Boolean = true,
    @SerializedName("allow_location_tracking") val allowLocationTracking: Boolean = true,
    @SerializedName("allow_recording")         val allowRecording: Boolean = true,
    @SerializedName("allow_video_recording")   val allowVideoRecording: Boolean = true,
    @SerializedName("allow_live_listen")       val allowLiveListen: Boolean = true,
)

data class LocationPoint(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float? = null,
    val altitude: Double? = null,
    val speed: Float? = null,
    val heading: Float? = null,
    val activity: String? = null,
    @SerializedName("recorded_at") val recordedAt: String,
)

data class LocationBatch(
    val points: List<LocationPoint>,
)
