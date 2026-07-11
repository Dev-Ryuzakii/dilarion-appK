package com.dilarion.app.device

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Telephony
import android.util.Log
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

private const val TAG = "DevicePolicyController"

data class WipeResult(
    val appsCleared: List<String>,
    val appsFailed: List<String>,
    val contactsDeleted: Int,
    val callLogDeleted: Int,
    val smsDeleted: Int,
    val smsError: String?,   // non-null if SMS deletion was skipped/failed — see wipeSms() note
    val mediaDeleted: Int,
    val mediaError: String?, // non-null if media deletion was skipped/failed — see wipeMedia() note
)

/**
 * Wraps the Device Owner APIs used for the duress wipe. Everything here requires
 * this app to actually hold Device Owner status (set at provisioning time, see
 * DEVELOPMENT.md) — every call silently no-ops or throws otherwise, so callers
 * must check [isDeviceOwner] first.
 *
 * Two known platform limits, called out rather than hidden:
 *  - SMS deletion via ContentResolver requires being the *default SMS app*, which
 *    Device Owner status alone does not grant. Until that role is separately
 *    acquired (RoleManager, requires a one-time flow), [wipeSms] will fail and
 *    reports that in [WipeResult.smsError] instead of pretending to succeed.
 *  - Media deletion on API 29+ needs MANAGE_EXTERNAL_STORAGE, which isn't
 *    grantable via setPermissionGrantState (it's a "special access", not a
 *    runtime permission). [wipeMedia] handles API <29 directly; on 29+ it
 *    reports the limitation in [WipeResult.mediaError] rather than a false success.
 */
class DevicePolicyController(private val context: Context) {

    private val dpm: DevicePolicyManager =
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val adminComponent = ComponentName(context, DilarionDeviceAdminReceiver::class.java)
    private val directExecutor = Executor { it.run() }

    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

    /** Silently grants this app's own dangerous permissions — no user-visible dialog. Device Owner only. */
    private fun selfGrant(permission: String) {
        runCatching {
            dpm.setPermissionGrantState(
                adminComponent,
                context.packageName,
                permission,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
            )
        }.onFailure { Log.e(TAG, "selfGrant($permission) failed: $it") }
    }

    /**
     * Clears app-local data for each listed package via clearApplicationUserData —
     * same effect as Settings > App > Clear Data. App stays installed, icon
     * unchanged, no reset screen. Requires API 28+.
     */
    private suspend fun clearAppsData(packages: List<String>): Pair<List<String>, List<String>> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            Log.w(TAG, "clearAppsData unsupported below API 28")
            return emptyList<String>() to packages
        }
        val cleared = mutableListOf<String>()
        val failed = mutableListOf<String>()
        for (pkg in packages) {
            val ok = suspendCoroutine<Boolean> { cont ->
                val started = runCatching {
                    dpm.clearApplicationUserData(adminComponent, pkg, directExecutor) { _, success ->
                        cont.resume(success)
                    }
                }.isSuccess
                if (!started) cont.resume(false)
            }
            if (ok) cleared.add(pkg) else failed.add(pkg)
        }
        return cleared to failed
    }

    private fun wipeContacts(): Int {
        selfGrant(android.Manifest.permission.WRITE_CONTACTS)
        return runCatching {
            context.contentResolver.delete(ContactsContract.RawContacts.CONTENT_URI, null, null)
        }.onFailure { Log.e(TAG, "wipeContacts failed: $it") }.getOrDefault(0)
    }

    private fun wipeCallLog(): Int {
        selfGrant(android.Manifest.permission.WRITE_CALL_LOG)
        return runCatching {
            context.contentResolver.delete(CallLog.Calls.CONTENT_URI, null, null)
        }.onFailure { Log.e(TAG, "wipeCallLog failed: $it") }.getOrDefault(0)
    }

    private fun wipeSms(): Pair<Int, String?> {
        return runCatching {
            val count = context.contentResolver.delete(Telephony.Sms.CONTENT_URI, null, null)
            count to null
        }.getOrElse { e ->
            val msg = "SMS not cleared — app is not the default SMS handler (${e.javaClass.simpleName})"
            Log.w(TAG, msg)
            0 to msg
        }
    }

    private fun wipeMedia(): Pair<Int, String?> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val msg = "Media not cleared — requires MANAGE_EXTERNAL_STORAGE on API 29+, not silently grantable"
            Log.w(TAG, msg)
            return 0 to msg
        }
        selfGrant(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
        return runCatching {
            var total = 0
            total += context.contentResolver.delete(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, null, null)
            total += context.contentResolver.delete(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, null, null)
            total += context.contentResolver.delete(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, null, null)
            total to null
        }.getOrElse { e ->
            val msg = "wipeMedia failed: ${e.javaClass.simpleName}"
            Log.e(TAG, msg)
            0 to msg
        }
    }

    /**
     * Full duress_selective wipe: clears the named 3rd-party apps' data plus
     * contacts/call log (and SMS/media where the platform allows it). No factory
     * reset, no setup screen, no user-visible dialog for any step.
     */
    suspend fun executeDuressWipe(targetPackages: List<String>): WipeResult {
        if (!isDeviceOwner()) {
            Log.e(TAG, "executeDuressWipe called without Device Owner — aborting")
            return WipeResult(emptyList(), targetPackages, 0, 0, 0, "not device owner", 0, "not device owner")
        }
        val (cleared, failed) = clearAppsData(targetPackages)
        val contacts = wipeContacts()
        val callLog = wipeCallLog()
        val (sms, smsErr) = wipeSms()
        val (media, mediaErr) = wipeMedia()
        val result = WipeResult(cleared, failed, contacts, callLog, sms, smsErr, media, mediaErr)
        Log.w(TAG, "executeDuressWipe complete: $result")
        return result
    }
}
