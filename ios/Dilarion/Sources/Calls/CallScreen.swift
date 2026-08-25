import SwiftUI
import WebRTC

struct CallScreen: View {
    @ObservedObject var vm: CallViewModel
    let masterToken: String
    let onDismiss: () -> Void
    
    var body: some View {
        ZStack {
            // Dark elegant calling background
            Color(hex: 0x121212)
                .ignoresSafeArea()
            
            // Video view (remote background)
            if vm.uiState.callType == .video && vm.uiState.state == .connected {
                if let remoteTrack = vm.remoteVideoTrack {
                    WebRTCVideoView(track: remoteTrack)
                        .ignoresSafeArea()
                } else {
                    VStack {
                        ProgressView()
                            .tint(.white)
                        Text("Waiting for remote video...")
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.7))
                            .padding(.top, 8)
                    }
                }
                
                // Local video PiP overlay
                if let localTrack = vm.localVideoTrack {
                    VStack {
                        HStack {
                            Spacer()
                            WebRTCVideoView(track: localTrack)
                                .frame(width: 90, height: 135)
                                .cornerRadius(12)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.white.opacity(0.3), lineWidth: 1)
                                )
                                .padding(.trailing, 16)
                                .padding(.top, 16)
                        }
                        Spacer()
                    }
                }
            } else {
                // Voice call / Non-connected states: Avatar & Name
                VStack(spacing: 24) {
                    Spacer()
                    
                    // Large initials avatar
                    Circle()
                        .fill(Color.dilarionRed)
                        .frame(width: 120, height: 120)
                        .overlay(
                            Text(String(vm.uiState.peerUsername.prefix(1)).uppercased())
                                .font(.system(size: 48, weight: .bold))
                                .foregroundColor(.white)
                        )
                        .shadow(color: Color.dilarionRed.opacity(0.4), radius: 10, y: 4)
                    
                    VStack(spacing: 8) {
                        Text(vm.uiState.peerUsername)
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)
                        
                        Text(statusText)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(statusColor)
                    }
                    
                    Spacer()
                }
            }
            
            // Overlay controls (Always present on top)
            VStack {
                // Network quality indicator (top left)
                if vm.uiState.state == .connected {
                    HStack {
                        HStack(spacing: 4) {
                            Image(systemName: "wifi")
                            Text("Quality: \(vm.uiState.networkQuality)/4")
                        }
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.black.opacity(0.5))
                        .clipShape(Capsule())
                        .padding(.leading, 16)
                        .padding(.top, 16)
                        Spacer()
                    }
                }
                
                Spacer()
                
                // Bottom control actions
                VStack(spacing: 24) {
                    if vm.uiState.state == .incoming {
                        // Accept / Decline options
                        HStack(spacing: 64) {
                            Button {
                                vm.declineCall()
                            } label: {
                                VStack(spacing: 8) {
                                    Image(systemName: "phone.down.fill")
                                        .font(.system(size: 24))
                                        .foregroundColor(.white)
                                        .frame(width: 64, height: 64)
                                        .background(Color.dilarionRed)
                                        .clipShape(Circle())
                                    Text("Decline")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundColor(.white.opacity(0.8))
                                }
                            }
                            
                            Button {
                                vm.acceptCall(masterToken: masterToken)
                            } label: {
                                VStack(spacing: 8) {
                                    Image(systemName: "phone.fill")
                                        .font(.system(size: 24))
                                        .foregroundColor(.white)
                                        .frame(width: 64, height: 64)
                                        .background(Color.green)
                                        .clipShape(Circle())
                                    Text("Accept")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundColor(.white.opacity(0.8))
                                }
                            }
                        }
                    } else if vm.uiState.state == .ended && vm.uiState.endedByMe {
                        // Empty control space when call is ending
                        Text("Ending session...")
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.5))
                    } else if vm.uiState.state == .ended {
                        // The other side ended, declined, or never answered —
                        // offer the redial here rather than sending the user
                        // back to the contact list to try again.
                        HStack(spacing: 28) {
                            Button {
                                onDismiss()
                            } label: {
                                VStack(spacing: 8) {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 22))
                                        .foregroundColor(.white)
                                        .frame(width: 56, height: 56)
                                        .background(Color.white.opacity(0.15))
                                        .clipShape(Circle())
                                    Text("Close")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundColor(.white.opacity(0.8))
                                }
                            }

                            Button {
                                vm.startOutgoingCall(peerUsername: vm.uiState.peerUsername, type: .voice)
                            } label: {
                                VStack(spacing: 8) {
                                    Image(systemName: "phone.fill")
                                        .font(.system(size: 24))
                                        .foregroundColor(.white)
                                        .frame(width: 64, height: 64)
                                        .background(Color.green)
                                        .clipShape(Circle())
                                    Text("Call back")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundColor(.white.opacity(0.8))
                                }
                            }

                            Button {
                                vm.startOutgoingCall(peerUsername: vm.uiState.peerUsername, type: .video)
                            } label: {
                                VStack(spacing: 8) {
                                    Image(systemName: "video.fill")
                                        .font(.system(size: 22))
                                        .foregroundColor(.white)
                                        .frame(width: 56, height: 56)
                                        .background(Color.blue)
                                        .clipShape(Circle())
                                    Text("Video")
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundColor(.white.opacity(0.8))
                                }
                            }
                        }
                    } else {
                        // Active call option: mute, speaker, end
                        HStack(spacing: 28) {
                            Button {
                                vm.toggleMute()
                            } label: {
                                Image(systemName: vm.uiState.isMuted ? "mic.slash.fill" : "mic.fill")
                                    .font(.system(size: 20))
                                    .foregroundColor(.white)
                                    .frame(width: 52, height: 52)
                                    .background(vm.uiState.isMuted ? Color.white.opacity(0.3) : Color.white.opacity(0.15))
                                    .clipShape(Circle())
                            }
                            
                            if vm.uiState.callType == .video {
                                Button {
                                    vm.flipCamera()
                                } label: {
                                    Image(systemName: "camera.rotate.fill")
                                        .font(.system(size: 20))
                                        .foregroundColor(.white)
                                        .frame(width: 52, height: 52)
                                        .background(Color.white.opacity(0.15))
                                        .clipShape(Circle())
                                }
                            }
                            
                            Button {
                                vm.toggleSpeaker()
                            } label: {
                                Image(systemName: vm.uiState.isSpeaker ? "speaker.wave.3.fill" : "speaker.wave.1.fill")
                                    .font(.system(size: 20))
                                    .foregroundColor(.white)
                                    .frame(width: 52, height: 52)
                                    .background(vm.uiState.isSpeaker ? Color.white.opacity(0.3) : Color.white.opacity(0.15))
                                    .clipShape(Circle())
                            }
                            
                            Button {
                                vm.endCall()
                            } label: {
                                Image(systemName: "phone.down.fill")
                                    .font(.system(size: 24))
                                    .foregroundColor(.white)
                                    .frame(width: 64, height: 64)
                                    .background(Color.dilarionRed)
                                    .clipShape(Circle())
                            }
                        }
                    }
                }
                .padding(.bottom, 48)
            }
        }
        .statusBarHidden(true)
        .onChange(of: vm.uiState.state) { state in
            // Only auto-dismiss the call we ended ourselves — a call the other
            // side ended stays up so its "Call back" buttons can be used.
            if state == .ended && vm.uiState.endedByMe {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                    onDismiss()
                }
            }
        }
    }
    
    private var statusText: String {
        switch vm.uiState.state {
        case .idle: return "Idle"
        case .calling: return "Calling..."
        case .ringing: return "Ringing..."
        case .incoming: return vm.uiState.callType == .video ? "Incoming Video Call" : "Incoming Voice Call"
        case .connected:
            let min = vm.uiState.durationSeconds / 60
            let sec = vm.uiState.durationSeconds % 60
            return String(format: "%02d:%02d", min, sec)
        case .ended: return "Call Ended"
        }
    }
    
    private var statusColor: Color {
        switch vm.uiState.state {
        case .connected: return .green
        case .ended: return Color.dilarionRed
        default: return .white.opacity(0.7)
        }
    }
}

// MARK: - WebRTC Video View wrapper
struct WebRTCVideoView: UIViewRepresentable {
    let track: RTCVideoTrack?
    
    func makeUIView(context: Context) -> RTCMTLVideoView {
        let view = RTCMTLVideoView()
        view.videoContentMode = .scaleAspectFill
        view.clipsToBounds = true
        return view
    }
    
    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {
        if let track = track {
            track.add(uiView)
        }
    }
}
