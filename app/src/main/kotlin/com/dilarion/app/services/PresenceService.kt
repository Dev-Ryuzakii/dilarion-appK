package com.dilarion.app.services

import com.google.gson.Gson
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
                _connectionState.tryEmit(true)
            }
            override fun onMessage(ws: WebSocket, text: String) {
                runCatching {
                    val msg = gson.fromJson(text, WsMessage::class.java)
                    _events.tryEmit(msg)
                }
            }
            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                _connectionState.tryEmit(false)
            }
            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                _connectionState.tryEmit(false)
            }
        })
    }

    fun send(json: String) {
        webSocket?.send(json)
    }

    fun disconnect() {
        webSocket?.close(1000, "logout")
        webSocket = null
        _connectionState.tryEmit(false)
    }
}
