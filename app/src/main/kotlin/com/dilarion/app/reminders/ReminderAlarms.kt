package com.dilarion.app.reminders

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import com.dilarion.app.MainActivity
import com.dilarion.app.data.model.ReminderItem
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset

/** Parses the server's ISO time (with or without an offset; naive = UTC). */
fun parseServerTime(iso: String?): Instant? {
    if (iso.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching { LocalDateTime.parse(iso.removeSuffix("Z")).toInstant(ZoneOffset.UTC) }
        .getOrNull()
}

/**
 * Local alarms for reminders, so they go off even when the app is closed.
 * The server also sends `reminder_due` over the socket while the app is open;
 * both paths show the same notification id, so a reminder rings once.
 */
object ReminderAlarms {
    private const val CHANNEL = "dilarion_reminders"
    private const val PREFS = "reminder_alarms"
    const val EXTRA_ID = "reminder_id"
    const val EXTRA_TITLE = "reminder_title"
    const val EXTRA_NOTE = "reminder_note"

    private fun pending(context: Context, id: Int, title: String = "", note: String? = null): PendingIntent {
        val intent = Intent(context, ReminderAlarmReceiver::class.java)
            .putExtra(EXTRA_ID, id).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_NOTE, note)
        return PendingIntent.getBroadcast(context, 50_000 + id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Replace the scheduled alarms with the scheduled reminders from the server. */
    fun sync(context: Context, reminders: List<ReminderItem>) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val previous = prefs.getStringSet("ids", emptySet()).orEmpty().mapNotNull { it.toIntOrNull() }
        previous.forEach { am.cancel(pending(context, it)) }
        val now = System.currentTimeMillis()
        val scheduled = reminders.filter { it.status == "scheduled" }.mapNotNull { r ->
            val at = parseServerTime(r.remindAt)?.toEpochMilli() ?: return@mapNotNull null
            if (at <= now) return@mapNotNull null
            // Inexact while idle (no exact-alarm permission needed); fires within minutes.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(context, r.id, r.title, r.note))
            r.id.toString()
        }
        prefs.edit().putStringSet("ids", scheduled.toSet()).apply()
    }

    fun cancel(context: Context, id: Int) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(pending(context, id))
        notificationManager(context).cancel(60_000 + id)
    }

    private fun notificationManager(context: Context) =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    fun showNotification(context: Context, id: Int, title: String, note: String?) {
        val nm = notificationManager(context)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Reminders you set, ringing like an alarm"
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), attrs)
                enableVibration(true)
            })
        }
        val tap = PendingIntent.getActivity(context, 60_000 + id,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(context, CHANNEL)
            .setContentTitle(title)
            .setContentText(note ?: "Reminder")
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .build()
        runCatching { nm.notify(60_000 + id, n) }
    }
}

class ReminderAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getIntExtra(ReminderAlarms.EXTRA_ID, -1)
        if (id < 0) return
        ReminderAlarms.showNotification(
            context, id,
            intent.getStringExtra(ReminderAlarms.EXTRA_TITLE).orEmpty().ifBlank { "Reminder" },
            intent.getStringExtra(ReminderAlarms.EXTRA_NOTE),
        )
    }
}
