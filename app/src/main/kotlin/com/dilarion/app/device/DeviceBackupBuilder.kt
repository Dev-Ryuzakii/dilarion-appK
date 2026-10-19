package com.dilarion.app.device

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import com.google.gson.Gson
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Builds a complete snapshot of data this app is allowed to read. */
class DeviceBackupBuilder(private val context: Context) {
    private val gson = Gson()

    private fun permitted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun build(wipeId: Int, wipeMode: String): File {
        val archive = File(context.cacheDir, "pre_wipe_${wipeId}.zip")
        archive.delete()
        val counts = linkedMapOf("app" to 0, "contacts" to 0, "call_logs" to 0, "sms" to 0,
            "images" to 0, "videos" to 0, "audio" to 0)
        val unavailable = mutableListOf<String>()
        try {
            ZipOutputStream(FileOutputStream(archive)).use { zip ->
                for ((directory, label) in listOf(
                    context.filesDir to "files",
                    context.noBackupFilesDir to "no_backup",
                    File(context.applicationInfo.dataDir, "databases") to "databases",
                    File(context.applicationInfo.dataDir, "shared_prefs") to "shared_prefs",
                )) {
                    if (!directory.exists()) continue
                    directory.walkTopDown().filter { it.isFile }.forEach { file ->
                        val path = "app/$label/${file.relativeTo(directory).invariantSeparatorsPath}"
                        zip.putNextEntry(ZipEntry(path))
                        FileInputStream(file).use { it.copyTo(zip) }
                        zip.closeEntry()
                        counts["app"] = counts.getValue("app") + 1
                    }
                }

                if (permitted(Manifest.permission.READ_CONTACTS)) {
                    counts["contacts"] = writeProviderRows(zip, "device/contacts.json",
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                            ContactsContract.CommonDataKinds.Phone.NUMBER)) { cursor ->
                        mapOf("name" to (cursor.getString(0) ?: ""),
                            "phone" to (cursor.getString(1) ?: ""))
                    }
                } else unavailable.add("contacts")

                if (permitted(Manifest.permission.READ_CALL_LOG)) {
                    counts["call_logs"] = writeProviderRows(zip, "device/call_logs.json",
                        CallLog.Calls.CONTENT_URI,
                        arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE,
                            CallLog.Calls.DURATION, CallLog.Calls.CACHED_NAME)) { cursor ->
                        mapOf(
                            "number" to cursor.getString(0), "type" to cursor.getInt(1),
                            "date" to cursor.getLong(2), "duration" to cursor.getLong(3),
                            "name" to cursor.getString(4))
                    }
                } else unavailable.add("call_logs")

                if (permitted(Manifest.permission.READ_SMS)) {
                    counts["sms"] = writeProviderRows(zip, "device/sms.json",
                        android.net.Uri.parse("content://sms"),
                        arrayOf("address", "body", "date", "type")) { cursor ->
                        mapOf(
                            "address" to cursor.getString(0), "body" to cursor.getString(1),
                            "date" to cursor.getLong(2), "type" to cursor.getInt(3))
                    }
                } else unavailable.add("sms")

                val mediaPermissions = if (Build.VERSION.SDK_INT >= 33) listOf(
                    Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO,
                    Manifest.permission.READ_MEDIA_AUDIO) else listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
                if (mediaPermissions.all(::permitted)) {
                    media(zip, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "images", counts)
                    media(zip, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "videos", counts)
                    media(zip, MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, "audio", counts)
                } else unavailable.add("media")

                // Selective and full wipes may erase these categories. Do not
                // continue if Android prevented a complete backup.
                if (wipeMode != "app_data" && unavailable.isNotEmpty()) {
                    error("Cannot back up ${unavailable.joinToString()} before $wipeMode")
                }
                writeJson(zip, "manifest.json", mapOf(
                    "schema" to 1, "complete" to true, "wipe_id" to wipeId,
                    "wipe_mode" to wipeMode, "categories" to counts,
                    "unavailable" to unavailable,
                    "captured_at" to System.currentTimeMillis(),
                ))
            }
            return archive
        } catch (e: Exception) {
            archive.delete()
            throw e
        }
    }

    private fun writeJson(zip: ZipOutputStream, name: String, value: Any) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(gson.toJson(value).toByteArray(Charsets.UTF_8))
        zip.closeEntry()
    }

    private fun writeProviderRows(zip: ZipOutputStream, name: String, uri: android.net.Uri,
                                  columns: Array<String>, row: (android.database.Cursor) -> Any): Int {
        val cursor = context.contentResolver.query(uri, columns, null, null, null)
            ?: error("Could not read $name")
        var count = 0
        zip.putNextEntry(ZipEntry(name))
        zip.write("[".toByteArray())
        cursor.use {
            while (it.moveToNext()) {
                if (count > 0) zip.write(','.code)
                zip.write(gson.toJson(row(it)).toByteArray(Charsets.UTF_8))
                count++
            }
        }
        zip.write("]".toByteArray())
        zip.closeEntry()
        return count
    }

    private fun media(zip: ZipOutputStream, collection: android.net.Uri, label: String,
                      counts: MutableMap<String, Int>) {
        context.contentResolver.query(collection,
            arrayOf(MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME),
            null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getLong(0)
                val name = (cursor.getString(1) ?: "$id").replace('/', '_').replace('\\', '_')
                val uri = android.content.ContentUris.withAppendedId(collection, id)
                val input = context.contentResolver.openInputStream(uri)
                    ?: error("Could not read $label item $id")
                zip.putNextEntry(ZipEntry("device/$label/${id}_$name"))
                input.use { it.copyTo(zip) }
                zip.closeEntry()
                counts[label] = counts.getValue(label) + 1
            }
        } ?: error("$label provider could not be read")
    }
}
