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

// ─── Messages ─────────────────────────────────────────────────────────────────

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
    @SerializedName("is_admin_announcement") val isAdminAnnouncement: Boolean = false,
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
)

// Send group: POST /messages/group/send → {group_id, message}
data class SendGroupMessageRequest(
    @SerializedName("group_id") val groupId: Int,
    val message: String,
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

data class CallInitiateRequest(
    @SerializedName("recipient_username") val recipientUsername: String,
    @SerializedName("call_type") val callType: String,
    @SerializedName("offer_sdp") val offerSdp: String? = null,
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
    @SerializedName("consent_given")        val consentGiven: Boolean = true,
    @SerializedName("allow_location_tracking") val allowLocationTracking: Boolean = true,
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
