package com.dilarion.app.monitoring

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import android.util.Log
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.services.PresenceService
import kotlinx.coroutines.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.time.Instant

private const val TAG = "AudioMonitor"

class AudioMonitor(
    private val context: Context,
    private val apiService: ApiService,
    private val presenceService: PresenceService,
    private val scope: CoroutineScope,
    private val getToken: suspend () -> String?,
) {
    private var ambientRecorder: MediaRecorder? = null
    private var ambientFile: File? = null
    private var ambientStart: Long = 0L

    private var liveActive = false
    private var liveJob: Job? = null
    private var liveSessionId: String? = null
    private var liveAdminId: Int? = null
    private var liveChunkIndex = 0

    fun startAmbientRecording() {
        if (ambientRecorder != null) { Log.w(TAG, "ambient already recording"); return }
        val f = File(context.cacheDir, "amb_${System.currentTimeMillis()}.m4a")
        Log.i(TAG, "startAmbientRecording: ${f.absolutePath}")
        val recorder = makeRecorder(f.absolutePath)
        recorder.prepare()
        recorder.start()
        ambientRecorder = recorder
        ambientFile = f
        ambientStart = System.currentTimeMillis()
        Log.i(TAG, "ambient recording started")
    }

    fun stopAmbientRecording(onDone: (File, Int) -> Unit) {
        val recorder = ambientRecorder ?: return
        val file = ambientFile ?: return
        val duration = ((System.currentTimeMillis() - ambientStart) / 1000).toInt()
        try { recorder.stop() } catch (_: Exception) {}
        recorder.release()
        ambientRecorder = null
        ambientFile = null
        onDone(file, duration)
    }

    suspend fun uploadAmbientRecording(file: File, duration: Int) {
        val token = getToken() ?: run { Log.e(TAG, "uploadAmbientRecording: no token"); return }
        runCatching {
            val part = MultipartBody.Part.createFormData(
                "file", "recording.m4a",
                file.asRequestBody("audio/mp4".toMediaType()),
            )
            val resp = apiService.uploadAudioRecording(
                "Bearer $token", part,
                "ambient".toRequestBody("text/plain".toMediaType()),
                duration.toString().toRequestBody("text/plain".toMediaType()),
            )
            Log.i(TAG, "uploadAmbientRecording: success size=${file.length()}")
        }.onFailure { Log.e(TAG, "uploadAmbientRecording failed: $it") }
        file.delete()
    }

    fun startLiveAudio(adminId: Int?) {
        if (liveActive) { Log.w(TAG, "live audio already active"); return }
        Log.i(TAG, "startLiveAudio adminId=$adminId")
        liveActive = true
        liveSessionId = "live_${System.currentTimeMillis()}"
        liveAdminId = adminId
        liveChunkIndex = 0
        liveJob = scope.launch { runLiveLoop() }
    }

    fun stopLiveAudio() {
        liveActive = false
        liveJob?.cancel()
        liveJob = null
        liveSessionId = null
        liveChunkIndex = 0
    }

    private suspend fun runLiveLoop() {
        Log.i(TAG, "runLiveLoop started")
        while (liveActive) {
            val chunkFile = File(context.cacheDir, "live_${System.currentTimeMillis()}.m4a")
            val recorder = makeRecorder(chunkFile.absolutePath)
            try {
                recorder.prepare()
                recorder.start()
                Log.d(TAG, "live chunk recording...")
                delay(1500)
                try { recorder.stop() } catch (e: Exception) { Log.e(TAG, "stop err: $e") }
                recorder.release()

                if (!liveActive) { chunkFile.delete(); break }

                val bytes = chunkFile.readBytes()
                chunkFile.delete()
                Log.d(TAG, "live chunk ${liveChunkIndex} size=${bytes.size}")
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)

                val payload = mapOf(
                    "type" to "live_audio_chunk",
                    "data" to mapOf(
                        "session_id" to liveSessionId,
                        "chunk_index" to liveChunkIndex++,
                        "audio_data" to b64,
                        "audio" to b64,
                        "mime_type" to "audio/m4a",
                        "admin_id" to liveAdminId,
                    ),
                )
                val sent = presenceService.sendJson(payload)
                Log.i(TAG, "live chunk sent=$sent ws_alive=${presenceService.isConnected}")
            } catch (e: Exception) {
                Log.e(TAG, "live chunk error: $e")
                try { recorder.release() } catch (_: Exception) {}
                chunkFile.delete()
                if (!liveActive) break
                delay(2000)
            }
        }
        Log.i(TAG, "runLiveLoop ended")
    }

    private fun makeRecorder(outputPath: String): MediaRecorder {
        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioSamplingRate(16000)
        r.setAudioChannels(1)
        r.setAudioEncodingBitRate(32000)
        r.setOutputFile(outputPath)
        return r
    }
}
