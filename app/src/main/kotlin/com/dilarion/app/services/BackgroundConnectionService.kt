package com.dilarion.app.services

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
import com.dilarion.app.security.SessionManager
import com.dilarion.app.ui.screens.calls.CALL_TERMINAL_STATUSES
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "BackgroundConnection"

/**
 * Keeps the realtime connection open while the app is in the background so
 * incoming calls ring and new messages notify. While a call is in progress it
 * also holds the microphone foreground type, so the call keeps its audio when
 * the user switches apps or locks the phone (Android 11+ cuts the mic for
 * background apps otherwise). It does nothing else.
 */
@AndroidEntryPoint
class BackgroundConnectionService : Service() {

    @Inject lateinit var presenceService: PresenceService
    @Inject lateinit var sessionManager: SessionManager

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var eventsJob: Job? = null
    private var reconnectJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, buildNotification())
        }

        scope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            if (!presenceService.isConnected) presenceService.connect(token)
        }

        eventsJob = scope.launch { collectEvents() }

        reconnectJob = scope.launch {
            while (isActive) {
                delay(30_000)
                if (sessionManager.sessionToken.first() == null) continue
                presenceService.reconnectIfNeeded()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CALL_STATE) applyForegroundType()
        return START_STICKY
    }

    /** dataSync always; plus microphone while a call is active and the mic is granted. */
    private fun applyForegroundType() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        val micGranted = ContextCompat.checkSelfPermission(this, android.Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (activeCalls.isNotEmpty() && micGranted) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        runCatching { startForeground(NOTIF_ID, buildNotification(), type) }
            .onFailure { Log.w(TAG, "foreground type update failed: $it") }
    }

    private suspend fun collectEvents() {
        presenceService.events.collect { msg ->
            when (msg.type) {
                "incoming_call" -> {
                    val data = msg.data ?: return@collect
                    val callId = data.get("call_id")?.asInt ?: return@collect
                    val caller = data.get("caller_username")?.asString ?: ""
                    val type = data.get("call_type")?.asString ?: "voice"
                    val offer = data.get("offer_sdp")?.asString
                    Log.i(TAG, "incoming_call from=$caller callId=$callId")
                    val notif = NotificationHelper.buildCallNotification(this, caller, callId, type, offer)
                    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.notify(NotificationHelper.NOTIF_ID_CALL, notif)
                    NotificationHelper.startRingtone(this)
                }
                "call_status_update" -> {
                    val data = msg.data ?: return@collect
                    val status = data.get("status")?.asString ?: ""
                    // "missed" — the caller hung up before it was answered —
                    // has to clear the notification and its ringtone too.
                    if (status in listOf("accept", "accepted") || status in CALL_TERMINAL_STATUSES) {
                        NotificationHelper.cancelCall(this)
                    }
                }
                "new_message" -> {
                    val data = msg.data ?: return@collect
                    val sender = data.get("sender_username")?.asString ?: return@collect
                    val notif = NotificationHelper.buildMessageNotification(this, sender)
                    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.notify(NotificationHelper.NOTIF_ID_MSG, notif)
                }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        eventsJob?.cancel()
        reconnectJob?.cancel()
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
        private const val ACTION_CALL_STATE = "com.dilarion.app.CALL_STATE"
        // Which call kinds are live right now (1:1, meeting, group call).
        private val activeCalls = java.util.Collections.synchronizedSet(mutableSetOf<String>())

        /** Tell the service a call started or ended so it can hold or drop the mic type. */
        fun setCallActive(context: Context, source: String, active: Boolean) {
            val changed = if (active) activeCalls.add(source) else activeCalls.remove(source)
            if (!changed) return
            runCatching {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, BackgroundConnectionService::class.java).setAction(ACTION_CALL_STATE),
                )
            }.onFailure { Log.w(TAG, "call state update failed: $it") }
        }

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, BackgroundConnectionService::class.java),
            )
        }
    }
}
