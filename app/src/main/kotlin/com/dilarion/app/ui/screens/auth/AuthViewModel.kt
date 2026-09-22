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
)

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
                val response = apiService.login(LoginRequest(username.trim(), token.trim()))
                if (!response.isSuccessful) {
                    val msg = when (response.code()) {
                        401  -> "Invalid credentials"
                        500  -> "Server error. Try again."
                        else -> "Login failed (${response.code()})"
                    }
                    _uiState.value = AuthUiState(error = msg)
                    return@launch
                }
                val body = response.body()!!
                val token = body.sessionToken
                if (token.isNullOrBlank()) {
                    _uiState.value = AuthUiState(error = "Server returned no session token")
                    return@launch
                }
                // Generate the E2EE keypair ONCE per device. Regenerating on every
                // login would rotate the identity and make all previously received
                // messages permanently undecryptable.
                val existingPriv = sessionManager.privateKey.first()
                val existingPub = sessionManager.publicKey.first()
                val (pubB64, privB64) = if (existingPriv.isNullOrBlank() || existingPub.isNullOrBlank()) {
                    val kp = cryptoManager.generateKeyPair()
                    apiService.updatePublicKey("Bearer $token", com.dilarion.app.data.model.UpdatePublicKeyRequest(kp.first))
                    kp
                } else {
                    Pair(existingPub, existingPriv)
                }
                sessionManager.saveSession(token, body.username, privB64, pubB64)

                // Register this phone as a device so senders can encrypt to it and
                // we know our device_uuid for finding our entry in a key map.
                runCatching {
                    val resp = apiService.registerDevice(
                        "Bearer $token",
                        com.dilarion.app.data.model.DeviceRegisterRequest(pubB64, "android", android.os.Build.MODEL),
                    )
                    resp.body()?.deviceUuid?.let { sessionManager.saveDeviceUuid(it) }
                }
                presenceService.connect(token)
                MonitoringForegroundService.start(context)
                _uiState.value = AuthUiState(success = true)
            }.onFailure { e ->
                _uiState.value = AuthUiState(error = e.message ?: "Network error")
            }
        }
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
