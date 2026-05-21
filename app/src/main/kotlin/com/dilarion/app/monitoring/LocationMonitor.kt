package com.dilarion.app.monitoring

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.LocationBatch
import com.dilarion.app.data.model.LocationPoint
import kotlinx.coroutines.*
import java.time.Instant

class LocationMonitor(
    private val context: Context,
    private val apiService: ApiService,
    private val scope: CoroutineScope,
    private val getToken: suspend () -> String?,
) {
    private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val buffer = mutableListOf<LocationPoint>()
    private var flushJob: Job? = null
    private var running = false

    private val listener = object : LocationListener {
        override fun onLocationChanged(loc: Location) {
            synchronized(buffer) {
                buffer.add(
                    LocationPoint(
                        latitude = loc.latitude,
                        longitude = loc.longitude,
                        accuracy = if (loc.hasAccuracy()) loc.accuracy else null,
                        altitude = if (loc.hasAltitude()) loc.altitude else null,
                        speed = if (loc.hasSpeed()) loc.speed else null,
                        heading = if (loc.hasBearing()) loc.bearing else null,
                        recordedAt = Instant.ofEpochMilli(loc.time).toString(),
                    )
                )
                if (buffer.size >= 20) scope.launch { flush() }
            }
        }
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    @SuppressLint("MissingPermission")
    fun start() {
        if (running) return
        running = true
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        val mainHandler = Handler(Looper.getMainLooper())
        providers.forEach { provider ->
            if (locationManager.isProviderEnabled(provider)) {
                locationManager.requestLocationUpdates(provider, 15_000L, 20f, listener, mainHandler.looper)
            }
        }
        flushJob = scope.launch {
            while (running) {
                delay(30_000)
                flush()
            }
        }
    }

    fun stop() {
        running = false
        locationManager.removeUpdates(listener)
        flushJob?.cancel()
        flushJob = null
        buffer.clear()
    }

    private suspend fun flush() {
        val points = synchronized(buffer) {
            if (buffer.isEmpty()) return
            val copy = buffer.toList()
            buffer.clear()
            copy
        }
        val token = getToken() ?: return
        runCatching {
            apiService.pushLocationBatch("Bearer $token", LocationBatch(points))
        }
    }
}
