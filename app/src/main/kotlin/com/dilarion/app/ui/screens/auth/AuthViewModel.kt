package com.dilarion.app.ui.screens.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.LoginRequest
import com.dilarion.app.security.CryptoManager
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val success: Boolean = false,
)

@HiltViewModel
class AuthViewModel @Inject constructor(
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
                val (pubB64, privB64) = cryptoManager.generateKeyPair()
                apiService.updatePublicKey("Bearer $token", com.dilarion.app.data.model.UpdatePublicKeyRequest(pubB64))
                sessionManager.saveSession(token, body.username, privB64, pubB64)
                presenceService.connect(token)
                _uiState.value = AuthUiState(success = true)
            }.onFailure { e ->
                _uiState.value = AuthUiState(error = e.message ?: "Network error")
            }
        }
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }
}
