package com.dilarion.app.ui.screens.calls

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dilarion.app.data.model.IncomingCallData
import com.dilarion.app.services.PresenceService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CallOverlayViewModel @Inject constructor(
    private val presenceService: PresenceService,
) : ViewModel() {

    private val _incomingCall = MutableStateFlow<IncomingCallData?>(null)
    val incomingCall: StateFlow<IncomingCallData?> = _incomingCall

    init {
        viewModelScope.launch {
            presenceService.events.collect { event ->
                if (event.type == "incoming_call") {
                    val data = event.data ?: return@collect
                    val callId = data.get("call_id")?.asInt ?: return@collect
                    val caller = data.get("caller_username")?.asString ?: ""
                    val callType = data.get("call_type")?.asString ?: "voice"
                    val offerSdp = data.get("offer_sdp")?.asString
                    _incomingCall.value = IncomingCallData(callId, caller, callType, offerSdp)
                }
            }
        }
    }

    fun clear() { _incomingCall.value = null }

    fun setFromNotification(call: IncomingCallData) {
        _incomingCall.value = call
    }
}
