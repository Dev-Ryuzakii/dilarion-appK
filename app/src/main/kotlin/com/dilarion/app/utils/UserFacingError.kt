package com.dilarion.app.utils

import android.util.Log
import retrofit2.HttpException
import java.io.IOException

/**
 * Turn an arbitrary [Throwable] into a clear, friendly, actionable message for
 * the user, while keeping the raw technical detail in Logcat for debugging.
 *
 * This does NOT change control flow — callers decide where and when to surface
 * the returned string; it only standardizes the wording so the same failure
 * reads the same way everywhere, and so raw exception text (e.g.
 * "Unable to resolve host", a socket timeout, or a bare HTTP status embedded in
 * a thrown message) never reaches a user.
 *
 * Pass a [fallback] that describes the specific thing that failed in friendly,
 * actionable terms (e.g. "Couldn't send your message. Please try again."). It
 * is used whenever the failure isn't a recognized network/auth/size/server case.
 */
fun Throwable.toUserMessage(fallback: String): String {
    // Always keep the real detail in the logs — never surfaced to the user.
    Log.e("Dilarion", "user-facing failure: $fallback", this)

    // Network / connectivity failures (no server reached).
    if (this is IOException) {
        return "Can't reach the server. Check your connection and try again."
    }

    if (this is HttpException) {
        return when {
            code() == 401 || code() == 403 -> "Your session expired. Please sign in again."
            code() == 413 -> "That file is too large to send."
            code() >= 500 -> "Something went wrong on our end. Please try again in a moment."
            else -> fallback
        }
    }

    return fallback
}
