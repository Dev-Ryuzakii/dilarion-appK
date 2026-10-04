package com.dilarion.app.ui.components

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.LoginRequest
import com.dilarion.app.security.IdleLogoutManager
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.TextSecondary
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class IdleLockViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
) : ViewModel() {
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    fun unlock(username: String, accessToken: String) {
        if (accessToken.isBlank()) return
        viewModelScope.launch {
            busy = true
            error = null
            runCatching { apiService.login(
                    LoginRequest(
                        username, accessToken.trim(),
                        deviceId = com.dilarion.app.security.DeviceIdentity.id(context),
                        deviceName = com.dilarion.app.security.DeviceIdentity.name(),
                    )
                ) }
                .onSuccess { resp ->
                    val token = resp.body()?.sessionToken
                    if (resp.isSuccessful && !token.isNullOrBlank()) {
                        sessionManager.saveSessionToken(token)
                        presenceService.connect(token)
                        IdleLogoutManager.unlock(context)
                    } else {
                        error = when (resp.code()) {
                            401 -> "Invalid access token"
                            409 -> "This account is now signed in on another phone"
                            else -> "Sign-in failed (${resp.code()})"
                        }
                    }
                }
                .onFailure { error = it.message ?: "Network error" }
            busy = false
        }
    }

    /** "Not you?" — full sign-out so a different account can sign in. */
    fun switchAccount() {
        viewModelScope.launch {
            sessionManager.clearSession()
            IdleLogoutManager.unlock(context)
        }
    }
}

/** Shown after the idle timeout logged the user out — asks for the access token. */
@Composable
fun IdleLockScreen(username: String, viewModel: IdleLockViewModel = hiltViewModel()) {
    var accessToken by remember { mutableStateOf("") }
    Box(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding().imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.padding(28.dp).widthIn(max = 420.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                Modifier.size(64.dp).clip(CircleShape).background(DilarionRed.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Default.Lock, null, tint = DilarionRed, modifier = Modifier.size(28.dp)) }
            Text("Session timed out", fontWeight = FontWeight.Bold, fontSize = 20.sp)
            Text(
                "You were logged out after being inactive. Enter your access token to continue as $username.",
                color = TextSecondary, fontSize = 14.sp, textAlign = TextAlign.Center,
            )
            OutlinedTextField(
                value = accessToken,
                onValueChange = { accessToken = it },
                label = { Text("Access token") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            viewModel.error?.let { Text(it, color = Color(0xFFEF4444), fontSize = 13.sp) }
            Button(
                onClick = { viewModel.unlock(username, accessToken) },
                enabled = accessToken.isNotBlank() && !viewModel.busy,
                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (viewModel.busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Text("Unlock")
            }
            TextButton(onClick = { viewModel.switchAccount() }) {
                Text("Not you? Sign in with a different account", color = TextSecondary)
            }
        }
    }
}
