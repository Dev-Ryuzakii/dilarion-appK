package com.dilarion.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.dilarion.app.ui.screens.auth.AuthScreen
import com.dilarion.app.ui.screens.auth.AuthViewModel
import com.dilarion.app.ui.screens.calls.CallOverlayViewModel
import com.dilarion.app.ui.screens.calls.CallScreen
import com.dilarion.app.ui.screens.calls.IncomingCallOverlay
import com.dilarion.app.ui.screens.chat.ChatScreen
import com.dilarion.app.ui.screens.home.HomeScreen
import com.dilarion.app.ui.screens.home.HomeViewModel
import com.dilarion.app.ui.screens.mastertoken.MasterTokenSetupScreen
import com.dilarion.app.ui.screens.newchat.NewChatScreen
import com.dilarion.app.ui.screens.settings.SettingsScreen
import com.dilarion.app.ui.screens.splash.SplashScreen

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    val overlayVm: CallOverlayViewModel = hiltViewModel()
    val incomingCall by overlayVm.incomingCall.collectAsState()

    // Show incoming call overlay over whatever screen is active
    incomingCall?.let { call ->
        IncomingCallOverlay(
            incoming = call,
            onDismiss = { overlayVm.clear() },
        )
        return
    }

    NavHost(
        navController = navController,
        startDestination = Screen.Splash.route,
    ) {

        composable(Screen.Splash.route) {
            SplashScreen(
                onAuthRequired = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.Splash.route) { inclusive = true }
                    }
                },
                onAuthenticated = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Splash.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.Auth.route) {
            val vm: AuthViewModel = hiltViewModel()
            AuthScreen(
                viewModel = vm,
                onAuthSuccess = {
                    navController.navigate(Screen.Home.route) {
                        popUpTo(Screen.Auth.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.MasterToken.route) {
            MasterTokenSetupScreen(
                onComplete = { navController.popBackStack() },
            )
        }

        composable(Screen.Home.route) {
            val vm: HomeViewModel = hiltViewModel()
            HomeScreen(
                viewModel = vm,
                onOpenChat = { username ->
                    navController.navigate(Screen.Chat.route(username))
                },
                onOpenGroupChat = { groupId, groupName ->
                    navController.navigate(Screen.GroupChat.route(groupId, groupName))
                },
                onNewChat = {
                    navController.navigate(Screen.OnlineUsers.route)
                },
                onSettings = {
                    navController.navigate(Screen.Settings.route)
                },
                onLogout = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
            )
        }

        composable(
            route = Screen.Chat.route,
            arguments = listOf(navArgument("username") { type = NavType.StringType }),
        ) { backStack ->
            val username = backStack.arguments?.getString("username") ?: return@composable
            ChatScreen(
                username = username,
                groupId = null,
                groupName = null,
                onBack = { navController.popBackStack() },
                onCall = { u -> navController.navigate(Screen.Call.route(u)) },
            )
        }

        composable(
            route = Screen.GroupChat.route,
            arguments = listOf(
                navArgument("groupId") { type = NavType.IntType },
                navArgument("groupName") { type = NavType.StringType },
            ),
        ) { backStack ->
            val groupId   = backStack.arguments?.getInt("groupId") ?: return@composable
            val groupName = backStack.arguments?.getString("groupName")
                ?.let { java.net.URLDecoder.decode(it, "UTF-8") } ?: ""
            ChatScreen(
                username = "",
                groupId = groupId,
                groupName = groupName,
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = Screen.Call.route,
            arguments = listOf(navArgument("username") { type = NavType.StringType }),
        ) { backStack ->
            val username = backStack.arguments?.getString("username") ?: return@composable
            CallScreen(
                username = username,
                onCallEnded = { navController.popBackStack() },
            )
        }

        composable(Screen.OnlineUsers.route) {
            NewChatScreen(
                onBack = { navController.popBackStack() },
                onOpenChat = { username ->
                    navController.navigate(Screen.Chat.route(username)) {
                        popUpTo(Screen.OnlineUsers.route) { inclusive = true }
                    }
                },
                onGroupCreated = { groupId, groupName ->
                    navController.navigate(Screen.GroupChat.route(groupId, groupName)) {
                        popUpTo(Screen.OnlineUsers.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onMasterToken = { navController.navigate(Screen.MasterToken.route) },
                onLogout = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
            )
        }
    }
}
