package com.dilarion.app.ui.screens.devices

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.DeviceLinkApproveRequest
import com.dilarion.app.data.model.MyDevice
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LinkedDevicesUiState(
    val devices: List<MyDevice> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val info: String? = null,
)

@HiltViewModel
class LinkedDevicesViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LinkedDevicesUiState())
    val uiState: StateFlow<LinkedDevicesUiState> = _uiState

    init { loadDevices() }

    fun loadDevices() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            runCatching { apiService.getMyDevices("Bearer $token").body()?.devices ?: emptyList() }
                .onSuccess { _uiState.value = _uiState.value.copy(devices = it, loading = false) }
                .onFailure { _uiState.value = _uiState.value.copy(loading = false, error = it.message) }
        }
    }

    /** Handle a scanned QR. Expects "dilarion:link:<nonce>" (a bare nonce also works). */
    fun approveScannedLink(raw: String) {
        val trimmed = raw.trim()
        val nonce = if (trimmed.startsWith("dilarion:link:")) trimmed.removePrefix("dilarion:link:").trim() else trimmed
        if (nonce.length < 8) {
            _uiState.value = _uiState.value.copy(error = "That QR code is not a Dilarion link code")
            return
        }
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.approveDeviceLink("Bearer $token", DeviceLinkApproveRequest(nonce)) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(info = "Device linked")
                        loadDevices()
                    } else {
                        val msg = when (resp.code()) {
                            404 -> "Link code not found or already used"
                            410 -> "Link code expired — regenerate it on the other device"
                            else -> "Could not link device (${resp.code()})"
                        }
                        _uiState.value = _uiState.value.copy(error = msg)
                    }
                }
                .onFailure { _uiState.value = _uiState.value.copy(error = it.message) }
        }
    }

    fun revoke(deviceUuid: String) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { apiService.revokeDevice("Bearer $token", deviceUuid) }
                .onSuccess { loadDevices() }
                .onFailure { _uiState.value = _uiState.value.copy(error = it.message) }
        }
    }

    fun clearMessages() {
        _uiState.value = _uiState.value.copy(error = null, info = null)
    }
}
