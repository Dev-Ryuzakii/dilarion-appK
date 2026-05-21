package com.dilarion.app

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.dilarion.app.ui.navigation.AppNavigation
import com.dilarion.app.ui.theme.DilarionTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Block screenshots, screen recording, and recent-apps thumbnail
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )
        enableEdgeToEdge()
        setContent {
            DilarionTheme {
                AppNavigation()
            }
        }
    }
}
