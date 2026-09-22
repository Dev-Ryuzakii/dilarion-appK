// Curated common-emoji set, grouped — not the full Unicode emoji database,
// but enough for a real picker (search + categories) without shipping a
// multi-thousand-entry dataset.

export const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: 'Smileys',
    emojis: ['😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😍', '🥰', '😘', '😋', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '😏', '😒', '😞', '😔', '😢', '😭', '😤', '😡', '🤬', '😱', '😨', '😰', '😥', '🥺', '😴', '🤤', '😷', '🤒', '🤕', '🤢', '🥵', '🥶', '😵', '🤯', '🤠', '🥸', '😬', '🙄', '😑'],
  },
  {
    label: 'Gestures',
    emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👊', '✊', '👏', '🙌', '👐', '🤲', '🙏', '💪', '🫡', '🖐️', '✋', '👋', '🤙', '☝️', '👆', '👇', '👈', '👉', '🫰', '🤝', '🖕'],
  },
  {
    label: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝'],
  },
  {
    label: 'Animals',
    emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦅', '🦉', '🐺', '🐗', '🐴', '🦄', '🐝', '🦋', '🐢', '🐍', '🦕', '🐙', '🐬', '🐳'],
  },
  {
    label: 'Food',
    emojis: ['🍏', '🍎', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🥭', '🍍', '🥥', '🍅', '🍕', '🍔', '🍟', '🌭', '🥪', '🌮', '🌯', '🍣', '🍜', '🍝', '🍿', '🍩', '🍪', '🎂', '🍰', '🍫', '🍬', '🍭', '☕', '🍵', '🥤', '🍺', '🍷', '🥂'],
  },
  {
    label: 'Activities',
    emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎱', '🏓', '🏸', '🥊', '🎮', '🎲', '🎯', '🎳', '🎸', '🎤', '🎧', '🎨', '🎬', '📷', '✈️', '🚗', '🚀', '⛵'],
  },
  {
    label: 'Objects',
    emojis: ['💡', '🔥', '✨', '🎉', '🎊', '🎁', '🏆', '⭐', '🌟', '💯', '✅', '❌', '⚠️', '🔒', '🔓', '📌', '📎', '💰', '💎', '⏰', '📱', '💻', '🔋', '🔑'],
  },
];

export function searchEmoji(query: string): string[] {
  // No metadata to search by keyword with this small a catalog — search just
  // narrows to categories whose label matches, falling back to everything.
  const q = query.trim().toLowerCase();
  if (!q) return EMOJI_CATEGORIES.flatMap(c => c.emojis);
  const matched = EMOJI_CATEGORIES.filter(c => c.label.toLowerCase().includes(q));
  return matched.length ? matched.flatMap(c => c.emojis) : EMOJI_CATEGORIES.flatMap(c => c.emojis);
}
