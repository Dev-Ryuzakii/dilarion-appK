package com.dilarion.app.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private val ShimmerBase  = Color(0xFFE0E0E0)
private val ShimmerLight = Color(0xFFF5F5F5)

@Composable
private fun shimmerBrush(): Brush {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val xShimmer by transition.animateFloat(
        initialValue = -300f,
        targetValue  = 1200f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1100, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "shimmerX",
    )
    return Brush.linearGradient(
        colors = listOf(ShimmerBase, ShimmerLight, ShimmerBase),
        start  = Offset(xShimmer, 0f),
        end    = Offset(xShimmer + 400f, 0f),
    )
}

@Composable
fun SkeletonBox(
    modifier: Modifier = Modifier,
    height: Dp = 16.dp,
    width: Dp? = null,
    cornerRadius: Dp = 8.dp,
) {
    val brush = shimmerBrush()
    Box(
        modifier = modifier
            .then(if (width != null) Modifier.width(width) else Modifier.fillMaxWidth())
            .height(height)
            .clip(RoundedCornerShape(cornerRadius))
            .background(brush),
    )
}

// ── Conversation row skeleton (Home screen) ───────────────────────────────────

@Composable
fun ConversationRowSkeleton() {
    val brush = shimmerBrush()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.White)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(50.dp)
                .clip(CircleShape)
                .background(brush),
        )
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            SkeletonBox(height = 14.dp, width = 140.dp)
            Spacer(Modifier.height(6.dp))
            SkeletonBox(height = 11.dp, width = 200.dp)
        }
        Spacer(Modifier.width(8.dp))
        SkeletonBox(height = 10.dp, width = 36.dp)
    }
}

@Composable
fun ConversationListSkeleton(count: Int = 7) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 8.dp),
    ) {
        items(count) {
            ConversationRowSkeleton()
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 78.dp)
                    .height(0.5.dp)
                    .background(Color(0xFFEEEEEE)),
            )
        }
    }
}

// ── Chat message skeleton ────────────────────────────────────────────────────

@Composable
fun ChatMessageSkeleton(fromMe: Boolean) {
    val brush = shimmerBrush()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = if (fromMe) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            horizontalAlignment = if (fromMe) Alignment.End else Alignment.Start,
        ) {
            Box(
                modifier = Modifier
                    .width(if (fromMe) 180.dp else 220.dp)
                    .height(40.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(brush),
            )
            Spacer(Modifier.height(3.dp))
            Box(
                modifier = Modifier
                    .width(50.dp)
                    .height(9.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(brush),
            )
        }
    }
}

@Composable
fun ChatListSkeleton(count: Int = 8) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 8.dp),
    ) {
        items(count) { i ->
            ChatMessageSkeleton(fromMe = i % 3 == 0)
        }
    }
}

// ── User row skeleton (NewChat screen) ────────────────────────────────────────

@Composable
fun UserRowSkeleton() {
    val brush = shimmerBrush()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Color.White)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(brush),
        )
        Spacer(Modifier.width(12.dp))
        Column {
            SkeletonBox(height = 13.dp, width = 120.dp)
            Spacer(Modifier.height(5.dp))
            SkeletonBox(height = 10.dp, width = 80.dp)
        }
    }
}

@Composable
fun UserListSkeleton(count: Int = 8) {
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
        items(count) {
            UserRowSkeleton()
        }
    }
}
