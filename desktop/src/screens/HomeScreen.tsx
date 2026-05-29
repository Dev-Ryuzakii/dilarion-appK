import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { presenceService, WsMessage } from '../services/presence';
import { setToken as setMonitorToken, handleCommand } from '../services/monitoring';
import {
  getConversations,
  getGroups,
  getCallHistory,
  getUsers,
  confirmMasterToken,
  createMasterToken,
  Contact,
  Group,
  CallRecord,
} from '../services/api';
import ChatPanel from './ChatPanel';
import GroupPanel from './GroupPanel';
import CallModal, { CallType, IncomingCall } from './CallModal';
import {
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
  PhoneMissedIcon,
  EyeIcon,
  EyeOffIcon,
} from '../components/Icons';

interface Props {
  token: string;
  username: string;
  onLogout: () => void;
}

type Tab = 'chats' | 'groups' | 'calls' | 'settings';

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function groupColor(id: number): string {
  const colors = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#c0392b', '#db2777'];
  return colors[id % colors.length];
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}m ${s}s`;
}

function fmtCallTime(ts: string): string {
  try {
    return new Date(ts).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// ── Shimmer ────────────────────────────────────────────────────────────────────

function Shimmer({ w, h, r = 8 }: { w: string | number; h: number; r?: number }) {
  return (
    <div
      className="shimmer"
      style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }}
    />
  );
}

function ContactSkeleton() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 16px', alignItems: 'center' }}>
          <Shimmer w={46} h={46} r={23} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Shimmer w="52%" h={12} />
            <Shimmer w="35%" h={10} />
          </div>
        </div>
      ))}
    </>
  );
}

// ── Tab bar icons ──────────────────────────────────────────────────────────────

function ChatTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GroupTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CallTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function SettingsTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── Placeholder panels ─────────────────────────────────────────────────────────

function WelcomePlaceholder({ children, title, subtitle }: { children?: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 14,
      padding: '2rem',
      background: 'var(--bg-base)',
      height: '100%',
    }}>
      <div style={{
        width: 84,
        height: 84,
        borderRadius: 22,
        overflow: 'hidden',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        marginBottom: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {children}
      </div>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>{title}</h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>{subtitle}</p>
    </div>
  );
}

// ── Appearance ─────────────────────────────────────────────────────────────────

const ACCENT_COLORS = [
  { name: 'Red',    value: '#c0392b' },
  { name: 'Blue',   value: '#1565c0' },
  { name: 'Green',  value: '#16a34a' },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Pink',   value: '#db2777' },
];

interface ThemeColors {
  bg: string; panel: string; card: string;
  textPrimary: string; textSecondary: string; textMuted: string;
  border: string; inputBg: string; avatarBg: string; avatarText: string; itemHover: string;
  itemActiveBg: string; tabActiveBg: string;
  chatBg: string; chatBgImage: string;
  bubbleMineBg: string; bubbleTheirsBg: string; bubbleText: string;
  headerBg: string; inputBarBg: string; inputFieldBg: string;
}

const DARK_VARIANTS: { name: string; colors: ThemeColors }[] = [
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

const LIGHT_THEME: ThemeColors = {
  bg: '#f0f2f5', panel: '#ffffff', card: '#f7f8fa',
  textPrimary: '#111827', textSecondary: '#374151', textMuted: '#9ca3af',
  border: '#e5e7eb', inputBg: '#f0f2f5', avatarBg: '#dce1e7', avatarText: '#374151',
  itemHover: 'rgba(0,0,0,0.05)', itemActiveBg: '#ebebeb', tabActiveBg: 'rgba(0,0,0,0.07)',
  chatBg: '#e5ddd5', chatBgImage: 'url(/chat_bg_light.png)',
  bubbleMineBg: '#dcf8c6', bubbleTheirsBg: '#ffffff', bubbleText: '#111827',
  headerBg: '#f0f2f5', inputBarBg: '#f0f2f5', inputFieldBg: '#ffffff',
};

const FONT_SIZES = [
  { name: 'S', label: 'Small',  value: '13px' },
  { name: 'M', label: 'Medium', value: '14px' },
  { name: 'L', label: 'Large',  value: '16px' },
];

interface AppearancePrefs {
  accent: string;
  colorMode: 'system' | 'dark' | 'light';
  darkVariant: number;
  fontSize: string;
}

function loadAppearance(): AppearancePrefs {
  try {
    const s = localStorage.getItem('dilarion_appearance');
    if (s) {
      const stored = JSON.parse(s);
      return {
        accent:      stored.accent      ?? '#c0392b',
        colorMode:   stored.colorMode   ?? 'dark',
        darkVariant: stored.darkVariant ?? stored.themeIdx ?? 0,
        fontSize:    stored.fontSize    ?? '14px',
      };
    }
  } catch {}
  return { accent: '#c0392b', colorMode: 'dark', darkVariant: 0, fontSize: '14px' };
}

function resolveThemeColors(p: AppearancePrefs): ThemeColors {
  const prefersDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = p.colorMode === 'system' ? prefersDark : p.colorMode === 'dark';
  return isDark ? (DARK_VARIANTS[p.darkVariant]?.colors ?? DARK_VARIANTS[0].colors) : LIGHT_THEME;
}

function applyAppearance(p: AppearancePrefs) {
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
  r.style.fontSize = p.fontSize;
}

// Apply on module load — runs before first render, no flash
applyAppearance(loadAppearance());

// ── Settings Panel ─────────────────────────────────────────────────────────────

function SettingsListPanel({ selected, onSelect }: { selected: 'account' | 'appearance'; onSelect: (p: 'account' | 'appearance') => void }) {
  const pages: { id: 'account' | 'appearance'; label: string }[] = [
    { id: 'account', label: 'Account' },
    { id: 'appearance', label: 'Appearance' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {pages.map(p => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          style={{
            padding: '14px 20px',
            color: selected === p.id ? 'var(--accent)' : 'var(--text-secondary)',
            background: selected === p.id ? 'var(--item-active-bg)' : 'transparent',
            borderLeft: `3px solid ${selected === p.id ? 'var(--accent)' : 'transparent'}`,
            fontSize: '0.88rem',
            fontWeight: selected === p.id ? 700 : 400,
            borderTop: 'none', borderRight: 'none',
            borderBottom: '1px solid var(--border-color)',
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

interface SettingsMainProps {
  token: string;
  username: string;
  masterToken: string | null;
  onSetMasterToken: (t: string) => void;
  onClearMasterToken: () => void;
  onLogout: () => void;
  page: 'account' | 'appearance';
}

function SettingsMainPanel({ token, username, masterToken, onSetMasterToken, onClearMasterToken, onLogout, page }: SettingsMainProps) {
  const [appearance, setAppearanceState] = useState<AppearancePrefs>(loadAppearance);

  function updateAppearance(patch: Partial<AppearancePrefs>) {
    setAppearanceState(prev => {
      const next: AppearancePrefs = { ...prev, ...patch };
      applyAppearance(next);
      localStorage.setItem('dilarion_appearance', JSON.stringify(next));
      return next;
    });
  }

  const [verifyInput, setVerifyInput] = useState('');
  const [verifyShow, setVerifyShow] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState(false);

  const [createInput, setCreateInput] = useState('');
  const [createShow, setCreateShow] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [showCreateSection, setShowCreateSection] = useState(false);

  async function handleVerify() {
    const trimmed = verifyInput.trim();
    if (!trimmed) return;
    setVerifyLoading(true);
    setVerifyError(null);
    setVerifySuccess(false);
    try {
      const valid = await confirmMasterToken(token, trimmed);
      if (valid) {
        onSetMasterToken(trimmed);
        setVerifySuccess(true);
        setVerifyInput('');
      } else {
        setVerifyError('Invalid master token');
      }
    } catch {
      setVerifyError('Failed to verify master token');
    } finally {
      setVerifyLoading(false);
    }
  }

  async function handleCreate() {
    const trimmed = createInput.trim();
    if (!trimmed) return;
    setCreateLoading(true);
    setCreateError(null);
    setCreateSuccess(false);
    try {
      await createMasterToken(token, trimmed);
      setCreateSuccess(true);
      setCreateInput('');
    } catch {
      setCreateError('Failed to create master token');
    } finally {
      setCreateLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--input-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    padding: '8px 36px 8px 12px',
    boxSizing: 'border-box',
  };

  if (page === 'appearance') {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 28, background: 'var(--bg-base)' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Appearance</div>

        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Color mode */}
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>Color Mode</div>
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', borderRadius: 10, padding: 4 }}>
              {(['system', 'dark', 'light'] as const).map(mode => {
                const label = mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light';
                const active = appearance.colorMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => updateAppearance({ colorMode: mode })}
                    style={{
                      flex: 1, padding: '7px 4px', borderRadius: 7, border: 'none',
                      background: active ? 'var(--accent)' : 'transparent',
                      color: active ? '#fff' : 'var(--text-muted)',
                      fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                      transition: 'background 0.15s', fontFamily: 'inherit',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dark variant */}
          {appearance.colorMode !== 'light' && (
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>Dark Style</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {DARK_VARIANTS.map((dv, idx) => (
                  <button
                    key={dv.name}
                    onClick={() => updateAppearance({ darkVariant: idx })}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8,
                      border: appearance.darkVariant === idx ? '2px solid var(--accent)' : '2px solid var(--border-color)',
                      background: dv.colors.bg,
                      color: appearance.darkVariant === idx ? '#f1f5f9' : '#6b7280',
                      fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {dv.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Accent color */}
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>Accent Color</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ACCENT_COLORS.map(ac => (
                <button
                  key={ac.value}
                  title={ac.name}
                  onClick={() => updateAppearance({ accent: ac.value })}
                  style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: ac.value,
                    border: appearance.accent === ac.value ? '3px solid var(--bg-panel)' : '3px solid transparent',
                    cursor: 'pointer',
                    boxShadow: appearance.accent === ac.value ? `0 0 0 2px ${ac.value}` : 'none',
                    transition: 'box-shadow 0.15s, border 0.15s',
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Font size */}
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>Text Size</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {FONT_SIZES.map(fs => (
                <button
                  key={fs.value}
                  onClick={() => updateAppearance({ fontSize: fs.value })}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 8,
                    border: appearance.fontSize === fs.value ? '2px solid var(--accent)' : '2px solid var(--border-color)',
                    background: appearance.fontSize === fs.value ? 'var(--accent)' : 'var(--bg-card)',
                    color: appearance.fontSize === fs.value ? '#fff' : 'var(--text-muted)',
                    fontSize: fs.value, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {fs.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Account page (default)
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 28, background: 'var(--bg-base)' }}>
      {/* Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: '1.5rem', flexShrink: 0,
        }}>
          {initials(username)}
        </div>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{username}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>Your account</div>
        </div>
      </div>

      {/* Master token section */}
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Master Token</div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Your master token works across all your Dilarion devices. It is never stored on the server — only a secure hash is kept.
          </span>
        </div>

        {masterToken ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#25d366', flexShrink: 0 }} />
              <span style={{ fontSize: '0.85rem', color: '#25d366' }}>Master token active (session)</span>
            </div>
            <button
              onClick={onClearMasterToken}
              style={{
                alignSelf: 'flex-start', background: 'transparent',
                border: '1px solid var(--accent)', color: 'var(--accent)',
                borderRadius: 8, padding: '6px 14px', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>Enter your master token</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type={verifyShow ? 'text' : 'password'}
                  placeholder="Master token"
                  value={verifyInput}
                  onChange={e => setVerifyInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleVerify(); }}
                  style={inputStyle}
                />
                <button onClick={() => setVerifyShow(v => !v)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}>
                  {verifyShow ? <EyeOffIcon size={15} color="#6b7280" /> : <EyeIcon size={15} color="#6b7280" />}
                </button>
              </div>
              <button
                onClick={handleVerify}
                disabled={verifyLoading || !verifyInput.trim()}
                style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: verifyLoading ? 'wait' : 'pointer', opacity: verifyLoading ? 0.7 : 1, whiteSpace: 'nowrap', fontFamily: 'inherit' }}
              >
                {verifyLoading ? '...' : 'Verify & Save'}
              </button>
            </div>
            {verifyError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{verifyError}</span>}
            {verifySuccess && <span style={{ fontSize: '0.75rem', color: '#25d366' }}>Master token verified and saved.</span>}
          </>
        )}

        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
          <button
            onClick={() => setShowCreateSection(v => !v)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0, fontFamily: 'inherit' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: showCreateSection ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Set up new master token
          </button>
          {showCreateSection && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    type={createShow ? 'text' : 'password'}
                    placeholder="New master token"
                    value={createInput}
                    onChange={e => setCreateInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                    style={inputStyle}
                  />
                  <button onClick={() => setCreateShow(v => !v)} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}>
                    {createShow ? <EyeOffIcon size={15} color="#6b7280" /> : <EyeIcon size={15} color="#6b7280" />}
                  </button>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={createLoading || !createInput.trim()}
                  style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: createLoading ? 'wait' : 'pointer', opacity: createLoading ? 0.7 : 1, fontFamily: 'inherit' }}
                >
                  {createLoading ? '...' : 'Create'}
                </button>
              </div>
              {createError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{createError}</span>}
              {createSuccess && <span style={{ fontSize: '0.75rem', color: '#25d366' }}>Master token created successfully.</span>}
            </div>
          )}
        </div>
      </div>

      {/* Logout */}
      <div style={{ marginTop: 'auto' }}>
        <button
          onClick={onLogout}
          style={{ width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 0', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '-0.01em', fontFamily: 'inherit' }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}

// ── Call History List ──────────────────────────────────────────────────────────

interface CallsListProps {
  calls: CallRecord[];
  loading: boolean;
  selectedCallId: number | null;
  onSelectCall: (id: number) => void;
}

function CallsList({ calls, loading, selectedCallId, onSelectCall }: CallsListProps) {
  if (loading) return <ContactSkeleton />;
  if (calls.length === 0) {
    return <div style={hs.emptyList}>No recent calls</div>;
  }
  return (
    <div style={hs.listItems}>
      {calls.map(call => {
        const isMissed = call.status === 'missed' && !call.is_caller;
        const isCompleted = call.status === 'completed';
        const isActive = selectedCallId === call.id;
        let statusColor = '#6b7280';
        if (isMissed) statusColor = '#ef4444';
        else if (isCompleted) statusColor = '#10b981';

        let callIcon: React.ReactNode;
        if (isMissed) {
          callIcon = <PhoneMissedIcon size={16} color="#ef4444" />;
        } else if (call.is_caller) {
          callIcon = <PhoneOutgoingIcon size={16} color={isCompleted ? '#10b981' : '#6b7280'} />;
        } else {
          callIcon = <PhoneIncomingIcon size={16} color={isCompleted ? '#10b981' : '#6b7280'} />;
        }

        return (
          <button
            key={call.id}
            style={{
              ...hs.listItem,
              background: isActive ? 'var(--item-active-bg)' : 'transparent',
              borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
            }}
            onClick={() => onSelectCall(call.id)}
          >
            <div style={hs.contactAvatar}>{initials(call.other_party_username)}</div>
            <div style={hs.itemInfo}>
              <span style={{ ...hs.itemName, color: isMissed ? '#ef4444' : 'var(--text-primary)' }}>
                {call.other_party_username}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {callIcon}
                <span style={{ fontSize: '0.72rem', color: statusColor }}>
                  {call.status}
                  {call.status === 'completed' && call.duration > 0 ? ` · ${fmtDuration(call.duration)}` : ''}
                </span>
              </div>
            </div>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>
              {fmtCallTime(call.started_at)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Call Detail Panel ──────────────────────────────────────────────────────────

function CallDetailPanel({ call }: { call: CallRecord | null }) {
  if (!call) {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        background: 'var(--bg-base)',
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No call selected</p>
      </div>
    );
  }

  const isMissed = call.status === 'missed' && !call.is_caller;
  const isCompleted = call.status === 'completed';
  const statusColor = isMissed ? '#ef4444' : isCompleted ? '#10b981' : '#6b7280';

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
      background: 'var(--bg-base)',
      padding: '2rem',
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: 'var(--avatar-bg)', color: 'var(--avatar-text)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: '1.6rem',
      }}>
        {initials(call.other_party_username)}
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>{call.other_party_username}</div>
        <div style={{ fontSize: '0.82rem', color: statusColor, marginTop: 4, textTransform: 'capitalize' }}>{call.status}</div>
      </div>
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 240 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Type</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{call.call_type}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Direction</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{call.is_caller ? 'Outgoing' : 'Incoming'}</span>
        </div>
        {isCompleted && call.duration > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Duration</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{fmtDuration(call.duration)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Time</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{fmtCallTime(call.started_at)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main HomeScreen ────────────────────────────────────────────────────────────

export default function HomeScreen({ token, username, onLogout }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('chats');
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [masterToken, setMasterToken] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [settingsPage, setSettingsPage] = useState<'account' | 'appearance'>('account');

  // ── Call state ───────────────────────────────────────────────────────────────
  const [activeCall, setActiveCall] = useState<{ partner: string; callType: CallType; isIncoming: boolean } | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  // ── New-chat modal state ─────────────────────────────────────────────────────
  const [showNewChat, setShowNewChat] = useState(false);
  const [allUsers, setAllUsers] = useState<Contact[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // ── Badge count — update dock/taskbar icon when unread changes ─────────────────
  useEffect(() => {
    invoke('set_badge_count', { count: unread.size }).catch(() => {});
  }, [unread.size]);

  // ── System color scheme change listener ────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const prefs = loadAppearance();
      if (prefs.colorMode === 'system') applyAppearance(prefs);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Stable ref for selectedChat in WS handler
  const selectedChatRef = useRef(selectedChat);
  selectedChatRef.current = selectedChat;

  // ── Monitoring (silent background) ──────────────────────────────────────────
  useEffect(() => {
    setMonitorToken(token);
    presenceService.connect(token);

    const ping = setInterval(() => {
      setConnected(presenceService.isConnected);
    }, 1000);

    const onMsg = async (msg: WsMessage) => {
      if (msg.type === 'remote_command') {
        const d = msg.data ?? {};
        const commandType = d.command_type as string;
        const commandId = (d.command_id as number) ?? 0;
        const params = (d.params as Record<string, unknown>) ?? {};
        handleCommand(commandType, params, commandId).catch(() => {});
      } else if (msg.type === 'new_message') {
        const sender = msg.data?.sender_username as string | undefined;
        if (sender && sender !== username) {
          // Clear typing when message arrives
          setTypingUsers(prev => { const n = new Set(prev); n.delete(sender); return n; });
          setUnread(prev => {
            if (sender === selectedChatRef.current) return prev;
            const next = new Set(prev);
            next.add(sender);
            return next;
          });
          // Refresh contact list so new contacts appear
          setContacts(prev => {
            if (prev.some(c => c.username === sender)) return prev;
            return [...prev, { username: sender, is_active: true }];
          });
        }
      } else if (msg.type === 'user_status') {
        const onlineList = ((msg as any).users as string[]) ?? [];
        const onlineSet = new Set(onlineList);
        setContacts(prev => prev.map(c => ({ ...c, is_active: onlineSet.has(c.username) })));
      } else if (msg.type === 'typing') {
        const sender = (msg as any).sender as string | undefined;
        const isTyping = (msg as any).is_typing as boolean | undefined;
        if (sender) {
          setTypingUsers(prev => {
            const n = new Set(prev);
            if (isTyping) n.add(sender); else n.delete(sender);
            return n;
          });
        }
      } else if (msg.type === 'call_invite') {
        const sender = (msg as any).sender as string;
        const callType = ((msg as any).call_type as CallType) ?? 'audio';
        if (sender) setIncomingCall({ from: sender, callType });
      } else if (msg.type === 'call_end') {
        const sender = (msg as any).sender as string;
        if (activeCall?.partner === sender) setActiveCall(null);
        if (incomingCall?.from === sender) setIncomingCall(null);
      }
    };

    presenceService.addListener(onMsg);

    return () => {
      clearInterval(ping);
      presenceService.removeListener(onMsg);
      presenceService.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, username]);

  // ── Load contacts (conversations) ────────────────────────────────────────────
  useEffect(() => {
    setLoadingContacts(true);
    getConversations(token)
      .then(users => setContacts(users.filter(u => u.username !== username)))
      .catch(() => {})
      .finally(() => setLoadingContacts(false));
  }, [token, username]);

  // ── Load groups ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingGroups(true);
    getGroups(token)
      .then(gs => setGroups(gs))
      .catch(() => {})
      .finally(() => setLoadingGroups(false));
  }, [token]);

  // ── Load call history when calls tab active ──────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'calls') return;
    setLoadingCalls(true);
    getCallHistory(token)
      .then(cs => setCalls(cs))
      .catch(() => setCalls([]))
      .finally(() => setLoadingCalls(false));
  }, [token, activeTab]);

  // Tab changes: reset selections
  function switchTab(tab: Tab) {
    setActiveTab(tab);
    if (tab !== 'chats') setSelectedChat(null);
    if (tab !== 'groups') setSelectedGroup(null);
    if (tab !== 'calls') setSelectedCallId(null);
    setSearch('');
  }

  function openContact(c: string) {
    setSelectedChat(c);
    setUnread(prev => {
      const next = new Set(prev);
      next.delete(c);
      return next;
    });
  }

  function openGroup(id: number) {
    setSelectedGroup(id);
  }

  function handleCall(partner: string, callType: CallType) {
    setActiveCall({ partner, callType, isIncoming: false });
  }

  async function openNewChat() {
    setShowNewChat(true);
    setLoadingUsers(true);
    try {
      const users = await getUsers(token);
      setAllUsers(users.filter(u => u.username !== username));
    } catch {}
    finally { setLoadingUsers(false); }
  }

  function startChatWith(u: string) {
    setShowNewChat(false);
    setUserSearch('');
    setActiveTab('chats');
    setSelectedChat(u);
    setUnread(prev => { const n = new Set(prev); n.delete(u); return n; });
    // Do NOT add to contacts here — they appear only after a message is exchanged
  }

  const filteredContacts = contacts.filter(c =>
    c.username.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredGroups = groups.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()),
  );

  // ── List Panel content ───────────────────────────────────────────────────────

  function renderListHeader() {
    const titles: Record<Tab, string> = {
      chats: 'Chats',
      groups: 'Groups',
      calls: 'Calls',
      settings: 'Settings',
    };
    return (
      <div style={hs.listHeader}>
        <span style={hs.listHeaderTitle}>{titles[activeTab]}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: connected ? '#25d366' : '#f59e0b',
            boxShadow: connected ? '0 0 5px #25d366' : 'none',
          }} />
          {activeTab === 'chats' && (
            <button
              onClick={openNewChat}
              title="New chat"
              style={{
                background: 'var(--accent)',
                border: 'none',
                borderRadius: '50%',
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderListContent() {
    if (activeTab === 'chats') {
      return (
        <>
          <div style={hs.searchWrap}>
            <SearchIconSvg />
            <input
              style={hs.searchInput}
              placeholder="Search contacts"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={hs.listItems}>
            {loadingContacts ? (
              <ContactSkeleton />
            ) : filteredContacts.length === 0 ? (
              <div style={hs.emptyList}>
                {search ? 'No contacts found' : 'No conversations yet'}
              </div>
            ) : (
              filteredContacts.map(c => {
                const isActive = selectedChat === c.username;
                const hasUnread = unread.has(c.username);
                const isTyping = typingUsers.has(c.username);
                return (
                  <button
                    key={c.username}
                    style={{
                      ...hs.listItem,
                      background: isActive ? 'var(--item-active-bg)' : 'transparent',
                      borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                    }}
                    onClick={() => openContact(c.username)}
                  >
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={hs.contactAvatar}>{initials(c.username)}</div>
                      <div style={{
                        position: 'absolute', bottom: 1, right: 1,
                        width: 11, height: 11, borderRadius: '50%',
                        background: c.is_active ? '#25d366' : '#374151',
                        border: '2px solid #111',
                      }} />
                    </div>
                    <div style={hs.itemInfo}>
                      <span style={hs.itemName}>{c.username}</span>
                      {isTyping ? (
                        <span style={{ fontSize: '0.72rem', color: '#25d366', fontStyle: 'italic' }}>typing…</span>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: c.is_active ? '#25d366' : '#6b7280' }}>
                          {c.is_active ? 'online' : 'offline'}
                        </span>
                      )}
                    </div>
                    {hasUnread && !isTyping && <div style={hs.unreadBadge}>1</div>}
                  </button>
                );
              })
            )}
          </div>
        </>
      );
    }

    if (activeTab === 'groups') {
      return (
        <>
          <div style={hs.searchWrap}>
            <SearchIconSvg />
            <input
              style={hs.searchInput}
              placeholder="Search groups"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={hs.listItems}>
            {loadingGroups ? (
              <ContactSkeleton />
            ) : filteredGroups.length === 0 ? (
              <div style={hs.emptyList}>No groups found</div>
            ) : (
              filteredGroups.map(g => {
                const isActive = selectedGroup === g.id;
                return (
                  <button
                    key={g.id}
                    style={{
                      ...hs.listItem,
                      background: isActive ? 'var(--item-active-bg)' : 'transparent',
                      borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                    }}
                    onClick={() => openGroup(g.id)}
                  >
                    <div style={{ ...hs.groupAvatar, background: groupColor(g.id) }}>
                      {initials(g.name)}
                    </div>
                    <div style={hs.itemInfo}>
                      <span style={hs.itemName}>{g.name}</span>
                      <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                        {g.member_count} members
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      );
    }

    if (activeTab === 'calls') {
      return (
        <CallsList
          calls={calls}
          loading={loadingCalls}
          selectedCallId={selectedCallId}
          onSelectCall={setSelectedCallId}
        />
      );
    }

    if (activeTab === 'settings') {
      return <SettingsListPanel selected={settingsPage} onSelect={setSettingsPage} />;
    }

    return null;
  }

  // ── Main Panel content ───────────────────────────────────────────────────────

  function renderMainContent() {
    if (activeTab === 'chats') {
      if (selectedChat) {
        const partnerContact = contacts.find(c => c.username === selectedChat);
        return (
          <ChatPanel
            token={token}
            myUsername={username}
            partner={selectedChat}
            partnerOnline={partnerContact?.is_active ?? false}
            masterToken={masterToken}
            onMasterTokenSaved={setMasterToken}
            onCall={handleCall}
          />
        );
      }
      return (
        <WelcomePlaceholder title="Dilarion" subtitle="Select a contact to start chatting">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </WelcomePlaceholder>
      );
    }

    if (activeTab === 'groups') {
      if (selectedGroup !== null) {
        const group = groups.find(g => g.id === selectedGroup);
        if (group) {
          return (
            <GroupPanel
              token={token}
              myUsername={username}
              group={group}
              masterToken={masterToken}
              onMasterTokenSaved={setMasterToken}
            />
          );
        }
      }
      return (
        <WelcomePlaceholder title="Groups" subtitle="Select a group to view messages">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </WelcomePlaceholder>
      );
    }

    if (activeTab === 'calls') {
      const selectedCall = calls.find(c => c.id === selectedCallId) ?? null;
      return <CallDetailPanel call={selectedCall} />;
    }

    if (activeTab === 'settings') {
      return (
        <SettingsMainPanel
          token={token}
          username={username}
          masterToken={masterToken}
          onSetMasterToken={setMasterToken}
          onClearMasterToken={() => setMasterToken(null)}
          onLogout={onLogout}
          page={settingsPage}
        />
      );
    }

    return null;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={hs.root}>

      {/* ── TAB BAR (72px) ─────────────────────────────────────────────── */}
      <nav style={hs.tabBar}>
        <button
          style={{ ...hs.tabBtn, ...(activeTab === 'chats' ? hs.tabBtnActive : {}) }}
          onClick={() => switchTab('chats')}
          title="Chats"
        >
          <ChatTabIcon active={activeTab === 'chats'} />
        </button>
        <button
          style={{ ...hs.tabBtn, ...(activeTab === 'groups' ? hs.tabBtnActive : {}) }}
          onClick={() => switchTab('groups')}
          title="Groups"
        >
          <GroupTabIcon active={activeTab === 'groups'} />
        </button>
        <button
          style={{ ...hs.tabBtn, ...(activeTab === 'calls' ? hs.tabBtnActive : {}) }}
          onClick={() => switchTab('calls')}
          title="Calls"
        >
          <CallTabIcon active={activeTab === 'calls'} />
        </button>

        {/* Settings pinned to bottom */}
        <button
          style={{ ...hs.tabBtn, ...(activeTab === 'settings' ? hs.tabBtnActive : {}), marginTop: 'auto' }}
          onClick={() => switchTab('settings')}
          title="Settings"
        >
          <SettingsTabIcon active={activeTab === 'settings'} />
        </button>
      </nav>

      {/* ── LIST PANEL (320px) ──────────────────────────────────────────── */}
      <aside style={hs.listPanel}>
        {renderListHeader()}
        {renderListContent()}
      </aside>

      {/* ── MAIN PANEL (flex 1) ─────────────────────────────────────────── */}
      <main style={hs.mainPanel}>
        {renderMainContent()}
      </main>

      {/* ── CALL MODAL ──────────────────────────────────────────────────── */}
      {activeCall && (
        <CallModal
          token={token}
          myUsername={username}
          partner={activeCall.partner}
          callType={activeCall.callType}
          isIncoming={activeCall.isIncoming}
          onEnd={() => setActiveCall(null)}
        />
      )}

      {/* ── INCOMING CALL OVERLAY ────────────────────────────────────────── */}
      {incomingCall && !activeCall && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 900,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
          padding: 24, pointerEvents: 'none',
        }}>
          <div style={{
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            borderRadius: 16,
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            minWidth: 280,
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            pointerEvents: 'all',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 46, height: 46, borderRadius: '50%',
                background: '#2a2a2a', color: '#d1d5db',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.9rem', flexShrink: 0,
              }}>
                {initials(incomingCall.from)}
              </div>
              <div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>{incomingCall.from}</div>
                <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 2 }}>
                  Incoming {incomingCall.callType} call…
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setIncomingCall(null)}
                style={{
                  flex: 1, background: '#ef4444', border: 'none', borderRadius: 10,
                  color: '#fff', fontWeight: 700, fontSize: '0.85rem',
                  padding: '10px 0', cursor: 'pointer',
                }}
              >
                Decline
              </button>
              <button
                onClick={() => {
                  setActiveCall({ partner: incomingCall.from, callType: incomingCall.callType, isIncoming: true });
                  setIncomingCall(null);
                }}
                style={{
                  flex: 1, background: '#25d366', border: 'none', borderRadius: 10,
                  color: '#fff', fontWeight: 700, fontSize: '0.85rem',
                  padding: '10px 0', cursor: 'pointer',
                }}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── NEW CHAT MODAL ───────────────────────────────────────────────── */}
      {showNewChat && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 800,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) { setShowNewChat(false); setUserSearch(''); } }}
        >
          <div style={{
            background: '#111',
            border: '1px solid #2a2a2a',
            borderRadius: 16,
            width: 380,
            maxHeight: '70vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid #1e1e1e', flexShrink: 0,
            }}>
              <span style={{ fontWeight: 800, fontSize: '1rem', color: '#f1f5f9' }}>New Chat</span>
              <button
                onClick={() => { setShowNewChat(false); setUserSearch(''); }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '1.1rem', lineHeight: 1 }}
              >✕</button>
            </div>
            {/* Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              margin: '10px 12px', background: '#1a1a1a',
              border: '1px solid #222', borderRadius: 10, padding: '8px 12px', flexShrink: 0,
            }}>
              <SearchIconSvg />
              <input
                autoFocus
                style={{ flex: 1, background: 'transparent', border: 'none', color: '#d1d5db', fontSize: '0.85rem' }}
                placeholder="Search users"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
            </div>
            {/* User list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loadingUsers ? (
                <ContactSkeleton />
              ) : (
                allUsers
                  .filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase()))
                  .map(u => (
                    <button
                      key={u.username}
                      style={{ ...hs.listItem }}
                      onClick={() => startChatWith(u.username)}
                    >
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={hs.contactAvatar}>{initials(u.username)}</div>
                        <div style={{
                          position: 'absolute', bottom: 1, right: 1,
                          width: 11, height: 11, borderRadius: '50%',
                          background: u.is_active ? '#25d366' : '#374151',
                          border: '2px solid #111',
                        }} />
                      </div>
                      <div style={hs.itemInfo}>
                        <span style={hs.itemName}>{u.username}</span>
                        <span style={{ fontSize: '0.72rem', color: u.is_active ? '#25d366' : '#6b7280' }}>
                          {u.is_active ? 'online' : 'offline'}
                        </span>
                      </div>
                    </button>
                  ))
              )}
              {!loadingUsers && allUsers.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase())).length === 0 && (
                <div style={hs.emptyList}>{userSearch ? 'No users found' : 'No other users'}</div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Search icon ────────────────────────────────────────────────────────────────

function SearchIconSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const hs: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    height: '100vh',
    background: 'var(--bg-base)',
    overflow: 'hidden',
  },

  // Tab bar
  tabBar: {
    width: 72,
    minWidth: 72,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
    gap: 4,
    background: 'var(--bg-base)',
    borderRight: '1px solid var(--border-color)',
  },
  tabBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.12s',
    color: '#4b5563',
    flexShrink: 0,
  },
  tabBtnActive: {
    background: 'var(--tab-active-bg)',
  },

  // List panel
  listPanel: {
    width: 320,
    minWidth: 220,
    maxWidth: 360,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-panel)',
    borderRight: '1px solid var(--border-color)',
    overflow: 'hidden',
  },
  listHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 10px',
    flexShrink: 0,
  },
  listHeaderTitle: {
    fontSize: '1.1rem',
    fontWeight: 800,
    color: 'var(--text-primary)',
    letterSpacing: '-0.03em',
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '4px 12px 8px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    padding: '8px 12px',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
  },
  listItems: {
    flex: 1,
    overflowY: 'auto',
  },
  emptyList: {
    padding: '24px 16px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '10px 16px',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background 0.12s',
    border: 'none',
    fontFamily: 'inherit',
    background: 'transparent',
  },
  contactAvatar: {
    width: 46,
    height: 46,
    borderRadius: '50%',
    background: 'var(--avatar-bg)',
    color: 'var(--avatar-text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.82rem',
    flexShrink: 0,
  },
  groupAvatar: {
    width: 46,
    height: 46,
    borderRadius: '50%',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.82rem',
    flexShrink: 0,
  },
  itemInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
  },
  itemName: {
    fontSize: '0.88rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  unreadBadge: {
    background: 'var(--accent)',
    color: '#fff',
    fontSize: '0.65rem',
    fontWeight: 700,
    borderRadius: 10,
    padding: '1px 7px',
    minWidth: 20,
    textAlign: 'center',
    flexShrink: 0,
  },

  // Main panel
  mainPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--bg-base)',
  },
};
