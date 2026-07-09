import Foundation
import AVFoundation

class AudioManager: NSObject, ObservableObject, AVAudioRecorderDelegate, AVAudioPlayerDelegate {
    static let shared = AudioManager()
    private override init() {
        super.init()
    }

    private var audioRecorder: AVAudioRecorder?
    private var audioPlayer: AVAudioPlayer?
    private var notificationPlayer: AVAudioPlayer?
    private var ringtoneAudioPlayer: AVAudioPlayer?

    @Published var isRecording = false
    @Published var recordingDuration: TimeInterval = 0
    private var timer: Timer?

    @Published var playingMediaId: String? = nil
    private var onPlaybackFinished: (() -> Void)?

    func playNotificationSound() {
        guard let url = Bundle.main.url(forResource: "beep", withExtension: "mp3") else { return }
        do {
            // Play notification sound concurrently without interrupting background music if possible
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.ambient, mode: .default, options: [])
            notificationPlayer = try AVAudioPlayer(contentsOf: url)
            notificationPlayer?.play()
        } catch {
            print("Failed to play notification sound: \(error)")
        }
    }

    func startRingtone() {
        guard let url = Bundle.main.url(forResource: "ringingtone", withExtension: "mp3") else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            ringtoneAudioPlayer = try AVAudioPlayer(contentsOf: url)
            ringtoneAudioPlayer?.numberOfLoops = -1
            ringtoneAudioPlayer?.play()
        } catch {
            print("Failed to play ringtone loop: \(error)")
        }
    }

    func stopRingtone() {
        ringtoneAudioPlayer?.stop()
        ringtoneAudioPlayer = nil
    }

    private func setupAudioSession(forRecording: Bool) {
        let session = AVAudioSession.sharedInstance()
        do {
            if forRecording {
                try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            } else {
                try session.setCategory(.playback, mode: .default, options: [])
            }
            try session.setActive(true)
        } catch {
            print("Failed to setup audio session: \(error)")
        }
    }

    func requestPermissions(completion: @escaping (Bool) -> Void) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                completion(granted)
            }
        }
    }

    func startRecording(to fileURL: URL) -> Bool {
        setupAudioSession(forRecording: true)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 12000.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        
        do {
            audioRecorder = try AVAudioRecorder(url: fileURL, settings: settings)
            audioRecorder?.delegate = self
            guard audioRecorder?.record() == true else { return false }
            
            isRecording = true
            recordingDuration = 0
            timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                guard let self = self else { return }
                self.recordingDuration += 1
            }
            return true
        } catch {
            print("Failed to start recording: \(error)")
            return false
        }
    }

    func stopRecording() -> URL? {
        timer?.invalidate()
        timer = nil
        isRecording = false
        
        guard let url = audioRecorder?.url else { return nil }
        audioRecorder?.stop()
        audioRecorder = nil
        return url
    }

    func cancelRecording() {
        timer?.invalidate()
        timer = nil
        isRecording = false
        audioRecorder?.stop()
        audioRecorder?.deleteRecording()
        audioRecorder = nil
    }

    func startPlaying(fileURL: URL, mediaId: String, onFinished: @escaping () -> Void) {
        stopPlaying()
        setupAudioSession(forRecording: false)
        
        do {
            audioPlayer = try AVAudioPlayer(contentsOf: fileURL)
            audioPlayer?.delegate = self
            guard audioPlayer?.play() == true else {
                onFinished()
                return
            }
            
            playingMediaId = mediaId
            onPlaybackFinished = onFinished
        } catch {
            print("Failed to play audio: \(error)")
            onFinished()
        }
    }

    func stopPlaying() {
        audioPlayer?.stop()
        audioPlayer = nil
        playingMediaId = nil
        onPlaybackFinished?()
        onPlaybackFinished = nil
    }

    // MARK: - AVAudioPlayerDelegate
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.stopPlaying()
        }
    }
}
