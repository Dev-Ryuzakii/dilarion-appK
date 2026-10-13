package com.dilarion.app.ui.screens.security

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.api.parseErrorDetail
import com.dilarion.app.data.model.MasterToken2FAEnableRequest
import com.dilarion.app.data.model.MasterTokenRequest
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import javax.inject.Inject

enum class SetupStep { VOICE, MASTER, TWOFA }

data class SecuritySetupUiState(
    val loading: Boolean = true,
    val steps: List<SetupStep> = emptyList(),
    val index: Int = 0,
    val done: Boolean = false,
    val error: String? = null,
    // voice
    val recording: Boolean = false,
    val recordSeconds: Int = 0,
    val uploading: Boolean = false,
    // master / 2fa
    val busy: Boolean = false,
) {
    val current: SetupStep? get() = steps.getOrNull(index)
    val stepNumber: Int get() = index + 1
    val total: Int get() = steps.size
}

@HiltViewModel
class SecuritySetupViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SecuritySetupUiState())
    val uiState: StateFlow<SecuritySetupUiState> = _uiState

    private var pendingMaster: String? = null
    private var recorder: MediaRecorder? = null
    private var recordFile: File? = null
    private var timerJob: Job? = null
    private val minSeconds = 8

    init {
        viewModelScope.launch {
            val bearer = bearer()
            val username = sessionManager.username.first()
            if (bearer == null || username == null) {
                _uiState.value = _uiState.value.copy(loading = false, done = true)
                return@launch
            }
            val voice = runCatching { apiService.getVoiceIdentity(bearer, username) }.getOrNull()?.isSuccessful ?: false
            val mt = runCatching { apiService.getMasterTokenStatus(bearer) }.getOrNull()?.body()
            val exists = mt?.exists ?: false
            val twofa = mt?.twofaEnabled ?: (runCatching { apiService.getMasterToken2FAStatus(bearer) }.getOrNull()?.body()?.enabled ?: false)

            val steps = buildList {
                if (!voice) add(SetupStep.VOICE)
                if (!exists) add(SetupStep.MASTER)
                if (!twofa) add(SetupStep.TWOFA)
            }
            _uiState.value = _uiState.value.copy(loading = false, steps = steps, done = steps.isEmpty())
        }
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    private fun advance() {
        val next = _uiState.value.index + 1
        _uiState.value = _uiState.value.copy(index = next, done = next >= _uiState.value.steps.size, error = null)
    }

    fun skip() = advance()

    // ── Voice ────────────────────────────────────────────────────────────────
    fun startRecording(context: Context) {
        if (_uiState.value.recording) return
        val out = File(context.cacheDir, "voice_identity_${System.currentTimeMillis()}.mp4")
        recordFile = out
        @Suppress("DEPRECATION")
        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else MediaRecorder()
        try {
            r.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setOutputFile(out.absolutePath)
                prepare()
                start()
            }
        } catch (e: Exception) {
            _uiState.value = _uiState.value.copy(error = "Microphone not available. Allow mic access and try again.")
            runCatching { r.release() }
            return
        }
        recorder = r
        _uiState.value = _uiState.value.copy(recording = true, recordSeconds = 0, error = null)
        timerJob = viewModelScope.launch {
            while (true) {
                delay(1000)
                val s = _uiState.value.recordSeconds + 1
                _uiState.value = _uiState.value.copy(recordSeconds = s)
                if (s >= 12) { stopAndUpload() ; break }   // auto-stop at 12s
            }
        }
    }

    fun stopAndUpload() {
        val r = recorder ?: return
        val file = recordFile ?: return
        val seconds = _uiState.value.recordSeconds
        timerJob?.cancel(); timerJob = null
        runCatching { r.stop() }
        r.release()
        recorder = null
        _uiState.value = _uiState.value.copy(recording = false, recordSeconds = 0)
        if (seconds < minSeconds) {
            file.delete()
            _uiState.value = _uiState.value.copy(error = "Recording too short — hold for at least ${minSeconds}s")
            return
        }
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(uploading = true, error = null)
            runCatching {
                val body = file.asRequestBody("audio/mp4".toMediaTypeOrNull())
                val part = MultipartBody.Part.createFormData("file", file.name, body)
                val resp = apiService.uploadVoiceIdentity(bearer, part)
                file.delete()
                if (!resp.isSuccessful) throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to save voice sample (${resp.code()})"))
            }.onSuccess {
                _uiState.value = _uiState.value.copy(uploading = false)
                advance()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(uploading = false, error = e.message)
            }
        }
    }

    fun cancelRecording() {
        timerJob?.cancel(); timerJob = null
        runCatching { recorder?.stop() }
        recorder?.release(); recorder = null
        recordFile?.delete(); recordFile = null
        _uiState.value = _uiState.value.copy(recording = false, recordSeconds = 0)
    }

    // ── Master token ───────────────────────────────────────────────────────
    fun setMasterToken(value: String, confirm: String) {
        val v = value.trim()
        if (v.length < 8) { _uiState.value = _uiState.value.copy(error = "Master token must be at least 8 characters"); return }
        if (v != confirm.trim()) { _uiState.value = _uiState.value.copy(error = "The two entries do not match"); return }
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true, error = null)
            runCatching {
                val resp = apiService.createMasterToken(bearer, MasterTokenRequest(v))
                if (!resp.isSuccessful) throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to set master token (${resp.code()})"))
            }.onSuccess {
                pendingMaster = v
                sessionManager.saveMasterToken(v)
                _uiState.value = _uiState.value.copy(busy = false)
                advance()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(busy = false, error = e.message)
            }
        }
    }

    // ── 2FA ───────────────────────────────────────────────────────────────
    fun presetMaster(): String? = pendingMaster

    fun enable2fa(master: String, password: String, confirm: String) {
        val m = master.trim()
        if (m.isEmpty()) { _uiState.value = _uiState.value.copy(error = "Enter your master token"); return }
        if (password.trim().length < 6) { _uiState.value = _uiState.value.copy(error = "2FA password must be at least 6 characters"); return }
        if (password.trim() != confirm.trim()) { _uiState.value = _uiState.value.copy(error = "The two passwords do not match"); return }
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true, error = null)
            runCatching {
                val confirmResp = apiService.confirmMasterToken(bearer, MasterTokenRequest(m))
                if (!confirmResp.isSuccessful) throw IllegalStateException("That master token is incorrect")
                val resp = apiService.enableMasterToken2FA(bearer, MasterToken2FAEnableRequest(m, password.trim()))
                if (!resp.isSuccessful) throw IllegalStateException(resp.errorBody().parseErrorDetail("Failed to enable 2FA (${resp.code()})"))
            }.onSuccess {
                _uiState.value = _uiState.value.copy(busy = false)
                advance()
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(busy = false, error = e.message)
            }
        }
    }

    private suspend fun bearer(): String? {
        val token = sessionManager.sessionToken.first() ?: return null
        return "Bearer $token"
    }

    override fun onCleared() {
        super.onCleared()
        timerJob?.cancel()
        runCatching { recorder?.release() }
    }
}
