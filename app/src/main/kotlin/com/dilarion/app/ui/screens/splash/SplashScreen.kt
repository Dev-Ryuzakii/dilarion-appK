package com.dilarion.app.ui.screens.splash

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.dilarion.app.ui.theme.DilarionRed
import com.dilarion.app.ui.theme.SurfaceWhite

@Composable
fun SplashScreen(
    onAuthRequired: () -> Unit,
    onAuthenticated: () -> Unit,
    viewModel: SplashViewModel = hiltViewModel(),
) {
    val destination by viewModel.destination.collectAsStateWithLifecycle()

    LaunchedEffect(destination) {
        when (destination) {
            SplashDestination.AUTH -> onAuthRequired()
            SplashDestination.HOME -> onAuthenticated()
            SplashDestination.LOADING -> Unit
        }
    }

    // Fade-in animation
    val alpha by animateFloatAsState(
        targetValue = 1f,
        animationSpec = tween(600),
        label = "fade",
    )
    val scale by animateFloatAsState(
        targetValue = 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy),
        label = "scale",
    )

    // Bouncing dots
    val dot1 = bouncingDot(delay = 0)
    val dot2 = bouncingDot(delay = 200)
    val dot3 = bouncingDot(delay = 400)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(DilarionRed),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.scale(scale),
        ) {
            Box(
                modifier = Modifier
                    .size(100.dp)
                    .clip(CircleShape)
                    .background(SurfaceWhite.copy(alpha = 0.18f)),
                contentAlignment = Alignment.Center,
            ) {
                Text("D", fontSize = 48.sp, fontWeight = FontWeight.ExtraBold, color = SurfaceWhite)
            }
            Spacer(Modifier.height(20.dp))
            Text(
                "DILARION",
                fontSize = 32.sp,
                fontWeight = FontWeight.ExtraBold,
                color = SurfaceWhite,
                letterSpacing = 4.sp,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "Secure · Private · Encrypted",
                fontSize = 12.sp,
                color = SurfaceWhite.copy(alpha = 0.75f),
                letterSpacing = 0.5.sp,
                textAlign = TextAlign.Center,
            )
        }

        // Bouncing dots
        Row(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 60.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            listOf(dot1, dot2, dot3).forEach { offsetY ->
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .offset(y = offsetY.dp)
                        .clip(CircleShape)
                        .background(SurfaceWhite.copy(alpha = 0.85f)),
                )
            }
        }
    }
}

@Composable
private fun bouncingDot(delay: Int): Float {
    val infiniteTransition = rememberInfiniteTransition(label = "dot")
    val y by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue  = 0f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = 1200
                0f      at delay       with FastOutSlowInEasing
                -8f     at delay + 300 with LinearEasing
                0f      at delay + 600 with FastOutSlowInEasing
                0f      at 1200
            },
            repeatMode = RepeatMode.Restart,
        ),
        label = "y_$delay",
    )
    return y
}
