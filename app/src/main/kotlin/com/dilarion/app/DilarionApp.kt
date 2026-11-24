package com.dilarion.app

import android.app.Application
import com.afribase.watch.AfribaseWatch
import com.afribase.watch.WatchConfig
import com.dilarion.app.security.SessionManager
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class DilarionApp : Application() {

    @Inject lateinit var sessionManager: SessionManager

    /** Logged-in username for Watch (hashed server-side); null when logged out. */
    @Volatile private var watchUser: String? = null

    override fun onCreate() {
        super.onCreate()
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            combine(sessionManager.sessionToken, sessionManager.username) { token, name ->
                if (token == null) null else name
            }.collect { watchUser = it }
        }
        // Base1 Watch: errors, UX signals and wireframe session replay. The
        // abw_ ingest key is write-only and meant to ship in the app.
        AfribaseWatch.init(
            this,
            WatchConfig(
                key = "abw_Sk8xQS84EIBreWKAvDsYFIkxTkJ-Kn7dJ6MwIfIspXQ",
                endpoint = "https://api.useafribase.app/watch/ingest",
                release = BuildConfig.VERSION_NAME,
                environment = BuildConfig.FLAVOR,
                replay = true,
                // MainActivity sets FLAG_SECURE. Replay is a wireframe with all
                // text masked and never takes pixels, so it stays safe there.
                replayOnSecureWindows = true,
                user = { watchUser },
            ),
        )
    }
}
