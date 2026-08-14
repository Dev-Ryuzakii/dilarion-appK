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
    object NewMeeting    : Screen("new_meeting")
    object Meetings      : Screen("meetings")
    object Whiteboard    : Screen("whiteboard?username={username}&groupId={groupId}&conferenceId={conferenceId}&startedByMe={startedByMe}") {
        fun route(username: String? = null, groupId: Int? = null, conferenceId: Int? = null, startedByMe: Boolean = false) =
            "whiteboard?username=${username ?: ""}&groupId=${groupId ?: -1}&conferenceId=${conferenceId ?: -1}&startedByMe=$startedByMe"
    }
    object Gallery       : Screen("gallery/{conferenceId}?micOn={micOn}&camOn={camOn}&displayName={displayName}") {
        fun route(conferenceId: Int, micOn: Boolean = true, camOn: Boolean = true, displayName: String? = null) =
            "gallery/$conferenceId?micOn=$micOn&camOn=$camOn&displayName=${(displayName ?: "").encodeToUrl()}"
    }
    object Lobby : Screen("lobby?mode={mode}&joinCode={joinCode}&title={title}&conferenceId={conferenceId}") {
        fun route(mode: String, joinCode: String? = null, title: String? = null, conferenceId: Int? = null) =
            "lobby?mode=$mode&joinCode=${joinCode ?: ""}&title=${(title ?: "").encodeToUrl()}&conferenceId=${conferenceId ?: -1}"
    }
    object Waiting : Screen("waiting/{conferenceId}?micOn={micOn}&camOn={camOn}&displayName={displayName}") {
        fun route(conferenceId: Int, micOn: Boolean = true, camOn: Boolean = true, displayName: String? = null) =
            "waiting/$conferenceId?micOn=$micOn&camOn=$camOn&displayName=${(displayName ?: "").encodeToUrl()}"
    }
    object MasterToken   : Screen("master_token")
    object LinkedDevices : Screen("linked_devices")
}

private fun String.encodeToUrl() = java.net.URLEncoder.encode(this, "UTF-8")
