package com.dilarion.app.ui.screens.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import com.dilarion.app.R
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.collectAsState
import com.dilarion.app.ui.theme.*

private enum class AuthView { LOGIN, SIGNUP, RECOVERY }

@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    onAuthSuccess: () -> Unit,
) {
    val uiState by viewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current

    var view by remember { mutableStateOf(AuthView.LOGIN) }

    var username by remember { mutableStateOf("") }
    var token    by remember { mutableStateOf("") }
    var showToken by remember { mutableStateOf(false) }

    var signupUsername by remember { mutableStateOf("") }
    var signupPhone by remember { mutableStateOf("") }
    var signupToken by remember { mutableStateOf("") }

    var recUsername by remember { mutableStateOf("") }
    var recCode by remember { mutableStateOf("") }
    var recNewToken by remember { mutableStateOf("") }

    var savedAck by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.success) {
        if (uiState.success) onAuthSuccess()
    }

    uiState.error?.let { error ->
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Error") },
            text  = { Text(error) },
            confirmButton = {
                TextButton(onClick = viewModel::clearError) { Text("OK") }
            },
        )
    }

    // Recovery code reveal — shown once after signup or a recovery-code
    // reset, regardless of which one produced it.
    if (uiState.revealedRecoveryCode != null) {
        RecoveryCodeRevealScreen(
            code = uiState.revealedRecoveryCode!!,
            savedAck = savedAck,
            onAckChange = { savedAck = it },
            onContinue = {
                username = uiState.revealedUsername ?: username
                savedAck = false
                viewModel.clearRevealedCode()
                view = AuthView.LOGIN
            },
        )
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(
                        DilarionRed.copy(alpha = 0.06f),
                        BackgroundGrey,
                        MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                    )
                )
            )
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(vertical = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {

            // ── Logo ──────────────────────────────────────────────────────────
            Image(
                painter = painterResource(R.drawable.dilarion_logo),
                contentDescription = "Dilarion",
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(110.dp).clip(CircleShape),
            )

            Spacer(Modifier.height(24.dp))
            Text(
                when (view) {
                    AuthView.SIGNUP -> "Create Account"
                    AuthView.RECOVERY -> "Reset Access"
                    AuthView.LOGIN -> "Welcome Back"
                },
                style = MaterialTheme.typography.headlineLarge,
            )
            Text(
                when (view) {
                    AuthView.SIGNUP -> "Set up your account"
                    AuthView.RECOVERY -> "Use your recovery code"
                    AuthView.LOGIN -> "Sign in to continue"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                modifier = Modifier.padding(top = 6.dp),
            )
            Spacer(Modifier.height(40.dp))

            // ── Form card ─────────────────────────────────────────────────────
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    when (view) {
                        AuthView.LOGIN -> {
                            // Username
                            OutlinedTextField(
                                value = username,
                                onValueChange = { username = it },
                                label = { Text("Username") },
                                leadingIcon = { Icon(Icons.Default.Person, null) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(
                                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                                ),
                                shape = RoundedCornerShape(14.dp),
                            )

                            // Token
                            OutlinedTextField(
                                value = token,
                                onValueChange = { token = it },
                                label = { Text("Authentication Token") },
                                leadingIcon = { Icon(Icons.Default.Lock, null) },
                                trailingIcon = {
                                    IconButton(onClick = { showToken = !showToken }) {
                                        Icon(
                                            if (showToken) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                            contentDescription = if (showToken) "Hide token" else "Show token",
                                        )
                                    }
                                },
                                visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(
                                    keyboardType = KeyboardType.Password,
                                    imeAction = ImeAction.Done,
                                ),
                                keyboardActions = KeyboardActions(
                                    onDone = {
                                        focusManager.clearFocus()
                                        viewModel.login(username, token)
                                    }
                                ),
                                shape = RoundedCornerShape(14.dp),
                            )

                            Spacer(Modifier.height(4.dp))

                            Button(
                                onClick = {
                                    focusManager.clearFocus()
                                    viewModel.login(username, token)
                                },
                                enabled = !uiState.isLoading,
                                modifier = Modifier.fillMaxWidth().height(52.dp),
                                shape = RoundedCornerShape(14.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                            ) {
                                if (uiState.isLoading) {
                                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                } else {
                                    Text("Sign In", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }

                            TextButton(onClick = { view = AuthView.SIGNUP }, modifier = Modifier.fillMaxWidth()) {
                                Text("Don't have an account? Sign up")
                            }
                            TextButton(onClick = { view = AuthView.RECOVERY }, modifier = Modifier.fillMaxWidth()) {
                                Text("Forgot your access token?")
                            }
                        }

                        AuthView.SIGNUP -> {
                            OutlinedTextField(
                                value = signupUsername,
                                onValueChange = { signupUsername = it },
                                label = { Text("Choose a username") },
                                leadingIcon = { Icon(Icons.Default.Person, null) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                                shape = RoundedCornerShape(14.dp),
                            )
                            OutlinedTextField(
                                value = signupPhone,
                                onValueChange = { signupPhone = it },
                                label = { Text("Phone number") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                                shape = RoundedCornerShape(14.dp),
                            )
                            OutlinedTextField(
                                value = signupToken,
                                onValueChange = { signupToken = it },
                                label = { Text("Choose an access token") },
                                leadingIcon = { Icon(Icons.Default.Lock, null) },
                                visualTransformation = PasswordVisualTransformation(),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(
                                    onDone = {
                                        focusManager.clearFocus()
                                        viewModel.signUp(signupUsername, signupPhone, signupToken)
                                    }
                                ),
                                shape = RoundedCornerShape(14.dp),
                            )
                            Spacer(Modifier.height(4.dp))
                            Button(
                                onClick = {
                                    focusManager.clearFocus()
                                    viewModel.signUp(signupUsername, signupPhone, signupToken)
                                },
                                enabled = !uiState.isLoading,
                                modifier = Modifier.fillMaxWidth().height(52.dp),
                                shape = RoundedCornerShape(14.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                            ) {
                                if (uiState.isLoading) {
                                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                } else {
                                    Text("Create account", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                            TextButton(onClick = { view = AuthView.LOGIN }, modifier = Modifier.fillMaxWidth()) {
                                Text("Back to sign in")
                            }
                        }

                        AuthView.RECOVERY -> {
                            OutlinedTextField(
                                value = recUsername,
                                onValueChange = { recUsername = it },
                                label = { Text("Username") },
                                leadingIcon = { Icon(Icons.Default.Person, null) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                                shape = RoundedCornerShape(14.dp),
                            )
                            OutlinedTextField(
                                value = recCode,
                                onValueChange = { recCode = it },
                                label = { Text("Recovery code (XXXX-XXXX-XXXX)") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                                shape = RoundedCornerShape(14.dp),
                            )
                            OutlinedTextField(
                                value = recNewToken,
                                onValueChange = { recNewToken = it },
                                label = { Text("New access token") },
                                leadingIcon = { Icon(Icons.Default.Lock, null) },
                                visualTransformation = PasswordVisualTransformation(),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(
                                    onDone = {
                                        focusManager.clearFocus()
                                        viewModel.resetWithRecoveryCode(recUsername, recCode, recNewToken)
                                    }
                                ),
                                shape = RoundedCornerShape(14.dp),
                            )
                            Spacer(Modifier.height(4.dp))
                            Button(
                                onClick = {
                                    focusManager.clearFocus()
                                    viewModel.resetWithRecoveryCode(recUsername, recCode, recNewToken)
                                },
                                enabled = !uiState.isLoading,
                                modifier = Modifier.fillMaxWidth().height(52.dp),
                                shape = RoundedCornerShape(14.dp),
                                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                            ) {
                                if (uiState.isLoading) {
                                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                } else {
                                    Text("Reset access", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                            TextButton(onClick = { view = AuthView.LOGIN }, modifier = Modifier.fillMaxWidth()) {
                                Text("Back to sign in")
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(24.dp))

            // Encrypt tag
            Text(
                "Secure · Private · Encrypted",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Shown once, right after signup or a recovery-code reset. If lost, there is
 * no way to see this code again short of regenerating a new one (Settings)
 * or an admin-approved reset — same tradeoff the desktop app makes.
 */
@Composable
private fun RecoveryCodeRevealScreen(
    code: String,
    savedAck: Boolean,
    onAckChange: (Boolean) -> Unit,
    onContinue: () -> Unit,
) {
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(DilarionRed.copy(alpha = 0.06f), BackgroundGrey, MaterialTheme.colorScheme.surface.copy(alpha = 0.96f))
                )
            )
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(vertical = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Save your recovery code", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            Spacer(Modifier.height(10.dp))
            Text(
                "This is shown once. If you lose your access token later, this code is the only " +
                    "way to get back in without an admin. Write it down or save it somewhere safe now.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(28.dp))

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
            ) {
                Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(
                        code,
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(BackgroundGrey, RoundedCornerShape(12.dp))
                            .padding(vertical = 16.dp),
                    )
                    TextButton(
                        onClick = { clipboard.setText(androidx.compose.ui.text.AnnotatedString(code)) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Copy code") }

                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Checkbox(checked = savedAck, onCheckedChange = onAckChange)
                        Text("I've saved this code somewhere safe", style = MaterialTheme.typography.bodySmall)
                    }

                    Button(
                        onClick = onContinue,
                        enabled = savedAck,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                    ) {
                        Text("Continue to sign in", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}
