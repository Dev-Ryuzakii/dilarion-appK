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

@Composable
fun AuthScreen(
    viewModel: AuthViewModel,
    onAuthSuccess: () -> Unit,
) {
    val uiState by viewModel.uiState.collectAsState()
    val focusManager = LocalFocusManager.current

    var username by remember { mutableStateOf("") }
    var token    by remember { mutableStateOf("") }
    var showToken by remember { mutableStateOf(false) }

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
            Text("Welcome Back", style = MaterialTheme.typography.headlineLarge)
            Text(
                "Sign in to continue",
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

                    // Sign In button
                    Button(
                        onClick = {
                            focusManager.clearFocus()
                            viewModel.login(username, token)
                        },
                        enabled = !uiState.isLoading,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                    ) {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = SurfaceWhite,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text(
                                "Sign In",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                            )
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
