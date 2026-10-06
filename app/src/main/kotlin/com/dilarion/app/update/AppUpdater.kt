package com.dilarion.app.update

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.core.content.FileProvider
import com.dilarion.app.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File

/**
 * GitHub-hosted OTA update for the production Android build.
 *
 * On launch it reads a small JSON published alongside each GitHub release
 * (android-latest.json), compares versionCode, and if a newer signed APK is
 * available offers to download and install it. Android always shows its own
 * "install this app?" screen — a sideloaded update can never be silent — and
 * the new APK must be signed with the SAME keystore as the installed app, or
 * the system rejects it.
 *
 * Only the production flavor updates; the staging/test and debug builds are
 * left alone, matching the desktop updater.
 */
object AppUpdater {
    private const val TAG = "AppUpdater"
    private const val MANIFEST_URL =
        "https://github.com/Yamikage-001/Dilarion/releases/latest/download/android-latest.json"

    private val http = OkHttpClient()

    private data class UpdateInfo(
        val versionCode: Int,
        val versionName: String,
        val notes: String,
        val url: String,
    )

    fun checkOnLaunch(activity: Activity) {
        if (BuildConfig.FLAVOR != "production" || BuildConfig.DEBUG) return
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val info = withContext(Dispatchers.IO) { fetchManifest() } ?: return@launch
                if (info.versionCode <= BuildConfig.VERSION_CODE) return@launch
                promptInstall(activity, info)
            } catch (e: Exception) {
                Log.d(TAG, "update check skipped: ${e.message}")
            }
        }
    }

    private fun fetchManifest(): UpdateInfo? {
        val req = Request.Builder().url(MANIFEST_URL).header("Accept", "application/json").build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return null
            val body = res.body?.string() ?: return null
            val j = JSONObject(body)
            val url = j.optString("url").ifBlank { return null }
            return UpdateInfo(
                versionCode = j.optInt("versionCode", 0),
                versionName = j.optString("versionName", "?"),
                notes = j.optString("notes", ""),
                url = url,
            )
        }
    }

    private fun promptInstall(activity: Activity, info: UpdateInfo) {
        AlertDialog.Builder(activity)
            .setTitle("Update available")
            .setMessage(
                "Dilarion ${info.versionName} is available." +
                    (if (info.notes.isNotBlank()) "\n\n${info.notes}" else "") +
                    "\n\nDownload and install now?"
            )
            .setPositiveButton("Update") { _, _ -> ensurePermissionThenDownload(activity, info) }
            .setNegativeButton("Later", null)
            .setCancelable(true)
            .show()
    }

    private fun ensurePermissionThenDownload(activity: Activity, info: UpdateInfo) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            Toast.makeText(
                activity,
                "Allow Dilarion to install updates, then tap Update again",
                Toast.LENGTH_LONG
            ).show()
            activity.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                )
            )
            return
        }
        downloadAndInstall(activity, info)
    }

    private fun downloadAndInstall(activity: Activity, info: UpdateInfo) {
        Toast.makeText(activity, "Downloading update…", Toast.LENGTH_SHORT).show()
        CoroutineScope(Dispatchers.Main).launch {
            val apk = try {
                withContext(Dispatchers.IO) { downloadApk(activity, info.url) }
            } catch (e: Exception) {
                Log.e(TAG, "download failed", e)
                null
            }
            if (apk == null) {
                Toast.makeText(activity, "Update download failed", Toast.LENGTH_SHORT).show()
                return@launch
            }
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", apk)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                activity.startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "install intent failed", e)
                Toast.makeText(activity, "Couldn't open the installer", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun downloadApk(activity: Activity, url: String): File {
        val out = File(activity.cacheDir, "dilarion-update.apk")
        if (out.exists()) out.delete()
        val req = Request.Builder().url(url).build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw IllegalStateException("HTTP ${res.code}")
            out.outputStream().use { s -> res.body?.byteStream()?.copyTo(s) }
        }
        return out
    }
}
