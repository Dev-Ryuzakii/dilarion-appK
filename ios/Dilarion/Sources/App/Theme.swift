import SwiftUI

// MARK: — Brand colours (mirror Kotlin Color.kt exactly)
extension Color {
    static let dilarionRed      = Color(hex: 0xD83428)
    static let dilarionRedDark  = Color(hex: 0xB82A20)
    static let dilarionRedLight = Color(hex: 0xF5A09B)
    static let surfaceWhite     = Color(hex: 0xFFFFFF)
    static let backgroundGrey   = Color(hex: 0xF0F2F5)
    static let chatBubbleSelf   = Color(hex: 0xDCF8C6)   // WhatsApp-style green
    static let chatBubbleOther  = Color(hex: 0xFFFFFF)
    static let textPrimary      = Color(hex: 0x111827)
    static let textSecondary    = Color(hex: 0x667781)
    static let borderGrey       = Color(hex: 0xE9EDEF)
    static let onlineGreen      = Color(hex: 0x25D366)

    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8)  & 0xFF) / 255
        let b = Double(hex         & 0xFF) / 255
        self.init(red: r, green: g, blue: b)
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
