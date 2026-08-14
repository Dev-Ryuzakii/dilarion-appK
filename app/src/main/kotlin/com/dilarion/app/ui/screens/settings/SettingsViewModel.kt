package com.dilarion.app.ui.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.api.parseErrorDetail
import com.dilarion.app.data.model.AccountDeletionRequestCreate
import com.dilarion.app.data.model.MasterToken2FADisableRequest
import com.dilarion.app.data.model.MasterToken2FAEnableRequest
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
    val twoFaEnabled: Boolean = false,
    val twoFaLoading: Boolean = false,
    val twoFaError: String? = null,
    val deletionStatus: String? = null,
    val deletionLoading: Boolean = false,
    val deletionError: String? = null,
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
            _uiState.value = _uiState.value.copy(
                username = username,
                publicKey = pubKey,
                hasMasterToken = !masterToken.isNullOrBlank(),
            )
        }
        refreshTwoFaStatus()
        refreshDeletionStatus()
    }

    private fun refreshTwoFaStatus() {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            runCatching { apiService.getMasterToken2FAStatus(bearer) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(twoFaEnabled = resp.body()?.enabled ?: false)
                    }
                }
        }
    }

    private fun refreshDeletionStatus() {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            runCatching { apiService.getMyAccountDeletionStatus(bearer) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(deletionStatus = resp.body()?.status)
                    }
                }
        }
    }

    fun enableTwoFa(masterToken: String, twoFaPassword: String) {
        if (masterToken.isBlank() || twoFaPassword.length < 6) return
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(twoFaLoading = true, twoFaError = null)
            runCatching {
                val resp = apiService.enableMasterToken2FA(bearer, MasterToken2FAEnableRequest(masterToken, twoFaPassword))
                if (!resp.isSuccessful) {
                    throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to enable 2FA (${resp.code()})"))
                }
                _uiState.value = _uiState.value.copy(twoFaLoading = false, twoFaEnabled = true)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(twoFaLoading = false, twoFaError = e.message)
            }
        }
    }

    fun disableTwoFa(twoFaPassword: String) {
        if (twoFaPassword.isBlank()) return
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(twoFaLoading = true, twoFaError = null)
            runCatching {
                val resp = apiService.disableMasterToken2FA(bearer, MasterToken2FADisableRequest(twoFaPassword))
                if (!resp.isSuccessful) {
                    throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to disable 2FA (${resp.code()})"))
                }
                _uiState.value = _uiState.value.copy(twoFaLoading = false, twoFaEnabled = false)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(twoFaLoading = false, twoFaError = e.message)
            }
        }
    }

    fun clearTwoFaError() { _uiState.value = _uiState.value.copy(twoFaError = null) }

    fun requestAccountDeletion(reason: String?) {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(deletionLoading = true, deletionError = null)
            runCatching {
                val resp = apiService.requestAccountDeletion(bearer, AccountDeletionRequestCreate(reason?.takeIf { it.isNotBlank() }))
                if (!resp.isSuccessful) {
                    throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to submit request (${resp.code()})"))
                }
                _uiState.value = _uiState.value.copy(deletionLoading = false, deletionStatus = "pending")
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(deletionLoading = false, deletionError = e.message)
            }
        }
    }

    fun clearDeletionError() { _uiState.value = _uiState.value.copy(deletionError = null) }

    private suspend fun bearer(): String? {
        val token = sessionManager.sessionToken.first() ?: return null
        return "Bearer $token"
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
