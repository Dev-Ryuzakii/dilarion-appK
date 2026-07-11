package com.dilarion.app.device

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

private const val TAG = "DeviceAdminReceiver"

/**
 * Required receiver for Device Owner provisioning (afw#setup / QR / zero-touch —
 * see DEVELOPMENT.md Phase 1/2). Device Owner status is what unlocks
 * DevicePolicyController's selective wipe capability; this receiver has no
 * logic of its own beyond acknowledging admin lifecycle callbacks.
 */
class DilarionDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "Device admin enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.w(TAG, "Device admin disabled — duress wipe capability lost")
    }
}
