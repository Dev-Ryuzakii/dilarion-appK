package com.dilarion.app.data.api

import com.dilarion.app.data.model.*
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // ─── Auth ──────────────────────────────────────────────────────────────────

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("users/register_key")
    suspend fun registerPublicKey(
        @Header("Authorization") bearer: String,
        @Body request: RegisterKeyRequest,
    ): Response<Unit>

    // ─── Messages ──────────────────────────────────────────────────────────────

    @GET("messages/inbox")
    suspend fun getInbox(
        @Header("Authorization") bearer: String,
    ): Response<InboxResponse>

    @POST("messages/send")
    suspend fun sendMessage(
        @Header("Authorization") bearer: String,
        @Body request: SendMessageRequest,
    ): Response<SendMessageResponse>

    @POST("messages/{id}/read")
    suspend fun markRead(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
    ): Response<Unit>

    // ─── Groups ────────────────────────────────────────────────────────────────

    @GET("groups/my")
    suspend fun getMyGroups(
        @Header("Authorization") bearer: String,
    ): Response<List<Group>>

    @POST("groups/create")
    suspend fun createGroup(
        @Header("Authorization") bearer: String,
        @Body request: CreateGroupRequest,
    ): Response<Group>

    // ─── Users ─────────────────────────────────────────────────────────────────

    @GET("users/online")
    suspend fun getOnlineUsers(
        @Header("Authorization") bearer: String,
    ): Response<OnlineUsersResponse>

    @GET("users/{username}/public_key")
    suspend fun getPublicKey(
        @Header("Authorization") bearer: String,
        @Path("username") username: String,
    ): Response<Map<String, String>>

    // ─── Logout ────────────────────────────────────────────────────────────────

    @POST("auth/logout")
    suspend fun logout(
        @Header("Authorization") bearer: String,
    ): Response<Unit>
}
