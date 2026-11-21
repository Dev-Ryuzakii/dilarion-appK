package com.dilarion.app.security

import android.content.Context
import android.os.Build
import java.util.UUID

/**
 * Stable per-install device id sent on login so the server can keep one
 * signed-in phone per account and name the phone in security alerts. Kept
 * in its own prefs file so signing out (which clears the session store)
 * doesn't make this phone look like a new device.
 */
object DeviceIdentity {
    private const val PREFS = "dilarion_device_identity"
    private const val KEY_ID = "device_id"

    fun id(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY_ID, null)?.let { return it }
        val fresh = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_ID, fresh).apply()
        return fresh
    }

    /**
     * The name the owner sees in "Is this you signing in on …?": the phone's
     * own name from Settings > About phone (e.g. "Infinix SMART 7"), else the
     * maker and model.
     */
    fun name(context: Context? = null): String {
        context?.let { ctx ->
            val cr = ctx.contentResolver
            val own = runCatching { android.provider.Settings.Global.getString(cr, android.provider.Settings.Global.DEVICE_NAME) }.getOrNull()
                ?: runCatching { android.provider.Settings.Secure.getString(cr, "bluetooth_name") }.getOrNull()
            if (!own.isNullOrBlank()) return own.trim().take(120)
        }
        val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        val model = Build.MODEL
        return if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model"
    }
}
