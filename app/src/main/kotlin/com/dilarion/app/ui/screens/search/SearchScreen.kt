package com.dilarion.app.ui.screens.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    onBack: () -> Unit,
    onOpenChat: (String) -> Unit,
    onOpenGroupChat: (Int, String) -> Unit,
    viewModel: SearchViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    Scaffold(
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed, titleContentColor = SurfaceWhite, navigationIconContentColor = SurfaceWhite),
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
                title = {
                    TextField(
                        value = state.query,
                        onValueChange = viewModel::onQueryChange,
                        placeholder = { Text("Search people, channels, files", color = SurfaceWhite.copy(alpha = 0.7f)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                            unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                            focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                            unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                            focusedTextColor = SurfaceWhite, unfocusedTextColor = SurfaceWhite, cursorColor = SurfaceWhite,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                },
            )
        },
    ) { padding ->
        val r = state.results
        Box(Modifier.fillMaxSize().padding(padding)) {
            if (state.loading) {
                LinearProgressIndicator(Modifier.fillMaxWidth(), color = DilarionRed)
            }
            when {
                state.query.trim().length < 2 ->
                    Hint("Type at least 2 characters.")
                r != null && r.people.isEmpty() && r.groups.isEmpty() && r.files.isEmpty() ->
                    Hint("No matches. Message text is searched inside each chat.")
                r != null -> LazyColumn(Modifier.fillMaxSize()) {
                    if (r.people.isNotEmpty()) item { SectionLabel("People") }
                    items(r.people) { p ->
                        ResultRow(title = p.fullName ?: p.username, subtitle = "@${p.username}" + (p.department?.let { " · $it" } ?: ""), avatar = (p.fullName ?: p.username).take(2).uppercase(), rounded = false) { onOpenChat(p.username) }
                    }
                    if (r.groups.isNotEmpty()) item { SectionLabel("Channels & groups") }
                    items(r.groups) { g ->
                        ResultRow(title = g.name, subtitle = "${g.memberCount} members" + (g.description?.let { " · $it" } ?: ""), avatar = "#", rounded = true) { onOpenGroupChat(g.id, g.name) }
                    }
                    if (r.files.isNotEmpty()) item { SectionLabel("Files") }
                    items(r.files) { f ->
                        ResultRow(title = f.filename, subtitle = "${f.mediaType} · ${fmtBytes(f.fileSize)}", avatar = "📎", rounded = true) {}
                    }
                }
            }
        }
    }
}

@Composable
private fun Hint(text: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = TextSecondary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 4.dp))
}

@Composable
private fun ResultRow(title: String, subtitle: String, avatar: String, rounded: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(38.dp).clip(if (rounded) RoundedCornerShape(10.dp) else CircleShape).let { it },
            contentAlignment = Alignment.Center,
        ) {
            Surface(shape = if (rounded) RoundedCornerShape(10.dp) else CircleShape, color = BackgroundGrey, modifier = Modifier.fillMaxSize()) {
                Box(contentAlignment = Alignment.Center) { Text(avatar, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = TextSecondary, maxLines = 1)
        }
    }
}

private fun fmtBytes(n: Long): String = when {
    n < 1024 -> "$n B"
    n < 1024 * 1024 -> "${n / 1024} KB"
    else -> "${"%.1f".format(n / 1024.0 / 1024.0)} MB"
}
