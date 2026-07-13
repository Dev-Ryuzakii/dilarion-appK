package com.dilarion.app.ui.screens.devices

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.DesktopWindows
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Laptop
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PhoneIphone
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.ui.theme.*
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LinkedDevicesScreen(
    onBack: () -> Unit,
    viewModel: LinkedDevicesViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let { viewModel.approveScannedLink(it) }
    }

    LaunchedEffect(uiState.error, uiState.info) {
        val msg = uiState.error ?: uiState.info
        if (msg != null) {
            snackbar.showSnackbar(msg)
            viewModel.clearMessages()
        }
    }

    fun startScan() {
        val options = ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Scan the QR code shown on your desktop")
            .setBeepEnabled(false)
            .setOrientationLocked(true)
            .setCaptureActivity(PortraitCaptureActivity::class.java)
        scanLauncher.launch(options)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite) }
                },
                title = { Text("Linked devices", color = SurfaceWhite) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = BackgroundGrey,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            // ── Illustration + link button card ────────────────────────────────
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(SurfaceWhite)
                    .padding(vertical = 24.dp, horizontal = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Default.PhoneIphone, null, tint = DilarionRed, modifier = Modifier.size(40.dp))
                    Text("♥", color = DilarionRed, style = MaterialTheme.typography.titleLarge)
                    Icon(Icons.Default.Laptop, null, tint = DilarionRed, modifier = Modifier.size(48.dp))
                }
                Spacer(Modifier.height(16.dp))
                Text(
                    "You can link other devices to this account.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondary,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
                Spacer(Modifier.height(20.dp))
                Button(
                    onClick = { startScan() },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(24.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DilarionRed, contentColor = SurfaceWhite),
                    contentPadding = PaddingValues(vertical = 14.dp),
                ) {
                    Icon(Icons.Default.Add, null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Link a device", fontWeight = FontWeight.SemiBold)
                }
            }

            // ── Device list ────────────────────────────────────────────────────
            if (uiState.loading) {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DilarionRed)
                }
            } else if (uiState.devices.isNotEmpty()) {
                Text(
                    "LINKED DEVICES",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextSecondary,
                    modifier = Modifier.padding(start = 16.dp, top = 4.dp, bottom = 6.dp),
                )
                Column {
                    uiState.devices.forEach { device ->
                        DeviceRow(
                            name = device.deviceName ?: device.platform.replaceFirstChar { it.uppercase() },
                            platform = device.platform,
                            lastSeen = device.lastSeen,
                            onRevoke = { viewModel.revoke(device.deviceUuid) },
                        )
                    }
                }
                Text(
                    "Tap a device to unlink it.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                    modifier = Modifier.padding(16.dp),
                )
            }

            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Icon(Icons.Default.Lock, null, tint = TextSecondary, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text(
                    "Your personal messages are end-to-end encrypted on all of your linked devices.",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                )
            }
        }
    }
}

private fun platformIcon(platform: String): ImageVector = when (platform) {
    "desktop" -> Icons.Default.DesktopWindows
    "ios"     -> Icons.Default.PhoneIphone
    "android" -> Icons.Default.Smartphone
    else       -> Icons.Default.Devices
}

private fun prettyLastSeen(iso: String?): String {
    if (iso.isNullOrBlank()) return "Active"
    // Show the date/time portion without over-engineering timezone parsing.
    val t = iso.replace("T", " ").take(16)
    return "Last active $t"
}

@Composable
private fun DeviceRow(name: String, platform: String, lastSeen: String?, onRevoke: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Unlink device") },
            text = { Text("Unlink \"$name\"? It will no longer receive new messages until re-linked.") },
            confirmButton = {
                TextButton(onClick = { confirm = false; onRevoke() }) { Text("Unlink", color = DilarionRed) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { confirm = true }
            .background(SurfaceWhite)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(40.dp).clip(CircleShape).background(BackgroundGrey),
            contentAlignment = Alignment.Center,
        ) {
            Icon(platformIcon(platform), null, tint = DilarionRed, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(16.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(prettyLastSeen(lastSeen), style = MaterialTheme.typography.bodySmall, color = TextSecondary)
        }
        Icon(Icons.Default.ChevronRight, null, tint = TextSecondary, modifier = Modifier.size(20.dp))
    }
}
