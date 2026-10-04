package com.dilarion.app.ui.screens.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.LoginRequest
import com.dilarion.app.monitoring.MonitoringForegroundService
import com.dilarion.app.security.CryptoManager
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

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
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState

    fun login(username: String, token: String) {
        if (username.isBlank() || token.isBlank()) {
            _uiState.value = AuthUiState(error = "Username and token are required")
            return
        }
        viewModelScope.launch {
            _uiState.value = AuthUiState(isLoading = true)
            runCatching {
                val response = apiService.login(
                    LoginRequest(
                        username.trim(), token.trim(),
                        deviceId = com.dilarion.app.security.DeviceIdentity.id(context),
                        deviceName = com.dilarion.app.security.DeviceIdentity.name(),
                    )
                )
                if (!response.isSuccessful) {
                    val msg = when (response.code()) {
                        401  -> "Invalid credentials"
                        409  -> errorBody(response.errorBody()?.string()) ?: "This account is already signed in on another phone"
                        500  -> "Server error. Try again."
                        else -> errorBody(response.errorBody()?.string()) ?: "Login failed (${response.code()})"
                    }
                    _uiState.value = AuthUiState(error = msg)
                    return@launch
                }
                val body = response.body()!!
                val sessionToken = body.sessionToken
                if (sessionToken.isNullOrBlank()) {
                    _uiState.value = AuthUiState(error = "Server returned no session token")
                    return@launch
                }
                establishSession(sessionToken, body.username, body.onboardingRequired)
                _uiState.value = AuthUiState(success = true, onboardingRequired = body.onboardingRequired)
            }.onFailure { e ->
                _uiState.value = AuthUiState(error = e.message ?: "Network error")
            }
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
                    val msg = errorBody(response.errorBody()?.string()) ?: "Activation failed (${response.code()})"
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
                _uiState.value = AuthUiState(error = e.message ?: "Network error")
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
        MonitoringForegroundService.start(context)
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
                    val msg = errorBody(response.errorBody()?.string()) ?: "Failed to create account (${response.code()})"
                    _uiState.value = AuthUiState(error = msg)
                    return@launch
                }
                val body = response.body()!!
                _uiState.value = AuthUiState(
                    revealedUsername = body.username,
                    revealedRecoveryCode = body.recoveryCode,
                )
            }.onFailure { e ->
                _uiState.value = AuthUiState(error = e.message ?: "Network error")
            }
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
                _uiState.value = AuthUiState(error = e.message ?: "Network error")
            }
        }
    }

    private fun errorBody(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        return runCatching {
            com.google.gson.JsonParser.parseString(raw).asJsonObject.get("detail")?.asString
        }.getOrNull()
    }
}
