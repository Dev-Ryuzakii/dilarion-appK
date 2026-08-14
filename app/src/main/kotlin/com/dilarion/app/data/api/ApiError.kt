package com.dilarion.app.data.api

import okhttp3.ResponseBody
import org.json.JSONObject

/** FastAPI error bodies are `{"detail": "..."}`; fall back to a generic message when parsing fails. */
fun ResponseBody?.parseErrorDetail(fallback: String): String {
    val raw = this?.string()?.takeIf { it.isNotBlank() } ?: return fallback
    return runCatching { JSONObject(raw).optString("detail", fallback) }.getOrDefault(fallback)
}
