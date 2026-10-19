package com.dilarion.app.device

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle

/** System callbacks for provisioning Dilarion as the fully managed device DPC. */
class ManagedDeviceProvisioningActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        when (intent.action) {
            DevicePolicyManager.ACTION_GET_PROVISIONING_MODE -> {
                val allowed = intent.getIntegerArrayListExtra(
                    DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES)
                val fullyManaged = DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
                if (allowed == null || fullyManaged in allowed) {
                    setResult(RESULT_OK, Intent().putExtra(
                        DevicePolicyManager.EXTRA_PROVISIONING_MODE, fullyManaged))
                } else {
                    setResult(RESULT_CANCELED)
                }
            }
            DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE -> {
                val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
                setResult(if (dpm.isDeviceOwnerApp(packageName)) RESULT_OK else RESULT_CANCELED)
            }
            else -> setResult(RESULT_CANCELED)
        }
        finish()
    }
}
