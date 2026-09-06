package com.dilarion.app.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.util.Log
import com.dilarion.app.MainActivity
import com.dilarion.app.R

private const val TAG = "NotificationHelper"

object NotificationHelper {

    const val CHANNEL_MESSAGES = "dilarion_messages"
    const val CHANNEL_CALLS    = "dilarion_calls"
    const val NOTIF_ID_CALL    = 9002
    const val NOTIF_ID_MSG     = 9003

    const val ACTION_INCOMING_CALL = "com.dilarion.app.INCOMING_CALL"
    const val EXTRA_CALLER         = "caller_username"
    const val EXTRA_CALL_ID        = "call_id"
    const val EXTRA_CALL_TYPE      = "call_type"
    const val EXTRA_OFFER_SDP      = "offer_sdp"

    private const val RING_LOOPS = 5

    private var ringtonePlayer: MediaPlayer? = null
    private var loopCount = 0

    fun createChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        // Message channel — beep sound
        if (nm.getNotificationChannel(CHANNEL_MESSAGES) == null) {
            val beepUri = Uri.parse("android.resource://${context.packageName}/${R.raw.beep}")
            val msgAttr = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "New message notifications"
                    setSound(beepUri, msgAttr)
                    enableVibration(true)
                }
            )
        }

        // Call channel — silent (we handle ringtone via MediaPlayer)
        if (nm.getNotificationChannel(CHANNEL_CALLS) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_CALLS, "Incoming Calls", NotificationManager.IMPORTANCE_MAX).apply {
                    description = "Incoming call alerts"
                    setSound(null, null)
                    enableVibration(true)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
            )
        }
    }

    fun startRingtone(context: Context) {
        stopRingtone()
        loopCount = 0
        runCatching {
            val player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                val uri = Uri.parse("android.resource://${context.packageName}/${R.raw.ringtone}")
                setDataSource(context, uri)
                prepare()
                isLooping = false
                setOnCompletionListener {
                    loopCount++
                    if (loopCount < RING_LOOPS) {
                        runCatching { it.seekTo(0); it.start() }
                    } else {
                        stopRingtone()
                    }
                }
                start()
            }
            ringtonePlayer = player
            Log.i(TAG, "ringtone started, will loop $RING_LOOPS times")
        }.onFailure { Log.e(TAG, "startRingtone failed: $it") }
    }

    fun stopRingtone() {
        runCatching { ringtonePlayer?.stop(); ringtonePlayer?.release() }
        ringtonePlayer = null
        loopCount = 0
    }

    fun buildCallNotification(
        context: Context,
        callerUsername: String,
        callId: Int,
        callType: String,
        offerSdp: String?,
    ): Notification {
        createChannels(context)

        val fullScreenIntent = Intent(context, MainActivity::class.java).apply {
            action = ACTION_INCOMING_CALL
            putExtra(EXTRA_CALLER, callerUsername)
            putExtra(EXTRA_CALL_ID, callId)
            putExtra(EXTRA_CALL_TYPE, callType)
            putExtra(EXTRA_OFFER_SDP, offerSdp)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val fsPending = PendingIntent.getActivity(
            context, callId,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return Notification.Builder(context, CHANNEL_CALLS)
            .setContentTitle("Incoming ${if (callType == "video") "Video" else "Voice"} Call")
            .setContentText("Someone is calling you")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setPriority(Notification.PRIORITY_MAX)
            .setCategory(Notification.CATEGORY_CALL)
            .setFullScreenIntent(fsPending, true)
            .setContentIntent(fsPending)
            .setOngoing(true)
            .setAutoCancel(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build()
    }

    fun buildMessageNotification(context: Context, sender: String): Notification {
        createChannels(context)
        val tapIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val tapPending = PendingIntent.getActivity(
            context, 0,
            tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(context, CHANNEL_MESSAGES)
            .setContentTitle("New message")
            .setContentText("You have a new message")
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentIntent(tapPending)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
    }

    fun cancelCall(context: Context) {
        stopRingtone()
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIF_ID_CALL)
    }
}
