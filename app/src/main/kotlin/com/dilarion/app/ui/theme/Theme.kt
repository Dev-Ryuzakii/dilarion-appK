package com.dilarion.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val DilarionColorScheme = lightColorScheme(
    primary          = DilarionRed,
    onPrimary        = SurfaceWhite,
    primaryContainer = DilarionRedLight,
    secondary        = TextSecondary,
    background       = BackgroundGrey,
    surface          = SurfaceWhite,
    onBackground     = TextPrimary,
    onSurface        = TextPrimary,
    outline          = BorderGrey,
)

@Composable
fun DilarionTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DilarionColorScheme,
        typography  = DilarionTypography,
        content     = content,
    )
}
