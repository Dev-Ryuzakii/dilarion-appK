package com.dilarion.app.ui.screens.calendar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.CalendarOccurrence
import com.dilarion.app.ui.theme.DilarionRed
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

private val WEEKDAY_ORDER = listOf(
    DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY,
)

/** Month grid over the same scheduled-meetings data as the Meetings tab —
 * mirrors the desktop Calendar tab's layout and interaction (tap a day to
 * see its meetings, tap a meeting to join through the same lobby flow). */
@Composable
fun CalendarScreen(
    onJoinMeeting: (joinCode: String, title: String?) -> Unit,
    viewModel: CalendarViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var selectedDay by remember { mutableStateOf(LocalDate.now()) }

    val monthStart = state.cursor.atDay(1)
    val monthEnd = state.cursor.atEndOfMonth()
    val gridStart = monthStart.minusDays((monthStart.dayOfWeek.value % 7).toLong())
    val gridEnd = monthEnd.plusDays((6 - monthEnd.dayOfWeek.value % 7).toLong())
    val days = remember(gridStart, gridEnd) {
        generateSequence(gridStart) { it.plusDays(1) }.takeWhile { !it.isAfter(gridEnd) }.toList()
    }

    val occurrencesByDay = remember(state.occurrences) {
        state.occurrences.groupBy { parseIsoToZoned(it.occurrenceStart).toLocalDate() }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Toolbar
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "${state.cursor.month.getDisplayName(TextStyle.FULL, Locale.getDefault())} ${state.cursor.year}",
                fontWeight = FontWeight.Bold, fontSize = 17.sp,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { viewModel.setMonth(YearMonth.now()); selectedDay = LocalDate.now() }) { Text("Today") }
                IconButton(onClick = { viewModel.setMonth(state.cursor.minusMonths(1)) }) { Text("‹", fontSize = 20.sp) }
                IconButton(onClick = { viewModel.setMonth(state.cursor.plusMonths(1)) }) { Text("›", fontSize = 20.sp) }
            }
        }

        // Weekday header
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
            WEEKDAY_ORDER.forEach { dow ->
                Text(
                    dow.getDisplayName(TextStyle.SHORT, Locale.getDefault()),
                    modifier = Modifier.weight(1f),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.Gray,
                )
            }
        }

        // Month grid — chunked into weeks
        Column(modifier = Modifier.fillMaxWidth().padding(8.dp)) {
            days.chunked(7).forEach { week ->
                Row(modifier = Modifier.fillMaxWidth()) {
                    week.forEach { day ->
                        val inMonth = YearMonth.from(day) == state.cursor
                        val isToday = day == LocalDate.now()
                        val isSelected = day == selectedDay
                        val dayOccs = occurrencesByDay[day].orEmpty()
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .padding(2.dp)
                                .heightIn(min = 56.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (isSelected) DilarionRed.copy(alpha = 0.12f) else Color.Transparent)
                                .clickable { selectedDay = day }
                                .padding(4.dp),
                        ) {
                            Text(
                                "${day.dayOfMonth}",
                                fontSize = 12.sp,
                                fontWeight = if (isToday) FontWeight.Black else FontWeight.Normal,
                                color = when {
                                    isToday -> DilarionRed
                                    !inMonth -> Color.LightGray
                                    else -> Color.Black
                                },
                            )
                            if (dayOccs.isNotEmpty()) {
                                Box(
                                    modifier = Modifier
                                        .padding(top = 2.dp)
                                        .size(6.dp)
                                        .clip(RoundedCornerShape(50))
                                        .background(DilarionRed),
                                )
                            }
                        }
                    }
                }
            }
        }

        if (state.isLoading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DilarionRed)
        }

        Divider()

        // Selected day list
        val selectedOccs = occurrencesByDay[selectedDay].orEmpty().sortedBy { it.occurrenceStart }
        LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f).padding(12.dp)) {
            item {
                Text(
                    selectedDay.format(java.time.format.DateTimeFormatter.ofPattern("EEEE, MMMM d")),
                    fontWeight = FontWeight.Bold, fontSize = 14.sp,
                    modifier = Modifier.padding(bottom = 10.dp),
                )
            }
            if (selectedOccs.isEmpty()) {
                item { Text("No meetings.", color = Color.Gray, fontSize = 13.sp) }
            }
            items(selectedOccs) { occ -> CalendarOccurrenceCard(occ, onClick = { onJoinMeeting(occ.joinCode, occ.title) }) }
        }
    }
}

@Composable
private fun CalendarOccurrenceCard(occ: CalendarOccurrence, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F5F5)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(occ.title ?: "Meeting", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            val time = parseIsoToZoned(occ.occurrenceStart)
            Text(
                "${time.format(java.time.format.DateTimeFormatter.ofPattern("h:mm a"))} · ${occ.durationMinutes}min" +
                    (occ.recurrence?.let { " · repeats $it" } ?: ""),
                fontSize = 12.sp, color = Color.Gray,
            )
            Text("Host: ${occ.creatorUsername}", fontSize = 11.sp, color = Color.Gray)
        }
    }
}
