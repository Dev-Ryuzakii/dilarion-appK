package com.dilarion.app.ui.screens.onboarding

import android.Manifest
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import android.media.ExifInterface
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.OnboardingProfileRequest
import com.dilarion.app.monitoring.MonitoringForegroundService
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.dilarion.app.ui.screens.auth.registerKeysAndConnect
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.TextSecondary
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.Instant
import javax.inject.Inject

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
) : ViewModel() {
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var photo by mutableStateOf<Bitmap?>(null)
        private set
    private var photoJpeg: ByteArray? = null
    private var capturedAt: Instant? = null

    /** Decode the fresh camera shot, fix rotation, shrink and JPEG-encode it. */
    fun onPhotoCaptured(file: File) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.Default) {
                runCatching {
                    val opts = BitmapFactory.Options().apply { inSampleSize = 2 }
                    var bmp = BitmapFactory.decodeFile(file.absolutePath, opts) ?: error("no image")
                    val rotation = when (ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                        else -> 0f
                    }
                    if (rotation != 0f) {
                        bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(rotation) }, true)
                    }
                    val scale = 1024f / maxOf(bmp.width, bmp.height)
                    if (scale < 1f) bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
                    val out = ByteArrayOutputStream()
                    bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
                    bmp to out.toByteArray()
                }
            }
            file.delete()
            result.onSuccess { (bmp, jpeg) ->
                photo = bmp; photoJpeg = jpeg; capturedAt = Instant.now(); error = null
            }.onFailure { error = "Couldn't read the photo — please take it again" }
        }
    }

    fun submit(jobTitle: String, address: String, contactName: String, contactPhone: String, onDone: () -> Unit) {
        val jpeg = photoJpeg
        val at = capturedAt
        when {
            jobTitle.isBlank() -> { error = "Enter your job title"; return }
            address.trim().length < 5 -> { error = "Enter your address"; return }
            contactName.trim().length < 2 -> { error = "Enter an emergency contact name"; return }
            contactPhone.trim().length < 10 -> { error = "Enter a valid emergency contact phone number"; return }
            jpeg == null || at == null -> { error = "Take a live photo with your camera"; return }
        }
        viewModelScope.launch {
            busy = true; error = null
            val token = sessionManager.sessionToken.first()
            if (token == null) { busy = false; error = "Session expired — sign in again"; return@launch }
            val resp = runCatching {
                apiService.completeOnboarding(
                    "Bearer $token",
                    OnboardingProfileRequest(
                        jobTitle = jobTitle.trim(),
                        address = address.trim(),
                        emergencyContactName = contactName.trim(),
                        emergencyContactPhone = contactPhone.trim(),
                        cameraImageBase64 = Base64.encodeToString(jpeg, Base64.NO_WRAP),
                        capturedAt = at.toString(),
                        cameraAttestation = true,
                    ),
                )
            }.getOrNull()
            if (resp == null || !resp.isSuccessful) {
                busy = false
                val detail = runCatching {
                    com.google.gson.JsonParser.parseString(resp?.errorBody()?.string() ?: "").asJsonObject.get("detail")?.asString
                }.getOrNull()
                error = when {
                    resp?.code() == 409 -> { finish(token); onDone(); return@launch }
                    detail != null -> detail
                    else -> "Couldn't save your profile — try again"
                }
                return@launch
            }
            finish(token)
            busy = false
            onDone()
        }
    }

    private suspend fun finish(token: String) {
        sessionManager.setOnboardingPending(false)
        sessionManager.publicKey.first()?.let { registerKeysAndConnect(apiService, sessionManager, token, it) }
        presenceService.connect(token)
        MonitoringForegroundService.start(context)
    }
}

/**
 * Mandatory first-run step for invited organization staff: profile details
 * and a LIVE camera photo (no gallery) — the server rejects every other call
 * until this is done.
 */
@Composable
fun OnboardingScreen(onComplete: () -> Unit, viewModel: OnboardingViewModel = hiltViewModel()) {
    val context = LocalContext.current
    var jobTitle by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var contactName by remember { mutableStateOf("") }
    var contactPhone by remember { mutableStateOf("") }
    var pendingFile by remember { mutableStateOf<File?>(null) }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = pendingFile
        if (ok && f != null) viewModel.onPhotoCaptured(f)
    }
    fun launchCamera() {
        val f = File(context.cacheDir, "onboarding_${System.currentTimeMillis()}.jpg")
        pendingFile = f
        val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", f)
        takePicture.launch(uri)
    }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera()
    }

    Scaffold { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Complete your profile", fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text(
                "Your organization requires these details and a live photo before you can start using Dilarion.",
                color = TextSecondary, fontSize = 14.sp,
            )

            Box(
                Modifier.size(140.dp).clip(CircleShape).background(DilarionRed.copy(alpha = 0.1f)),
                contentAlignment = Alignment.Center,
            ) {
                val bmp = viewModel.photo
                if (bmp != null) {
                    Image(bmp.asImageBitmap(), "Your photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                } else {
                    Icon(Icons.Default.CameraAlt, null, tint = DilarionRed, modifier = Modifier.size(44.dp))
                }
            }
            OutlinedButton(onClick = { cameraPermission.launch(Manifest.permission.CAMERA) }, shape = RoundedCornerShape(12.dp)) {
                Icon(Icons.Default.CameraAlt, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(if (viewModel.photo == null) "Take live photo" else "Retake photo")
            }
            Text("Photos from your gallery are not accepted.", color = TextSecondary, fontSize = 12.sp)

            OutlinedTextField(jobTitle, { jobTitle = it }, label = { Text("Job title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(address, { address = it }, label = { Text("Address") }, minLines = 2, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(contactName, { contactName = it }, label = { Text("Emergency contact name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                contactPhone, { contactPhone = it }, label = { Text("Emergency contact phone") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth(),
            )
            viewModel.error?.let { Text(it, color = Color(0xFFEF4444), fontSize = 13.sp) }
            Button(
                onClick = { viewModel.submit(jobTitle, address, contactName, contactPhone, onComplete) },
                enabled = !viewModel.busy,
                colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) {
                if (viewModel.busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Text("Finish setup", fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
