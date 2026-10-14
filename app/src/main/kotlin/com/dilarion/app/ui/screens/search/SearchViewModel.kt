package com.dilarion.app.ui.screens.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.SearchResponse
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SearchUiState(
    val query: String = "",
    val loading: Boolean = false,
    val results: SearchResponse? = null,
)

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState
    private var job: Job? = null

    fun onQueryChange(q: String) {
        _uiState.value = _uiState.value.copy(query = q)
        job?.cancel()
        val t = q.trim()
        if (t.length < 2) {
            _uiState.value = _uiState.value.copy(results = null, loading = false)
            return
        }
        _uiState.value = _uiState.value.copy(loading = true)
        job = viewModelScope.launch {
            delay(250)  // debounce
            val bearer = sessionManager.sessionToken.first()?.let { "Bearer $it" } ?: return@launch
            val res = runCatching { apiService.search(bearer, t) }.getOrNull()
            if (_uiState.value.query.trim() == t) {
                _uiState.value = _uiState.value.copy(loading = false, results = res?.body())
            }
        }
    }
}
