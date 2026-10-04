package com.dilarion.app.security

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "dilarion_session")

@Singleton
class SessionManager @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private object Keys {
        val SESSION_TOKEN  = stringPreferencesKey("session_token")
        val USERNAME       = stringPreferencesKey("username")
        val PRIVATE_KEY    = stringPreferencesKey("private_key")
        val PUBLIC_KEY     = stringPreferencesKey("public_key")
        val MASTER_TOKEN   = stringPreferencesKey("master_token")
        val DEVICE_UUID    = stringPreferencesKey("device_uuid")
        // Which account the stored master token belongs to — a token saved by
        // one user must never unlock another user's messages on this device.
        val MASTER_TOKEN_OWNER = stringPreferencesKey("master_token_owner")
        // Invited staff must finish the profile + live camera step before the
        // server lets them use anything else.
        val ONBOARDING_PENDING = stringPreferencesKey("onboarding_pending")
    }

    val sessionToken: Flow<String?> = context.dataStore.data.map { it[Keys.SESSION_TOKEN] }
    val username: Flow<String?>      = context.dataStore.data.map { it[Keys.USERNAME] }
    val privateKey: Flow<String?>    = context.dataStore.data.map { it[Keys.PRIVATE_KEY] }
    val publicKey: Flow<String?>     = context.dataStore.data.map { it[Keys.PUBLIC_KEY] }
    val masterToken: Flow<String?>   = context.dataStore.data.map { prefs ->
        val token = prefs[Keys.MASTER_TOKEN]
        val owner = prefs[Keys.MASTER_TOKEN_OWNER]
        // Older installs stored the token without an owner — accept it only
        // for the account that is signed in now (the switch-wipe below
        // guarantees that was its owner).
        if (token != null && (owner == null || owner.equals(prefs[Keys.USERNAME], ignoreCase = true))) token else null
    }
    val onboardingPending: Flow<Boolean> = context.dataStore.data.map { it[Keys.ONBOARDING_PENDING] == "1" }
    // This device's server id, used to find our own entry in a message's key map.
    val deviceUuid: Flow<String?>    = context.dataStore.data.map { it[Keys.DEVICE_UUID] }

    suspend fun saveSession(token: String, username: String, privateKey: String, publicKey: String) {
        context.dataStore.edit { prefs ->
            prefs[Keys.SESSION_TOKEN] = token
            prefs[Keys.USERNAME]      = username
            prefs[Keys.PRIVATE_KEY]   = privateKey
            prefs[Keys.PUBLIC_KEY]    = publicKey
        }
    }

    suspend fun updateUsername(newUsername: String) {
        context.dataStore.edit { prefs ->
            // Same account renamed — its master token goes with it.
            if (prefs[Keys.MASTER_TOKEN] != null) prefs[Keys.MASTER_TOKEN_OWNER] = newUsername
            prefs[Keys.USERNAME] = newUsername
        }
    }

    suspend fun saveMasterToken(masterToken: String) {
        context.dataStore.edit { prefs ->
            prefs[Keys.MASTER_TOKEN] = masterToken
            prefs[Keys.USERNAME]?.let { prefs[Keys.MASTER_TOKEN_OWNER] = it }
        }
    }

    suspend fun setOnboardingPending(pending: Boolean) {
        context.dataStore.edit { if (pending) it[Keys.ONBOARDING_PENDING] = "1" else it.remove(Keys.ONBOARDING_PENDING) }
    }

    /**
     * Call before establishing a session. If a DIFFERENT account was last
     * signed in on this device, wipe everything that belonged to it — its
     * E2EE keypair, device id and master token — so nothing of user A's can
     * ever decrypt or unlock for user B. Same account signing back in keeps
     * its keys (otherwise its old messages would become undecryptable).
     */
    suspend fun prepareForAccount(username: String) {
        val prefs = context.dataStore.data.first()
        val previous = prefs[Keys.USERNAME]
        if (previous != null && !previous.equals(username, ignoreCase = true)) {
            context.dataStore.edit { it.clear() }
        }
    }

    suspend fun saveDeviceUuid(deviceUuid: String) {
        context.dataStore.edit { it[Keys.DEVICE_UUID] = deviceUuid }
    }

    suspend fun clearSession() {
        context.dataStore.edit { it.clear() }
    }

    /** Idle logout: drop only the session token — the device keypair, username
     *  and device id stay so re-entering the access token restores everything. */
    suspend fun clearSessionTokenOnly() {
        context.dataStore.edit { it.remove(Keys.SESSION_TOKEN) }
    }

    suspend fun saveSessionToken(token: String) {
        context.dataStore.edit { it[Keys.SESSION_TOKEN] = token }
    }

    suspend fun getSnapshot(): SessionSnapshot? {
        val prefs = context.dataStore.data.first()
        val token = prefs[Keys.SESSION_TOKEN]
        val user  = prefs[Keys.USERNAME]
        val priv  = prefs[Keys.PRIVATE_KEY]
        return if (token != null && user != null) SessionSnapshot(token, user, priv) else null
    }

    data class SessionSnapshot(
        val token: String,
        val username: String,
        val privateKey: String?,
    )
}
