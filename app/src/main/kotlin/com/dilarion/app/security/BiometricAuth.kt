package com.dilarion.app.security

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

// Thin wrapper around BiometricPrompt. Deliberately never touches the master
// token or content decryption — see AppLockManager / the settings rows that
// call this for what it's actually allowed to gate: opening the app, and
// account-security changes (master token, 2FA, device linking).
object BiometricAuth {
    private const val ALLOWED = BiometricManager.Authenticators.BIOMETRIC_WEAK or
        BiometricManager.Authenticators.DEVICE_CREDENTIAL

    fun isAvailable(activity: FragmentActivity): Boolean {
        val manager = BiometricManager.from(activity)
        return manager.canAuthenticate(ALLOWED) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /** Falls back to the device PIN/pattern/password if biometrics aren't
     * enrolled — still a real local secret. Returns false (never throws) on
     * any failure or cancellation. */
    suspend fun authenticate(activity: FragmentActivity, reason: String): Boolean {
        if (!isAvailable(activity)) return false
        return suspendCancellableCoroutine { cont ->
            val executor = ContextCompat.getMainExecutor(activity)
            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (cont.isActive) cont.resume(true)
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (cont.isActive) cont.resume(false)
                }
                override fun onAuthenticationFailed() {
                    // A single failed attempt (e.g. wrong finger) — the prompt stays open
                    // for retry, don't resolve the coroutine yet.
                }
            }
            val prompt = BiometricPrompt(activity, executor, callback)
            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Dilarion")
                .setSubtitle(reason)
                .setAllowedAuthenticators(ALLOWED)
                .build()
            prompt.authenticate(info)
            cont.invokeOnCancellation { runCatching { prompt.cancelAuthentication() } }
        }
    }

    /** Off (or unavailable) passes straight through — this only adds friction
     * for users who opted into Biometric Lock in Settings. */
    suspend fun gateSensitiveAction(activity: FragmentActivity, reason: String = "Confirm it's you"): Boolean {
        if (!BiometricLockPrefs.isEnabled(activity)) return true
        return authenticate(activity, reason)
    }
}
