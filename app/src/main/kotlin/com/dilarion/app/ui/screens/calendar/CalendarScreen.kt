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
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.dilarion.app.ui.theme.BorderGrey
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.DilarionRedLight
import com.dilarion.app.ui.theme.DilarionRedSoft
import com.dilarion.app.ui.theme.SurfaceWhite
import com.dilarion.app.ui.theme.TextMuted
import com.dilarion.app.ui.theme.TextPrimary
import com.dilarion.app.ui.theme.TextSecondary
import java.time.format.DateTimeFormatter
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

private val WEEKDAY_ORDER = listOf(
    DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY,
)

/** Month grid over the same scheduled-meetings data as the Meetings tab -
 * mirrors the desktop Calendar tab's layout and interaction (tap a day to
 * see its meetings, tap a meeting to join through the same lobby flow). */
@Composable
fun CalendarScreen(
    onJoinMeeting: (joinCode: String, title: String?) -> Unit,
    viewModel: CalendarViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var selectedDay by remember { mutableStateOf(LocalDate.now()) }
    val today = LocalDate.now()

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
    val selectedOccs = occurrencesByDay[selectedDay].orEmpty().sortedBy { it.occurrenceStart }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    state.cursor.month.getDisplayName(TextStyle.FULL, Locale.getDefault()),
                    fontWeight = FontWeight.Bold, fontSize = 20.sp, color = TextPrimary,
                )
                Spacer(Modifier.width(6.dp))
                Text("${state.cursor.year}", fontSize = 20.sp, color = TextMuted)
                Spacer(Modifier.weight(1f))
                if (state.cursor != YearMonth.now() || selectedDay != today) {
                    Text(
                        "Today",
                        fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = DilarionRed,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(DilarionRedSoft)
                            .clickable { viewModel.setMonth(YearMonth.now()); selectedDay = today }
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                }
                RoundNav("‹") { viewModel.setMonth(state.cursor.minusMonths(1)) }
                Spacer(Modifier.width(6.dp))
                RoundNav("›") { viewModel.setMonth(state.cursor.plusMonths(1)) }
            }
        }

        item {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(SurfaceWhite)
                    .border(1.dp, BorderGrey, RoundedCornerShape(18.dp)).padding(horizontal = 6.dp, vertical = 10.dp),
            ) {
                Row(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                    WEEKDAY_ORDER.forEach { dow ->
                        Text(
                            dow.getDisplayName(TextStyle.NARROW, Locale.getDefault()),
                            modifier = Modifier.weight(1f),
                            textAlign = TextAlign.Center,
                            fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = TextMuted,
                        )
                    }
                }
                days.chunked(7).forEach { week ->
                    Row(Modifier.fillMaxWidth()) {
                        week.forEach { day ->
                            DayCell(
                                day = day,
                                inMonth = YearMonth.from(day) == state.cursor,
                                isToday = day == today,
                                isSelected = day == selectedDay,
                                count = occurrencesByDay[day]?.size ?: 0,
                                modifier = Modifier.weight(1f),
                                onClick = { selectedDay = day },
                            )
                        }
                    }
                }
                if (state.isLoading) {
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 4.dp).clip(RoundedCornerShape(50)),
                        color = DilarionRed, trackColor = DilarionRedSoft,
                    )
                }
            }
        }

        item {
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(
                    Modifier.size(48.dp).clip(RoundedCornerShape(14.dp))
                        .background(if (selectedDay == today) DilarionRed else DilarionRedSoft),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    val onTile = if (selectedDay == today) SurfaceWhite else DilarionRed
                    Text(
                        selectedDay.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault()).uppercase(),
                        fontSize = 10.sp, fontWeight = FontWeight.Bold, color = onTile,
                    )
                    Text("${selectedDay.dayOfMonth}", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = onTile)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(
                        when (selectedDay) {
                            today -> "Today"
                            today.plusDays(1) -> "Tomorrow"
                            else -> selectedDay.format(DateTimeFormatter.ofPattern("EEEE"))
                        },
                        fontWeight = FontWeight.Bold, fontSize = 17.sp, color = TextPrimary,
                    )
                    Text(
                        selectedDay.format(DateTimeFormatter.ofPattern("MMMM d, yyyy")) +
                            " · " + when (selectedOccs.size) { 0 -> "nothing planned"; 1 -> "1 meeting"; else -> "${selectedOccs.size} meetings" },
                        fontSize = 13.sp, color = TextSecondary,
                    )
                }
            }
        }

        if (selectedOccs.isEmpty()) {
            item {
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xFFF6F7F9))
                        .padding(vertical = 22.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(Icons.Default.EventAvailable, null, tint = TextMuted, modifier = Modifier.size(26.dp))
                    Spacer(Modifier.height(6.dp))
                    Text("Your day is clear", fontWeight = FontWeight.Medium, color = TextSecondary, fontSize = 14.sp)
                }
            }
        }
        items(selectedOccs, key = { "${it.meetingId}-${it.occurrenceStart}" }) { occ ->
            CalendarOccurrenceCard(occ, onJoin = { onJoinMeeting(occ.joinCode, occ.title) })
        }
    }
}

@Composable
private fun RoundNav(label: String, onClick: () -> Unit) {
    Box(
        Modifier.size(34.dp).clip(CircleShape).border(1.dp, BorderGrey, CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(label, fontSize = 20.sp, color = TextPrimary, modifier = Modifier.padding(bottom = 2.dp)) }
}

@Composable
private fun DayCell(
    day: LocalDate,
    inMonth: Boolean,
    isToday: Boolean,
    isSelected: Boolean,
    count: Int,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Column(
        modifier.height(50.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(34.dp).clip(CircleShape).background(
                when {
                    isToday -> DilarionRed
                    isSelected -> DilarionRedSoft
                    else -> Color.Transparent
                },
            ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "${day.dayOfMonth}",
                fontSize = 14.sp,
                fontWeight = if (isToday || isSelected) FontWeight.Bold else FontWeight.Normal,
                color = when {
                    isToday -> SurfaceWhite
                    isSelected -> DilarionRed
                    !inMonth -> Color(0xFFD1D5DB)
                    else -> TextPrimary
                },
            )
        }
        Row(Modifier.height(6.dp).padding(top = 2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            repeat(count.coerceAtMost(3)) {
                Box(Modifier.size(4.dp).clip(CircleShape).background(if (inMonth) DilarionRed else DilarionRedLight))
            }
        }
    }
}

@Composable
private fun CalendarOccurrenceCard(occ: CalendarOccurrence, onJoin: () -> Unit) {
    val start = parseIsoToZoned(occ.occurrenceStart)
    val end = start.plusMinutes(occ.durationMinutes.toLong())
    val clock = DateTimeFormatter.ofPattern("h:mm a")
    val live = occ.status.equals("live", ignoreCase = true)
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(SurfaceWhite)
            .border(1.dp, BorderGrey, RoundedCornerShape(16.dp)).clickable(onClick = onJoin).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).height(44.dp).clip(RoundedCornerShape(2.dp)).background(DilarionRed))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                occ.title ?: "Meeting", fontWeight = FontWeight.SemiBold, fontSize = 15.sp, color = TextPrimary,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${start.format(clock)} – ${end.format(clock)}" + (occ.recurrence?.let { " · repeats $it" } ?: ""),
                fontSize = 12.sp, color = TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text("Host: ${occ.creatorUsername}", fontSize = 12.sp, color = TextMuted)
        }
        Spacer(Modifier.width(8.dp))
        Text(
            if (live) "Join · LIVE" else "Join",
            fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            color = if (live) SurfaceWhite else DilarionRed,
            modifier = Modifier.clip(RoundedCornerShape(50)).background(if (live) DilarionRed else DilarionRedSoft)
                .clickable(onClick = onJoin).padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}
