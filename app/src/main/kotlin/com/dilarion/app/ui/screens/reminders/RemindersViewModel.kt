package com.dilarion.app.ui.screens.reminders

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.api.parseErrorDetail
import com.dilarion.app.data.model.ReminderCreateRequest
import com.dilarion.app.data.model.ReminderItem
import com.dilarion.app.data.model.ReminderSnoozeRequest
import com.dilarion.app.reminders.ReminderAlarms
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.dilarion.app.utils.toUserMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject

data class RemindersUiState(
    val reminders: List<ReminderItem> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
    val busy: Boolean = false,
    val createError: String? = null,
    val showCreate: Boolean = false,
)

@HiltViewModel
class RemindersViewModel @Inject constructor(
    private val api: ApiService,
    private val session: SessionManager,
    private val presence: PresenceService,
    @ApplicationContext private val context: Context,
) : ViewModel() {

    private val _ui = MutableStateFlow(RemindersUiState())
    val ui: StateFlow<RemindersUiState> = _ui

    init {
        load()
        viewModelScope.launch {
            presence.events.collect { if (it.type == "reminder_due") load(quiet = true) }
        }
    }

    private suspend fun bearer(): String? = session.sessionToken.first()?.let { "Bearer $it" }

    fun load(quiet: Boolean = false) {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            if (!quiet) _ui.value = _ui.value.copy(loading = true, error = null)
            runCatching { api.listReminders(b) }
                .onSuccess { r ->
                    if (r.isSuccessful) {
                        val list = r.body()?.reminders.orEmpty()
                        _ui.value = _ui.value.copy(loading = false, reminders = list)
                        ReminderAlarms.sync(context, list)
                    } else _ui.value = _ui.value.copy(loading = false, error = "Couldn't load reminders")
                }
                .onFailure { e -> _ui.value = _ui.value.copy(loading = false, error = e.toUserMessage("Couldn't load reminders. Check your connection and try again.")) }
        }
    }

    fun openCreate(show: Boolean) { _ui.value = _ui.value.copy(showCreate = show, createError = null) }

    fun create(title: String, at: Instant, note: String?, recurrence: String?) {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _ui.value = _ui.value.copy(busy = true, createError = null)
            runCatching { api.createReminder(b, ReminderCreateRequest(title.trim(), at.toString(), note?.takeIf { it.isNotBlank() }, recurrence)) }
                .onSuccess { r ->
                    if (r.isSuccessful) { _ui.value = _ui.value.copy(busy = false, showCreate = false); load(quiet = true) }
                    else _ui.value = _ui.value.copy(busy = false, createError = r.errorBody().parseErrorDetail("Couldn't save the reminder"))
                }
                .onFailure { e -> _ui.value = _ui.value.copy(busy = false, createError = e.toUserMessage("Couldn't save the reminder.")) }
        }
    }

    private fun act(id: Int, call: suspend (String) -> retrofit2.Response<*>) {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            ReminderAlarms.cancel(context, id)
            runCatching { call(b) }
                .onSuccess { load(quiet = true) }
                .onFailure { e -> _ui.value = _ui.value.copy(error = e.toUserMessage("That didn't work. Try again.")) }
        }
    }

    fun snooze(id: Int, minutes: Int) = act(id) { api.snoozeReminder(it, id, ReminderSnoozeRequest(minutes)) }
    fun done(id: Int) = act(id) { api.completeReminder(it, id) }
    fun dismiss(id: Int) = act(id) { api.dismissReminder(it, id) }
    fun delete(id: Int) = act(id) { api.deleteReminder(it, id) }
}
