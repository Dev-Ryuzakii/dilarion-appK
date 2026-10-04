package com.dilarion.app.ui.screens.groups

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.CreateGroupRequest
import com.dilarion.app.data.model.Group
import com.dilarion.app.data.model.GroupInvite
import com.dilarion.app.data.model.GroupInvitePreview
import com.dilarion.app.data.model.GroupMember
import com.dilarion.app.data.model.GroupUpdateRequest
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.data.model.normalizeInviteCode
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject
import retrofit2.Response
import javax.inject.Inject

data class GroupManageUiState(
    val me: String = "",
    val users: List<UserInfo> = emptyList(),
    val group: Group? = null,
    val members: List<GroupMember> = emptyList(),
    val invite: GroupInvite? = null,
    val preview: GroupInvitePreview? = null,
    val busy: Boolean = false,
    val error: String? = null,
    /** Set once the group was created/joined — the screen navigates into it. */
    val openedGroup: Group? = null,
    /** The viewer left or deleted the group. */
    val gone: Boolean = false,
) {
    val iAmAdmin: Boolean get() = members.any { it.username == me && it.role == "admin" } || group?.myRole == "admin"
}

/**
 * Self-service groups — any user creates and runs their own groups from the
 * app, no admin website. The creator is the first group admin; group admins
 * edit info, set the disappearing timer, share the invite link / QR and
 * manage members.
 */
@HiltViewModel
class GroupManageViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
) : ViewModel() {

    private val _uiState = MutableStateFlow(GroupManageUiState())
    val uiState: StateFlow<GroupManageUiState> = _uiState

    private var groupId: Int? = null

    init {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(me = sessionManager.username.first() ?: "")
        }
        viewModelScope.launch {
            presenceService.events.collect { event ->
                if (event.type != "group_updated") return@collect
                val d = event.data ?: return@collect
                val gid = d.get("group_id")?.asInt
                if (gid != null && gid == groupId) {
                    val ev = d.get("event")?.asString
                    if (ev == "deleted" || ev == "removed") _uiState.value = _uiState.value.copy(gone = true)
                    else load(gid)
                }
            }
        }
    }

    private suspend fun bearer(): String? = sessionManager.sessionToken.first()?.let { "Bearer $it" }

    private fun errorOf(resp: Response<*>?, fallback: String): String {
        val raw = runCatching { resp?.errorBody()?.string() }.getOrNull()
        return runCatching { JSONObject(raw ?: "").optString("detail") }.getOrNull()?.takeIf { it.isNotBlank() } ?: fallback
    }

    fun clearError() { _uiState.value = _uiState.value.copy(error = null) }

    fun loadUsers() {
        if (_uiState.value.users.isNotEmpty()) return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            val users = runCatching { apiService.getUsers(b).body() }.getOrNull().orEmpty()
            _uiState.value = _uiState.value.copy(users = users)
        }
    }

    fun load(gid: Int) {
        groupId = gid
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            val group = runCatching { apiService.getGroup(b, gid).body() }.getOrNull()
            val members = runCatching { apiService.getGroupMembers(b, gid).body() }.getOrNull().orEmpty()
            _uiState.value = _uiState.value.copy(group = group ?: _uiState.value.group, members = members)
        }
    }

    fun createGroup(name: String, description: String, members: List<String>, timerHours: Int?) {
        if (name.isBlank()) { _uiState.value = _uiState.value.copy(error = "Give the group a name"); return }
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true, error = null)
            val resp = runCatching {
                apiService.createGroup(b, CreateGroupRequest(name.trim(), members, description.trim().ifBlank { null }, timerHours))
            }.getOrNull()
            val g = resp?.body()
            _uiState.value = if (resp?.isSuccessful == true && g != null) _uiState.value.copy(busy = false, openedGroup = g)
            else _uiState.value.copy(busy = false, error = errorOf(resp, "Failed to create group"))
        }
    }

    fun previewInvite(code: String) {
        if (code.isBlank()) return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true, error = null, preview = null)
            val resp = runCatching { apiService.previewGroupInvite(b, normalizeInviteCode(code)) }.getOrNull()
            _uiState.value = if (resp?.isSuccessful == true) _uiState.value.copy(busy = false, preview = resp.body())
            else _uiState.value.copy(busy = false, error = errorOf(resp, "Invite link is invalid or has been reset"))
        }
    }

    fun joinInvite(code: String) {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true, error = null)
            val resp = runCatching { apiService.joinGroupViaInvite(b, normalizeInviteCode(code)) }.getOrNull()
            val g = resp?.body()
            _uiState.value = if (resp?.isSuccessful == true && g != null) _uiState.value.copy(busy = false, openedGroup = g)
            else _uiState.value.copy(busy = false, error = errorOf(resp, "Failed to join group"))
        }
    }

    fun saveInfo(name: String, description: String) {
        val gid = groupId ?: return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            val resp = runCatching {
                apiService.updateGroup(b, gid, GroupUpdateRequest(name = name.trim(), description = description.trim()))
            }.getOrNull()
            _uiState.value = if (resp?.isSuccessful == true) _uiState.value.copy(group = resp.body())
            else _uiState.value.copy(error = errorOf(resp, "Failed to save"))
        }
    }

    fun setTimer(hours: Int?) {
        val gid = groupId ?: return
        if (hours == _uiState.value.group?.disappearAfterHours) return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            val req = if (hours == null) GroupUpdateRequest(clearDisappear = true) else GroupUpdateRequest(disappearAfterHours = hours)
            val resp = runCatching { apiService.updateGroup(b, gid, req) }.getOrNull()
            _uiState.value = if (resp?.isSuccessful == true) _uiState.value.copy(group = resp.body())
            else _uiState.value.copy(error = errorOf(resp, "Failed to change timer"))
        }
    }

    fun loadInvite(reset: Boolean = false) {
        val gid = groupId ?: return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            val resp = runCatching {
                if (reset) apiService.resetGroupInvite(b, gid) else apiService.getGroupInvite(b, gid)
            }.getOrNull()
            _uiState.value = if (resp?.isSuccessful == true) _uiState.value.copy(invite = resp.body())
            else _uiState.value.copy(error = errorOf(resp, "Failed to load invite link"))
        }
    }

    private fun memberAction(fallback: String, call: suspend (String, Int) -> Response<*>) {
        val gid = groupId ?: return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true, error = null)
            val resp = runCatching { call(b, gid) }.getOrNull()
            _uiState.value = _uiState.value.copy(busy = false, error = if (resp?.isSuccessful == true) null else errorOf(resp, fallback))
            load(gid)
        }
    }

    fun addMembers(usernames: List<String>) {
        val gid = groupId ?: return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _uiState.value = _uiState.value.copy(busy = true, error = null)
            var failure: String? = null
            for (u in usernames) {
                val resp = runCatching { apiService.addGroupMember(b, gid, u) }.getOrNull()
                if (resp?.isSuccessful != true) failure = errorOf(resp, "Failed to add $u")
            }
            _uiState.value = _uiState.value.copy(busy = false, error = failure)
            load(gid)
        }
    }

    fun promote(username: String) = memberAction("Failed to make admin") { b, gid -> apiService.promoteGroupMember(b, gid, username) }
    fun demote(username: String) = memberAction("Failed to dismiss admin") { b, gid -> apiService.demoteGroupMember(b, gid, username) }
    fun remove(username: String) = memberAction("Failed to remove $username") { b, gid -> apiService.removeGroupMember(b, gid, username) }

    fun leave() {
        val gid = groupId ?: return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            val resp = runCatching { apiService.leaveGroup(b, gid) }.getOrNull()
            _uiState.value = if (resp?.isSuccessful == true) _uiState.value.copy(gone = true)
            else _uiState.value.copy(error = errorOf(resp, "Failed to leave group"))
        }
    }

    fun deleteGroup() {
        val gid = groupId ?: return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            val resp = runCatching { apiService.deleteGroup(b, gid) }.getOrNull()
            _uiState.value = if (resp?.isSuccessful == true) _uiState.value.copy(gone = true)
            else _uiState.value.copy(error = errorOf(resp, "Failed to delete group"))
        }
    }
}
