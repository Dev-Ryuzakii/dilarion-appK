package com.dilarion.app.ui.screens.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.LoginRequest
import com.dilarion.app.services.BackgroundConnectionService
import com.dilarion.app.security.CryptoManager
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import com.dilarion.app.data.api.LoginApprovalApi
import com.dilarion.app.data.api.LoginOutcome
import com.dilarion.app.data.api.LoginRequestMasterToken
import com.dilarion.app.data.api.LoginRequestToken
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import com.dilarion.app.utils.toUserMessage

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val success: Boolean = false,
    // Shown once after signup or a recovery-code reset — same reveal screen
    // either way, since both hand back a fresh code that never comes back.
    val revealedUsername: String? = null,
    val revealedRecoveryCode: String? = null,
    /** Invited staff still owe the profile + live camera step. */
    val onboardingRequired: Boolean = false,
    /** The reveal screen is for a fresh activation (continue → onboarding/home, not back to login). */
    val activated: Boolean = false,
)

/** Forgot access token without a recovery code: email → code + reason → sent. */
enum class ForgotStep { EMAIL, DETAILS, SENT }

data class ForgotUiState(
    val step: ForgotStep = ForgotStep.EMAIL,
    val loading: Boolean = false,
    val error: String? = null,
    val message: String? = null,
)

/**
 * This device is waiting for the owner to approve the sign-in, because the
 * account is already signed in on another device.
 */
data class LoginApprovalUi(
    val requestToken: String,
    val deviceName: String,
    val location: String,
    val expiresAtMillis: Long,
    val emailSent: Boolean,
    val twoFaRequired: Boolean,
    /** pending | denied | expired */
    val status: String = "pending",
    val busy: Boolean = false,
    val error: String? = null,
)

/** Uploads this device's public key and registers it so senders can encrypt to it. */
suspend fun registerKeysAndConnect(apiService: ApiService, sessionManager: SessionManager, sessionToken: String, publicKey: String) {
    runCatching {
        apiService.updatePublicKey("Bearer $sessionToken", com.dilarion.app.data.model.UpdatePublicKeyRequest(publicKey))
    }
    runCatching {
        val resp = apiService.registerDevice(
            "Bearer $sessionToken",
            com.dilarion.app.data.model.DeviceRegisterRequest(publicKey, "android", android.os.Build.MODEL),
        )
        resp.body()?.deviceUuid?.let { sessionManager.saveDeviceUuid(it) }
    }
}

@HiltViewModel
class AuthViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val cryptoManager: CryptoManager,
    private val presenceService: PresenceService,
    private val loginApprovalApi: LoginApprovalApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState

    private val _approval = MutableStateFlow<LoginApprovalUi?>(null)
    val approval: StateFlow<LoginApprovalUi?> = _approval
    private var approvalPoll: Job? = null

    fun login(username: String, token: String) {
        if (username.isBlank() || token.isBlank()) {
            _uiState.value = AuthUiState(error = "Username and token are required")
            return
        }
        val cleanUsername = username.trim()
        if (cleanUsername.length !in 3..50) {
            _uiState.value = AuthUiState(error = "Username must be between 3 and 50 characters")
            return
        }
        viewModelScope.launch {
            _uiState.value = AuthUiState(isLoading = true)
            runCatching {
                val response = loginApprovalApi.login(
                    LoginRequest(
                        cleanUsername, token.trim(),
                        deviceId = com.dilarion.app.security.DeviceIdentity.id(context),
                        deviceName = com.dilarion.app.security.DeviceIdentity.name(context),
                    )
                )
                if (!response.isSuccessful) {
                    val msg = when (response.code()) {
                        401  -> "Invalid credentials"
                        409  -> errorBody(response.errorBody()?.string()) ?: "This account is already signed in on another phone"
                        422  -> errorBody(response.errorBody()?.string()) ?: "Check the login fields and try again"
                        500  -> "Server error. Try again."
                        else -> errorBody(response.errorBody()?.string()) ?: "Couldn't sign you in. Please try again."
                    }
                    _uiState.value = AuthUiState(error = msg)
                    return@launch
                }
                val body = response.body()!!
                if (response.code() == 202 && body.status == "approval_required" && body.requestToken != null) {
                    _uiState.value = AuthUiState()
                    startApproval(body, cleanUsername)
                    return@launch
                }
                completeLogin(body, cleanUsername)
            }.onFailure { e ->
                _uiState.value = AuthUiState(error = e.toUserMessage("Can't reach the server. Check your connection and try again."))
            }
        }
    }

    private suspend fun completeLogin(body: LoginOutcome, fallbackUsername: String) {
        val sessionToken = body.sessionToken
        if (sessionToken.isNullOrBlank()) {
            _uiState.value = AuthUiState(error = "Something went wrong signing you in. Please try again.")
            return
        }
        establishSession(sessionToken, body.username ?: fallbackUsername, body.onboardingRequired)
        _uiState.value = AuthUiState(success = true, onboardingRequired = body.onboardingRequired)
    }

    private fun startApproval(body: LoginOutcome, username: String) {
        val expires = body.expiresAt?.let { runCatching { java.time.OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() }
            ?: (System.currentTimeMillis() + 10 * 60_000L)
        val requestToken = body.requestToken ?: return
        _approval.value = LoginApprovalUi(
            requestToken = requestToken,
            deviceName = body.deviceName ?: com.dilarion.app.security.DeviceIdentity.name(context),
            location = body.location ?: "Unknown location",
            expiresAtMillis = expires,
            emailSent = body.emailSent,
            twoFaRequired = body.twoFaRequired,
        )
        approvalPoll?.cancel()
        approvalPoll = viewModelScope.launch {
            while (true) {
                val current = _approval.value ?: break
                if (current.status != "pending" || current.requestToken != requestToken) break
                runCatching { loginApprovalApi.status(LoginRequestToken(requestToken)) }.getOrNull()?.let { resp ->
                    val st = resp.body()
                    when {
                        st?.status == "completed" && st.login != null -> {
                            _approval.value = null
                            completeLogin(st.login, username)
                            return@launch
                        }
                        st?.status == "denied" || st?.status == "expired" || st?.status == "cancelled" ->
                            _approval.value = current.copy(status = st.status)
                        resp.code() == 404 || resp.code() == 409 ->
                            _approval.value = current.copy(status = "expired")
                    }
                }
                delay(2500)
            }
        }
    }

    /** Can't reach the signed-in device: the master token approves this sign-in. */
    fun approveWithMasterToken(masterToken: String, twoFaPassword: String, username: String) {
        val current = _approval.value ?: return
        if (masterToken.isBlank()) return
        viewModelScope.launch {
            _approval.value = current.copy(busy = true, error = null)
            runCatching {
                loginApprovalApi.masterToken(
                    LoginRequestMasterToken(current.requestToken, masterToken.trim(), twoFaPassword.takeIf { it.isNotEmpty() })
                )
            }.onSuccess { resp ->
                val login = resp.body()?.login
                if (resp.isSuccessful && login != null) {
                    approvalPoll?.cancel()
                    _approval.value = null
                    completeLogin(login, username)
                } else {
                    val msg = errorBody(resp.errorBody()?.string()) ?: "That master token is incorrect."
                    _approval.value = _approval.value?.copy(
                        busy = false, error = msg,
                        status = if (resp.code() == 403) "denied" else "pending",
                    )
                }
            }.onFailure { e ->
                _approval.value = _approval.value?.copy(busy = false, error = e.toUserMessage("Can't reach the server."))
            }
        }
    }

    /** Leave the waiting screen (cancels the request if it's still open). */
    fun leaveApproval() {
        val current = _approval.value ?: return
        approvalPoll?.cancel()
        _approval.value = null
        if (current.status == "pending") {
            viewModelScope.launch { runCatching { loginApprovalApi.cancel(LoginRequestToken(current.requestToken)) } }
        }
    }

    /**
     * Invited staff activate in the app: the one-time code from their email
     * or SMS plus a login token they choose here (never seen by anyone else).
     */
    fun activate(code: String, token: String, confirm: String) {
        val cleanCode = code.trim()
        when {
            cleanCode.isBlank() -> { _uiState.value = AuthUiState(error = "Enter the activation code from your email or SMS"); return }
            token.length < 8 -> { _uiState.value = AuthUiState(error = "Your login token must be at least 8 characters"); return }
            token != confirm -> { _uiState.value = AuthUiState(error = "The two tokens do not match"); return }
        }
        viewModelScope.launch {
            _uiState.value = AuthUiState(isLoading = true)
            runCatching {
                val response = apiService.activateAccount(
                    com.dilarion.app.data.model.ActivationRequest(cleanCode, token)
                )
                if (!response.isSuccessful) {
                    val msg = errorBody(response.errorBody()?.string()) ?: "Couldn't activate your account. Please check the code and try again."
                    _uiState.value = AuthUiState(error = msg)
                    return@launch
                }
                val body = response.body()!!
                establishSession(body.token, body.username, body.onboardingRequired)
                _uiState.value = AuthUiState(
                    revealedUsername = body.username,
                    revealedRecoveryCode = body.recoveryCode,
                    onboardingRequired = body.onboardingRequired,
                    activated = true,
                )
            }.onFailure { e ->
                _uiState.value = AuthUiState(error = e.toUserMessage("Can't reach the server. Check your connection and try again."))
            }
        }
    }

    /** After the recovery code was shown following activation — go on to onboarding or home. */
    fun finishActivation() {
        val onboarding = _uiState.value.onboardingRequired
        _uiState.value = AuthUiState(success = true, onboardingRequired = onboarding)
    }

    /**
     * Shared by login and activation. Keys and the master token are bound to
     * the account: if a different user was last on this device, everything of
     * theirs is wiped first (prepareForAccount), so user A's keypair or master
     * token can never decrypt or unlock anything for user B.
     */
    private suspend fun establishSession(sessionToken: String, username: String, onboardingRequired: Boolean) {
        sessionManager.prepareForAccount(username)
        // Generate the E2EE keypair ONCE per account on this device. Regenerating
        // on every login would rotate the identity and make all previously
        // received messages permanently undecryptable.
        val existingPriv = sessionManager.privateKey.first()
        val existingPub = sessionManager.publicKey.first()
        val (pubB64, privB64) = if (existingPriv.isNullOrBlank() || existingPub.isNullOrBlank()) {
            cryptoManager.generateKeyPair()
        } else {
            Pair(existingPub, existingPriv)
        }
        sessionManager.saveSession(sessionToken, username, privB64, pubB64)
        sessionManager.setOnboardingPending(onboardingRequired)
        if (onboardingRequired) {
            // Everything else 428s until the profile step is done; keys are
            // uploaded right after onboarding completes (OnboardingViewModel).
            return
        }
        registerKeysAndConnect(apiService, sessionManager, sessionToken, pubB64)
        presenceService.connect(sessionToken)
        BackgroundConnectionService.start(context)
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    fun clearRevealedCode() {
        _uiState.value = _uiState.value.copy(revealedUsername = null, revealedRecoveryCode = null)
    }

    fun signUp(username: String, phoneNumber: String, token: String) {
        if (username.isBlank() || phoneNumber.isBlank() || token.isBlank()) {
            _uiState.value = AuthUiState(error = "All fields are required")
            return
        }
        viewModelScope.launch {
            _uiState.value = AuthUiState(isLoading = true)
            runCatching {
                val response = apiService.signUp(
                    com.dilarion.app.data.model.SignUpRequest(username.trim(), phoneNumber.trim(), token.trim())
                )
                if (!response.isSuccessful) {
                    val msg = errorBody(response.errorBody()?.string()) ?: "Couldn't create your account. Please try again."
                    _uiState.value = AuthUiState(error = msg)
                    return@launch
                }
                val body = response.body()!!
                _uiState.value = AuthUiState(
                    revealedUsername = body.username,
                    revealedRecoveryCode = body.recoveryCode,
                )
            }.onFailure { e ->
                _uiState.value = AuthUiState(error = e.toUserMessage("Can't reach the server. Check your connection and try again."))
            }
        }
    }

    private val _forgot = kotlinx.coroutines.flow.MutableStateFlow(ForgotUiState())
    val forgot: kotlinx.coroutines.flow.StateFlow<ForgotUiState> = _forgot

    fun resetForgot() { _forgot.value = ForgotUiState() }
    fun forgotChangeEmail() { _forgot.value = ForgotUiState() }

    fun sendResetEmailCode(email: String) {
        val e = email.trim()
        if (e.isBlank()) return
        viewModelScope.launch {
            _forgot.value = _forgot.value.copy(loading = true, error = null)
            runCatching { apiService.sendResetEmailCode(com.dilarion.app.data.model.ResetEmailCodeRequest(e)) }
                .onSuccess { resp ->
                    _forgot.value = if (resp.isSuccessful) {
                        ForgotUiState(step = ForgotStep.DETAILS, message = "If $e is on a Dilarion account, we've emailed it a 6-digit code.")
                    } else {
                        _forgot.value.copy(loading = false, error = errorBody(resp.errorBody()?.string()) ?: "Couldn't send the code. Please try again.")
                    }
                }
                .onFailure { _forgot.value = _forgot.value.copy(loading = false, error = it.toUserMessage("Can't reach the server. Check your connection and try again.")) }
        }
    }

    fun requestAccessReset(email: String, code: String, reason: String, confirm: Boolean) {
        viewModelScope.launch {
            _forgot.value = _forgot.value.copy(loading = true, error = null)
            runCatching {
                apiService.requestAccessReset(com.dilarion.app.data.model.AccessResetRequest(email.trim(), code.trim(), reason.trim(), confirm))
            }.onSuccess { resp ->
                _forgot.value = if (resp.isSuccessful) {
                    ForgotUiState(step = ForgotStep.SENT, message = resp.body()?.get("message")?.asString
                        ?: "Request sent. When it's approved, we'll email you a new recovery code.")
                } else {
                    _forgot.value.copy(loading = false, error = errorBody(resp.errorBody()?.string()) ?: "Couldn't send your request. Please try again.")
                }
            }.onFailure { _forgot.value = _forgot.value.copy(loading = false, error = it.toUserMessage("Can't reach the server. Check your connection and try again.")) }
        }
    }

    fun resetWithRecoveryCode(username: String, recoveryCode: String, newToken: String) {
        if (username.isBlank() || recoveryCode.isBlank() || newToken.isBlank()) {
            _uiState.value = AuthUiState(error = "All fields are required")
            return
        }
        viewModelScope.launch {
            _uiState.value = AuthUiState(isLoading = true)
            runCatching {
                val response = apiService.resetWithRecoveryCode(
                    com.dilarion.app.data.model.RecoveryCodeResetRequest(username.trim(), recoveryCode.trim(), newToken.trim())
                )
                if (!response.isSuccessful) {
                    val msg = errorBody(response.errorBody()?.string()) ?: "Invalid username or recovery code"
                    _uiState.value = AuthUiState(error = msg)
                    return@launch
                }
                val body = response.body()!!
                _uiState.value = AuthUiState(
                    revealedUsername = body.username,
                    revealedRecoveryCode = body.recoveryCode,
                )
            }.onFailure { e ->
                _uiState.value = AuthUiState(error = e.toUserMessage("Can't reach the server. Check your connection and try again."))
            }
        }
    }

    private fun errorBody(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        return runCatching {
            val detail = com.google.gson.JsonParser.parseString(raw).asJsonObject.get("detail")
            when {
                detail == null || detail.isJsonNull -> null
                detail.isJsonPrimitive -> detail.asString
                detail.isJsonArray -> detail.asJsonArray.firstOrNull()?.asJsonObject?.let { issue ->
                    val field = issue.getAsJsonArray("loc")?.lastOrNull()?.asString
                    val message = issue.get("msg")?.asString
                    if (field != null && message != null) "${field.replace('_', ' ')}: $message" else message
                }
                else -> null
            }
        }.getOrNull()
    }
}
