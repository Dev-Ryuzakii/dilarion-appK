package com.dilarion.app.ui.screens.newchat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.collectAsState
import androidx.hilt.navigation.compose.hiltViewModel
import com.dilarion.app.data.model.UserInfo
import com.dilarion.app.ui.theme.BackgroundGrey
import com.dilarion.app.ui.theme.BorderGrey
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite
import com.dilarion.app.ui.theme.TextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewChatScreen(
    onBack: () -> Unit,
    onOpenChat: (String) -> Unit,
    onGroupCreated: (groupId: Int, groupName: String) -> Unit,
    viewModel: NewChatViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val filtered = viewModel.filteredUsers()

    uiState.error?.let { err ->
        AlertDialog(
            onDismissRequest = viewModel::clearError,
            title = { Text("Error") },
            text = { Text(err) },
            confirmButton = {
                TextButton(onClick = viewModel::clearError) { Text("OK") }
            },
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, "Back", tint = SurfaceWhite)
                    }
                },
                title = { Text("New Message", color = SurfaceWhite, style = MaterialTheme.typography.titleMedium) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = DilarionRed),
            )
        },
        containerColor = BackgroundGrey,
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {

            OutlinedTextField(
                value = uiState.query,
                onValueChange = viewModel::setQuery,
                placeholder = { Text("Search users…", color = TextSecondary) },
                leadingIcon = { Icon(Icons.Default.Search, null, tint = TextSecondary) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                shape = RoundedCornerShape(24.dp),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = DilarionRed,
                    unfocusedBorderColor = BorderGrey,
                    focusedContainerColor = SurfaceWhite,
                    unfocusedContainerColor = SurfaceWhite,
                ),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            )

            if (uiState.isLoading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = DilarionRed)
                }
            } else if (filtered.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (uiState.query.isNotEmpty()) "No users found" else "No users available",
                        color = TextSecondary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            } else {
                LazyColumn(contentPadding = PaddingValues(vertical = 4.dp)) {
                    items(filtered, key = { it.username ?: "" }) { user ->
                        UserRow(user = user, onTap = { onOpenChat(user.username ?: return@UserRow) })
                    }
                }
            }
        }
    }
}

@Composable
private fun UserRow(user: UserInfo, onTap: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(SurfaceWhite)
            .clickable(onClick = onTap)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(50.dp)
                .clip(CircleShape)
                .background(DilarionRed),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                user.username?.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                color = SurfaceWhite,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                user.username ?: "",
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            user.lastLogin?.let { login ->
                Text(
                    "Last seen: ${login.take(10)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondary,
                )
            }
        }
    }

    HorizontalDivider(
        modifier = Modifier.padding(start = 78.dp),
        color = BorderGrey,
        thickness = 0.5.dp,
    )
}
