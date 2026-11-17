// Appearance tokens shared by every screen: auth, onboarding and the main
// app. Applied once in main.tsx before the first render so nothing flashes
// in the old dark palette.

export const ACCENT_COLORS = [
  { name: 'Red',    value: '#c0392b' },
  { name: 'Blue',   value: '#1565c0' },
  { name: 'Green',  value: '#16a34a' },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Pink',   value: '#db2777' },
];

export interface ThemeColors {
  bg: string; panel: string; card: string;
  textPrimary: string; textSecondary: string; textMuted: string;
  border: string; inputBg: string; avatarBg: string; avatarText: string; itemHover: string;
  itemActiveBg: string; tabActiveBg: string;
  chatBg: string; chatBgImage: string;
  bubbleMineBg: string; bubbleTheirsBg: string; bubbleText: string;
  headerBg: string; inputBarBg: string; inputFieldBg: string;
}

export const DARK_VARIANTS: { name: string; colors: ThemeColors }[] = [
  { name: 'Dark', colors: {
    bg: '#0e0e0e', panel: '#111111', card: '#1a1a1a',
    textPrimary: '#f1f5f9', textSecondary: '#d1d5db', textMuted: '#6b7280',
    border: '#1e1e1e', inputBg: '#1a1a1a', avatarBg: '#2a2a2a', avatarText: '#d1d5db',
    itemHover: 'rgba(255,255,255,0.04)', itemActiveBg: '#1e1e1e', tabActiveBg: '#1a0d0d',
    chatBg: '#0e0e0e', chatBgImage: 'url(/chat_bg.png)',
    bubbleMineBg: '#2a1515', bubbleTheirsBg: '#1a1a1a', bubbleText: '#f1f5f9',
    headerBg: '#141414', inputBarBg: '#141414', inputFieldBg: '#1a1a1a',
  }},
  { name: 'Pitch Black', colors: {
    bg: '#000000', panel: '#0a0a0a', card: '#101010',
    textPrimary: '#f1f5f9', textSecondary: '#d1d5db', textMuted: '#6b7280',
    border: '#1a1a1a', inputBg: '#111111', avatarBg: '#1f1f1f', avatarText: '#d1d5db',
    itemHover: 'rgba(255,255,255,0.03)', itemActiveBg: '#151515', tabActiveBg: '#100808',
    chatBg: '#000000', chatBgImage: 'url(/chat_bg.png)',
    bubbleMineBg: '#1a0a0a', bubbleTheirsBg: '#111111', bubbleText: '#f1f5f9',
    headerBg: '#0a0a0a', inputBarBg: '#0a0a0a', inputFieldBg: '#111111',
  }},
  { name: 'Slate', colors: {
    bg: '#0f172a', panel: '#1e293b', card: '#293548',
    textPrimary: '#e2e8f0', textSecondary: '#cbd5e1', textMuted: '#64748b',
    border: '#334155', inputBg: '#1e293b', avatarBg: '#334155', avatarText: '#cbd5e1',
    itemHover: 'rgba(255,255,255,0.05)', itemActiveBg: '#293548', tabActiveBg: '#0d1b2e',
    chatBg: '#0f172a', chatBgImage: 'url(/chat_bg.png)',
    bubbleMineBg: '#1e3a5f', bubbleTheirsBg: '#1e293b', bubbleText: '#e2e8f0',
    headerBg: '#1e293b', inputBarBg: '#1e293b', inputFieldBg: '#293548',
  }},
];

export const LIGHT_THEME: ThemeColors = {
  bg: '#ffffff', panel: '#ffffff', card: '#f5f5f6',
  textPrimary: '#18181b', textSecondary: '#3f3f46', textMuted: '#8a8a93',
  border: '#ececef', inputBg: '#f5f5f6', avatarBg: '#ececef', avatarText: '#3f3f46',
  itemHover: 'rgba(24,24,27,0.04)', itemActiveBg: '#f1f1f3', tabActiveBg: '#f1f1f3',
  chatBg: '#ffffff', chatBgImage: 'none',
  bubbleMineBg: '#c0392b', bubbleTheirsBg: '#f4f4f5', bubbleText: '#27272a',
  headerBg: '#ffffff', inputBarBg: '#ffffff', inputFieldBg: '#ffffff',
};

export const FONT_SIZES = [
  { name: 'S', label: 'Small',  value: '13px' },
  { name: 'M', label: 'Medium', value: '14px' },
  { name: 'L', label: 'Large',  value: '16px' },
];

export interface AppearancePrefs {
  accent: string;
  colorMode: 'system' | 'dark' | 'light';
  darkVariant: number;
  fontSize: string;
}

export function loadAppearance(): AppearancePrefs {
  try {
    const s = localStorage.getItem('dilarion_appearance');
    if (s) {
      const stored = JSON.parse(s);
      // The 2026 redesign is light-first. Earlier installs saved 'dark' as the
      // old default, so switch them once; a later choice is kept.
      const migrated = stored.layoutVersion === 2;
      return {
        accent:      stored.accent      ?? '#c0392b',
        colorMode:   migrated ? (stored.colorMode ?? 'light') : 'light',
        darkVariant: stored.darkVariant ?? stored.themeIdx ?? 0,
        fontSize:    stored.fontSize    ?? '14px',
      };
    }
  } catch {}
  return { accent: '#c0392b', colorMode: 'light', darkVariant: 0, fontSize: '14px' };
}

export function resolveThemeColors(p: AppearancePrefs): ThemeColors {
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = p.colorMode === 'system' ? prefersDark : p.colorMode === 'dark';
  return isDark ? (DARK_VARIANTS[p.darkVariant]?.colors ?? DARK_VARIANTS[0].colors) : LIGHT_THEME;
}

export function applyAppearance(p: AppearancePrefs) {
  const t = resolveThemeColors(p);
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = p.colorMode === 'system' ? prefersDark : p.colorMode === 'dark';
  const r = document.documentElement;
  r.style.setProperty('--accent',            p.accent);
  r.style.setProperty('--bg-base',           t.bg);
  r.style.setProperty('--bg-panel',          t.panel);
  r.style.setProperty('--bg-card',           t.card);
  r.style.setProperty('--text-primary',      t.textPrimary);
  r.style.setProperty('--text-secondary',    t.textSecondary);
  r.style.setProperty('--text-muted',        t.textMuted);
  r.style.setProperty('--border-color',      t.border);
  r.style.setProperty('--input-bg',          t.inputBg);
  r.style.setProperty('--avatar-bg',         t.avatarBg);
  r.style.setProperty('--avatar-text',       t.avatarText);
  r.style.setProperty('--item-hover',        t.itemHover);
  r.style.setProperty('--item-active-bg',    t.itemActiveBg);
  r.style.setProperty('--tab-active-bg',     t.tabActiveBg);
  r.style.setProperty('--chat-bg',           t.chatBg);
  r.style.setProperty('--chat-bg-image',     t.chatBgImage);
  r.style.setProperty('--bubble-mine-bg',    isDark ? t.bubbleMineBg : p.accent);
  r.style.setProperty('--bubble-mine-text',  '#fff');
  r.style.setProperty('--bubble-theirs-bg',  t.bubbleTheirsBg);
  r.style.setProperty('--bubble-theirs-text',t.bubbleText);
  r.style.setProperty('--header-bg',         t.headerBg);
  r.style.setProperty('--input-bar-bg',      t.inputBarBg);
  r.style.setProperty('--input-field-bg',    t.inputFieldBg);
  r.style.setProperty('--frame-bg', isDark
    ? 'linear-gradient(160deg, #3a120d 0%, #160807 55%, #0a0a0a 100%)'
    : `linear-gradient(160deg, ${p.accent} 0%, #7a1d14 60%, #4a0f0a 100%)`);
  r.style.setProperty('--rail-fg', 'rgba(255,255,255,0.78)');
  r.style.setProperty('--rail-tile', 'rgba(255,255,255,0.14)');
  r.style.setProperty('--rail-tile-active', 'rgba(255,255,255,0.26)');
  r.dataset.theme = isDark ? 'dark' : 'light';
  r.style.fontSize = p.fontSize;
}

/** Save prefs and apply them. The layoutVersion marks the light-first redesign. */
export function saveAppearance(next: AppearancePrefs) {
  applyAppearance(next);
  try { localStorage.setItem('dilarion_appearance', JSON.stringify({ ...next, layoutVersion: 2 })); } catch { /* storage unavailable */ }
}
