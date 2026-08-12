package com.dilarion.app.ui.screens.whiteboard

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.WhiteboardStroke
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite

private data class UiSegment(val x0: Float, val y0: Float, val x1: Float, val y1: Float, val color: Color, val width: Float)

private val PALETTE = listOf(
    "#e5484d" to Color(0xFFE5484D),
    "#0ea5e9" to Color(0xFF0EA5E9),
    "#22c55e" to Color(0xFF22C55E),
    "#f59e0b" to Color(0xFFF59E0B),
    "#111827" to Color(0xFF111827),
)

/**
 * Ephemeral shared canvas — strokes relay live via WS (POST /whiteboard/stroke
 * -> ws_manager push), nothing is persisted, so this always opens blank.
 * Coordinates are normalized to 0..1 so different screen sizes still align.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WhiteboardScreen(
    username: String?,
    groupId: Int?,
    conferenceId: Int? = null,
    onBack: () -> Unit,
    viewModel: WhiteboardViewModel = hiltViewModel(),
) {
    var segments by remember { mutableStateOf(listOf<UiSegment>()) }
    var selectedColorHex by remember { mutableStateOf(PALETTE[0].first) }
    var selectedColor by remember { mutableStateOf(PALETTE[0].second) }
    var canvasSize by remember { mutableStateOf(Offset(1f, 1f)) }
    var lastPoint by remember { mutableStateOf<Offset?>(null) }

    fun matchesTarget(data: com.google.gson.JsonObject): Boolean {
        val msgGroupId = data.get("group_id")?.takeIf { !it.isJsonNull }?.asInt
        val msgConferenceId = data.get("conference_id")?.takeIf { !it.isJsonNull }?.asInt
        return when {
            conferenceId != null -> msgConferenceId == conferenceId
            groupId != null -> msgGroupId == groupId
            else -> msgGroupId == null && msgConferenceId == null
        }
    }

    LaunchedEffect(username, groupId, conferenceId) {
        viewModel.events.collect { msg ->
            when (msg.type) {
                "whiteboard_stroke" -> {
                    val data = msg.data ?: return@collect
                    if (!matchesTarget(data)) return@collect
                    val s = data.getAsJsonObject("stroke") ?: return@collect
                    segments = segments + UiSegment(
                        x0 = s.get("x0").asFloat, y0 = s.get("y0").asFloat,
                        x1 = s.get("x1").asFloat, y1 = s.get("y1").asFloat,
                        color = Color(android.graphics.Color.parseColor(s.get("color").asString)),
                        width = s.get("width").asFloat,
                    )
                }
                "whiteboard_clear" -> {
                    val data = msg.data ?: return@collect
                    if (matchesTarget(data)) segments = emptyList()
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite) }
                },
                title = { Text("Whiteboard", color = SurfaceWhite, style = MaterialTheme.typography.titleMedium) },
                actions = {
                    TextButton(onClick = {
                        segments = emptyList()
                        viewModel.sendClear(username, groupId, conferenceId)
                    }) { Text("Clear", color = SurfaceWhite) }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
    ) { innerPadding ->
        Column(Modifier.padding(innerPadding).fillMaxSize()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PALETTE.forEach { (hex, color) ->
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(CircleShape)
                            .background(color)
                            .border(
                                width = if (hex == selectedColorHex) 2.dp else 0.dp,
                                color = Color.Black,
                                shape = CircleShape,
                            )
                            .clickable { selectedColorHex = hex; selectedColor = color }
                    )
                }
            }
            Canvas(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.White)
                    .pointerInput(username, groupId, conferenceId, selectedColor) {
                        detectDragGestures(
                            onDragStart = { offset -> lastPoint = offset },
                            onDragEnd = { lastPoint = null },
                            onDragCancel = { lastPoint = null },
                        ) { change, _ ->
                            val prev = lastPoint ?: change.position
                            val cur = change.position
                            val w = size.width.toFloat().coerceAtLeast(1f)
                            val h = size.height.toFloat().coerceAtLeast(1f)
                            val nx0 = prev.x / w; val ny0 = prev.y / h
                            val nx1 = cur.x / w; val ny1 = cur.y / h
                            segments = segments + UiSegment(nx0, ny0, nx1, ny1, selectedColor, 4f)
                            viewModel.sendStroke(
                                username, groupId, conferenceId,
                                WhiteboardStroke(nx0.toDouble(), ny0.toDouble(), nx1.toDouble(), ny1.toDouble(), selectedColorHex, 4f)
                            )
                            lastPoint = cur
                        }
                    }
            ) {
                canvasSize = Offset(size.width, size.height)
                segments.forEach { seg ->
                    drawLine(
                        color = seg.color,
                        start = Offset(seg.x0 * size.width, seg.y0 * size.height),
                        end = Offset(seg.x1 * size.width, seg.y1 * size.height),
                        strokeWidth = seg.width,
                        cap = androidx.compose.ui.graphics.StrokeCap.Round,
                    )
                }
            }
        }
    }
}
