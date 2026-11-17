package com.dilarion.app.ui.screens.splash

import androidx.compose.animation.core.*
import androidx.compose.foundation.Image
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.runtime.collectAsState
import com.dilarion.app.R
import com.dilarion.app.ui.theme.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.ui.draw.alpha

@Composable
fun SplashScreen(
    onAuthRequired: () -> Unit,
    onAuthenticated: () -> Unit,
    onOnboardingRequired: () -> Unit = {},
    viewModel: SplashViewModel = hiltViewModel(),
) {
    val destination by viewModel.destination.collectAsState()

    // Signed-in users go straight through. Signed-out users stay on this
    // welcome page until they tap "Get Started".
    LaunchedEffect(destination) {
        when (destination) {
            SplashDestination.HOME       -> onAuthenticated()
            SplashDestination.ONBOARDING -> onOnboardingRequired()
            SplashDestination.AUTH, SplashDestination.LOADING -> Unit
        }
    }

    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    val alpha by animateFloatAsState(if (shown) 1f else 0f, tween(600), label = "fade")
    val lift by animateFloatAsState(if (shown) 0f else 24f, tween(700, easing = FastOutSlowInEasing), label = "lift")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(SurfaceWhite)
            .statusBarsPadding(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 28.dp)
                .padding(top = 40.dp)
                .alpha(alpha)
                .offset(y = lift.dp),
        ) {
            // Logo + wordmark
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(R.drawable.dilarion_logo),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)),
                )
                Spacer(Modifier.width(10.dp))
                Text("Dilarion", fontSize = 30.sp, fontWeight = FontWeight.ExtraBold, color = TextPrimary, letterSpacing = (-0.5).sp)
            }

            Spacer(Modifier.height(44.dp))
            Text("Private messaging for", fontSize = 17.sp, color = TextSecondary)
            Text("Your Whole Team", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = TextPrimary)
            Spacer(Modifier.height(12.dp))
            Text(
                "Chats, channels, calls and meetings — end-to-end encrypted, so only your team can read them.",
                fontSize = 14.sp,
                lineHeight = 21.sp,
                color = TextSecondary,
            )
            Spacer(Modifier.height(24.dp))

            if (destination == SplashDestination.AUTH) {
                Button(
                    onClick = onAuthRequired,
                    shape = RoundedCornerShape(50),
                    colors = ButtonDefaults.buttonColors(containerColor = DilarionRed),
                    contentPadding = PaddingValues(horizontal = 22.dp, vertical = 14.dp),
                    elevation = ButtonDefaults.buttonElevation(defaultElevation = 6.dp),
                ) {
                    Text("Get Started", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(10.dp))
                    Icon(Icons.Default.ArrowForward, null, modifier = Modifier.size(18.dp))
                }
            } else {
                // Still checking the session — bouncing dots where the button will be.
                val dots = listOf(bouncingDot(0), bouncingDot(200), bouncingDot(400))
                Row(
                    modifier = Modifier.height(48.dp).padding(start = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    dots.forEach { y ->
                        Box(Modifier.size(8.dp).offset(y = y.dp).clip(CircleShape).background(DilarionRed))
                    }
                }
            }
        }

        // Illustration: "Standup meeting" by Storyset (storyset.com), accent recoloured to brand red.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .alpha(alpha)
                .navigationBarsPadding(),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(R.drawable.welcome_team),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 20.dp, vertical = 16.dp),
            )
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
