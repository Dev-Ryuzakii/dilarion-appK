package com.dilarion.app.services

import android.util.Log
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.dilarion.app.data.model.WsMessage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "PresenceService"

private const val WS_BASE = "ws://187.124.208.16:8010/ws"

@Singleton
class PresenceService @Inject constructor(
    private val okHttpClient: OkHttpClient,
) {

    private var webSocket: WebSocket? = null
    private val gson = Gson()

    private val _events = MutableSharedFlow<WsMessage>(extraBufferCapacity = 64)
    val events: SharedFlow<WsMessage> = _events

    private val _connectionState = MutableSharedFlow<Boolean>(extraBufferCapacity = 1)
    val connectionState: SharedFlow<Boolean> = _connectionState

    fun connect(token: String?) {
        if (token.isNullOrBlank()) return
        disconnect()
        val request = Request.Builder()
            .url("$WS_BASE?token=$token")
            .build()
        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "WS connected")
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
                _connectionState.tryEmit(false)
            }
            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WS failure: $t")
                _connectionState.tryEmit(false)
            }
        })
    }

    fun send(json: String) {
        webSocket?.send(json)
    }

    fun sendJson(payload: Any): Boolean {
        val json = gson.toJson(payload)
        return webSocket?.send(json) ?: false
    }

    fun disconnect() {
        webSocket?.close(1000, "logout")
        webSocket = null
        _connectionState.tryEmit(false)
    }
}
