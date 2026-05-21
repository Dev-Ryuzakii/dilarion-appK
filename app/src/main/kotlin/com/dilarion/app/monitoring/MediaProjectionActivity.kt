package com.dilarion.app.monitoring

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle

class MediaProjectionActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(pm.createScreenCaptureIntent(), REQUEST_CODE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            // Store result for the monitoring service to use
            pendingResult = Pair(resultCode, data)
            MonitoringForegroundService.onProjectionGranted(this, resultCode, data)
        }
        finish()
    }

    companion object {
        private const val REQUEST_CODE = 1001
        var pendingResult: Pair<Int, Intent>? = null

        fun request(context: Context) {
            context.startActivity(
                Intent(context, MediaProjectionActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        }
    }
}
