# Dilarion iOS

Swift/SwiftUI iOS client for Dilarion.

## Requirements
- Xcode 15+
- iOS 16+ target
- macOS Ventura or later for development

## Structure

```
ios/
├── Package.swift                    # SPM manifest (WebRTC dependency)
├── Dilarion/
│   └── Sources/
│       ├── App/
│       │   ├── DilarionApp.swift    # @main entry point
│       │   ├── AppState.swift       # Global app state
│       │   └── MainTabView.swift    # Tab navigation
│       ├── Auth/
│       │   ├── AuthView.swift
│       │   └── AuthViewModel.swift
│       ├── Chat/
│       │   ├── ConversationsView.swift
│       │   ├── ConversationsViewModel.swift
│       │   ├── ChatView.swift
│       │   └── ChatViewModel.swift
│       ├── Calls/
│       │   └── CallsListView.swift  # TODO: CallView with WebRTC
│       ├── Groups/
│       │   ├── GroupsView.swift
│       │   └── GroupsViewModel.swift
│       ├── Settings/
│       │   └── SettingsView.swift
│       ├── Models/
│       │   └── Models.swift
│       ├── Networking/
│       │   ├── APIClient.swift
│       │   └── WebSocketManager.swift
│       └── Security/
│           ├── KeychainHelper.swift
│           └── EncryptionManager.swift
```

## Next Steps (TODO)

1. Create `Dilarion.xcodeproj` in Xcode → File > New > Project > iOS App
2. Add files from Sources/ into project
3. Add WebRTC SPM package
4. Implement `CallView.swift` with WebRTC (mirror Android CallScreen logic)
5. Add `Info.plist` permissions: microphone, camera, push notifications
6. Set up APNs push notifications (FCM or native APNs)
7. Implement `IncomingCallOverlay` (like Android's IncomingCallOverlay)
8. Add app lock (Face ID / Touch ID via LocalAuthentication)
9. Add `FLAG_SECURE` equivalent: `UIScreen.main` privacy mask
