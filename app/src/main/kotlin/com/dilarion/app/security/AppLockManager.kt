package com.dilarion.app.security

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

// App-entry biometric gate — opt-in (Settings > Biometric Lock), off by
// default. Arms on every pause (backgrounding, including cold launch via
// MainActivity.onCreate) — unlocking here only reveals the UI shell, it
// never touches the master token or decrypts anything, which stays behind
// its own tap-to-reveal flow regardless of this being on or off.
object AppLockManager {
    private val _isLocked = MutableStateFlow(false)
    val isLocked: StateFlow<Boolean> = _isLocked

    fun armIfEnabled(context: Context) {
        if (BiometricLockPrefs.isEnabled(context)) {
            _isLocked.value = true
        }
    }

    fun unlock() {
        _isLocked.value = false
    }
}

object BiometricLockPrefs {
    private const val PREFS = "dilarion_biometric_lock"
    private const val KEY_ENABLED = "enabled"

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }
}
