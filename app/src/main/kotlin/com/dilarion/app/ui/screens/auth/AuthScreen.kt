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
import androidx.compose.material.icons.filled.Key
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

private enum class AuthView { LOGIN, SIGNUP, RECOVERY, ACTIVATE }

@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    /** onboardingRequired = invited staff must finish the profile + camera step first. */
    onAuthSuccess: (onboardingRequired: Boolean) -> Unit,
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

    var actCode by remember { mutableStateOf("") }
    var actToken by remember { mutableStateOf("") }
    var actConfirm by remember { mutableStateOf("") }

    LaunchedEffect(uiState.success) {
        if (uiState.success) onAuthSuccess(uiState.onboardingRequired)
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
                savedAck = false
                if (uiState.activated) {
                    // Already signed in by activation — straight on.
                    viewModel.finishActivation()
                } else {
                    username = uiState.revealedUsername ?: username
                    viewModel.clearRevealedCode()
                    view = AuthView.LOGIN
                }
            },
        )
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(SurfaceWhite)
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(vertical = 48.dp),
            horizontalAlignment = Alignment.Start,
        ) {

            // ── Logo ──────────────────────────────────────────────────────────
            Image(
                painter = painterResource(R.drawable.dilarion_logo),
                contentDescription = "Dilarion",
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(72.dp).clip(RoundedCornerShape(20.dp)),
            )

            Spacer(Modifier.height(28.dp))
            Text(
                when (view) {
                    AuthView.SIGNUP -> "Create Account"
                    AuthView.RECOVERY -> "Reset Access"
                    AuthView.ACTIVATE -> "Activate Account"
                    AuthView.LOGIN -> "Welcome Back"
                },
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
                color = TextPrimary,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                when (view) {
                    AuthView.SIGNUP -> "Set up your account"
                    AuthView.RECOVERY -> "Use your recovery code"
                    AuthView.ACTIVATE -> "Use the code from your invitation email or SMS"
                    AuthView.LOGIN -> "Sign in to continue"
                },
                style = MaterialTheme.typography.bodyMedium,
                color = TextSecondary,
                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            )
            Spacer(Modifier.height(32.dp))

            // ── Form card ─────────────────────────────────────────────────────
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
            ) {
                Column(
                    modifier = Modifier.padding(vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    when (view) {
                        AuthView.LOGIN -> {
                            // Username
                            AuthTextField(
                                value = username,
                                onValueChange = { username = it },
                                label = "Username",
                                leadingIcon = { Icon(Icons.Default.Person, null) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(
                                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                                ),
                            )

                            // Token
                            AuthTextField(
                                value = token,
                                onValueChange = { token = it },
                                label = "Authentication Token",
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
                            )

                            Spacer(Modifier.height(4.dp))

                            Button(
                                onClick = {
                                    focusManager.clearFocus()
                                    viewModel.login(username, token)
                                },
                                enabled = !uiState.isLoading,
                                modifier = Modifier.fillMaxWidth().height(54.dp),
                                shape = RoundedCornerShape(50),
                                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                            ) {
                                if (uiState.isLoading) {
                                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                } else {
                                    Text("Sign In", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }

                            OutlinedButton(
                                onClick = { view = AuthView.ACTIVATE },
                                modifier = Modifier.fillMaxWidth().height(48.dp),
                                shape = RoundedCornerShape(50),
                            ) {
                                Icon(Icons.Default.Key, null, tint = DilarionRed, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Activate account", color = DilarionRed, fontWeight = FontWeight.SemiBold)
                            }
                            TextButton(onClick = { view = AuthView.SIGNUP }, modifier = Modifier.fillMaxWidth()) {
                                Text("Don't have an account? Sign up")
                            }
                            TextButton(onClick = { view = AuthView.RECOVERY }, modifier = Modifier.fillMaxWidth()) {
                                Text("Forgot your access token?")
                            }
                        }

                        AuthView.ACTIVATE -> {
                            Text(
                                "Your organization sent you an activation code by email or SMS. Enter it below and choose your private login token — only you will know it.",
                                style = MaterialTheme.typography.bodySmall,
                                color = TextSecondary,
                            )
                            AuthTextField(
                                value = actCode,
                                onValueChange = { actCode = it.trim() },
                                label = "Activation code",
                                leadingIcon = { Icon(Icons.Default.Key, null) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            AuthTextField(
                                value = actToken,
                                onValueChange = { actToken = it },
                                label = "Choose a login token",
                                supportingText = { Text("At least 8 characters") },
                                leadingIcon = { Icon(Icons.Default.Lock, null) },
                                visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                                trailingIcon = {
                                    IconButton(onClick = { showToken = !showToken }) {
                                        Icon(if (showToken) Icons.Default.VisibilityOff else Icons.Default.Visibility, contentDescription = "Show token")
                                    }
                                },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            AuthTextField(
                                value = actConfirm,
                                onValueChange = { actConfirm = it },
                                label = "Confirm login token",
                                leadingIcon = { Icon(Icons.Default.Lock, null) },
                                visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Button(
                                onClick = { focusManager.clearFocus(); viewModel.activate(actCode, actToken, actConfirm) },
                                enabled = !uiState.isLoading,
                                modifier = Modifier.fillMaxWidth().height(54.dp),
                                shape = RoundedCornerShape(50),
                                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                            ) {
                                if (uiState.isLoading) {
                                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = SurfaceWhite, strokeWidth = 2.dp)
                                } else {
                                    Text("Activate", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                            TextButton(onClick = { view = AuthView.LOGIN }, modifier = Modifier.fillMaxWidth()) {
                                Text("Back to sign in")
                            }
                        }

                        AuthView.SIGNUP -> {
                            AuthTextField(
                                value = signupUsername,
                                onValueChange = { signupUsername = it },
                                label = "Choose a username",
                                leadingIcon = { Icon(Icons.Default.Person, null) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                            )
                            AuthTextField(
                                value = signupPhone,
                                onValueChange = { signupPhone = it },
                                label = "Phone number",
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                            )
                            AuthTextField(
                                value = signupToken,
                                onValueChange = { signupToken = it },
                                label = "Choose an access token",
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
                            )
                            Spacer(Modifier.height(4.dp))
                            Button(
                                onClick = {
                                    focusManager.clearFocus()
                                    viewModel.signUp(signupUsername, signupPhone, signupToken)
                                },
                                enabled = !uiState.isLoading,
                                modifier = Modifier.fillMaxWidth().height(54.dp),
                                shape = RoundedCornerShape(50),
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
                            AuthTextField(
                                value = recUsername,
                                onValueChange = { recUsername = it },
                                label = "Username",
                                leadingIcon = { Icon(Icons.Default.Person, null) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                            )
                            AuthTextField(
                                value = recCode,
                                onValueChange = { recCode = it },
                                label = "Recovery code (XXXX-XXXX-XXXX)",
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                            )
                            AuthTextField(
                                value = recNewToken,
                                onValueChange = { recNewToken = it },
                                label = "New access token",
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
                            )
                            Spacer(Modifier.height(4.dp))
                            Button(
                                onClick = {
                                    focusManager.clearFocus()
                                    viewModel.resetWithRecoveryCode(recUsername, recCode, recNewToken)
                                },
                                enabled = !uiState.isLoading,
                                modifier = Modifier.fillMaxWidth().height(54.dp),
                                shape = RoundedCornerShape(50),
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
                modifier = Modifier.fillMaxWidth(),
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
            .background(SurfaceWhite)
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
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
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
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(50),
                        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                    ) {
                        Text("Continue to sign in", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

/**
 * Label-above, grey-filled input used across the sign-in flows — no outline,
 * rounded corners, brand-colour cursor and focus ring.
 */
@Composable
private fun AuthTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    supportingText: (@Composable () -> Unit)? = null,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    singleLine: Boolean = true,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    Column(modifier) {
        Text(
            label,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            color = TextPrimary,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
        )
        TextField(
            value = value,
            onValueChange = onValueChange,
            leadingIcon = leadingIcon,
            trailingIcon = trailingIcon,
            supportingText = supportingText,
            visualTransformation = visualTransformation,
            singleLine = singleLine,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth(),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = InputGrey,
                unfocusedContainerColor = InputGrey,
                disabledContainerColor = InputGrey,
                focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                disabledIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                cursorColor = DilarionRed,
                focusedLeadingIconColor = DilarionRed,
                unfocusedLeadingIconColor = TextMuted,
                unfocusedTrailingIconColor = TextMuted,
                focusedTrailingIconColor = TextSecondary,
            ),
        )
    }
}
