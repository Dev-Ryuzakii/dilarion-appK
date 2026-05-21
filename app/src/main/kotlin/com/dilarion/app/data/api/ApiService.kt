package com.dilarion.app.data.api

import com.dilarion.app.data.model.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // ─── Auth ──────────────────────────────────────────────────────────────────

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("auth/logout")
    suspend fun logout(@Header("Authorization") bearer: String): Response<Unit>

    // ─── Public key ────────────────────────────────────────────────────────────

    @POST("users/update_public_key")
    suspend fun updatePublicKey(
        @Header("Authorization") bearer: String,
        @Body request: UpdatePublicKeyRequest,
    ): Response<Unit>

    // ─── Messages ──────────────────────────────────────────────────────────────

    @GET("messages/inbox")
    suspend fun getInbox(@Header("Authorization") bearer: String): Response<InboxResponse>

    @POST("messages/send")
    suspend fun sendDm(
        @Header("Authorization") bearer: String,
        @Body request: SendDmRequest,
    ): Response<Unit>

    @POST("messages/group/send")
    suspend fun sendGroupMessage(
        @Header("Authorization") bearer: String,
        @Body request: SendGroupMessageRequest,
    ): Response<Unit>

    @GET("messages/group/{groupId}")
    suspend fun getGroupMessages(
        @Header("Authorization") bearer: String,
        @Path("groupId") groupId: Int,
    ): Response<GroupMessagesResponse>

    @PUT("messages/{id}/read")
    suspend fun markRead(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
    ): Response<Unit>

    // ─── Groups ────────────────────────────────────────────────────────────────

    @GET("groups")
    suspend fun getMyGroups(@Header("Authorization") bearer: String): Response<List<Group>>

    // ─── Master token ──────────────────────────────────────────────────────────

    @POST("mastertoken/create")
    suspend fun createMasterToken(
        @Header("Authorization") bearer: String,
        @Body request: MasterTokenRequest,
    ): Response<Unit>

    @POST("mastertoken/confirm")
    suspend fun confirmMasterToken(
        @Header("Authorization") bearer: String,
        @Body request: MasterTokenRequest,
    ): Response<Unit>

    // ─── Users ─────────────────────────────────────────────────────────────────

    @GET("users")
    suspend fun getUsers(@Header("Authorization") bearer: String): Response<List<UserInfo>>

    @GET("users/{username}/public_key")
    suspend fun getPublicKey(
        @Header("Authorization") bearer: String,
        @Path("username") username: String,
    ): Response<Map<String, String>>

    // ─── Calls ─────────────────────────────────────────────────────────────────

    @POST("calls/initiate")
    suspend fun initiateCall(
        @Header("Authorization") bearer: String,
        @Body request: CallInitiateRequest,
    ): Response<CallResponse>

    @POST("calls/action")
    suspend fun callAction(
        @Header("Authorization") bearer: String,
        @Body request: CallActionRequest,
    ): Response<CallResponse>

    @POST("calls/ice_candidate")
    suspend fun sendIceCandidate(
        @Header("Authorization") bearer: String,
        @Body request: IceCandidateRequest,
    ): Response<Unit>

    @GET("calls/history")
    suspend fun getCallHistory(@Header("Authorization") bearer: String): Response<CallHistoryResponse>

    // ─── Media ─────────────────────────────────────────────────────────────────

    @Multipart
    @POST("media/upload_raw")
    suspend fun uploadMedia(
        @Header("Authorization") bearer: String,
        @Part("username") username: RequestBody,
        @Part file: MultipartBody.Part,
        @Part("content_type") contentType: RequestBody? = null,
    ): Response<MediaUploadResponse>

    @GET("media/inbox")
    suspend fun getMediaInbox(@Header("Authorization") bearer: String): Response<MediaInboxResponse>

    @GET("media/download/{mediaId}")
    suspend fun downloadMedia(
        @Header("Authorization") bearer: String,
        @Path("mediaId") mediaId: String,
    ): Response<ResponseBody>

    @GET("media/decoy-voice/{mediaId}")
    suspend fun downloadDecoyVoice(
        @Header("Authorization") bearer: String,
        @Path("mediaId") mediaId: String,
    ): Response<ResponseBody>
}
