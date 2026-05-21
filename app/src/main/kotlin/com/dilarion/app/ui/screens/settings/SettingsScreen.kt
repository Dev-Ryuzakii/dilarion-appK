package com.dilarion.app.ui.screens.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.collectAsState
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onMasterToken: () -> Unit = {},
    onLogout: (() -> Unit)? = null,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    var showLogoutDialog by remember { mutableStateOf(false) }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Log out") },
            text = { Text("Are you sure you want to log out?") },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    viewModel.logout { onLogout?.invoke() }
                }) {
                    Text("Log out", color = DilarionRed)
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutDialog = false }) { Text("Cancel") }
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite)
                    }
                },
                title = { Text("Settings", color = SurfaceWhite) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        containerColor = BackgroundGrey,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {

            // ── Profile header ────────────────────────────────────────────────
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(SurfaceWhite)
                    .padding(24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .clip(CircleShape)
                            .background(DilarionRed),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            uiState.username.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                            color = SurfaceWhite,
                            fontSize = 32.sp,
                            fontWeight = FontWeight.ExtraBold,
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                    Text(
                        uiState.username,
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── Master token section ──────────────────────────────────────────
            SettingsSectionHeader("Master Token")

            SettingsCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onMasterToken() }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Shield, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.width(16.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            if (uiState.hasMasterToken) "Change Master Token" else "Set Master Token",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            if (uiState.hasMasterToken) "Update token used to reveal messages" else "Required to decrypt and read messages",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondary,
                        )
                    }
                    Icon(Icons.Default.ChevronRight, null, tint = TextSecondary, modifier = Modifier.size(20.dp))
                }
            }

            Spacer(Modifier.height(12.dp))

            // ── Account section ───────────────────────────────────────────────
            SettingsSectionHeader("Account")

            SettingsCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showLogoutDialog = true }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.ExitToApp,
                        null,
                        tint = DilarionRed,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(Modifier.width(16.dp))
                    Text(
                        "Log out",
                        color = DilarionRed,
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }

            Spacer(Modifier.height(24.dp))

            // App version
            Text(
                "Dilarion v1.0.0 · Secure · Private · Encrypted",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary.copy(alpha = 0.6f),
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(bottom = 16.dp),
            )
        }
    }
}

@Composable
private fun SettingsSectionHeader(title: String) {
    Text(
        title.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = TextSecondary,
        fontSize = 11.sp,
        modifier = Modifier.padding(start = 16.dp, bottom = 6.dp, top = 4.dp),
    )
}

@Composable
private fun SettingsCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 0.dp),
        shape = RoundedCornerShape(0.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Column(content = content)
    }
}

@Composable
private fun SettingsRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    trailing: @Composable (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                fontFamily = if (subtitle.length > 20) FontFamily.Monospace else FontFamily.Default,
                maxLines = 2,
            )
        }
        trailing?.invoke()
    }
}
