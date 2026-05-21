package com.dilarion.app.utils

object FakeTextGenerator {
    private val phrases = listOf(
        "Okay, sounds good.", "Got it, thanks!", "I'll check on that.",
        "Sure, no problem.", "On my way.", "Let me know.", "Will do!",
        "Talk later.", "Roger that.", "All good here.",
        "Understood.", "Noted.", "Confirmed.", "See you then.",
        "Give me a moment.", "I'm on it.", "Thanks for the update.",
    )

    fun generate(): String = phrases.random()
}
