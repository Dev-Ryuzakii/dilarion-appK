package com.dilarion.app.services

import android.content.Context
import android.os.Build
import android.util.Log
import com.google.gson.Gson
import com.dilarion.app.BuildConfig
import com.dilarion.app.data.model.WsMessage
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "PresenceService"
private val WS_BASE = BuildConfig.WS_BASE
private const val PREFS_NAME = "dilarion_device"
private const val KEY_DEVICE_ID = "device_id"

@Singleton
class PresenceService @Inject constructor(
    private val okHttpClient: OkHttpClient,
    @ApplicationContext private val context: Context,
) {

    @Volatile private var webSocket: WebSocket? = null
    @Volatile private var isOpen: Boolean = false
    private var currentToken: String? = null
    private val gson = Gson()

    val isConnected: Boolean get() = isOpen && webSocket != null

    private val _events = MutableSharedFlow<WsMessage>(extraBufferCapacity = 64)
    val events: SharedFlow<WsMessage> = _events

    private val _connectionState = MutableSharedFlow<Boolean>(extraBufferCapacity = 1)
    val connectionState: SharedFlow<Boolean> = _connectionState

    // ── Device identity (persists across sessions) ─────────────────────────────

    private val deviceId: String by lazy {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(KEY_DEVICE_ID, it).apply()
        }
    }

    private val deviceName: String by lazy {
        val model = Build.MODEL ?: "Android"
        val manufacturer = Build.MANUFACTURER ?: ""
        if (model.startsWith(manufacturer, ignoreCase = true)) model
        else "$manufacturer $model".trim()
    }

    fun connect(token: String?) {
        if (token.isNullOrBlank()) return
        currentToken = token
        disconnect()
        val url = buildString {
            append(WS_BASE)
            append("?token=").append(token)
            append("&device_id=").append(deviceId)
            append("&device_type=mobile")
            append("&device_name=").append(android.net.Uri.encode(deviceName))
        }
        val request = Request.Builder()
            .url(url)
            .build()
        val newWs = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "WS connected")
                isOpen = true
                _connectionState.tryEmit(true)
            }
            override fun onMessage(ws: WebSocket, text: String) {
                Log.d(TAG, "WS message: $text")
                runCatching {
                    val msg = gson.fromJson(text, WsMessage::class.java)
                    Log.i(TAG, "parsed type=${msg.type} commandType=${msg.commandType} commandId=${msg.commandId}")
                    _events.tryEmit(msg)
                }.onFailure { Log.e(TAG, "parse error: $it") }
            }
            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "WS closed: $code $reason")
                if (webSocket === ws) { webSocket = null; isOpen = false }
                _connectionState.tryEmit(false)
            }
            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WS failure: $t")
                if (webSocket === ws) { webSocket = null; isOpen = false }
                _connectionState.tryEmit(false)
            }
        })
        webSocket = newWs
    }

    fun reconnectIfNeeded() {
        if (!isConnected && currentToken != null) {
            Log.i(TAG, "reconnecting WS")
            connect(currentToken)
        }
    }

    fun send(json: String) {
        webSocket?.send(json)
    }

    fun sendJson(payload: Any): Boolean {
        val json = gson.toJson(payload)
        return webSocket?.send(json) ?: false
    }

    fun disconnect() {
        val ws = webSocket
        webSocket = null
        isOpen = false
        ws?.close(1000, "logout")
        _connectionState.tryEmit(false)
    }
}
