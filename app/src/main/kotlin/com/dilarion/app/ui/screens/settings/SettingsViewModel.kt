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
import javax.inject.Inject

data class SettingsUiState(
    val username: String = "",
    val publicKey: String = "",
    val hasMasterToken: Boolean = false,
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

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first()
            if (token != null) {
                runCatching { apiService.logout("Bearer $token") }
            }
            presenceService.disconnect()
            sessionManager.clearSession()
            onDone()
        }
    }
}
