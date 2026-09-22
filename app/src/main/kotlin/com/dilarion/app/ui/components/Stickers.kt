package com.dilarion.app.ui.components

// Original, hand-picked "sticker" set — rendered large in a colored circle
// (see StickerTile in MediaPicker.kt) rather than shipped as bitmap assets,
// matching the desktop app's own no-bitmap-art choice for this feature.

data class StickerDef(val id: String, val label: String, val glyph: String, val colorHex: Long)

val STICKERS: List<StickerDef> = listOf(
    StickerDef("thumbsup", "Thumbs up", "👍", 0xFF25D366),
    StickerDef("heart", "Heart", "❤️", 0xFFE53935),
    StickerDef("fire", "Fire", "🔥", 0xFFFF7043),
    StickerDef("party", "Party", "🎉", 0xFFAB47BC),
    StickerDef("clap", "Clap", "👏", 0xFFFFB300),
    StickerDef("laugh", "Laugh", "😂", 0xFFFDD835),
    StickerDef("sad", "Sad", "😢", 0xFF42A5F5),
    StickerDef("loveeyes", "Love eyes", "😍", 0xFFEC407A),
    StickerDef("wave", "Wave", "👋", 0xFF26A69A),
    StickerDef("ok", "OK", "👌", 0xFF66BB6A),
)

fun stickerById(id: String): StickerDef? = STICKERS.find { it.id == id }
