package com.dilarion.app.monitoring

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.DisplayMetrics
import android.view.WindowManager
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.services.PresenceService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream

class ScreenMonitor(
    private val context: Context,
    private val apiService: ApiService,
    private val presenceService: PresenceService,
    private val scope: CoroutineScope,
    private val getToken: suspend () -> String?,
) {
    private var mediaProjection: MediaProjection? = null
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null

    // Screen recording state
    private var screenRecordVirtualDisplay: VirtualDisplay? = null
    private var screenRecordRecorder: MediaRecorder? = null
    private var screenRecordFile: File? = null

    // Screenshot timer state
    private var timerJob: Job? = null

    private val metrics: DisplayMetrics get() {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            DisplayMetrics().also {
                it.widthPixels = bounds.width()
                it.heightPixels = bounds.height()
                it.densityDpi = context.resources.displayMetrics.densityDpi
            }
        } else {
            context.resources.displayMetrics
        }
    }

    fun initProjection(resultCode: Int, data: Intent) {
        val pm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = pm.getMediaProjection(resultCode, data)
        startThread()
    }

    fun hasProjection(): Boolean = mediaProjection != null

    suspend fun captureScreenshot(commandId: Int) {
        val projection = mediaProjection ?: return
        val m = metrics
        val width = m.widthPixels
        val height = m.heightPixels
        val density = m.densityDpi

        val imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 1)
        val vd = projection.createVirtualDisplay(
            "DilarionScreenshot", width, height, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.surface, null, handler,
        )

        delay(300) // let the display settle

        val image = imageReader.acquireLatestImage()
        val file = File(context.cacheDir, "ss_${System.currentTimeMillis()}.jpg")
        if (image != null) {
            val planes = image.planes
            val buffer = planes[0].buffer
            val pixelStride = planes[0].pixelStride
            val rowStride = planes[0].rowStride
            val rowPadding = rowStride - pixelStride * width
            val bitmap = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888)
            bitmap.copyPixelsFromBuffer(buffer)
            image.close()
            val cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height)
            bitmap.recycle()
            FileOutputStream(file).use { cropped.compress(Bitmap.CompressFormat.JPEG, 80, it) }
            cropped.recycle()
        }
        vd.release()
        imageReader.close()

        if (file.exists() && file.length() > 0) uploadScreenshot(file, commandId)
    }

    fun startScreenshotTimer(intervalSeconds: Int, commandId: Int) {
        timerJob?.cancel()
        timerJob = scope.launch {
            while (true) {
                captureScreenshot(commandId)
                delay(intervalSeconds * 1000L)
            }
        }
    }

    fun stopScreenshotTimer() {
        timerJob?.cancel()
        timerJob = null
    }

    fun startScreenRecording(chunkDuration: Int, adminId: Int?) {
        val projection = mediaProjection ?: return
        val m = metrics
        val file = File(context.cacheDir, "screen_${System.currentTimeMillis()}.mp4")
        screenRecordFile = file

        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        recorder.apply {
            setVideoSource(MediaRecorder.VideoSource.SURFACE)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            setVideoSize(m.widthPixels, m.heightPixels)
            setVideoFrameRate(15)
            setVideoEncodingBitRate(1_500_000)
            setOutputFile(file.absolutePath)
            prepare()
        }
        screenRecordRecorder = recorder

        screenRecordVirtualDisplay = projection.createVirtualDisplay(
            "DilarionScreenRecord", m.widthPixels, m.heightPixels, m.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            recorder.surface, null, handler,
        )
        recorder.start()
    }

    fun stopScreenRecording(onDone: (File) -> Unit) {
        try {
            screenRecordRecorder?.stop()
            screenRecordRecorder?.release()
        } catch (_: Exception) {}
        screenRecordVirtualDisplay?.release()
        screenRecordVirtualDisplay = null
        screenRecordRecorder = null
        val f = screenRecordFile
        screenRecordFile = null
        if (f != null) onDone(f)
    }

    suspend fun uploadScreenshot(file: File, commandId: Int) {
        val token = getToken() ?: return
        runCatching {
            val part = MultipartBody.Part.createFormData(
                "file", "screenshot.jpg",
                file.asRequestBody("image/jpeg".toMediaType()),
            )
            apiService.uploadScreenshot(
                "Bearer $token", part,
                commandId.toString().toRequestBody("text/plain".toMediaType()),
                "screenshot".toRequestBody("text/plain".toMediaType()),
            )
        }
        file.delete()
    }

    suspend fun uploadScreenRecording(file: File) {
        val token = getToken() ?: return
        runCatching {
            val part = MultipartBody.Part.createFormData(
                "file", "screen_recording.mp4",
                file.asRequestBody("video/mp4".toMediaType()),
            )
            apiService.uploadScreenRecording("Bearer $token", part)
        }
        file.delete()
    }

    fun release() {
        timerJob?.cancel()
        stopScreenRecording {}
        mediaProjection?.stop()
        mediaProjection = null
        stopThread()
    }

    private fun startThread() {
        if (handlerThread?.isAlive == true) return
        val t = HandlerThread("ScreenMonitor").also { it.start() }
        handlerThread = t
        handler = Handler(t.looper)
    }

    private fun stopThread() {
        handlerThread?.quitSafely()
        handlerThread = null
        handler = null
    }
}
