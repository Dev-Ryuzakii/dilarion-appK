package com.dilarion.app.ui.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject
import javax.inject.Inject

data class SettingsUiState(
    val username: String = "",
    val publicKey: String = "",
    val hasMasterToken: Boolean = false,
    val exportedKey: String? = null,
    val exportError: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState

    init {
        viewModelScope.launch {
            val username = sessionManager.username.first() ?: ""
            val pubKey = sessionManager.publicKey.first() ?: ""
            val masterToken = sessionManager.masterToken.first()
            _uiState.value = SettingsUiState(
                username = username,
                publicKey = pubKey,
                hasMasterToken = !masterToken.isNullOrBlank(),
            )
        }
    }

    /**
     * Reveals this device's identity keypair so it can be imported on desktop.
     * Anyone holding this blob can read the user's messages, so it is released only
     * after the master token is re-entered and it is never sent to the server.
     */
    fun exportKey(masterTokenAttempt: String) {
        viewModelScope.launch {
            val saved = sessionManager.masterToken.first()
            if (saved.isNullOrBlank() || saved != masterTokenAttempt) {
                _uiState.value = _uiState.value.copy(
                    exportError = "Incorrect master token",
                    exportedKey = null,
                )
                return@launch
            }

            val priv = sessionManager.privateKey.first()
            val pub = sessionManager.publicKey.first()
            if (priv.isNullOrBlank()) {
                _uiState.value = _uiState.value.copy(
                    exportError = "No encryption key on this device",
                    exportedKey = null,
                )
                return@launch
            }

            val blob = JSONObject()
                .put("private_key", priv)
                .put("public_key", pub ?: "")
                .toString()

            _uiState.value = _uiState.value.copy(exportedKey = blob, exportError = null)
        }
    }

    fun clearExportedKey() {
        _uiState.value = _uiState.value.copy(exportedKey = null, exportError = null)
    }

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first()
            // Tell the server in the background, but never block logout on it — a slow
            // or unreachable network must not leave the user stuck signed in.
            if (token != null) {
                launch { runCatching { apiService.logout("Bearer $token") } }
            }
            runCatching { presenceService.disconnect() }
            sessionManager.clearSession()
            onDone()
        }
    }
}
