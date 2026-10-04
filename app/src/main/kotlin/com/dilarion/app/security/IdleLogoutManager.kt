package com.dilarion.app.security

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.atomic.AtomicInteger

/**
 * Idle auto-logout — system-set, not a user setting. After IDLE_TIMEOUT_MS
 * with no touch activity the session token is dropped (device keys stay, so
 * old messages remain decryptable) and the user must re-enter their access
 * token to get back in. Last activity is persisted, so time spent with the
 * app closed counts too. Calls in progress hold it off.
 */
object IdleLogoutManager {
    const val IDLE_TIMEOUT_MS = 15 * 60 * 1000L

    private const val PREFS = "dilarion_idle_logout"
    private const val KEY_LAST_ACTIVE = "last_active"
    private const val KEY_LOCKED_USER = "locked_user"

    private val _lockedUser = MutableStateFlow<String?>(null)
    /** Username the token prompt is for, or null when not idle-locked. */
    val lockedUser: StateFlow<String?> = _lockedUser

    private val activeCalls = AtomicInteger(0)
    private var lastWrite = 0L

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun restore(context: Context) {
        _lockedUser.value = prefs(context).getString(KEY_LOCKED_USER, null)
    }

    fun markActive(context: Context, force: Boolean = false) {
        val now = System.currentTimeMillis()
        // Throttle disk writes; a few seconds of precision is plenty.
        if (!force && now - lastWrite < 5_000) return
        lastWrite = now
        prefs(context).edit().putLong(KEY_LAST_ACTIVE, now).apply()
    }

    fun isExpired(context: Context): Boolean {
        if (activeCalls.get() > 0) return false
        val last = prefs(context).getLong(KEY_LAST_ACTIVE, 0L)
        return last > 0 && System.currentTimeMillis() - last > IDLE_TIMEOUT_MS
    }

    fun lock(context: Context, username: String) {
        prefs(context).edit().putString(KEY_LOCKED_USER, username).apply()
        _lockedUser.value = username
    }

    fun unlock(context: Context) {
        prefs(context).edit().remove(KEY_LOCKED_USER).putLong(KEY_LAST_ACTIVE, System.currentTimeMillis()).apply()
        _lockedUser.value = null
    }

    fun callStarted() { activeCalls.incrementAndGet() }
    fun callEnded(context: Context) {
        if (activeCalls.decrementAndGet() < 0) activeCalls.set(0)
        markActive(context, force = true)
    }
}

/** Put on any in-call screen: no idle logout while it's showing. */
@Composable
fun HoldIdleLogoutWhileVisible() {
    val context = LocalContext.current
    DisposableEffect(Unit) {
        IdleLogoutManager.callStarted()
        onDispose { IdleLogoutManager.callEnded(context) }
    }
}
