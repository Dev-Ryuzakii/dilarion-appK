package com.dilarion.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.dilarion.app.data.model.GifResult

private enum class PickerTab { EMOJI, GIF, STICKER }

/**
 * Combined Emoji/GIF/Sticker picker for composing a message — matches the
 * desktop app's glassmorphic picker (frosted, translucent panel that floats
 * above the composer), sized for a bottom sheet on mobile instead.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaPickerSheet(
    gifs: List<GifResult>,
    gifsLoading: Boolean,
    gifsError: String?,
    onSearchGifs: (String) -> Unit,
    onPickEmoji: (String) -> Unit,
    onPickGif: (GifResult) -> Unit,
    onPickSticker: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var tab by remember { mutableStateOf(PickerTab.EMOJI) }
    var query by remember { mutableStateOf("") }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.fillMaxWidth().height(420.dp).padding(horizontal = 8.dp)) {
            // Tabs
            Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
                listOf(PickerTab.EMOJI to "Emoji", PickerTab.GIF to "GIFs", PickerTab.STICKER to "Stickers").forEach { (t, label) ->
                    val selected = tab == t
                    Surface(
                        onClick = { tab = t; query = "" },
                        shape = RoundedCornerShape(10.dp),
                        color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                        modifier = Modifier.weight(1f).padding(2.dp),
                    ) {
                        Text(
                            label,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                            color = if (selected) Color.White else MaterialTheme.colorScheme.onSurface,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                }
            }

            if (tab != PickerTab.STICKER) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it; if (tab == PickerTab.GIF) onSearchGifs(it) },
                    placeholder = { Text(if (tab == PickerTab.GIF) "Search GIPHY…" else "Search category…") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    shape = RoundedCornerShape(10.dp),
                )
            }

            Box(modifier = Modifier.weight(1f).padding(horizontal = 4.dp)) {
                when (tab) {
                    PickerTab.EMOJI -> {
                        val emojis = remember(query) { searchEmoji(query) }
                        LazyVerticalGrid(columns = GridCells.Fixed(8)) {
                            items(emojis) { e ->
                                Box(
                                    modifier = Modifier
                                        .aspectRatio(1f)
                                        .clickable { onPickEmoji(e) },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(e, fontSize = 22.sp)
                                }
                            }
                        }
                    }
                    PickerTab.GIF -> {
                        when {
                            gifsLoading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator()
                            }
                            gifsError != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text(gifsError, color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                            }
                            gifs.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text("No GIFs found", fontSize = 13.sp)
                            }
                            else -> LazyVerticalGrid(columns = GridCells.Fixed(2)) {
                                items(gifs) { g ->
                                    AsyncImage(
                                        model = ImageRequest.Builder(LocalContext.current).data(g.previewUrl).crossfade(true).build(),
                                        contentDescription = g.title,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier
                                            .aspectRatio(1f)
                                            .padding(4.dp)
                                            .clip(RoundedCornerShape(10.dp))
                                            .clickable { onPickGif(g) },
                                    )
                                }
                            }
                        }
                    }
                    PickerTab.STICKER -> {
                        LazyVerticalGrid(columns = GridCells.Fixed(3)) {
                            items(STICKERS) { s ->
                                Box(
                                    modifier = Modifier
                                        .aspectRatio(1f)
                                        .padding(6.dp)
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(Color(s.colorHex).copy(alpha = 0.15f))
                                        .clickable { onPickSticker(s.id) },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(s.glyph, fontSize = 34.sp)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
