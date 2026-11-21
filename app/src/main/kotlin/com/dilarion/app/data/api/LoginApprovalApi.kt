package com.dilarion.app.data.api

import com.dilarion.app.data.model.LoginRequest
import com.google.gson.annotations.SerializedName
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Signing in while the account is signed in on another device: the new device
 * waits until a signed-in device (or the email link, or the master token)
 * approves it. Nobody gets signed out.
 */
interface LoginApprovalApi {
    /** Same endpoint as [ApiService.login], read as either outcome (200 signed in, 202 waiting). */
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginOutcome>

    @POST("auth/login-requests/status")
    suspend fun status(@Body body: LoginRequestToken): Response<LoginRequestState>

    @POST("auth/login-requests/master-token")
    suspend fun masterToken(@Body body: LoginRequestMasterToken): Response<LoginRequestState>

    @POST("auth/login-requests/cancel")
    suspend fun cancel(@Body body: LoginRequestToken): Response<ResponseBody>

    @GET("auth/login-requests/pending")
    suspend fun pending(@Header("Authorization") auth: String): Response<PendingLoginRequests>

    @POST("auth/login-requests/{id}/decision")
    suspend fun decide(
        @Header("Authorization") auth: String,
        @Path("id") requestId: Long,
        @Body body: LoginDecision,
    ): Response<ResponseBody>
}

data class LoginOutcome(
    // Signed in (200)
    @SerializedName("token") val sessionToken: String? = null,
    val username: String? = null,
    @SerializedName("onboarding_required") val onboardingRequired: Boolean = false,
    // Waiting for approval (202)
    val status: String? = null,
    @SerializedName("request_token") val requestToken: String? = null,
    @SerializedName("request_id") val requestId: Long? = null,
    @SerializedName("expires_at") val expiresAt: String? = null,
    @SerializedName("device_name") val deviceName: String? = null,
    val location: String? = null,
    @SerializedName("email_sent") val emailSent: Boolean = false,
    @SerializedName("two_fa_required") val twoFaRequired: Boolean = false,
)

data class LoginRequestToken(@SerializedName("request_token") val requestToken: String)

data class LoginRequestMasterToken(
    @SerializedName("request_token") val requestToken: String,
    @SerializedName("master_token") val masterToken: String,
    @SerializedName("two_fa_password") val twoFaPassword: String? = null,
)

/** pending | approved | completed | denied | expired | cancelled; `login` once completed. */
data class LoginRequestState(
    val status: String = "pending",
    @SerializedName("expires_at") val expiresAt: String? = null,
    val login: LoginOutcome? = null,
)

data class PendingLoginRequest(
    @SerializedName("request_id") val requestId: Long,
    @SerializedName("device_name") val deviceName: String? = null,
    val platform: String? = null,
    val location: String? = null,
    val ip: String? = null,
    val time: String? = null,
    @SerializedName("expires_at") val expiresAt: String? = null,
)

data class PendingLoginRequests(val requests: List<PendingLoginRequest> = emptyList())

data class LoginDecision(val approve: Boolean)
