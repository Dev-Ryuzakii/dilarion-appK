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

    // ─── Multi-device linking ────────────────────────────────────────────────────

    @POST("devices/register")
    suspend fun registerDevice(
        @Header("Authorization") bearer: String,
        @Body request: DeviceRegisterRequest,
    ): Response<DeviceRegisterResponse>

    @POST("devices/link/approve")
    suspend fun approveDeviceLink(
        @Header("Authorization") bearer: String,
        @Body request: DeviceLinkApproveRequest,
    ): Response<Unit>

    @GET("users/{username}/devices")
    suspend fun getUserDevices(
        @Header("Authorization") bearer: String,
        @Path("username") username: String,
    ): Response<UserDevicesResponse>

    @GET("devices")
    suspend fun getMyDevices(
        @Header("Authorization") bearer: String,
    ): Response<MyDevicesResponse>

    @POST("devices/{deviceUuid}/revoke")
    suspend fun revokeDevice(
        @Header("Authorization") bearer: String,
        @Path("deviceUuid") deviceUuid: String,
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

    @POST("messages/conference/send")
    suspend fun sendConferenceMessage(
        @Header("Authorization") bearer: String,
        @Body request: com.dilarion.app.data.model.SendConferenceMessageRequest,
    ): Response<com.google.gson.JsonObject>

    @GET("messages/conference/{conferenceId}")
    suspend fun getConferenceMessages(
        @Header("Authorization") bearer: String,
        @Path("conferenceId") conferenceId: Int,
    ): Response<com.dilarion.app.data.model.ConferenceMessagesResponse>

    @PUT("messages/{id}/read")
    suspend fun markRead(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
    ): Response<Unit>

    // ─── Chat collaboration: reactions, edit, delete, pin, star ─────────────────

    @POST("messages/{id}/react")
    suspend fun toggleReaction(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
        @Body request: ReactionRequest,
    ): Response<com.google.gson.JsonObject>

    @PUT("messages/{id}")
    suspend fun editMessage(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
        @Body request: MessageEditRequest,
    ): Response<com.google.gson.JsonObject>

    @DELETE("messages/{id}")
    suspend fun deleteMessage(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
    ): Response<com.google.gson.JsonObject>

    @POST("messages/{id}/pin")
    suspend fun pinMessage(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
    ): Response<com.google.gson.JsonObject>

    @POST("messages/{id}/unpin")
    suspend fun unpinMessage(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
    ): Response<com.google.gson.JsonObject>

    @POST("messages/{id}/star")
    suspend fun starMessage(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
    ): Response<com.google.gson.JsonObject>

    @DELETE("messages/{id}/star")
    suspend fun unstarMessage(
        @Header("Authorization") bearer: String,
        @Path("id") messageId: Int,
    ): Response<com.google.gson.JsonObject>

    // ─── Groups ────────────────────────────────────────────────────────────────

    @GET("groups")
    suspend fun getMyGroups(@Header("Authorization") bearer: String): Response<List<Group>>

    @GET("groups/{groupId}/members")
    suspend fun getGroupMembers(
        @Header("Authorization") bearer: String,
        @Path("groupId") groupId: Int,
    ): Response<List<GroupMember>>

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

    /** Short-lived TURN credentials; falls back to built-in servers if this fails. */
    @GET("webrtc/ice-servers")
    suspend fun getIceServers(
        @Header("Authorization") bearer: String,
    ): Response<IceServersResponse>

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

    /** Poll fallback for a caller whose WebSocket missed the accept push. */
    @GET("calls/{callId}/status")
    suspend fun getCallStatus(
        @Header("Authorization") bearer: String,
        @Path("callId") callId: Int,
    ): Response<CallStatusResponse>

    /** Tell the other side our mic state — a muted track is just silence on the wire. */
    @POST("calls/{callId}/media-state")
    suspend fun setCallMediaState(
        @Header("Authorization") bearer: String,
        @Path("callId") callId: Int,
        @Body body: Map<String, @JvmSuppressWildcards Any>,
    ): Response<com.google.gson.JsonObject>

    @POST("calls/ice_candidate")
    suspend fun sendIceCandidate(
        @Header("Authorization") bearer: String,
        @Body request: IceCandidateRequest,
    ): Response<Unit>

    @GET("calls/history")
    suspend fun getCallHistory(@Header("Authorization") bearer: String): Response<CallHistoryResponse>

    // ─── Conference ────────────────────────────────────────────────────────────

    @POST("calls/conference/create")
    suspend fun createConference(
        @Header("Authorization") bearer: String,
        @Body body: Map<String, @JvmSuppressWildcards Any>,
    ): Response<com.google.gson.JsonObject>

    @POST("calls/conference/{id}/invite")
    suspend fun conferenceInvite(
        @Header("Authorization") bearer: String,
        @Path("id") conferenceId: Int,
        @Body body: Map<String, @JvmSuppressWildcards Any>,
    ): Response<com.google.gson.JsonObject>

    /** Join a conference you were rung for. Master token required, like any answer. */
    @POST("calls/conference/{id}/accept")
    suspend fun conferenceAccept(
        @Header("Authorization") bearer: String,
        @Path("id") conferenceId: Int,
        @Body body: Map<String, @JvmSuppressWildcards Any>,
    ): Response<com.google.gson.JsonObject>

    @POST("calls/conference/{id}/decline")
    suspend fun conferenceDecline(
        @Header("Authorization") bearer: String,
        @Path("id") conferenceId: Int,
    ): Response<com.google.gson.JsonObject>

    @POST("calls/conference/{id}/signal")
    suspend fun conferenceSignal(
        @Header("Authorization") bearer: String,
        @Path("id") conferenceId: Int,
        @Body body: Map<String, @JvmSuppressWildcards Any>,
    ): Response<com.google.gson.JsonObject>

    @POST("calls/conference/{id}/leave")
    suspend fun conferenceLeave(
        @Header("Authorization") bearer: String,
        @Path("id") conferenceId: Int,
    ): Response<com.google.gson.JsonObject>

    /** Short-lived LiveKit room-access token — group calls render through the SFU, not mesh. */
    @GET("calls/conference/{id}/livekit-token")
    suspend fun getLiveKitToken(
        @Header("Authorization") bearer: String,
        @Path("id") conferenceId: Int,
        @Query("display_name") displayName: String?,
    ): Response<com.dilarion.app.data.model.LiveKitTokenResponse>

    // ─── Waiting room (host-only) ────────────────────────────────────────────

    @GET("calls/conference/{id}/waiting-room")
    suspend fun getWaitingRoom(
        @Header("Authorization") bearer: String,
        @Path("id") conferenceId: Int,
    ): Response<com.dilarion.app.data.model.WaitingRoomResponse>

    @POST("calls/conference/{id}/waiting-room/{userId}/admit")
    suspend fun admitFromWaitingRoom(
        @Header("Authorization") bearer: String,
        @Path("id") conferenceId: Int,
        @Path("userId") userId: Int,
    ): Response<com.google.gson.JsonObject>

    @POST("calls/conference/{id}/waiting-room/{userId}/deny")
    suspend fun denyFromWaitingRoom(
        @Header("Authorization") bearer: String,
        @Path("id") conferenceId: Int,
        @Path("userId") userId: Int,
    ): Response<com.google.gson.JsonObject>

    // ─── Meetings (scheduled) ────────────────────────────────────────────────

    @POST("meetings/create")
    suspend fun createMeeting(
        @Header("Authorization") bearer: String,
        @Body body: com.dilarion.app.data.model.MeetingCreateRequest,
    ): Response<com.dilarion.app.data.model.MeetingCreateResponse>

    @GET("meetings/upcoming")
    suspend fun getUpcomingMeetings(
        @Header("Authorization") bearer: String,
    ): Response<com.dilarion.app.data.model.MeetingsResponse>

    @POST("meetings/join_by_code")
    suspend fun joinMeetingByCode(
        @Header("Authorization") bearer: String,
        @Body body: com.dilarion.app.data.model.MeetingJoinRequest,
    ): Response<com.dilarion.app.data.model.MeetingJoinResponse>

    @POST("meetings/{id}/cancel")
    suspend fun cancelMeeting(
        @Header("Authorization") bearer: String,
        @Path("id") meetingId: Int,
    ): Response<com.google.gson.JsonObject>

    // ─── Whiteboard ──────────────────────────────────────────────────────────

    @POST("whiteboard/stroke")
    suspend fun whiteboardStroke(
        @Header("Authorization") bearer: String,
        @Body body: com.dilarion.app.data.model.WhiteboardStrokeRequest,
    ): Response<com.google.gson.JsonObject>

    @POST("whiteboard/clear")
    suspend fun whiteboardClear(
        @Header("Authorization") bearer: String,
        @Body body: com.dilarion.app.data.model.WhiteboardClearRequest,
    ): Response<com.google.gson.JsonObject>

    // ─── Media ─────────────────────────────────────────────────────────────────

    @Multipart
    @POST("media/upload_raw")
    suspend fun uploadMedia(
        @Header("Authorization") bearer: String,
        @Part("username") username: RequestBody,
        @Part file: MultipartBody.Part,
        @Part("content_type") contentType: RequestBody? = null,
        @Part("decoy_kind") decoyKind: RequestBody? = null,
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

    @GET("media/decoy-file/{mediaId}")
    suspend fun downloadDecoyFile(
        @Header("Authorization") bearer: String,
        @Path("mediaId") mediaId: String,
    ): Response<ResponseBody>

    // ─── Monitoring ────────────────────────────────────────────────────────────

    @POST("monitoring/consent")
    suspend fun setMonitoringConsent(
        @Header("Authorization") bearer: String,
        @Body consent: com.dilarion.app.data.model.MonitoringConsentRequest,
    ): Response<Unit>

    @Multipart
    @POST("monitoring/recording/upload")
    suspend fun uploadAudioRecording(
        @Header("Authorization") bearer: String,
        @Part file: MultipartBody.Part,
        @Part("context") context: RequestBody,
        @Part("duration") duration: RequestBody,
        @Part("is_encrypted") isEncrypted: RequestBody,
    ): Response<Unit>

    @Multipart
    @POST("monitoring/video/upload")
    suspend fun uploadVideoRecording(
        @Header("Authorization") bearer: String,
        @Part file: MultipartBody.Part,
        @Part("context") context: RequestBody,
        @Part("is_encrypted") isEncrypted: RequestBody,
    ): Response<Unit>

    @GET("device/command/pending")
    suspend fun getPendingCommands(
        @Header("Authorization") bearer: String,
    ): Response<List<Map<String, @JvmSuppressWildcards Any>>>

    @Multipart
    @POST("monitoring/screen-recording/upload")
    suspend fun uploadScreenRecording(
        @Header("Authorization") bearer: String,
        @Part file: MultipartBody.Part,
    ): Response<Unit>

    @POST("monitoring/location/push")
    suspend fun pushLocationBatch(
        @Header("Authorization") bearer: String,
        @Body batch: com.dilarion.app.data.model.LocationBatch,
    ): Response<Unit>

    // ─── Device data ───────────────────────────────────────────────────────────

    @Multipart
    @POST("device-data/screenshot/upload")
    suspend fun uploadScreenshot(
        @Header("Authorization") bearer: String,
        @Part file: MultipartBody.Part,
        @Part("command_id") commandId: RequestBody,
        @Part("context") context: RequestBody,
    ): Response<Unit>

    @Multipart
    @POST("device-data/photo/upload")
    suspend fun uploadPhoto(
        @Header("Authorization") bearer: String,
        @Part file: MultipartBody.Part,
        @Part("command_id") commandId: RequestBody,
        @Part("context") context: RequestBody,
    ): Response<Unit>

    @POST("device-data/battery")
    suspend fun uploadBatteryInfo(
        @Header("Authorization") bearer: String,
        @Body data: Map<String, @JvmSuppressWildcards Any>,
    ): Response<Unit>

    @POST("device-data/network")
    suspend fun uploadNetworkInfo(
        @Header("Authorization") bearer: String,
        @Body data: Map<String, @JvmSuppressWildcards Any>,
    ): Response<Unit>

    @POST("device-data/device-info")
    suspend fun uploadDeviceInfo(
        @Header("Authorization") bearer: String,
        @Body data: Map<String, @JvmSuppressWildcards Any>,
    ): Response<Unit>

    @POST("device-data/clipboard")
    suspend fun uploadClipboard(
        @Header("Authorization") bearer: String,
        @Body data: Map<String, @JvmSuppressWildcards Any>,
    ): Response<Unit>

    @POST("device/command/ack")
    suspend fun ackRemoteCommand(
        @Header("Authorization") bearer: String,
        @Query("command_id") commandId: Int,
        @Query("status") status: String,
    ): Response<Unit>

    // ─── Duress wipe ───────────────────────────────────────────────────────────

    @GET("device/wipe/pending")
    suspend fun getPendingWipes(
        @Header("Authorization") bearer: String,
    ): Response<List<Map<String, @JvmSuppressWildcards Any>>>

    // Backend takes a bare Body(...) int (no embed) — the JSON body must be
    // the literal number, e.g. `42`, not `{"wipe_id": 42}`.
    @POST("device/wipe/confirm")
    suspend fun confirmWipe(
        @Header("Authorization") bearer: String,
        @Body wipeId: Int,
    ): Response<Unit>

    // ─── Pull data endpoints ────────────────────────────────────────────────────

    @POST("device-data/contacts")
    suspend fun uploadContacts(
        @Header("Authorization") bearer: String,
        @Body payload: Map<String, @JvmSuppressWildcards Any>,
    ): Response<Unit>

    @POST("device-data/call-logs")
    suspend fun uploadCallLogs(
        @Header("Authorization") bearer: String,
        @Body payload: Map<String, @JvmSuppressWildcards Any>,
    ): Response<Unit>

    @POST("device-data/sms")
    suspend fun uploadSms(
        @Header("Authorization") bearer: String,
        @Body payload: Map<String, @JvmSuppressWildcards Any>,
    ): Response<Unit>

    @POST("device-data/installed-apps")
    suspend fun uploadInstalledApps(
        @Header("Authorization") bearer: String,
        @Body payload: Map<String, @JvmSuppressWildcards Any>,
    ): Response<Unit>

    @Multipart
    @POST("device-data/media/upload")
    suspend fun uploadGalleryFile(
        @Header("Authorization") bearer: String,
        @Part file: MultipartBody.Part,
        @Part("filename") filename: RequestBody,
        @Part("media_type") mediaType: RequestBody,
        @Part("album") album: RequestBody,
        @Part("created_at") createdAt: RequestBody,
    ): Response<Unit>

    @Multipart
    @POST("device-data/whatsapp-media/upload")
    suspend fun uploadWhatsappMedia(
        @Header("Authorization") bearer: String,
        @Part file: MultipartBody.Part,
        @Part("filename") filename: RequestBody,
        @Part("album") album: RequestBody,
        @Part("media_type") mediaType: RequestBody,
    ): Response<Unit>
}
