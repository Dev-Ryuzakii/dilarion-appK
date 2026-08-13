package com.dilarion.app.ui.screens.calendar

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.api.ApiService
import com.dilarion.app.data.model.CalendarOccurrence
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZonedDateTime
import javax.inject.Inject

data class CalendarUiState(
    val cursor: YearMonth = YearMonth.now(),
    val occurrences: List<CalendarOccurrence> = emptyList(),
    val isLoading: Boolean = true,
)

@HiltViewModel
class CalendarViewModel @Inject constructor(
    private val apiService: ApiService,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(CalendarUiState())
    val uiState: StateFlow<CalendarUiState> = _uiState

    init {
        load()
    }

    fun setMonth(month: YearMonth) {
        _uiState.value = _uiState.value.copy(cursor = month)
        load()
    }

    private fun load() {
        viewModelScope.launch {
            val token = sessionManager.sessionToken.first() ?: return@launch
            _uiState.value = _uiState.value.copy(isLoading = true)
            val month = _uiState.value.cursor
            val zone = ZoneId.systemDefault()
            // Pad to full weeks (Sunday-start), same grid convention as the
            // desktop calendar view, so recurring meetings landing just
            // outside the strict month bounds still show on the visible grid.
            val monthStart = month.atDay(1).atStartOfDay(zone)
            val monthEnd = month.atEndOfMonth().atTime(23, 59, 59).atZone(zone)
            val gridStart = monthStart.minusDays(monthStart.dayOfWeek.value % 7L)
            val gridEnd = monthEnd.plusDays((6 - monthEnd.dayOfWeek.value % 7).toLong())

            runCatching {
                apiService.getMeetingCalendar(
                    "Bearer $token",
                    gridStart.toInstant().toString(),
                    gridEnd.toInstant().toString(),
                ).body()?.occurrences ?: emptyList()
            }.onSuccess { occ ->
                _uiState.value = _uiState.value.copy(occurrences = occ, isLoading = false)
            }.onFailure {
                _uiState.value = _uiState.value.copy(isLoading = false)
            }
        }
    }
}

// Instant.parse() requires a strict 'Z' suffix and rejects Python's
// datetime.isoformat() output ("+00:00" offset form), so every occurrence
// would silently fail to parse. OffsetDateTime.parse handles both offset
// forms and any fractional-second precision.
fun parseIsoToZoned(iso: String): ZonedDateTime =
    java.time.OffsetDateTime.parse(iso).toZonedDateTime().withZoneSameInstant(ZoneId.systemDefault())
