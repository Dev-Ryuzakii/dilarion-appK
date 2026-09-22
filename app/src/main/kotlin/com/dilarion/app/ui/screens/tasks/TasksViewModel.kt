package com.dilarion.app.ui.screens.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.api.parseErrorDetail
import com.dilarion.app.data.model.Group
import com.dilarion.app.data.model.TaskBreakoutGroupCreate
import com.dilarion.app.data.model.TaskCreateRequest
import com.dilarion.app.data.model.TaskGroupReportSubmitRequest
import com.dilarion.app.data.model.TaskItem
import com.dilarion.app.data.model.TaskStatusUpdateRequest
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class TaskStatusFilter { ALL, OPEN, IN_PROGRESS, COMPLETED, CANCELLED }

data class TasksUiState(
    val tasks: List<TaskItem> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val filter: TaskStatusFilter = TaskStatusFilter.ALL,
    val selectedTaskId: Int? = null,
    val showCreate: Boolean = false,
    val users: List<UserInfo> = emptyList(),
    val groups: List<Group> = emptyList(),
    val currentUsername: String = "",
    val busy: Boolean = false,
    val createError: String? = null,
)

@HiltViewModel
class TasksViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TasksUiState())
    val uiState: StateFlow<TasksUiState> = _uiState

    init {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(currentUsername = sessionManager.username.first() ?: "")
        }
        loadTasks()
    }

    private suspend fun bearer(): String? {
        val token = sessionManager.sessionToken.first() ?: return null
        return "Bearer $token"
    }

    fun loadTasks() {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            runCatching { apiService.listTasks(bearer) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(loading = false, tasks = resp.body()?.tasks ?: emptyList())
                    } else {
                        _uiState.value = _uiState.value.copy(loading = false, error = "Failed to load tasks")
                    }
                }
                .onFailure { e -> _uiState.value = _uiState.value.copy(loading = false, error = e.message) }
        }
    }

    fun setFilter(filter: TaskStatusFilter) { _uiState.value = _uiState.value.copy(filter = filter) }

    fun selectTask(taskId: Int?) { _uiState.value = _uiState.value.copy(selectedTaskId = taskId) }

    fun openCreate() {
        _uiState.value = _uiState.value.copy(showCreate = true, createError = null)
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            val me = _uiState.value.currentUsername
            runCatching { apiService.getUsers(bearer) }
                .onSuccess { resp -> if (resp.isSuccessful) _uiState.value = _uiState.value.copy(users = resp.body()?.filter { it.username != me } ?: emptyList()) }
            runCatching { apiService.getMyGroups(bearer) }
                .onSuccess { resp -> if (resp.isSuccessful) _uiState.value = _uiState.value.copy(groups = resp.body() ?: emptyList()) }
        }
    }

    fun closeCreate() { _uiState.value = _uiState.value.copy(showCreate = false, createError = null) }

    fun createTask(
        title: String,
        description: String?,
        groupId: Int?,
        isBreakout: Boolean,
        assigneeUsernames: List<String>,
        breakoutGroups: List<TaskBreakoutGroupCreate>,
        recurrence: String?,
    ) {
        if (title.isBlank()) return
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true, createError = null)
            val req = TaskCreateRequest(
                title = title.trim(),
                description = description?.trim()?.ifBlank { null },
                groupId = groupId,
                assigneeUsernames = if (!isBreakout) assigneeUsernames else emptyList(),
                isBreakout = isBreakout,
                breakoutGroups = if (isBreakout) breakoutGroups.filter { it.usernames.isNotEmpty() } else null,
                recurrence = recurrence,
            )
            runCatching { apiService.createTask(bearer, req) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) {
                        _uiState.value = _uiState.value.copy(busy = false, showCreate = false)
                        loadTasks()
                    } else {
                        _uiState.value = _uiState.value.copy(busy = false, createError = resp.errorBody().parseErrorDetail("Failed to create task"))
                    }
                }
                .onFailure { e -> _uiState.value = _uiState.value.copy(busy = false, createError = e.message) }
        }
    }

    fun updateTaskStatus(taskId: Int, status: String) {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            runCatching { apiService.updateTaskStatus(bearer, taskId, TaskStatusUpdateRequest(status)) }
                .onSuccess { resp -> if (resp.isSuccessful) loadTasks() }
        }
    }

    fun updateMyStatus(taskId: Int, status: String) {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            runCatching { apiService.updateMyTaskStatus(bearer, taskId, TaskStatusUpdateRequest(status)) }
                .onSuccess { resp -> if (resp.isSuccessful) loadTasks() }
        }
    }

    fun submitBreakoutReport(taskId: Int, groupId: Int, text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true)
            runCatching { apiService.submitBreakoutReport(bearer, taskId, groupId, TaskGroupReportSubmitRequest(text.trim())) }
                .onSuccess { resp -> if (resp.isSuccessful) loadTasks() }
            _uiState.value = _uiState.value.copy(busy = false)
        }
    }

    fun compileTask(taskId: Int) {
        viewModelScope.launch {
            val bearer = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true, error = null)
            runCatching { apiService.compileTask(bearer, taskId) }
                .onSuccess { resp ->
                    if (resp.isSuccessful) loadTasks()
                    else _uiState.value = _uiState.value.copy(error = resp.errorBody().parseErrorDetail("Failed to compile report"))
                }
                .onFailure { e -> _uiState.value = _uiState.value.copy(error = e.message) }
            _uiState.value = _uiState.value.copy(busy = false)
        }
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }
}
