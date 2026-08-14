package com.dilarion.app.ui.screens.mastertoken

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.api.parseErrorDetail
import com.dilarion.app.data.model.MasterTokenRequest
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MasterTokenUiState(
    val step: Step = Step.CREATE,
    val isLoading: Boolean = false,
    val error: String? = null,
    val success: Boolean = false,
    val twoFaRequired: Boolean = false,
) {
    enum class Step { CREATE, CONFIRM }
}

@HiltViewModel
class MasterTokenSetupViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MasterTokenUiState())
    val uiState: StateFlow<MasterTokenUiState> = _uiState

    private var pendingToken: String = ""

    init {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            runCatching { apiService.getMasterToken2FAStatus(bearer) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(twoFaRequired = resp.body()?.enabled ?: false)
                    }
                }
        }
    }

    fun create(token: String, twoFaPassword: String? = null) {
        val err = validate(token)
        if (err != null) { _uiState.value = _uiState.value.copy(error = err); return }
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                val resp = apiService.createMasterToken(bearer, MasterTokenRequest(token, twoFaPassword))
                if (!resp.isSuccessful) {
                    throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to create master token (${resp.code()})"))
                }
                pendingToken = token
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    step = MasterTokenUiState.Step.CONFIRM,
                )
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.message)
            }
        }
    }

    fun confirm(token: String) {
        if (token != pendingToken) {
            _uiState.value = _uiState.value.copy(error = "Tokens do not match")
            return
        }
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            runCatching {
                val resp = apiService.confirmMasterToken(bearer, MasterTokenRequest(token))
                if (!resp.isSuccessful) {
                    throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to confirm master token (${resp.code()})"))
                }
                sessionManager.saveMasterToken(token)
                _uiState.value = _uiState.value.copy(isLoading = false, success = true)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(isLoading = false, error = e.message)
            }
        }
    }

    fun backToCreate() {
        pendingToken = ""
        _uiState.value = _uiState.value.copy(step = MasterTokenUiState.Step.CREATE, error = null)
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    private suspend fun bearer(): String? {
        val token = sessionManager.sessionToken.first() ?: return null
        return "Bearer $token"
    }

    companion object {
        fun validate(token: String): String? {
            if (token.length < 12) return "Master token must be at least 12 characters"
            val upper   = token.any { it.isUpperCase() }
            val lower   = token.any { it.isLowerCase() }
            val digit   = token.any { it.isDigit() }
            val special = token.any { "!@#\$%^&*".contains(it) }
            val complexity = listOf(upper, lower, digit, special).count { it }
            if (complexity < 3) return "Must include at least 3 of: uppercase, lowercase, digit, special (!@#\$%^&*)"
            return null
        }

        fun isValidForDecrypt(token: String): Boolean {
            return token.length >= 8 && token.any { it.isLetter() } && token.any { it.isDigit() }
        }
    }
}
