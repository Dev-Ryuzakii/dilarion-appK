package com.dilarion.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.dilarion.app.security.BiometricAuth
import com.dilarion.app.ui.theme.BackgroundGrey
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.TextPrimary
import kotlinx.coroutines.launch

@Composable
fun AppLockScreen(onUnlocked: () -> Unit) {
    val context = LocalContext.current
    val activity = context as? FragmentActivity
    val scope = rememberCoroutineScope()
    var isAuthenticating by remember { mutableStateOf(false) }

    fun authenticate() {
        val act = activity ?: return
        if (isAuthenticating) return
        isAuthenticating = true
        scope.launch {
            val ok = BiometricAuth.authenticate(act, "Unlock Dilarion")
            isAuthenticating = false
            if (ok) onUnlocked()
        }
    }

    LaunchedEffect(Unit) { authenticate() }

    Box(
        modifier = Modifier.fillMaxSize().background(BackgroundGrey),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.Fingerprint, null, tint = DilarionRed, modifier = Modifier.size(56.dp))
            Spacer(Modifier.height(20.dp))
            Text("Dilarion is locked", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = { authenticate() },
                enabled = !isAuthenticating,
                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
            ) {
                if (isAuthenticating) CircularProgressIndicator(Modifier.size(16.dp), color = androidx.compose.ui.graphics.Color.White, strokeWidth = 2.dp)
                else Text("Unlock")
            }
        }
    }
}
