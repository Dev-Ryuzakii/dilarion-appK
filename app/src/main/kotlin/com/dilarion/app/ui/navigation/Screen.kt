package com.dilarion.app.ui.navigation

sealed class Screen(val route: String) {
    object Splash   : Screen("splash")
    object Auth     : Screen("auth")
    object Home     : Screen("home")
    object Chat     : Screen("chat/{username}") {
        fun route(username: String) = "chat/$username"
    }
    object GroupChat : Screen("group/{groupId}/{groupName}") {
        fun route(groupId: Int, groupName: String) = "group/$groupId/${groupName.encodeToUrl()}"
    }
    object Groups        : Screen("groups")
    object Calls         : Screen("calls")
    object Call          : Screen("call/{username}") {
        fun route(username: String) = "call/$username"
    }
    object Settings      : Screen("settings")
    object OnlineUsers   : Screen("online_users")
    object MasterToken   : Screen("master_token")
    object LinkedDevices : Screen("linked_devices")
}

private fun String.encodeToUrl() = java.net.URLEncoder.encode(this, "UTF-8")
