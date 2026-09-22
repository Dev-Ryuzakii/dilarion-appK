package com.dilarion.app.ui.components

// Curated common-emoji set, grouped — not the full Unicode emoji database,
// but enough for a real picker (search + categories) without shipping a
// multi-thousand-entry dataset. Mirrors the desktop app's catalog.

data class EmojiCategory(val label: String, val emojis: List<String>)

val EMOJI_CATEGORIES: List<EmojiCategory> = listOf(
    EmojiCategory(
        "Smileys",
        listOf("😀", "😁", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😍", "🥰", "😘", "😋", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥳", "😏", "😒", "😞", "😔", "😢", "😭", "😤", "😡", "🤬", "😱", "😨", "😰", "😥", "🥺", "😴", "🤤", "😷", "🤒", "🤕", "🤢", "🥵", "🥶", "😵", "🤯", "🤠", "🥸", "😬", "🙄", "😑"),
    ),
    EmojiCategory(
        "Gestures",
        listOf("👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "👊", "✊", "👏", "🙌", "👐", "🤲", "🙏", "💪", "🫡", "🖐️", "✋", "👋", "🤙", "☝️", "👆", "👇", "👈", "👉", "🫰", "🤝", "🖕"),
    ),
    EmojiCategory(
        "Hearts",
        listOf("❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝"),
    ),
    EmojiCategory(
        "Animals",
        listOf("🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦅", "🦉", "🐺", "🐗", "🐴", "🦄", "🐝", "🦋", "🐢", "🐍", "🦕", "🐙", "🐬", "🐳"),
    ),
    EmojiCategory(
        "Food",
        listOf("🍏", "🍎", "🍌", "🍉", "🍇", "🍓", "🍒", "🍑", "🥭", "🍍", "🥥", "🍅", "🍕", "🍔", "🍟", "🌭", "🥪", "🌮", "🌯", "🍣", "🍜", "🍝", "🍿", "🍩", "🍪", "🎂", "🍰", "🍫", "🍬", "🍭", "☕", "🍵", "🥤", "🍺", "🍷", "🥂"),
    ),
    EmojiCategory(
        "Activities",
        listOf("⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🎱", "🏓", "🏸", "🥊", "🎮", "🎲", "🎯", "🎳", "🎸", "🎤", "🎧", "🎨", "🎬", "📷", "✈️", "🚗", "🚀", "⛵"),
    ),
    EmojiCategory(
        "Objects",
        listOf("💡", "🔥", "✨", "🎉", "🎊", "🎁", "🏆", "⭐", "🌟", "💯", "✅", "❌", "⚠️", "🔒", "🔓", "📌", "📎", "💰", "💎", "⏰", "📱", "💻", "🔋", "🔑"),
    ),
)

fun searchEmoji(query: String): List<String> {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return EMOJI_CATEGORIES.flatMap { it.emojis }
    val matched = EMOJI_CATEGORIES.filter { it.label.lowercase().contains(q) }
    return (if (matched.isNotEmpty()) matched else EMOJI_CATEGORIES).flatMap { it.emojis }
}
