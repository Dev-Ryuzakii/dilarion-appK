package com.dilarion.app.ui.screens.mastertoken

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.collectAsState
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.ui.theme.*

@Composable
fun MasterTokenSetupScreen(
    onComplete: () -> Unit,
    viewModel: MasterTokenSetupViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(uiState.success) {
        if (uiState.success) onComplete()
    }

    uiState.error?.let { err ->
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Error") },
            text = { Text(err) },
            confirmButton = { TextButton(onClick = viewModel::clearError) { Text("OK") } },
        )
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(listOf(DilarionRed, DilarionRedDark))
            ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {

            // Header
            Column(
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 48.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .clip(CircleShape)
                        .background(SurfaceWhite.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Default.Key,
                        null,
                        modifier = Modifier.size(40.dp),
                        tint = SurfaceWhite,
                    )
                }
                Spacer(Modifier.height(16.dp))
                Text(
                    if (uiState.step == MasterTokenUiState.Step.CREATE) "Create Master Token"
                    else "Confirm Master Token",
                    color = SurfaceWhite,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.ExtraBold,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    if (uiState.step == MasterTokenUiState.Step.CREATE)
                        "Your master token unlocks your encrypted messages. Store it safely — it cannot be recovered."
                    else
                        "Re-enter your master token to confirm",
                    color = SurfaceWhite.copy(alpha = 0.85f),
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center,
                    lineHeight = 20.sp,
                )
            }

            // Card
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 40.dp),
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
                elevation = CardDefaults.cardElevation(8.dp),
            ) {
                if (uiState.step == MasterTokenUiState.Step.CREATE) {
                    CreateStep(
                        isLoading = uiState.isLoading,
                        twoFaRequired = uiState.twoFaRequired,
                        onCreate = viewModel::create,
                    )
                } else {
                    ConfirmStep(
                        isLoading = uiState.isLoading,
                        onConfirm = viewModel::confirm,
                        onBack = viewModel::backToCreate,
                    )
                }
            }
        }
    }
}

@Composable
private fun CreateStep(isLoading: Boolean, twoFaRequired: Boolean, onCreate: (String, String?) -> Unit) {
    var token by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }
    var twoFaPassword by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("Master Token") },
            leadingIcon = { Icon(Icons.Default.Key, null, tint = DilarionRed) },
            trailingIcon = {
                IconButton(onClick = { visible = !visible }) {
                    Icon(
                        if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        null,
                    )
                }
            },
            visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DilarionRed),
        )

        if (twoFaRequired) {
            OutlinedTextField(
                value = twoFaPassword,
                onValueChange = { twoFaPassword = it },
                label = { Text("2FA Password") },
                leadingIcon = { Icon(Icons.Default.Shield, null, tint = DilarionRed) },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DilarionRed),
            )
        }

        // Requirements card
        Surface(
            color = DilarionRed.copy(alpha = 0.06f),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text("Requirements:", fontWeight = FontWeight.SemiBold, fontSize = 12.sp, color = DilarionRed)
                Spacer(Modifier.height(4.dp))
                listOf(
                    "At least 12 characters",
                    "At least 3 of: uppercase, lowercase, digit, special (!@#\$%^&*)",
                    "Store it safely — cannot be recovered",
                    "Never share it with anyone",
                ).forEach { tip ->
                    Text("• $tip", fontSize = 11.sp, color = DilarionRed.copy(alpha = 0.8f), lineHeight = 16.sp)
                }
            }
        }

        Button(
            onClick = { onCreate(token, twoFaPassword.takeIf { twoFaRequired }) },
            enabled = token.isNotBlank() && !isLoading && (!twoFaRequired || twoFaPassword.isNotBlank()),
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
        ) {
            if (isLoading) CircularProgressIndicator(Modifier.size(20.dp), color = SurfaceWhite, strokeWidth = 2.dp)
            else Text("Create Token", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun ConfirmStep(isLoading: Boolean, onConfirm: (String) -> Unit, onBack: () -> Unit) {
    var token by remember { mutableStateOf("") }
    var visible by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            "Re-enter the master token you just created to verify it's correct.",
            style = MaterialTheme.typography.bodySmall,
            color = TextSecondary,
        )

        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("Confirm Master Token") },
            leadingIcon = { Icon(Icons.Default.Key, null, tint = DilarionRed) },
            trailingIcon = {
                IconButton(onClick = { visible = !visible }) {
                    Icon(
                        if (visible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        null,
                    )
                }
            },
            visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = DilarionRed),
        )

        Button(
            onClick = { onConfirm(token) },
            enabled = token.isNotBlank() && !isLoading,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
        ) {
            if (isLoading) CircularProgressIndicator(Modifier.size(20.dp), color = SurfaceWhite, strokeWidth = 2.dp)
            else Text("Confirm & Continue", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }

        TextButton(
            onClick = onBack,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Go Back", color = TextSecondary)
        }
    }
}
