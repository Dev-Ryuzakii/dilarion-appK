package com.dilarion.app.ui.screens.devices

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
            .setPrompt("Scan the code shown on the other device")
            .setBeepEnabled(false)
            .setOrientationLocked(true)
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
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { startScan() },
                containerColor = DilarionRed,
                contentColor = SurfaceWhite,
                icon = { Icon(Icons.Default.QrCodeScanner, null) },
                text = { Text("Link a device") },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = BackgroundGrey,
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Text(
                "Scan the QR shown on your desktop or another device to link it. Each device gets its own key; you can unlink any of them here.",
                style = MaterialTheme.typography.bodySmall,
                color = TextSecondary,
                modifier = Modifier.padding(16.dp),
            )

            if (uiState.loading) {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DilarionRed)
                }
            } else if (uiState.devices.isEmpty()) {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    Text("No linked devices yet", color = TextSecondary)
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(uiState.devices, key = { it.deviceUuid }) { device ->
                        DeviceRow(
                            name = device.deviceName ?: device.platform.replaceFirstChar { it.uppercase() },
                            platform = device.platform,
                            lastSeen = device.lastSeen,
                            onRevoke = { viewModel.revoke(device.deviceUuid) },
                        )
                    }
                }
            }
        }
    }
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

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceWhite),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.Devices, null, tint = DilarionRed, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(16.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(
                    platform.replaceFirstChar { it.uppercase() } + (lastSeen?.let { " · active" } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                )
            }
            TextButton(onClick = { confirm = true }) { Text("Unlink", color = DilarionRed) }
        }
    }
}
