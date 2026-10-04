package com.dilarion.app.ui.screens.splash

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.monitoring.MonitoringForegroundService
import com.dilarion.app.security.SessionManager
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class SplashDestination { LOADING, AUTH, HOME, ONBOARDING }

@HiltViewModel
class SplashViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val sessionManager: SessionManager,
    private val presenceService: PresenceService,
) : ViewModel() {

    private val _destination = MutableStateFlow(SplashDestination.LOADING)
    val destination: StateFlow<SplashDestination> = _destination

    init {
        viewModelScope.launch {
            delay(2000)
            val session = sessionManager.getSnapshot()
            if (session == null) {
                _destination.value = SplashDestination.AUTH
            } else if (sessionManager.onboardingPending.first()) {
                // Activated but the mandatory profile/camera step isn't done.
                _destination.value = SplashDestination.ONBOARDING
            } else {
                presenceService.connect(session.token)
                MonitoringForegroundService.start(context)
                _destination.value = SplashDestination.HOME
            }
        }
    }
}
