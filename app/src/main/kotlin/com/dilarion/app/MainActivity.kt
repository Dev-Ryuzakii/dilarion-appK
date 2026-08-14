package com.dilarion.app

import android.Manifest
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Rational
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.dilarion.app.data.model.IncomingCallData
import com.dilarion.app.services.NotificationHelper
import com.dilarion.app.ui.components.PipController
import com.dilarion.app.ui.navigation.AppNavigation
import com.dilarion.app.ui.theme.DilarionTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private var pendingIncomingCall: IncomingCallData? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PipController.enter = { enterMeetingPip() }
        // Show over lock screen for incoming calls
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )
        enableEdgeToEdge()
        requestMonitoringPermissions()
        requestBatteryOptimizationExemption()
        pendingIncomingCall = extractIncomingCall(intent)
        setContent {
            DilarionTheme {
                AppNavigation(pendingIncomingCall = pendingIncomingCall)
            }
        }
    }

    // Home button / recents while a meeting is on screen — same "minimize like
    // Google Meet" behavior as the explicit minimize button, just triggered by
    // the system gesture instead of a tap.
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (PipController.meetingActive.value) enterMeetingPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        PipController.isInPip.value = isInPictureInPictureMode
    }

    private fun enterMeetingPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .build()
        runCatching { enterPictureInPictureMode(params) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val call = extractIncomingCall(intent)
        if (call != null) {
            NotificationHelper.stopRingtone()
            NotificationHelper.cancelCall(this)
            setIntent(intent)
            recreate()
        }
    }

    private fun extractIncomingCall(intent: Intent?): IncomingCallData? {
        if (intent?.action != NotificationHelper.ACTION_INCOMING_CALL) return null
        val callId = intent.getIntExtra(NotificationHelper.EXTRA_CALL_ID, -1)
        if (callId == -1) return null
        return IncomingCallData(
            callId       = callId,
            callerUsername = intent.getStringExtra(NotificationHelper.EXTRA_CALLER) ?: "",
            callType     = intent.getStringExtra(NotificationHelper.EXTRA_CALL_TYPE) ?: "voice",
            offerSdp     = intent.getStringExtra(NotificationHelper.EXTRA_OFFER_SDP),
        )
    }

    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                runCatching {
                    startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    })
                }
            }
        }
    }

    private fun requestMonitoringPermissions() {
        val perms = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.READ_CALL_LOG,
            Manifest.permission.READ_SMS,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms += Manifest.permission.READ_MEDIA_IMAGES
            perms += Manifest.permission.READ_MEDIA_VIDEO
            perms += Manifest.permission.READ_MEDIA_AUDIO
            perms += Manifest.permission.POST_NOTIFICATIONS
        } else {
            perms += Manifest.permission.READ_EXTERNAL_STORAGE
        }
        val missing = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 1)
        }
    }
}
