package com.dilarion.app.ui.components

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.LoginApprovalApi
import com.dilarion.app.data.api.LoginDecision
import com.dilarion.app.data.api.PendingLoginRequest
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.NotificationHelper
import com.dilarion.app.services.PresenceService
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.TextSecondary
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Someone is signing in to this account on a new device. Every signed-in
 * device gets "Is this you signing in on <device>?"; one answer settles it
 * everywhere. This phone stays signed in whatever the answer.
 */
@HiltViewModel
class LoginApprovalViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val presenceService: PresenceService,
    private val loginApprovalApi: LoginApprovalApi,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _queue = MutableStateFlow<List<PendingLoginRequest>>(emptyList())
    val queue: StateFlow<List<PendingLoginRequest>> = _queue

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    init {
        refresh()
        viewModelScope.launch {
            presenceService.events.collect { event ->
                val data = event.data ?: return@collect
                fun str(k: String) = data.get(k)?.takeIf { !it.isJsonNull }?.asString
                val id = data.get("request_id")?.takeIf { !it.isJsonNull }?.asLong ?: return@collect
                when (event.type) {
                    "login_approval_request" -> {
                        val req = PendingLoginRequest(id, str("device_name"), str("platform"), str("location"), str("ip"), str("time"), str("expires_at"))
                        if (_queue.value.none { it.requestId == id }) _queue.value = _queue.value + req
                        NotificationHelper.showSecurityAlert(
                            context,
                            "Is this you signing in?",
                            "New sign-in on ${req.deviceName ?: "another device"} from ${req.location ?: "an unknown location"}. Open Dilarion to approve or block it.",
                        )
                    }
                    // Answered on another device, by email, or it expired.
                    "login_approval_resolved" -> _queue.value = _queue.value.filterNot { it.requestId == id }
                }
            }
        }
        // Requests made while this phone was offline.
        viewModelScope.launch { presenceService.connectionState.collect { if (it) refresh() } }
    }

    fun refresh() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching { loginApprovalApi.pending("Bearer $token") }.getOrNull()
                ?.takeIf { it.isSuccessful }?.body()?.let { _queue.value = it.requests }
        }
    }

    fun answer(req: PendingLoginRequest, approve: Boolean) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _busy.value = true
            _error.value = null
            runCatching { loginApprovalApi.decide("Bearer $token", req.requestId, LoginDecision(approve)) }
                .onSuccess { resp ->
                    if (resp.isSuccessful || resp.code() == 404 || resp.code() == 409) {
                        // 404/409: already answered elsewhere or expired.
                        _queue.value = _queue.value.filterNot { it.requestId == req.requestId }
                    } else {
                        _error.value = "Couldn't send your answer. Please try again."
                    }
                }
                .onFailure { _error.value = "Couldn't send your answer. Check your connection." }
            _busy.value = false
        }
    }

    fun dropExpired() {
        val now = System.currentTimeMillis()
        _queue.value = _queue.value.filter { r ->
            val exp = r.expiresAt?.let { runCatching { java.time.OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() }
            exp == null || exp > now
        }
    }
}

@Composable
fun LoginApprovalPrompt(vm: LoginApprovalViewModel = hiltViewModel()) {
    val queue by vm.queue.collectAsState()
    val busy by vm.busy.collectAsState()
    val error by vm.error.collectAsState()
    androidx.compose.runtime.LaunchedEffect(queue.size) {
        while (queue.isNotEmpty()) { vm.dropExpired(); kotlinx.coroutines.delay(5000) }
    }
    val req = queue.firstOrNull() ?: return
    val whenText = req.time?.let { t ->
        runCatching {
            java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm")
                .format(java.time.OffsetDateTime.parse(t).atZoneSameInstant(java.time.ZoneId.systemDefault()))
        }.getOrDefault(t)
    } ?: "Just now"
    val device = req.deviceName ?: "a new device"

    AlertDialog(
        // Has to be answered (or left to expire): tapping outside does nothing.
        onDismissRequest = {},
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
        title = { Text("Is this you signing in on $device?", fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text("Device: $device" + (req.platform?.let { " ($it)" } ?: ""))
                Text("Location: ${req.location ?: "Unknown"}")
                req.ip?.let { Text("IP address: $it") }
                Text("Time: $whenText")
                Spacer(Modifier.height(10.dp))
                Text(
                    "You stay signed in here either way. If this wasn't you, block it and change your login token.",
                    style = MaterialTheme.typography.bodySmall, color = TextSecondary,
                )
                error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = DilarionRed, style = MaterialTheme.typography.bodySmall) }
                if (queue.size > 1) {
                    Spacer(Modifier.height(6.dp))
                    Text("${queue.size - 1} more waiting", style = MaterialTheme.typography.bodySmall, color = TextSecondary)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { vm.answer(req, true) },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
            ) { Text("Yes, it's me") }
        },
        dismissButton = {
            TextButton(onClick = { vm.answer(req, false) }, enabled = !busy) { Text("No, block it") }
        },
    )
}
