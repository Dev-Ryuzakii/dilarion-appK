package com.dilarion.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val DilarionTypography = Typography(
    headlineLarge = TextStyle(fontSize = 28.sp, fontWeight = FontWeight.ExtraBold),
    headlineMedium = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold),
    titleLarge  = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge   = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Normal),
    bodyMedium  = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Normal),
    bodySmall   = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Normal),
    labelSmall  = TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Medium),
)
