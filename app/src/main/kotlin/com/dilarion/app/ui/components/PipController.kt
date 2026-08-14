package com.dilarion.app.ui.components

import androidx.compose.runtime.mutableStateOf

/**
 * Bridges Compose (which can't call Activity.enterPictureInPictureMode itself)
 * with MainActivity (the only thing that can). MainActivity registers [enter]
 * once at startup; GalleryScreen flips [meetingActive] while a call is on
 * screen so MainActivity knows whether to auto-enter PiP on the home gesture
 * (onUserLeaveHint), and reads [isInPip] to swap to a minimal video-only
 * layout once the window has actually shrunk.
 */
object PipController {
    val isInPip = mutableStateOf(false)
    val meetingActive = mutableStateOf(false)
    var enter: (() -> Unit)? = null
}
