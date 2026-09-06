package com.dilarion.app.ui.screens.settings

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.api.parseErrorDetail
import com.dilarion.app.data.model.AccountDeletionRequestCreate
import com.dilarion.app.data.model.MasterToken2FADisableRequest
import com.dilarion.app.data.model.MasterToken2FAEnableRequest
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import javax.inject.Inject

data class SettingsUiState(
    val username: String = "",
    val publicKey: String = "",
    val hasMasterToken: Boolean = false,
    val exportedKey: String? = null,
    val exportError: String? = null,
    val twoFaEnabled: Boolean = false,
    val twoFaLoading: Boolean = false,
    val twoFaError: String? = null,
    val deletionStatus: String? = null,
    val deletionLoading: Boolean = false,
    val deletionError: String? = null,
    // AI Voice Decoy — enrolled sample, cloned server-side to speak decoys in
    // the user's own voice (see ApiService voice-identity endpoints).
    val voiceIdentityEnrolled: Boolean = false,
    val voiceIdentityLoading: Boolean = false,
    val voiceIdentityUploading: Boolean = false,
    val voiceIdentityError: String? = null,
    val isRecordingVoiceIdentity: Boolean = false,
    val voiceIdentityRecordingSeconds: Int = 0,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState

    init {
        viewModelScope.launch {
            val username = sessionManager.username.first() ?: ""
            val pubKey = sessionManager.publicKey.first() ?: ""
            val masterToken = sessionManager.masterToken.first()
            _uiState.value = _uiState.value.copy(
                username = username,
                publicKey = pubKey,
                hasMasterToken = !masterToken.isNullOrBlank(),
            )
        }
        refreshTwoFaStatus()
        refreshDeletionStatus()
        refreshVoiceIdentityStatus()
    }

    private var voiceIdentityRecorder: MediaRecorder? = null
    private var voiceIdentityFile: File? = null
    private var voiceIdentityTimerJob: kotlinx.coroutines.Job? = null

    private fun refreshVoiceIdentityStatus() {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            val username = sessionManager.username.first() ?: return@launch
            _uiState.value = _uiState.value.copy(voiceIdentityLoading = true)
            val enrolled = runCatching { apiService.getVoiceIdentity(bearer, username) }
                .getOrNull()?.isSuccessful ?: false
            _uiState.value = _uiState.value.copy(voiceIdentityEnrolled = enrolled, voiceIdentityLoading = false)
        }
    }

    fun startVoiceIdentityRecording(context: Context) {
        if (_uiState.value.isRecordingVoiceIdentity) return
        val outFile = File(context.cacheDir, "voice_identity_${System.currentTimeMillis()}.mp4")
        voiceIdentityFile = outFile
        @Suppress("DEPRECATION")
        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else MediaRecorder()
        recorder.apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setOutputFile(outFile.absolutePath)
            prepare()
            start()
        }
        voiceIdentityRecorder = recorder
        _uiState.value = _uiState.value.copy(isRecordingVoiceIdentity = true, voiceIdentityRecordingSeconds = 0, voiceIdentityError = null)
        voiceIdentityTimerJob = viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(1000)
                _uiState.value = _uiState.value.copy(voiceIdentityRecordingSeconds = _uiState.value.voiceIdentityRecordingSeconds + 1)
            }
        }
    }

    fun cancelVoiceIdentityRecording() {
        voiceIdentityTimerJob?.cancel()
        voiceIdentityTimerJob = null
        runCatching { voiceIdentityRecorder?.stop() }
        voiceIdentityRecorder?.release()
        voiceIdentityRecorder = null
        voiceIdentityFile?.delete()
        voiceIdentityFile = null
        _uiState.value = _uiState.value.copy(isRecordingVoiceIdentity = false, voiceIdentityRecordingSeconds = 0)
    }

    // Enough for a clean voice clone, short enough not to feel like a chore.
    private val minVoiceIdentitySeconds = 8

    fun stopAndUploadVoiceIdentity() {
        val recorder = voiceIdentityRecorder ?: return
        val file = voiceIdentityFile ?: return
        val seconds = _uiState.value.voiceIdentityRecordingSeconds
        voiceIdentityTimerJob?.cancel()
        voiceIdentityTimerJob = null
        runCatching { recorder.stop() }
        recorder.release()
        voiceIdentityRecorder = null
        _uiState.value = _uiState.value.copy(isRecordingVoiceIdentity = false, voiceIdentityRecordingSeconds = 0)

        if (seconds < minVoiceIdentitySeconds) {
            file.delete()
            _uiState.value = _uiState.value.copy(voiceIdentityError = "Recording too short — need at least ${minVoiceIdentitySeconds}s")
            return
        }

        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(voiceIdentityUploading = true, voiceIdentityError = null)
            runCatching {
                val requestFile = file.asRequestBody("audio/mp4".toMediaTypeOrNull())
                val filePart = MultipartBody.Part.createFormData("file", file.name, requestFile)
                val resp = apiService.uploadVoiceIdentity(bearer, filePart)
                file.delete()
                if (!resp.isSuccessful) {
                    throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to save voice sample (${resp.code()})"))
                }
                _uiState.value = _uiState.value.copy(voiceIdentityUploading = false, voiceIdentityEnrolled = true)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(voiceIdentityUploading = false, voiceIdentityError = e.message)
            }
        }
    }

    fun clearVoiceIdentityError() { _uiState.value = _uiState.value.copy(voiceIdentityError = null) }

    private fun refreshTwoFaStatus() {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            runCatching { apiService.getMasterToken2FAStatus(bearer) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(twoFaEnabled = resp.body()?.enabled ?: false)
                    }
                }
        }
    }

    private fun refreshDeletionStatus() {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            runCatching { apiService.getMyAccountDeletionStatus(bearer) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(deletionStatus = resp.body()?.status)
                    }
                }
        }
    }

    fun enableTwoFa(masterToken: String, twoFaPassword: String) {
        if (masterToken.isBlank() || twoFaPassword.length < 6) return
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(twoFaLoading = true, twoFaError = null)
            runCatching {
                val resp = apiService.enableMasterToken2FA(bearer, MasterToken2FAEnableRequest(masterToken, twoFaPassword))
                if (!resp.isSuccessful) {
                    throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to enable 2FA (${resp.code()})"))
                }
                _uiState.value = _uiState.value.copy(twoFaLoading = false, twoFaEnabled = true)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(twoFaLoading = false, twoFaError = e.message)
            }
        }
    }

    fun disableTwoFa(twoFaPassword: String) {
        if (twoFaPassword.isBlank()) return
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(twoFaLoading = true, twoFaError = null)
            runCatching {
                val resp = apiService.disableMasterToken2FA(bearer, MasterToken2FADisableRequest(twoFaPassword))
                if (!resp.isSuccessful) {
                    throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to disable 2FA (${resp.code()})"))
                }
                _uiState.value = _uiState.value.copy(twoFaLoading = false, twoFaEnabled = false)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(twoFaLoading = false, twoFaError = e.message)
            }
        }
    }

    fun clearTwoFaError() { _uiState.value = _uiState.value.copy(twoFaError = null) }

    fun requestAccountDeletion(reason: String?) {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(deletionLoading = true, deletionError = null)
            runCatching {
                val resp = apiService.requestAccountDeletion(bearer, AccountDeletionRequestCreate(reason?.takeIf { it.isNotBlank() }))
                if (!resp.isSuccessful) {
                    throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to submit request (${resp.code()})"))
                }
                _uiState.value = _uiState.value.copy(deletionLoading = false, deletionStatus = "pending")
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(deletionLoading = false, deletionError = e.message)
            }
        }
    }

    fun clearDeletionError() { _uiState.value = _uiState.value.copy(deletionError = null) }

    private suspend fun bearer(): String? {
        val token = sessionManager.sessionToken.first() ?: return null
        return "Bearer $token"
    }

    /**
     * Reveals this device's identity keypair so it can be imported on desktop.
     * Anyone holding this blob can read the user's messages, so it is released only
     * after the master token is re-entered and it is never sent to the server.
     */
    fun exportKey(masterTokenAttempt: String) {
        viewModelScope.launch {
            val saved = sessionManager.masterToken.first()
            if (saved.isNullOrBlank() || saved != masterTokenAttempt) {
                _uiState.value = _uiState.value.copy(
                    exportError = "Incorrect master token",
                    exportedKey = null,
                )
                return@launch
            }

            val priv = sessionManager.privateKey.first()
            val pub = sessionManager.publicKey.first()
            if (priv.isNullOrBlank()) {
                _uiState.value = _uiState.value.copy(
                    exportError = "No encryption key on this device",
                    exportedKey = null,
                )
                return@launch
            }

            val blob = JSONObject()
                .put("private_key", priv)
                .put("public_key", pub ?: "")
                .toString()

            _uiState.value = _uiState.value.copy(exportedKey = blob, exportError = null)
        }
    }

    fun clearExportedKey() {
        _uiState.value = _uiState.value.copy(exportedKey = null, exportError = null)
    }

    fun logout(onDone: () -> Unit) {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first()
            // Tell the server in the background, but never block logout on it — a slow
            // or unreachable network must not leave the user stuck signed in.
            if (token != null) {
                launch { runCatching { apiService.logout("Bearer $token") } }
            }
            runCatching { presenceService.disconnect() }
            sessionManager.clearSession()
            onDone()
        }
    }
}
