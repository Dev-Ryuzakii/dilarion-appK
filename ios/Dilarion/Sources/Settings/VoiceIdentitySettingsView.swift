import SwiftUI

// Voice enrollment for decoy notes and speech the account owner types.
// See VoiceIdentityAPI.swift and the backend voice_clone.py.
@MainActor
final class VoiceIdentitySettingsViewModel: ObservableObject {
    @Published var isEnrolled = false
    @Published var isLoading = true
    @Published var isUploading = false
    @Published var error: String? = nil
    @Published var clips: [VoiceSpeechClip] = []
    @Published var speechText = ""
    @Published var isGenerating = false
    @Published var speechError: String? = nil
    @Published var playingId: String? = nil

    private var username: String { KeychainHelper.shared.read(key: "username") ?? "" }

    func refresh() {
        isLoading = true
        Task {
            let enrolled = await APIClient.shared.hasVoiceIdentity(username: username)
            isEnrolled = enrolled
            clips = enrolled ? ((try? await APIClient.shared.listVoiceSpeech()) ?? []) : []
            isLoading = false
        }
    }

    func upload(data: Data) async -> Bool {
        isUploading = true
        error = nil
        do {
            try await APIClient.shared.uploadVoiceIdentity(data: data)
            isEnrolled = true
            isUploading = false
            return true
        } catch {
            self.error = error.localizedDescription
            isUploading = false
            return false
        }
    }

    func generate() async {
        let spoken = speechText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !spoken.isEmpty else {
            speechError = "Enter the words to speak"
            return
        }
        isGenerating = true
        speechError = nil
        do {
            _ = try await APIClient.shared.createVoiceSpeech(text: spoken)
            speechText = ""
            clips = try await APIClient.shared.listVoiceSpeech()
            isGenerating = false
        } catch {
            speechError = error.localizedDescription
            isGenerating = false
        }
    }

    func preview(id: String) async {
        speechError = nil
        do {
            let data = try await APIClient.shared.downloadVoiceSpeech(id: id)
            let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("voice_speech_\(id).m4a")
            try data.write(to: url, options: .atomic)
            playingId = id
            AudioManager.shared.startPlaying(fileURL: url, mediaId: id) { [weak self] in
                Task { @MainActor in self?.playingId = nil }
            }
        } catch {
            speechError = error.localizedDescription
        }
    }

    func deleteClip(id: String) async {
        speechError = nil
        do {
            try await APIClient.shared.deleteVoiceSpeech(id: id)
            clips.removeAll { $0.id == id }
            if playingId == id {
                AudioManager.shared.stopPlaying()
                playingId = nil
            }
        } catch {
            speechError = error.localizedDescription
        }
    }

    func deleteEnrollment() async {
        isUploading = true
        error = nil
        do {
            try await APIClient.shared.deleteVoiceIdentity()
            AudioManager.shared.stopPlaying()
            isEnrolled = false
            clips = []
            playingId = nil
            isUploading = false
        } catch {
            self.error = error.localizedDescription
            isUploading = false
        }
    }
}

struct VoiceIdentitySettingsRow: View {
    @StateObject private var vm = VoiceIdentitySettingsViewModel()
    @State private var showEnrollSheet = false

    var body: some View {
        Button {
            showEnrollSheet = true
        } label: {
            HStack(spacing: 16) {
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 20))
                    .foregroundColor(.dilarionRed)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text("AI Voice Decoy")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.textPrimary)
                    Text(vm.isLoading ? "Checking…" : (vm.isEnrolled ? "Enrolled — decoys use your voice" : "Not set — voice notes get a generic decoy"))
                        .font(.system(size: 12))
                        .foregroundColor(.textSecondary)
                }

                Spacer()

                if !vm.isLoading {
                    Text(vm.isEnrolled ? "On" : "Off")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(vm.isEnrolled ? .green : .textSecondary)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.textSecondary.opacity(0.6))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color.surfaceWhite)
        }
        .buttonStyle(.plain)
        .disabled(vm.isLoading)
        .onAppear { vm.refresh() }
        .sheet(isPresented: $showEnrollSheet, onDismiss: { vm.refresh() }) {
            VoiceIdentityEnrollSheet(vm: vm) { showEnrollSheet = false }
        }
    }
}

private struct VoiceIdentityEnrollSheet: View {
    @ObservedObject var vm: VoiceIdentitySettingsViewModel
    let onDone: () -> Void

    @ObservedObject private var audio = AudioManager.shared
    @State private var recordingURL: URL? = nil
    @State private var recordedData: Data? = nil
    @State private var localError: String? = nil

    // Enough for a clean voice clone, short enough not to feel like a chore.
    private static let minSeconds: TimeInterval = 8
    private static let maxSeconds: TimeInterval = 30

    var body: some View {
        NavigationStack {
            ScrollView {
            VStack(spacing: 24) {
                Text("Read a sentence or two out loud — at least \(Int(Self.minSeconds))s. Decoy voice notes use this sample, and you can type English text below to preview speech in your own voice.")
                    .font(.system(size: 13))
                    .foregroundColor(.textSecondary)
                    .padding(.horizontal, 24)
                    .multilineTextAlignment(.center)

                Spacer()

                Button {
                    if audio.isRecording {
                        stopRecording()
                    } else {
                        startRecording()
                    }
                } label: {
                    ZStack {
                        Circle()
                            .fill(audio.isRecording ? Color.dilarionRed : Color.dilarionRed.opacity(0.15))
                            .frame(width: 88, height: 88)
                        Image(systemName: audio.isRecording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 32))
                            .foregroundColor(audio.isRecording ? .white : .dilarionRed)
                    }
                }

                Text(audio.isRecording ? "\(Int(audio.recordingDuration))s — tap to stop" : (recordedData != nil ? "Recorded \(Int(audio.recordingDuration))s — ready to save" : "Tap to record"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.textSecondary)

                if let localError {
                    Text(localError).foregroundColor(.red).font(.system(size: 12))
                }
                if let error = vm.error {
                    Text(error).foregroundColor(.red).font(.system(size: 12))
                }

                if vm.isEnrolled {
                    TextField("Text to speak", text: $vm.speechText, axis: .vertical)
                        .lineLimit(2...4)
                        .textFieldStyle(.roundedBorder)
                        .padding(.horizontal, 24)

                    Button {
                        Task { await vm.generate() }
                    } label: {
                        if vm.isGenerating { ProgressView() } else { Text("Generate speech").bold() }
                    }
                    .disabled(vm.isGenerating || vm.speechText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    if let speechError = vm.speechError {
                        Text(speechError).foregroundColor(.red).font(.system(size: 12)).padding(.horizontal, 24)
                    }

                    ForEach(vm.clips) { clip in
                        HStack {
                            Text(clip.text)
                                .font(.system(size: 13))
                                .lineLimit(2)
                            Spacer()
                            Button(vm.playingId == clip.id ? "Playing" : "Play") {
                                Task { await vm.preview(id: clip.id) }
                            }
                            Button("Delete") {
                                Task { await vm.deleteClip(id: clip.id) }
                            }
                        }
                        .padding(.horizontal, 24)
                    }

                    Button("Delete enrollment and clips", role: .destructive) {
                        Task { await vm.deleteEnrollment() }
                    }
                    .disabled(vm.isUploading)
                }

                Spacer()
            }
            }
            .padding(.vertical, 24)
            .navigationTitle("Your voice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        if audio.isRecording { audio.cancelRecording() }
                        onDone()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        guard let data = recordedData else { return }
                        Task {
                            if await vm.upload(data: data) { onDone() }
                        }
                    } label: {
                        if vm.isUploading { ProgressView() } else { Text("Save").bold() }
                    }
                    .disabled(recordedData == nil || vm.isUploading)
                }
            }
        }
    }

    private func startRecording() {
        localError = nil
        recordedData = nil
        let fileURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("voice_identity_\(UUID().uuidString).m4a")
        recordingURL = fileURL
        audio.requestPermissions { granted in
            guard granted else {
                localError = "Microphone permission denied"
                return
            }
            _ = audio.startRecording(to: fileURL)
        }
    }

    private func stopRecording() {
        guard let url = audio.stopRecording() else { return }
        guard audio.recordingDuration >= Self.minSeconds else {
            localError = "Recording too short — need at least \(Int(Self.minSeconds))s"
            try? FileManager.default.removeItem(at: url)
            return
        }
        recordedData = try? Data(contentsOf: url)
        try? FileManager.default.removeItem(at: url)
    }
}
