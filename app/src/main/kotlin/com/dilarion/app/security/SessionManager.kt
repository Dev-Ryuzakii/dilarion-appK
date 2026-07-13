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
    }

    val sessionToken: Flow<String?> = context.dataStore.data.map { it[Keys.SESSION_TOKEN] }
    val username: Flow<String?>      = context.dataStore.data.map { it[Keys.USERNAME] }
    val privateKey: Flow<String?>    = context.dataStore.data.map { it[Keys.PRIVATE_KEY] }
    val publicKey: Flow<String?>     = context.dataStore.data.map { it[Keys.PUBLIC_KEY] }
    val masterToken: Flow<String?>   = context.dataStore.data.map { it[Keys.MASTER_TOKEN] }
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

    suspend fun saveMasterToken(masterToken: String) {
        context.dataStore.edit { it[Keys.MASTER_TOKEN] = masterToken }
    }

    suspend fun saveDeviceUuid(deviceUuid: String) {
        context.dataStore.edit { it[Keys.DEVICE_UUID] = deviceUuid }
    }

    suspend fun clearSession() {
        context.dataStore.edit { it.clear() }
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
