package com.dilarion.app.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.dilarion.app.data.model.IncomingCallData
import com.dilarion.app.ui.screens.auth.AuthScreen
import com.dilarion.app.ui.screens.auth.AuthViewModel
import com.dilarion.app.ui.screens.calls.CallOverlayViewModel
import com.dilarion.app.ui.screens.calls.CallScreen
import com.dilarion.app.ui.screens.calls.FloatingCallBar
import com.dilarion.app.ui.screens.calls.IncomingCallOverlay
import com.dilarion.app.ui.screens.calls.IncomingConferenceOverlay
import com.dilarion.app.ui.screens.chat.ChatScreen
import com.dilarion.app.ui.screens.home.HomeScreen
import com.dilarion.app.ui.screens.home.HomeViewModel
import com.dilarion.app.ui.screens.mastertoken.MasterTokenSetupScreen
import com.dilarion.app.ui.screens.newchat.NewChatScreen
import com.dilarion.app.ui.screens.newmeeting.NewMeetingScreen
import com.dilarion.app.ui.screens.meetings.MeetingsScreen
import com.dilarion.app.ui.screens.gallery.GalleryScreen
import com.dilarion.app.ui.screens.lobby.LobbyScreen
import com.dilarion.app.ui.screens.lobby.WaitingForHostScreen
import com.dilarion.app.ui.screens.whiteboard.WhiteboardScreen
import com.dilarion.app.ui.screens.settings.SettingsScreen
import com.dilarion.app.ui.screens.devices.LinkedDevicesScreen
import com.dilarion.app.ui.screens.splash.SplashScreen

@Composable
fun AppNavigation(pendingIncomingCall: IncomingCallData? = null) {
    val navController = rememberNavController()
    val overlayVm: CallOverlayViewModel = hiltViewModel()
    val incomingCall by overlayVm.incomingCall.collectAsState()
    val conferenceInvite by overlayVm.conferenceInvite.collectAsState()
    val minimizedCall by overlayVm.minimizedCall.collectAsState()
    val missedCall by overlayVm.missedCall.collectAsState()
    val conferenceUpgrade by overlayVm.conferenceUpgrade.collectAsState()

    // Our 1:1 call was turned into a group call by the other party. Group calls
    // run in the LiveKit room — staying on the mesh leg would leave us connected
    // to no one — so follow it there.
    LaunchedEffect(conferenceUpgrade) {
        val confId = conferenceUpgrade ?: return@LaunchedEffect
        overlayVm.clearConferenceUpgrade()
        overlayVm.clearMinimized()
        navController.navigate(Screen.Gallery.route(confId))
    }

    // Inject call from notification intent into overlay VM
    LaunchedEffect(pendingIncomingCall) {
        if (pendingIncomingCall != null) overlayVm.setFromNotification(pendingIncomingCall)
    }

    // The caller gave up before this device answered. The ring is already gone;
    // offer the call back here rather than making the user go find them again.
    missedCall?.let { missed ->
        AlertDialog(
            onDismissRequest = { overlayVm.clearMissedCall() },
            title = { Text("Missed call") },
            text = { Text("${missed.caller} called and hung up before you answered.") },
            confirmButton = {
                TextButton(onClick = {
                    overlayVm.clearMissedCall()
                    navController.navigate(Screen.Call.route(missed.caller))
                }) { Text("Call back") }
            },
            dismissButton = {
                TextButton(onClick = { overlayVm.clearMissedCall() }) { Text("Dismiss") }
            },
        )
    }

    // Show incoming call overlay over whatever screen is active
    incomingCall?.let { call ->
        IncomingCallOverlay(
            incoming = call,
            onDismiss = { overlayVm.clear() },
        )
        return
    }

    // Being added to a call in progress rings over whatever screen is showing.
    conferenceInvite?.let { invite ->
        IncomingConferenceOverlay(
            invite = invite,
            onDismiss = { overlayVm.declineConferenceInvite() },
            onJoined = { confId ->
                overlayVm.clearConferenceInvite()
                navController.navigate(Screen.Gallery.route(confId))
            },
        )
        return
    }

    Box(modifier = Modifier.fillMaxSize()) {
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
                onCallUser = { username ->
                    navController.navigate(Screen.Call.route(username))
                },
                onOpenGroupChat = { groupId, groupName ->
                    navController.navigate(Screen.GroupChat.route(groupId, groupName))
                },
                onNewChat = {
                    navController.navigate(Screen.OnlineUsers.route)
                },
                onNewMeeting = {
                    navController.navigate(Screen.NewMeeting.route)
                },
                onMeetings = {
                    navController.navigate(Screen.Meetings.route)
                },
                onJoinMeeting = { joinCode, title ->
                    navController.navigate(Screen.Lobby.route(mode = "join", joinCode = joinCode, title = title))
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
            LaunchedEffect(username) { overlayVm.clearMinimized() }
            CallScreen(
                username = username,
                onCallEnded = { overlayVm.clearMinimized(); navController.popBackStack() },
                onOpenGallery = { confId ->
                    overlayVm.clearMinimized()
                    navController.popBackStack()
                    navController.navigate(Screen.Gallery.route(confId))
                },
                onMinimize = { callId ->
                    overlayVm.setMinimized(callId ?: 0, username)
                    navController.popBackStack()
                },
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

        composable(Screen.NewMeeting.route) {
            NewMeetingScreen(
                onBack = { navController.popBackStack() },
                onMeetingStarted = { conferenceId ->
                    navController.navigate(Screen.Lobby.route(mode = "instant", conferenceId = conferenceId)) {
                        popUpTo(Screen.NewMeeting.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.Meetings.route) {
            MeetingsScreen(
                onBack = { navController.popBackStack() },
                onJoined = { joinCode, title ->
                    navController.navigate(Screen.Lobby.route(mode = "join", joinCode = joinCode, title = title)) {
                        popUpTo(Screen.Meetings.route) { inclusive = true }
                    }
                },
            )
        }

        composable(
            route = Screen.Lobby.route,
            arguments = listOf(
                navArgument("mode") { type = NavType.StringType },
                navArgument("joinCode") { type = NavType.StringType; defaultValue = "" },
                navArgument("title") { type = NavType.StringType; defaultValue = "" },
                navArgument("conferenceId") { type = NavType.IntType; defaultValue = -1 },
            ),
        ) { backStack ->
            val mode = backStack.arguments?.getString("mode") ?: "instant"
            val joinCode = backStack.arguments?.getString("joinCode")?.takeIf { it.isNotEmpty() }
            val title = backStack.arguments?.getString("title")
                ?.let { java.net.URLDecoder.decode(it, "UTF-8") }?.takeIf { it.isNotEmpty() }
            val conferenceId = backStack.arguments?.getInt("conferenceId")?.takeIf { it >= 0 }
            LobbyScreen(
                mode = mode,
                joinCode = joinCode,
                conferenceId = conferenceId,
                title = title ?: if (mode == "instant") "Start Meeting" else "Join Meeting",
                onBack = { navController.popBackStack() },
                onGalleryReady = { confId, micOn, camOn, name ->
                    navController.navigate(Screen.Gallery.route(confId, micOn, camOn, name)) {
                        popUpTo(Screen.Lobby.route) { inclusive = true }
                    }
                },
                onWaiting = { confId, micOn, camOn, name ->
                    navController.navigate(Screen.Waiting.route(confId, micOn, camOn, name)) {
                        popUpTo(Screen.Lobby.route) { inclusive = true }
                    }
                },
            )
        }

        composable(
            route = Screen.Waiting.route,
            arguments = listOf(
                navArgument("conferenceId") { type = NavType.IntType },
                navArgument("micOn") { type = NavType.BoolType; defaultValue = true },
                navArgument("camOn") { type = NavType.BoolType; defaultValue = true },
                navArgument("displayName") { type = NavType.StringType; defaultValue = "" },
            ),
        ) { backStack ->
            val conferenceId = backStack.arguments?.getInt("conferenceId") ?: return@composable
            val micOn = backStack.arguments?.getBoolean("micOn") ?: true
            val camOn = backStack.arguments?.getBoolean("camOn") ?: true
            val displayName = backStack.arguments?.getString("displayName")
                ?.let { java.net.URLDecoder.decode(it, "UTF-8") }?.takeIf { it.isNotEmpty() }
            WaitingForHostScreen(
                conferenceId = conferenceId,
                onAdmitted = {
                    navController.navigate(Screen.Gallery.route(conferenceId, micOn, camOn, displayName)) {
                        popUpTo(Screen.Waiting.route) { inclusive = true }
                    }
                },
                onDenied = { navController.popBackStack(Screen.Home.route, inclusive = false) },
                onCancel = { navController.popBackStack(Screen.Home.route, inclusive = false) },
            )
        }

        composable(
            route = Screen.Gallery.route,
            arguments = listOf(
                navArgument("conferenceId") { type = NavType.IntType },
                navArgument("micOn") { type = NavType.BoolType; defaultValue = true },
                navArgument("camOn") { type = NavType.BoolType; defaultValue = true },
                navArgument("displayName") { type = NavType.StringType; defaultValue = "" },
            ),
        ) { backStack ->
            val conferenceId = backStack.arguments?.getInt("conferenceId") ?: return@composable
            GalleryScreen(
                conferenceId = conferenceId,
                initialMicOn = backStack.arguments?.getBoolean("micOn") ?: true,
                initialCamOn = backStack.arguments?.getBoolean("camOn") ?: true,
                displayName = backStack.arguments?.getString("displayName")
                    ?.let { java.net.URLDecoder.decode(it, "UTF-8") }?.takeIf { it.isNotEmpty() },
                onClose = { navController.popBackStack() },
                onOpenWhiteboard = { confId, startedByMe -> navController.navigate(Screen.Whiteboard.route(conferenceId = confId, startedByMe = startedByMe)) },
            )
        }

        composable(
            route = Screen.Whiteboard.route,
            arguments = listOf(
                navArgument("username") { type = NavType.StringType; defaultValue = "" },
                navArgument("groupId") { type = NavType.IntType; defaultValue = -1 },
                navArgument("conferenceId") { type = NavType.IntType; defaultValue = -1 },
                navArgument("startedByMe") { type = NavType.BoolType; defaultValue = false },
            ),
        ) { backStack ->
            val username = backStack.arguments?.getString("username")?.takeIf { it.isNotEmpty() }
            val groupIdArg = backStack.arguments?.getInt("groupId")?.takeIf { it >= 0 }
            val conferenceIdArg = backStack.arguments?.getInt("conferenceId")?.takeIf { it >= 0 }
            val startedByMe = backStack.arguments?.getBoolean("startedByMe") ?: false
            WhiteboardScreen(
                username = username,
                groupId = groupIdArg,
                conferenceId = conferenceIdArg,
                startedByMe = startedByMe,
                onBack = { navController.popBackStack() },
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onMasterToken = { navController.navigate(Screen.MasterToken.route) },
                onLinkedDevices = { navController.navigate(Screen.LinkedDevices.route) },
                onLogout = {
                    navController.navigate(Screen.Auth.route) {
                        popUpTo(Screen.Home.route) { inclusive = true }
                    }
                },
            )
        }

        composable(Screen.LinkedDevices.route) {
            LinkedDevicesScreen(onBack = { navController.popBackStack() })
        }
    }

    // Floating minimized call bar — shown over all screens
    minimizedCall?.let { info ->
        FloatingCallBar(
            info = info,
            onExpand = {
                overlayVm.clearMinimized()
                navController.navigate(Screen.Call.route(info.partner))
            },
            onEnd = { overlayVm.endMinimizedCall() },
        )
    }
    } // close Box
}
