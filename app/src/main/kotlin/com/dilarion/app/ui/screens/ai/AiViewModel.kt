package com.dilarion.app.ui.screens.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.api.parseErrorDetail
import com.dilarion.app.data.model.*
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import com.dilarion.app.utils.toUserMessage
import com.google.gson.Gson
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class AiTab { CHAT, AGENTS }

data class AiUiState(
    val tab: AiTab = AiTab.CHAT,
    val conversations: List<AiConversation> = emptyList(),
    val currentId: Int? = null,
    val currentTitle: String = "New chat",
    val messages: List<AiChatMessage> = emptyList(),
    val runs: Map<Int, AgentRun> = emptyMap(),
    val loading: Boolean = false,
    val sending: Boolean = false,
    val autoApprove: Boolean = false,
    val error: String? = null,
)

/** Turn a pushed `ai_agent_*` payload into a run. */
fun agentRunFrom(gson: Gson, data: com.google.gson.JsonObject?): AgentRun? =
    data?.let { runCatching { gson.fromJson(it, AgentRun::class.java) }.getOrNull() }

@HiltViewModel
class AiViewModel @Inject constructor(
    private val api: ApiService,
    private val session: SessionManager,
    private val presence: PresenceService,
) : ViewModel() {
    private val gson = Gson()
    private val _ui = MutableStateFlow(AiUiState())
    val ui: StateFlow<AiUiState> = _ui

    init {
        refresh()
        viewModelScope.launch {
            presence.events.collect { e ->
                if (e.type == "ai_agent_progress" || e.type == "ai_agent_finished") {
                    agentRunFrom(gson, e.data)?.let { upsertRun(it) }
                }
            }
        }
    }

    private suspend fun bearer(): String? = session.sessionToken.first()?.let { "Bearer $it" }
    private fun upsertRun(run: AgentRun) { _ui.value = _ui.value.copy(runs = _ui.value.runs + (run.id to run)) }
    private fun fail(e: Throwable, msg: String) { _ui.value = _ui.value.copy(loading = false, sending = false, error = e.toUserMessage(msg)) }
    fun clearError() { _ui.value = _ui.value.copy(error = null) }
    fun setTab(t: AiTab) { _ui.value = _ui.value.copy(tab = t) }

    fun refresh() {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _ui.value = _ui.value.copy(loading = true)
            runCatching {
                val convs = api.listAiConversations(b).body()?.conversations.orEmpty()
                val runs = api.listAgentRuns(b).body()?.runs.orEmpty()
                val prefs = api.getAiPreferences(b).body()
                Triple(convs, runs, prefs)
            }.onSuccess { (convs, runs, prefs) ->
                _ui.value = _ui.value.copy(loading = false, conversations = convs,
                    runs = _ui.value.runs + runs.associateBy { it.id },
                    autoApprove = prefs?.autoApprove ?: _ui.value.autoApprove)
            }.onFailure { fail(it, "Couldn't load the AI page. Check your connection.") }
        }
    }

    fun newChat() { _ui.value = _ui.value.copy(currentId = null, currentTitle = "New chat", messages = emptyList(), tab = AiTab.CHAT) }

    fun open(id: Int) {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _ui.value = _ui.value.copy(loading = true, tab = AiTab.CHAT)
            runCatching { api.getAiConversation(b, id) }
                .onSuccess { r ->
                    val c = r.body()
                    if (r.isSuccessful && c != null) {
                        _ui.value = _ui.value.copy(loading = false, currentId = c.id, currentTitle = c.title, messages = c.messages.orEmpty())
                        c.messages.orEmpty().mapNotNull { it.agentRunId }.filter { it !in _ui.value.runs }.forEach { loadRun(it) }
                    } else _ui.value = _ui.value.copy(loading = false, error = "Couldn't open that chat")
                }
                .onFailure { fail(it, "Couldn't open that chat.") }
        }
    }

    private fun loadRun(id: Int) {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            runCatching { api.getAgentRun(b, id).body() }.getOrNull()?.let { upsertRun(it) }
        }
    }

    fun delete(id: Int) {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            runCatching { api.deleteAiConversation(b, id) }
            _ui.value = _ui.value.copy(conversations = _ui.value.conversations.filterNot { it.id == id })
            if (_ui.value.currentId == id) newChat()
        }
    }

    fun send(text: String) {
        val body = text.trim()
        if (body.isEmpty() || _ui.value.sending) return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            val pending = AiChatMessage(id = -1, role = "user", content = body)
            _ui.value = _ui.value.copy(sending = true, messages = _ui.value.messages + pending)
            runCatching {
                val id = _ui.value.currentId ?: api.createAiConversation(b, AiConversationCreateRequest()).body()?.id
                    ?: error("couldn't start a chat")
                id to api.sendAiMessage(b, id, AiSendRequest(body))
            }.onSuccess { (id, r) ->
                val res = r.body()
                if (r.isSuccessful && res != null) {
                    res.agentRun?.let { upsertRun(it) }
                    val title = res.title ?: _ui.value.currentTitle
                    _ui.value = _ui.value.copy(
                        sending = false, currentId = id, currentTitle = title,
                        messages = _ui.value.messages.filterNot { it.id == -1 } + res.userMessage + res.assistantMessage,
                        conversations = listOf(AiConversation(id, title)) + _ui.value.conversations.filterNot { it.id == id },
                    )
                } else {
                    _ui.value = _ui.value.copy(sending = false, messages = _ui.value.messages.filterNot { it.id == -1 },
                        error = r.errorBody().parseErrorDetail("The assistant couldn't answer. Try again."))
                }
            }.onFailure {
                _ui.value = _ui.value.copy(messages = _ui.value.messages.filterNot { m -> m.id == -1 })
                fail(it, "The assistant couldn't answer. Try again.")
            }
        }
    }

    fun startAgent(instruction: String) {
        val body = instruction.trim()
        if (body.isEmpty()) return
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            _ui.value = _ui.value.copy(sending = true)
            runCatching { api.startAgent(b, AgentStartRequest(body, requireApproval = true)) }
                .onSuccess { r ->
                    r.body()?.let { upsertRun(it) }
                    _ui.value = _ui.value.copy(sending = false,
                        error = if (r.isSuccessful) null else r.errorBody().parseErrorDetail("Couldn't start the agent"))
                }
                .onFailure { fail(it, "Couldn't start the agent.") }
        }
    }

    fun approve(id: Int) = runAction { api.approveAgent(it, id) }
    fun cancel(id: Int) = runAction { api.cancelAgent(it, id) }

    private fun runAction(call: suspend (String) -> retrofit2.Response<AgentRun>) {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            runCatching { call(b) }
                .onSuccess { r -> r.body()?.let { upsertRun(it) } ?: run { _ui.value = _ui.value.copy(error = r.errorBody().parseErrorDetail("That didn't work")) } }
                .onFailure { fail(it, "That didn't work. Try again.") }
        }
    }

    fun setAutoApprove(on: Boolean) {
        viewModelScope.launch {
            val b = bearer() ?: return@launch
            val before = _ui.value.autoApprove
            _ui.value = _ui.value.copy(autoApprove = on)
            runCatching { api.setAiPreferences(b, AiPreferencesUpdate(autoApprove = on)) }
                .onSuccess { r -> if (!r.isSuccessful) _ui.value = _ui.value.copy(autoApprove = before, error = "Couldn't change Full control") }
                .onFailure { _ui.value = _ui.value.copy(autoApprove = before); fail(it, "Couldn't change Full control.") }
        }
    }
}
