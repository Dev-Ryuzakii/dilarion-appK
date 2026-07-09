import SwiftUI
import UIKit

// MARK: — Appearance mode (Settings → Appearance)
enum AppearanceMode: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    static let storageKey = "appearance_mode"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "System Default"
        case .light:  return "Light"
        case .dark:   return "Dark"
        }
    }

    var icon: String {
        switch self {
        case .system: return "circle.lefthalf.filled"
        case .light:  return "sun.max.fill"
        case .dark:   return "moon.fill"
        }
    }

    // nil = follow the system setting
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light:  return .light
        case .dark:   return .dark
        }
    }
}

// MARK: — Brand colours (light values mirror Kotlin Color.kt exactly)
extension Color {
    static let dilarionRed      = Color(hex: 0xD83428)
    static let dilarionRedDark  = Color(hex: 0xB82A20)
    static let dilarionRedLight = Color(hex: 0xF5A09B)
    static let surfaceWhite     = Color(light: 0xFFFFFF, dark: 0x1F2C34)
    static let backgroundGrey   = Color(light: 0xF0F2F5, dark: 0x0B141A)
    static let chatBubbleSelf   = Color(light: 0xDCF8C6, dark: 0x005C4B)   // WhatsApp-style green
    static let chatBubbleOther  = Color(light: 0xFFFFFF, dark: 0x1F2C34)
    static let textPrimary      = Color(light: 0x111827, dark: 0xE9EDEF)
    static let textSecondary    = Color(light: 0x667781, dark: 0x8696A0)
    static let borderGrey       = Color(light: 0xE9EDEF, dark: 0x2A3942)
    static let onlineGreen      = Color(hex: 0x25D366)

    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8)  & 0xFF) / 255
        let b = Double(hex         & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
    }

    // Adaptive colour that resolves per the current light/dark trait
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { trait in
            let hex = trait.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

// MARK: — Avatar colours (mirrors Kotlin AVATAR_COLORS)
let avatarPalette: [Color] = [
    Color(hex: 0x7C3AED),
    Color(hex: 0x0891B2),
    Color(hex: 0x059669),
    Color(hex: 0xD97706),
    Color(hex: 0xC0392B),
    Color(hex: 0xDB2777),
]

func avatarColor(for username: String) -> Color {
    let h = abs(username.hashValue)
    return avatarPalette[h % avatarPalette.count]
}

func initials(for name: String) -> String {
    let parts = name.components(separatedBy: CharacterSet(charactersIn: " _-")).filter { !$0.isEmpty }
    if parts.count >= 2 {
        return String(parts[0].prefix(1) + parts[1].prefix(1)).uppercased()
    }
    return String(name.prefix(2)).uppercased()
}

// MARK: — Decoy phrases (mirror Kotlin DECOY_PHRASES)
let decoyPhrases = [
    "Hey, how are you doing?",
    "Let me know when you're free.",
    "Sounds good to me!",
    "Can we talk later?",
    "I'll send that over shortly.",
    "Got it, thanks!",
    "Sure, that works.",
    "On my way now.",
    "Just checking in.",
    "All good here.",
    "Will do, see you soon.",
    "That makes sense.",
    "Let me check and get back to you.",
    "Okay, perfect.",
    "Noted, thanks!",
]

func decoyFor(id: Int) -> String {
    decoyPhrases[abs(id) % decoyPhrases.count]
}
