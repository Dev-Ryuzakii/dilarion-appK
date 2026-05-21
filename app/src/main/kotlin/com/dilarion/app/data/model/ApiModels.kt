package com.dilarion.app.data.model

import com.google.gson.annotations.SerializedName

// ─── Auth ─────────────────────────────────────────────────────────────────────

data class LoginRequest(
    val username: String,
    val token: String,
)

data class LoginResponse(
    @SerializedName("session_token") val sessionToken: String,
    val username: String,
    @SerializedName("public_key")   val publicKey: String?,
)

data class RegisterKeyRequest(
    @SerializedName("public_key") val publicKey: String,
)

// ─── Messages ─────────────────────────────────────────────────────────────────

data class Message(
    val id: Int,
    val sender: String,
    val recipient: String,
    val content: String,
    @SerializedName("decoy_content")  val decoyContent: String,
    @SerializedName("content_type")  val contentType: String = "text",
    val timestamp: String,
    val read: Boolean = false,
    @SerializedName("group_id")      val groupId: Int? = null,
    @SerializedName("encrypted_key") val encryptedKey: String? = null,
    val iv: String? = null,
)

data class InboxResponse(
    val messages: List<Message>,
)

data class SendMessageRequest(
    val recipient: String,
    val content: String,
    @SerializedName("decoy_content")  val decoyContent: String,
    @SerializedName("content_type")   val contentType: String = "text",
    @SerializedName("encrypted_key")  val encryptedKey: String? = null,
    val iv: String? = null,
    @SerializedName("group_id")       val groupId: Int? = null,
)

data class SendMessageResponse(
    @SerializedName("message_id") val messageId: Int,
    val status: String,
)

// ─── Groups ───────────────────────────────────────────────────────────────────

data class Group(
    val id: Int,
    val name: String,
    @SerializedName("created_at") val createdAt: String,
    val members: List<String> = emptyList(),
)

data class CreateGroupRequest(
    val name: String,
    val members: List<String>,
)

// ─── Users ────────────────────────────────────────────────────────────────────

data class OnlineUser(
    val username: String,
    @SerializedName("public_key") val publicKey: String?,
    val online: Boolean = false,
)

data class OnlineUsersResponse(
    val users: List<OnlineUser>,
)

// ─── Presence ─────────────────────────────────────────────────────────────────

data class WsMessage(
    val type: String,
    val sender: String? = null,
    val content: String? = null,
    @SerializedName("message_id") val messageId: Int? = null,
    @SerializedName("group_id")   val groupId: Int? = null,
)
