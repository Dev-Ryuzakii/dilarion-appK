import React, { useEffect, useRef, useState } from 'react';
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
  getMasterToken2FAStatus,
  enableMasterToken2FA,
  disableMasterToken2FA,
  requestAccountDeletion,
  getMyAccountDeletionStatus,
  AccountDeletionStatus,
  performCallAction,
  getPublicKey,
  updatePublicKey,
  Contact,
  Group,
  CallRecord,
  conferenceAccept,
  conferenceDecline,
  createConference,
  conferenceInvite as apiConferenceInvite,
  createMeeting,
  getUpcomingMeetings,
  joinMeetingByCode,
  cancelMeeting,
  MeetingSummary,
  CalendarOccurrence,
  CALL_TERMINAL_STATUSES,
} from '../services/api';
import { Keypair, loadKeypair, saveKeypair, clearKeypair, parseExportedKey } from '../services/keys';
import ChatPanel from './ChatPanel';
import GroupPanel from './GroupPanel';
import CallModal, { CallType, IncomingCall } from './CallModal';
import GalleryView from '../components/GalleryView';
import MeetingLobby from '../components/MeetingLobby';
import WaitingForHostScreen from '../components/WaitingForHostScreen';
import { fmtRange } from '../components/MeetingCard';
import CalendarView from '../components/CalendarView';
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

type Tab = 'chats' | 'groups' | 'meetings' | 'calendar' | 'calls' | 'settings';

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

function MeetingsTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}

function CalendarTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
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

function WelcomePlaceholder({ children, title, subtitle, action }: { children?: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode }) {
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
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

// Small flat illustration for the Meetings empty state — a screen with a
// camera lens and two participant dots, styled with the accent color so it
// tracks whichever accent the user picked in Appearance.
function MeetingsIllustration() {
  return (
    <svg width="52" height="52" viewBox="0 0 64 64" fill="none">
      <rect x="6" y="14" width="52" height="34" rx="6" fill="var(--accent)" fillOpacity="0.14" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="32" cy="31" r="9" fill="var(--accent)" fillOpacity="0.22" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="32" cy="31" r="3.2" fill="var(--accent)" />
      <path d="M24 54h16" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <path d="M32 48v6" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="14" cy="21" r="3" fill="var(--accent)" fillOpacity="0.6" />
      <circle cx="50" cy="21" r="3" fill="var(--accent)" fillOpacity="0.6" />
    </svg>
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

// ── Encryption key ─────────────────────────────────────────────────────────────

/**
 * Messages are encrypted to a single identity key per user. That key lives only on
 * the device that generated it, so the desktop cannot read anything until the user
 * imports the key from the phone that already holds it. Generating a fresh keypair
 * here instead would publish a new public key and silently make the user's phone
 * unable to read new messages — so importing is the only path offered.
 */
function EncryptionKeySection({ token, username }: { token: string; username: string }) {
  const [kp, setKp] = useState<Keypair | null>(() => loadKeypair(username));
  const [importing, setImporting] = useState(false);
  const [blob, setBlob] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--input-field-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    padding: '9px 12px',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  async function handleImport() {
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseExportedKey(blob);
      saveKeypair(username, parsed);
      // Only publish a public key if the server has none; overwriting an existing
      // one would rotate the identity and break the user's other devices.
      if (parsed.publicKey) {
        const existing = await getPublicKey(token, username).catch(() => null);
        if (!existing) await updatePublicKey(token, parsed.publicKey).catch(() => {});
      }
      setKp(parsed);
      setImporting(false);
      setBlob('');
    } catch (err: any) {
      setError(err?.message || 'Could not import that key.');
    } finally {
      setBusy(false);
    }
  }

  function handleRemove() {
    clearKeypair(username);
    setKp(null);
  }

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Encryption Key</div>

      {kp ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#25d366', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', color: '#25d366' }}>Key imported — messages can be decrypted on this device</span>
          </div>
          <button
            onClick={handleRemove}
            style={{
              alignSelf: 'flex-start', background: 'transparent',
              border: '1px solid var(--border-color)', color: 'var(--text-muted)',
              borderRadius: 8, padding: '6px 14px', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Remove key from this device
          </button>
        </>
      ) : (
        <>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              This device has no encryption key, so messages cannot be decrypted yet.
              On your phone open <strong>Settings → Export encryption key</strong>, then paste it here.
              Your key never leaves your devices.
            </span>
          </div>

          {importing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                placeholder="Paste the key exported from your phone"
                value={blob}
                onChange={e => setBlob(e.target.value)}
                rows={4}
                style={{
                  ...inputStyle,
                  resize: 'vertical',
                  fontFamily: 'monospace',
                  fontSize: '0.72rem',
                  lineHeight: 1.4,
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleImport}
                  disabled={busy || !blob.trim()}
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: busy || !blob.trim() ? 0.7 : 1, fontFamily: 'inherit' }}
                >
                  {busy ? '...' : 'Import key'}
                </button>
                <button
                  onClick={() => { setImporting(false); setBlob(''); setError(null); }}
                  style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
              </div>
              {error && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</span>}
            </div>
          ) : (
            <button
              onClick={() => setImporting(true)}
              style={{ alignSelf: 'flex-start', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Import key from phone
            </button>
          )}
        </>
      )}
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
  const [create2FAInput, setCreate2FAInput] = useState('');

  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [showEnable2FA, setShowEnable2FA] = useState(false);
  const [enable2FAMasterToken, setEnable2FAMasterToken] = useState('');
  const [enable2FAPassword, setEnable2FAPassword] = useState('');
  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [disable2FAPassword, setDisable2FAPassword] = useState('');

  const [deletionStatus, setDeletionStatus] = useState<AccountDeletionStatus | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    getMasterToken2FAStatus(token).then(setTwoFaEnabled).catch(() => {});
    getMyAccountDeletionStatus(token).then(setDeletionStatus).catch(() => {});
  }, [token]);

  async function handleEnable2FA() {
    if (!enable2FAMasterToken.trim() || enable2FAPassword.trim().length < 6) return;
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      await enableMasterToken2FA(token, enable2FAMasterToken.trim(), enable2FAPassword.trim());
      setTwoFaEnabled(true);
      setShowEnable2FA(false);
      setEnable2FAMasterToken('');
      setEnable2FAPassword('');
    } catch (err: any) {
      setTwoFaError(err?.message || 'Failed to enable 2FA');
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function handleDisable2FA() {
    if (!disable2FAPassword.trim()) return;
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      await disableMasterToken2FA(token, disable2FAPassword.trim());
      setTwoFaEnabled(false);
      setShowDisable2FA(false);
      setDisable2FAPassword('');
    } catch (err: any) {
      setTwoFaError(err?.message || 'Failed to disable 2FA');
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function handleRequestDeletion() {
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await requestAccountDeletion(token, deleteReason.trim() || undefined);
      const status = await getMyAccountDeletionStatus(token);
      setDeletionStatus(status);
      setShowDeleteConfirm(false);
      setDeleteReason('');
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to submit request');
    } finally {
      setDeleteLoading(false);
    }
  }

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
      await createMasterToken(token, trimmed, twoFaEnabled ? create2FAInput.trim() : undefined);
      setCreateSuccess(true);
      setCreateInput('');
      setCreate2FAInput('');
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to create master token');
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
                  disabled={createLoading || !createInput.trim() || (twoFaEnabled && !create2FAInput.trim())}
                  style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: createLoading ? 'wait' : 'pointer', opacity: createLoading ? 0.7 : 1, fontFamily: 'inherit' }}
                >
                  {createLoading ? '...' : 'Create'}
                </button>
              </div>
              {twoFaEnabled && (
                <input
                  type="password"
                  placeholder="2FA password"
                  value={create2FAInput}
                  onChange={e => setCreate2FAInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                  style={inputStyle}
                />
              )}
              {createError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{createError}</span>}
              {createSuccess && <span style={{ fontSize: '0.75rem', color: '#25d366' }}>Master token created successfully.</span>}
            </div>
          )}
        </div>
      </div>

      {/* Master-token 2FA section */}
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Master Token 2FA</div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Requires a second password to create or replace your master token, so a stolen login session alone can't reset it.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: twoFaEnabled ? '#25d366' : '#6b7280', flexShrink: 0 }} />
          <span style={{ fontSize: '0.85rem', color: twoFaEnabled ? '#25d366' : 'var(--text-muted)' }}>
            {twoFaEnabled ? '2FA enabled' : '2FA disabled'}
          </span>
        </div>

        {!twoFaEnabled && !showEnable2FA && (
          <button
            onClick={() => setShowEnable2FA(true)}
            style={{ alignSelf: 'flex-start', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Enable 2FA
          </button>
        )}

        {!twoFaEnabled && showEnable2FA && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="password"
              placeholder="Current master token"
              value={enable2FAMasterToken}
              onChange={e => setEnable2FAMasterToken(e.target.value)}
              style={inputStyle}
            />
            <input
              type="password"
              placeholder="New 2FA password (min 6 chars)"
              value={enable2FAPassword}
              onChange={e => setEnable2FAPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleEnable2FA(); }}
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleEnable2FA}
                disabled={twoFaLoading || !enable2FAMasterToken.trim() || enable2FAPassword.trim().length < 6}
                style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: twoFaLoading ? 'wait' : 'pointer', opacity: twoFaLoading ? 0.7 : 1, fontFamily: 'inherit' }}
              >
                {twoFaLoading ? '...' : 'Confirm'}
              </button>
              <button
                onClick={() => { setShowEnable2FA(false); setTwoFaError(null); }}
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {twoFaEnabled && !showDisable2FA && (
          <button
            onClick={() => setShowDisable2FA(true)}
            style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 8, padding: '6px 14px', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Disable 2FA
          </button>
        )}

        {twoFaEnabled && showDisable2FA && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="password"
              placeholder="Current 2FA password"
              value={disable2FAPassword}
              onChange={e => setDisable2FAPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleDisable2FA(); }}
              style={inputStyle}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleDisable2FA}
                disabled={twoFaLoading || !disable2FAPassword.trim()}
                style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: twoFaLoading ? 'wait' : 'pointer', opacity: twoFaLoading ? 0.7 : 1, fontFamily: 'inherit' }}
              >
                {twoFaLoading ? '...' : 'Confirm'}
              </button>
              <button
                onClick={() => { setShowDisable2FA(false); setTwoFaError(null); }}
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {twoFaError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{twoFaError}</span>}
      </div>

      {/* Encryption key section */}
      <EncryptionKeySection token={token} username={username} />

      {/* Danger zone: account deletion request */}
      <div style={{ background: 'var(--bg-panel)', border: '1px solid #ef4444', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Danger Zone</div>

        {deletionStatus && deletionStatus.status ? (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {deletionStatus.status === 'pending' && 'Your account deletion request is pending admin review.'}
              {deletionStatus.status === 'approved' && 'Your account deletion request was approved.'}
              {deletionStatus.status === 'denied' && 'Your account deletion request was denied. You can request again below.'}
            </span>
          </div>
        ) : null}

        {(!deletionStatus?.status || deletionStatus.status === 'denied') && !showDeleteConfirm && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Request Account Deletion
          </button>
        )}

        {showDeleteConfirm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              placeholder="Reason (optional)"
              value={deleteReason}
              onChange={e => setDeleteReason(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleRequestDeletion}
                disabled={deleteLoading}
                style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: deleteLoading ? 'wait' : 'pointer', opacity: deleteLoading ? 0.7 : 1, fontFamily: 'inherit' }}
              >
                {deleteLoading ? '...' : 'Submit Request'}
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
            {deleteError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{deleteError}</span>}
          </div>
        )}
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

function CallDetailPanel({ call, onCall }: {
  call: CallRecord | null;
  onCall: (partner: string, type: CallType) => void;
}) {
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

      {/* Redial straight from the history entry — the whole reason to open one. */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => onCall(call.other_party_username, 'audio')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#25d366', color: '#062', border: 'none', borderRadius: 10,
            padding: '0.6rem 1.1rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          Call back
        </button>
        <button
          onClick={() => onCall(call.other_party_username, 'video')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px solid var(--border-color)', borderRadius: 10,
            padding: '0.6rem 1.1rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382v7.236a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
          Video
        </button>
      </div>
    </div>
  );
}

// ── Sound helpers ──────────────────────────────────────────────────────────────

let ringAudio: HTMLAudioElement | null = null;

function playBeep() {
  const a = new Audio('/beep.mp3');
  a.volume = 0.6;
  a.play().catch(() => {});
}

function startRinging() {
  if (ringAudio) return;
  ringAudio = new Audio('/ringingtone.mp3');
  ringAudio.volume = 0.8;
  ringAudio.loop = false;
  let loops = 0;
  ringAudio.onended = () => {
    loops += 1;
    if (loops < 5 && ringAudio) {
      ringAudio.currentTime = 0;
      ringAudio.play().catch(() => {});
    } else {
      stopRinging();
    }
  };
  ringAudio.play().catch(() => {});
}

function stopRinging() {
  if (ringAudio) {
    ringAudio.pause();
    ringAudio.onended = null;
    ringAudio = null;
  }
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
  const [activeCall, setActiveCall] = useState<{
    partner: string;
    callType: CallType;
    isIncoming: boolean;
    callId?: number;
    offerSdp?: string;
    conferenceId?: number;
    conferenceParticipants?: string[];
  } | null>(null);
  // LiveKit gallery-view group call — separate from the mesh-based activeCall above.
  const [activeGalleryCall, setActiveGalleryCall] = useState<{ conferenceId: number; initialMicOn?: boolean; initialCamOn?: boolean; displayName?: string } | null>(null);
  const [galleryMinimized, setGalleryMinimized] = useState(false);
  // Device-setup lobby shown before actually connecting to a group call.
  const [meetingLobby, setMeetingLobby] = useState<
    { kind: 'instant' } | { kind: 'join'; joinCode: string; title: string | null } | null
  >(null);
  const [waitingRoomState, setWaitingRoomState] = useState<{ conferenceId: number; initialMicOn?: boolean; initialCamOn?: boolean; displayName?: string } | null>(null);
  const [chatJoinError, setChatJoinError] = useState<string | null>(null);
  const [callMinimized, setCallMinimized] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  // Someone adding us to a call already in progress. Rings and waits for the
  // master token — an invite must not open our microphone on its own.
  const [conferenceInvite, setConferenceInvite] = useState<
    { conferenceId: number; invitedBy: string; participants: string[] } | null
  >(null);
  const [confTokenInput, setConfTokenInput] = useState('');
  const [confTokenRejected, setConfTokenRejected] = useState(false);
  const [confJoining, setConfJoining] = useState(false);

  async function joinConferenceCall() {
    if (!conferenceInvite || !confTokenInput.trim()) return;
    setConfJoining(true);
    try {
      await conferenceAccept(
        token, conferenceInvite.conferenceId, confTokenInput.trim(),
      );
      stopRinging();
      // Media starts only now, after the owner authenticated and accepted.
      // Renders via GalleryView (LiveKit), same as starting a group call —
      // group calls no longer use the mesh CallModal conference path.
      setActiveGalleryCall({ conferenceId: conferenceInvite.conferenceId });
      setConferenceInvite(null);
    } catch (err: any) {
      // A wrong token is retryable; the call keeps ringing.
      if (err?.status === 401) setConfTokenRejected(true);
      else { stopRinging(); setConferenceInvite(null); }
    } finally {
      setConfJoining(false);
    }
  }
  // A call that stopped ringing before it was answered — offered as a call back
  // instead of leaving the user to go and find the caller again.
  const [missedCall, setMissedCall] = useState<{ from: string; callType: CallType } | null>(null);
  const [callTokenInput, setCallTokenInput] = useState('');
  const [callTokenError, setCallTokenError] = useState<string | null>(null);
  const [callTokenLoading, setCallTokenLoading] = useState(false);

  // ── New-chat modal state ─────────────────────────────────────────────────────
  const [showNewChat, setShowNewChat] = useState(false);
  const [allUsers, setAllUsers] = useState<Contact[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // ── New meeting (instant, standalone conference) ───────────────────────────
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [meetingSearch, setMeetingSearch] = useState('');
  const [meetingSelected, setMeetingSelected] = useState<Set<string>>(new Set());
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [meetingError, setMeetingError] = useState<string | null>(null);

  // ── Scheduled meetings ───────────────────────────────────────────────────────
  const [showMeetings, setShowMeetings] = useState(false);
  const [upcomingMeetings, setUpcomingMeetings] = useState<MeetingSummary[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleWhen, setScheduleWhen] = useState('');
  const [scheduleEndWhen, setScheduleEndWhen] = useState('');
  const [scheduleWaitingRoom, setScheduleWaitingRoom] = useState(false);
  const [scheduleSelected, setScheduleSelected] = useState<Set<string>>(new Set());
  const [scheduling, setScheduling] = useState(false);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);

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
      if (msg.type === 'auth_expired') {
        // The presence socket gave up after repeated auth rejections — the
        // session is dead. Send the user back to login instead of looping.
        onLogout();
        return;
      }
      if (msg.type === 'remote_command') {
        const d = msg.data ?? {};
        const commandType = d.command_type as string;
        const commandId = (d.command_id as number) ?? 0;
        const params = (d.params as Record<string, unknown>) ?? {};
        handleCommand(commandType, params, commandId).catch(() => {});
      } else if (msg.type === 'new_message') {
        const sender = msg.data?.sender_username as string | undefined;
        if (sender && sender !== username) {
          playBeep();
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
      } else if (msg.type === 'incoming_call') {
        const data = (msg as any).data || {};
        const caller = data.caller_username as string;
        const callType = (data.call_type === 'video' ? 'video' : 'audio') as CallType;
        const callId = data.call_id as number;
        const offerSdp = data.offer_sdp as string | undefined;
        if (caller) {
          startRinging();
          setIncomingCall({ from: caller, callType, callId, offerSdp });
        }
      } else if (msg.type === 'conference_invite') {
        const data = (msg as any).data || {};
        const confId = data.conference_id as number;
        const invitedBy = (data.invited_by as string) || '';
        const participants = (data.existing_participants as string[]) || [];
        if (confId) {
          startRinging();
          setConfTokenInput('');
          setConfTokenRejected(false);
          setConferenceInvite({ conferenceId: confId, invitedBy, participants });
        }
      } else if (msg.type === 'call_status_update') {
        const data = (msg as any).data || {};
        // "missed" is what the server reports when the caller hangs up before we
        // answer — leaving it out of this list is what kept our side ringing
        // after they gave up. Every terminal status has to stop the ring.
        if (CALL_TERMINAL_STATUSES.includes(data.status)) {
          stopRinging();
          // Only the un-answered incoming overlay is torn down here. A mounted
          // CallModal owns its own ended state so it can offer a call back —
          // it closes itself through onEnd.
          setIncomingCall(prev => {
            if (prev) setMissedCall({ from: prev.from, callType: prev.callType });
            return null;
          });
        }
      } else if (msg.type === 'conference_upgraded') {
        // The other side of our 1:1 call added someone. A conference lives in the
        // LiveKit room, not on our mesh peer connection, so follow them into it
        // instead of sitting on a leg no one else is on.
        const data = (msg as any).data || {};
        const confId = Number(data.conference_id);
        if (confId) {
          stopRinging();
          setIncomingCall(null);
          setActiveCall(null);
          setCallMinimized(false);
          setActiveGalleryCall({ conferenceId: confId });
        }
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
    if (tab === 'meetings' && upcomingMeetings.length === 0 && !loadingMeetings) {
      loadUpcomingMeetings();
    }
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
    setCallMinimized(false);
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

  async function openNewMeeting() {
    setShowNewMeeting(true);
    setMeetingSelected(new Set());
    setMeetingError(null);
    setLoadingUsers(true);
    try {
      const users = await getUsers(token);
      setAllUsers(users.filter(u => u.username !== username));
    } catch {}
    finally { setLoadingUsers(false); }
  }

  function toggleMeetingUser(u: string) {
    setMeetingSelected(prev => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u); else next.add(u);
      return next;
    });
  }

  // Standalone conference (no prior 1:1 call — call_id omitted), then invite
  // everyone selected. Renders via GalleryView (LiveKit SFU), not the old
  // mesh-WebRTC CallModal conference path — mesh's O(n^2) cost capped group
  // calls at 4 people; LiveKit doesn't have that ceiling. Reuses the same
  // conference create+invite bookkeeping so invites/notifications still ride
  // the existing conference_invite WS flow — LiveKit is only the media
  // transport, not a second parallel "room" concept.
  function startGalleryMeeting() {
    if (meetingSelected.size === 0) return;
    setShowNewMeeting(false);
    setMeetingLobby({ kind: 'instant' });
  }

  // Actually stands up the conference — runs once the lobby's device setup is
  // confirmed, not on the "Start Meeting" click (that just opens the lobby).
  async function confirmInstantMeeting(opts: { micOn: boolean; camOn: boolean; displayName: string }) {
    const invitees = Array.from(meetingSelected);
    if (invitees.length === 0 || creatingMeeting) return;
    setCreatingMeeting(true);
    setChatJoinError(null);
    try {
      const { conference_id } = await createConference(token);
      await Promise.all(invitees.map(u => apiConferenceInvite(token, conference_id, u)));
      setMeetingSelected(new Set());
      setMeetingSearch('');
      setMeetingLobby(null);
      setActiveGalleryCall({ conferenceId: conference_id, initialMicOn: opts.micOn, initialCamOn: opts.camOn, displayName: opts.displayName });
    } catch (err: any) {
      setChatJoinError(err?.message || 'Failed to start group video');
      setMeetingLobby(null);
    } finally {
      setCreatingMeeting(false);
    }
  }

  // ── Scheduled meetings ───────────────────────────────────────────────────────

  async function loadUpcomingMeetings() {
    setMeetingsError(null);
    setLoadingMeetings(true);
    try {
      const list = await getUpcomingMeetings(token);
      setUpcomingMeetings(list);
    } catch (err: any) {
      setMeetingsError(err?.message || 'Failed to load meetings');
    } finally {
      setLoadingMeetings(false);
    }
  }

  async function openMeetings() {
    setShowMeetings(true);
    await loadUpcomingMeetings();
  }

  function toggleScheduleUser(u: string) {
    setScheduleSelected(prev => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u); else next.add(u);
      return next;
    });
  }

  async function submitSchedule() {
    if (!scheduleWhen || scheduling) return;
    const startMs = new Date(scheduleWhen).getTime();
    const endMs = scheduleEndWhen ? new Date(scheduleEndWhen).getTime() : startMs + 60 * 60000;
    const durationMinutes = Math.max(5, Math.round((endMs - startMs) / 60000));
    setScheduling(true);
    setMeetingsError(null);
    try {
      await createMeeting(token, {
        title: scheduleTitle.trim() || undefined,
        scheduledAt: new Date(scheduleWhen).toISOString(),
        durationMinutes,
        inviteeUsernames: Array.from(scheduleSelected),
        waitingRoomEnabled: scheduleWaitingRoom,
      });
      setShowScheduleForm(false);
      setScheduleTitle('');
      setScheduleWhen('');
      setScheduleEndWhen('');
      setScheduleWaitingRoom(false);
      setScheduleSelected(new Set());
      const list = await getUpcomingMeetings(token);
      setUpcomingMeetings(list);
    } catch (err: any) {
      setMeetingsError(err?.message || 'Failed to schedule meeting');
    } finally {
      setScheduling(false);
    }
  }

  function joinScheduledMeeting(meeting: MeetingSummary) {
    setShowMeetings(false);
    setMeetingLobby({ kind: 'join', joinCode: meeting.join_code, title: meeting.title });
  }

  // Runs once the lobby's device setup is confirmed. join_by_code hands back
  // either {status:"admitted", conference_id, participants} — renders via
  // GalleryView (LiveKit) like every other group call — or {status:"waiting"}
  // when the host has a waiting room on, which shows WaitingForHostScreen
  // until the host admits/denies (WS conference_admitted/denied).
  async function confirmScheduledJoin(joinCode: string, opts: { micOn: boolean; camOn: boolean; displayName: string }) {
    setChatJoinError(null);
    try {
      const { conference_id, status } = await joinMeetingByCode(token, joinCode);
      setMeetingLobby(null);
      if (status === 'waiting') {
        setWaitingRoomState({ conferenceId: conference_id, initialMicOn: opts.micOn, initialCamOn: opts.camOn, displayName: opts.displayName });
      } else {
        setActiveGalleryCall({ conferenceId: conference_id, initialMicOn: opts.micOn, initialCamOn: opts.camOn, displayName: opts.displayName });
      }
    } catch (err: any) {
      setChatJoinError(err?.message || 'Failed to join meeting');
      setMeetingLobby(null);
    }
  }

  async function cancelScheduledMeeting(meetingId: number) {
    try {
      await cancelMeeting(token, meetingId);
      setUpcomingMeetings(prev => prev.filter(m => m.id !== meetingId));
    } catch (err: any) {
      setMeetingsError(err?.message || 'Failed to cancel meeting');
    }
  }

  // Join tapped from a meeting card inside a chat/group thread. Instant
  // meetings still need the master-token accept gate (opening a mic without
  // consent is not okay) — reuse the same conferenceInvite overlay that
  // handles that. Scheduled meetings join directly, matching joinScheduledMeeting.
  function handleJoinMeetingFromChat(
    m: { kind: 'instant'; conferenceId: number; invitedBy: string } | { kind: 'scheduled'; joinCode: string },
  ) {
    setChatJoinError(null);
    if (m.kind === 'instant') {
      setConferenceInvite({ conferenceId: m.conferenceId, invitedBy: m.invitedBy, participants: [] });
      return;
    }
    setMeetingLobby({ kind: 'join', joinCode: m.joinCode, title: null });
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
      meetings: 'Meetings',
      calendar: 'Calendar',
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
            <>
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
            </>
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

    if (activeTab === 'meetings') {
      return (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button style={hs.listItem} onClick={openNewMeeting}>
            <div style={{ ...hs.groupAvatar, background: 'var(--accent)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
              </svg>
            </div>
            <div style={hs.itemInfo}>
              <span style={hs.itemName}>Start Instant Meeting</span>
              <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>Group video — invite anyone, add more later</span>
            </div>
          </button>
          <button style={hs.listItem} onClick={openMeetings}>
            <div style={{ ...hs.groupAvatar, background: 'var(--accent)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div style={hs.itemInfo}>
              <span style={hs.itemName}>Scheduled Meetings</span>
              <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>Upcoming, join by code, or schedule a new one</span>
            </div>
          </button>

          {upcomingMeetings.length > 0 && (
            <>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', margin: '8px 4px 0' }}>
                Up next
              </span>
              {upcomingMeetings.slice(0, 3).map(m => (
                <button key={m.id} style={hs.listItem} onClick={() => joinScheduledMeeting(m)}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                    background: 'var(--input-field-bg)', border: '1px solid var(--border-color)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.68rem', fontWeight: 800, color: 'var(--accent)', lineHeight: 1.1, textAlign: 'center',
                  }}>
                    {new Date(m.scheduled_at).toLocaleDateString(undefined, { month: 'short' })}
                    <br />
                    {new Date(m.scheduled_at).getDate()}
                  </div>
                  <div style={hs.itemInfo}>
                    <span style={hs.itemName}>{m.title || 'Untitled meeting'}</span>
                    <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>{fmtRange(m.scheduled_at, m.duration_minutes)}</span>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
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
            // Never hold the master token for decryption: each locked message
            // prompts for it and discards it after use.
            masterToken={null}
            onMasterTokenSaved={() => {}}
            onCall={handleCall}
            onJoinMeeting={handleJoinMeetingFromChat}
            onBack={() => setSelectedChat(null)}
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
              // Ask for the token per message; never retain it.
              masterToken={null}
              onMasterTokenSaved={() => {}}
              onJoinMeeting={handleJoinMeetingFromChat}
              onBack={() => setSelectedGroup(null)}
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

    if (activeTab === 'meetings') {
      return (
        <WelcomePlaceholder
          title="Meetings"
          subtitle="Start an instant group call, or open Scheduled Meetings to join by code or plan ahead."
          action={
            <button
              onClick={openNewMeeting}
              style={{
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: 10, padding: '10px 20px', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Start Instant Meeting
            </button>
          }
        >
          <MeetingsIllustration />
        </WelcomePlaceholder>
      );
    }

    if (activeTab === 'calendar') {
      return (
        <CalendarView
          token={token}
          onJoinMeeting={(occ: CalendarOccurrence) => joinScheduledMeeting({
            id: occ.meeting_id,
            title: occ.title,
            scheduled_at: occ.occurrence_start,
            duration_minutes: occ.duration_minutes,
            status: occ.status,
            join_code: occ.join_code,
            creator_username: occ.creator_username,
            group_id: occ.group_id,
            waiting_room_enabled: occ.waiting_room_enabled,
          })}
        />
      );
    }

    if (activeTab === 'calls') {
      const selectedCall = calls.find(c => c.id === selectedCallId) ?? null;
      return <CallDetailPanel call={selectedCall} onCall={handleCall} />;
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
          style={{ ...hs.tabBtn, ...(activeTab === 'meetings' ? hs.tabBtnActive : {}) }}
          onClick={() => switchTab('meetings')}
          title="Meetings"
        >
          <MeetingsTabIcon active={activeTab === 'meetings'} />
        </button>
        <button
          style={{ ...hs.tabBtn, ...(activeTab === 'calendar' ? hs.tabBtnActive : {}) }}
          onClick={() => switchTab('calendar')}
          title="Calendar"
        >
          <CalendarTabIcon active={activeTab === 'calendar'} />
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

      {chatJoinError && (
        <div
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 950,
            background: '#ef4444', color: '#fff', borderRadius: 10,
            padding: '10px 16px', fontSize: '0.82rem', boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          {chatJoinError}
          <button
            onClick={() => setChatJoinError(null)}
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.9rem' }}
          >✕</button>
        </div>
      )}

      {/* ── MEETING LOBBY (device setup before joining) ─────────────────────── */}
      {meetingLobby && (
        <MeetingLobby
          title={meetingLobby.kind === 'instant' ? 'Start Meeting' : (meetingLobby.title || 'Join Meeting')}
          subtitle={meetingLobby.kind === 'join' ? 'Set up your camera and mic before joining' : undefined}
          defaultName={username}
          onCancel={() => setMeetingLobby(null)}
          onJoin={opts =>
            meetingLobby.kind === 'instant'
              ? confirmInstantMeeting(opts)
              : confirmScheduledJoin(meetingLobby.joinCode, opts)
          }
        />
      )}

      {/* ── WAITING FOR HOST ─────────────────────────────────────────────── */}
      {waitingRoomState && (
        <WaitingForHostScreen
          conferenceId={waitingRoomState.conferenceId}
          onAdmitted={() => {
            setActiveGalleryCall({
              conferenceId: waitingRoomState.conferenceId,
              initialMicOn: waitingRoomState.initialMicOn,
              initialCamOn: waitingRoomState.initialCamOn,
              displayName: waitingRoomState.displayName,
            });
            setWaitingRoomState(null);
          }}
          onDenied={() => {
            setWaitingRoomState(null);
            setChatJoinError('The host denied your request to join');
          }}
          onCancel={() => setWaitingRoomState(null)}
        />
      )}

      {/* ── GROUP VIDEO (LiveKit gallery view) ─────────────────────────────── */}
      {activeGalleryCall && (
        <GalleryView
          token={token}
          conferenceId={activeGalleryCall.conferenceId}
          initialMicOn={activeGalleryCall.initialMicOn}
          initialCamOn={activeGalleryCall.initialCamOn}
          displayName={activeGalleryCall.displayName}
          myUsername={username}
          masterToken={masterToken}
          onMasterTokenSaved={setMasterToken}
          onClose={() => { setActiveGalleryCall(null); setGalleryMinimized(false); }}
          minimized={galleryMinimized}
          onMinimize={() => setGalleryMinimized(true)}
          onMaximize={() => setGalleryMinimized(false)}
        />
      )}

      {/* ── CALL MODAL ──────────────────────────────────────────────────── */}
      {activeCall && (
        <CallModal
          token={token}
          myUsername={username}
          partner={activeCall.partner}
          callType={activeCall.callType}
          isIncoming={activeCall.isIncoming}
          callId={activeCall.callId}
          offerSdp={activeCall.offerSdp}
          conferenceIdProp={activeCall.conferenceId}
          conferenceParticipants={activeCall.conferenceParticipants}
          masterToken={masterToken ?? undefined}
          onEnd={() => { setActiveCall(null); setCallMinimized(false); }}
          onCallBack={(type) => {
            // Remount as a brand-new outgoing call rather than resetting the
            // modal in place: a fresh mount is the same path a normal outgoing
            // call takes, so there is no half-torn-down peer connection to reuse.
            const to = activeCall.partner;
            setActiveCall(null);
            setCallMinimized(false);
            setTimeout(() => setActiveCall({ partner: to, callType: type, isIncoming: false }), 250);
          }}
          onUpgradeToGallery={(confId) => {
            setActiveCall(null);
            setCallMinimized(false);
            setActiveGalleryCall({ conferenceId: confId });
          }}
          minimized={callMinimized}
          onMinimize={() => setCallMinimized(true)}
          onMaximize={() => setCallMinimized(false)}
        />
      )}

      {/* ── GROUP CALL INVITE ───────────────────────────────────────────── */}
      {conferenceInvite && !activeCall && !activeGalleryCall && (
        <div style={ci.backdrop}>
          <div style={ci.card}>
            <p style={ci.kicker}>Group call</p>
            <h3 style={ci.title}>{conferenceInvite.invitedBy} is adding you</h3>
            {conferenceInvite.participants.length > 0 && (
              <p style={ci.people}>
                Already on the call: {conferenceInvite.participants.join(', ')}
              </p>
            )}
            <p style={{ ...ci.hint, color: confTokenRejected ? '#ef4444' : '#9ca3af' }}>
              {confTokenRejected
                ? 'That token was rejected. The call is still ringing — try again.'
                : 'Enter your master token to join.'}
            </p>
            <input
              style={ci.input}
              type="password"
              autoFocus
              placeholder="Master token"
              value={confTokenInput}
              disabled={confJoining}
              onChange={e => setConfTokenInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && confTokenInput.trim()) joinConferenceCall(); }}
            />
            <div style={ci.row}>
              <button
                style={ci.decline}
                disabled={confJoining}
                onClick={() => {
                  stopRinging();
                  conferenceDecline(token, conferenceInvite.conferenceId);
                  setConferenceInvite(null);
                }}
              >
                Decline
              </button>
              <button
                style={{ ...ci.join, opacity: confTokenInput.trim() && !confJoining ? 1 : 0.5 }}
                disabled={!confTokenInput.trim() || confJoining}
                onClick={joinConferenceCall}
              >
                {confJoining ? 'Joining…' : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MISSED CALL — CALL BACK ──────────────────────────────────────── */}
      {missedCall && !incomingCall && !activeCall && !activeGalleryCall && (
        <div style={{
          position: 'fixed', right: 24, bottom: 24, zIndex: 900,
          background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 16,
          padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Missed call</span>
          <span style={{ fontSize: '0.95rem', color: '#fff', fontWeight: 600 }}>{missedCall.from}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={{ background: 'transparent', color: '#9ca3af', border: '1px solid #2a2a2a', borderRadius: 10, padding: '0.45rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem' }}
              onClick={() => setMissedCall(null)}
            >
              Dismiss
            </button>
            <button
              style={{ background: '#25d366', color: '#062', border: 'none', borderRadius: 10, padding: '0.45rem 0.9rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem' }}
              onClick={() => {
                const to = missedCall.from;
                const type = missedCall.callType;
                setMissedCall(null);
                handleCall(to, type);
              }}
            >
              Call back
            </button>
          </div>
        </div>
      )}

      {/* ── INCOMING CALL OVERLAY ────────────────────────────────────────── */}
      {incomingCall && !activeCall && !activeGalleryCall && (
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
            minWidth: 300,
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

            {/* Master token required to accept */}
            {!masterToken && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Enter master token to accept</span>
                <input
                  type="password"
                  placeholder="Master token"
                  value={callTokenInput}
                  onChange={e => { setCallTokenInput(e.target.value); setCallTokenError(null); }}
                  onKeyDown={async e => {
                    if (e.key === 'Enter') {
                      const trimmed = callTokenInput.trim();
                      if (!trimmed) return;
                      setCallTokenLoading(true);
                      const ok = await confirmMasterToken(token, trimmed).catch(() => false);
                      setCallTokenLoading(false);
                      if (ok) { setMasterToken(trimmed); setCallTokenError(null); }
                      else setCallTokenError('Invalid master token');
                    }
                  }}
                  style={{
                    background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 8,
                    color: '#f1f5f9', fontSize: '0.82rem', padding: '8px 12px',
                  }}
                  autoFocus
                />
                {callTokenError && <span style={{ fontSize: '0.7rem', color: '#ef4444' }}>{callTokenError}</span>}
                {callTokenLoading && <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>Verifying…</span>}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => {
                  stopRinging();
                  setCallTokenInput('');
                  setCallTokenError(null);
                  if (incomingCall.callId) {
                    performCallAction(token, incomingCall.callId, 'decline').catch(() => {});
                  }
                  setIncomingCall(null);
                }}
                style={{
                  flex: 1, background: '#ef4444', border: 'none', borderRadius: 10,
                  color: '#fff', fontWeight: 700, fontSize: '0.85rem',
                  padding: '10px 0', cursor: 'pointer',
                }}
              >
                Decline
              </button>
              <button
                disabled={!masterToken}
                onClick={() => {
                  if (!masterToken) return;
                  stopRinging();
                  setCallTokenInput('');
                  setCallTokenError(null);
                  setCallMinimized(false);
                  setActiveCall({ partner: incomingCall.from, callType: incomingCall.callType, isIncoming: true, callId: incomingCall.callId, offerSdp: incomingCall.offerSdp });
                  setIncomingCall(null);
                }}
                style={{
                  flex: 1, background: masterToken ? '#25d366' : '#1a3a2a', border: 'none', borderRadius: 10,
                  color: masterToken ? '#fff' : '#6b7280', fontWeight: 700, fontSize: '0.85rem',
                  padding: '10px 0', cursor: masterToken ? 'pointer' : 'not-allowed',
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
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: 16,
            width: 380,
            maxHeight: '70vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
            }}>
              <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>New Chat</span>
              <button
                onClick={() => { setShowNewChat(false); setUserSearch(''); }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1 }}
              >✕</button>
            </div>
            {/* Search */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              margin: '10px 12px', background: 'var(--input-field-bg)',
              border: '1px solid var(--border-color)', borderRadius: 10, padding: '8px 12px', flexShrink: 0,
            }}>
              <SearchIconSvg />
              <input
                autoFocus
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '0.85rem' }}
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
                          background: u.is_active ? '#25d366' : 'var(--text-muted)',
                          border: '2px solid var(--bg-panel)',
                        }} />
                      </div>
                      <div style={hs.itemInfo}>
                        <span style={hs.itemName}>{u.username}</span>
                        <span style={{ fontSize: '0.72rem', color: u.is_active ? '#25d366' : 'var(--text-muted)' }}>
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

      {showNewMeeting && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 800,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) { setShowNewMeeting(false); setMeetingSearch(''); } }}
        >
          <div style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: 16,
            width: 380,
            maxHeight: '70vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 20px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
            }}>
              <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>New Meeting</span>
              <button
                onClick={() => { setShowNewMeeting(false); setMeetingSearch(''); }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1 }}
              >✕</button>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              margin: '10px 12px', background: 'var(--input-field-bg)',
              border: '1px solid var(--border-color)', borderRadius: 10, padding: '8px 12px', flexShrink: 0,
            }}>
              <SearchIconSvg />
              <input
                autoFocus
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                placeholder="Search people to invite"
                value={meetingSearch}
                onChange={e => setMeetingSearch(e.target.value)}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loadingUsers ? (
                <ContactSkeleton />
              ) : (
                allUsers
                  .filter(u => u.username.toLowerCase().includes(meetingSearch.toLowerCase()))
                  .map(u => {
                    const checked = meetingSelected.has(u.username);
                    return (
                      <button
                        key={u.username}
                        style={{ ...hs.listItem, background: checked ? 'var(--input-field-bg)' : hs.listItem.background }}
                        onClick={() => toggleMeetingUser(u.username)}
                      >
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <div style={hs.contactAvatar}>{initials(u.username)}</div>
                          <div style={{
                            position: 'absolute', bottom: 1, right: 1,
                            width: 11, height: 11, borderRadius: '50%',
                            background: u.is_active ? '#25d366' : 'var(--text-muted)',
                            border: '2px solid var(--bg-panel)',
                          }} />
                        </div>
                        <div style={hs.itemInfo}>
                          <span style={hs.itemName}>{u.username}</span>
                          <span style={{ fontSize: '0.72rem', color: u.is_active ? '#25d366' : 'var(--text-muted)' }}>
                            {u.is_active ? 'online' : 'offline'}
                          </span>
                        </div>
                        <div style={{
                          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                          border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-color)'}`,
                          background: checked ? 'var(--accent)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {checked && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })
              )}
              {!loadingUsers && allUsers.filter(u => u.username.toLowerCase().includes(meetingSearch.toLowerCase())).length === 0 && (
                <div style={hs.emptyList}>{meetingSearch ? 'No users found' : 'No other users'}</div>
              )}
            </div>
            {meetingError && (
              <div style={{ padding: '8px 16px', color: '#ef4444', fontSize: '0.78rem', flexShrink: 0 }}>{meetingError}</div>
            )}
            <div style={{ padding: 12, borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
              <button
                onClick={startGalleryMeeting}
                disabled={meetingSelected.size === 0 || creatingMeeting}
                style={{
                  width: '100%',
                  background: meetingSelected.size === 0 ? 'var(--input-field-bg)' : 'var(--accent)',
                  color: meetingSelected.size === 0 ? 'var(--text-muted)' : '#fff',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 0',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: meetingSelected.size === 0 || creatingMeeting ? 'default' : 'pointer',
                }}
              >
                {creatingMeeting ? 'Starting…' : `Start Meeting${meetingSelected.size ? ` (${meetingSelected.size})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMeetings && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 800,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowMeetings(false); }}
        >
          <div style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: 18,
            width: 480,
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '18px 22px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9, background: 'var(--accent)', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)', flex: 1 }}>
                {showScheduleForm ? 'Schedule a Meeting' : 'Scheduled Meetings'}
              </span>
              <button
                onClick={() => (showScheduleForm ? setShowScheduleForm(false) : setShowMeetings(false))}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1 }}
              >✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: showScheduleForm ? '18px 22px' : '8px 12px' }}>
              {!showScheduleForm && (
                loadingMeetings ? (
                  <ContactSkeleton />
                ) : upcomingMeetings.length === 0 ? (
                  <div style={{ ...hs.emptyList, padding: '40px 10px' }}>
                    No upcoming meetings — schedule one below.
                  </div>
                ) : (
                  upcomingMeetings.map(m => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 10px', borderBottom: '1px solid var(--border-color)',
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                        background: 'var(--input-field-bg)', border: '1px solid var(--border-color)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.7rem', fontWeight: 800, color: 'var(--accent)', lineHeight: 1.1, textAlign: 'center',
                      }}>
                        {new Date(m.scheduled_at).toLocaleDateString(undefined, { month: 'short' })}
                        <br />
                        {new Date(m.scheduled_at).getDate()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {m.title || 'Untitled meeting'}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          {fmtRange(m.scheduled_at, m.duration_minutes)} · hosted by {m.creator_username}
                        </div>
                      </div>
                      <button
                        onClick={() => joinScheduledMeeting(m)}
                        style={{
                          background: 'var(--accent)', color: '#fff', border: 'none',
                          borderRadius: 8, padding: '7px 14px', fontSize: '0.76rem',
                          fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        Join
                      </button>
                      {m.creator_username === username && (
                        <button
                          onClick={() => cancelScheduledMeeting(m.id)}
                          title="Cancel"
                          style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.95rem', flexShrink: 0 }}
                        >✕</button>
                      )}
                    </div>
                  ))
                )
              )}

              {showScheduleForm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div>
                    <label style={hs.fieldLabel}>Title</label>
                    <input
                      placeholder="e.g. Weekly sync"
                      value={scheduleTitle}
                      onChange={e => setScheduleTitle(e.target.value)}
                      style={hs.fieldInput}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <label style={hs.fieldLabel}>Start time</label>
                      <input
                        type="datetime-local"
                        value={scheduleWhen}
                        onChange={e => {
                          const next = e.target.value;
                          setScheduleWhen(next);
                          // Keep the end time trailing the start by the same gap
                          // (default 60m) rather than letting it go stale/invalid.
                          const startMs = next ? new Date(next).getTime() : NaN;
                          const endMs = scheduleEndWhen ? new Date(scheduleEndWhen).getTime() : NaN;
                          if (!Number.isNaN(startMs) && (Number.isNaN(endMs) || endMs <= startMs)) {
                            const d = new Date(startMs + 60 * 60000);
                            const pad = (n: number) => String(n).padStart(2, '0');
                            setScheduleEndWhen(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                          }
                        }}
                        style={hs.fieldInput}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={hs.fieldLabel}>End time</label>
                      <input
                        type="datetime-local"
                        value={scheduleEndWhen}
                        min={scheduleWhen || undefined}
                        onChange={e => setScheduleEndWhen(e.target.value)}
                        style={hs.fieldInput}
                      />
                    </div>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <div
                      onClick={() => setScheduleWaitingRoom(v => !v)}
                      style={{
                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                        border: `1.5px solid ${scheduleWaitingRoom ? 'var(--accent)' : 'var(--border-color)'}`,
                        background: scheduleWaitingRoom ? 'var(--accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                      }}
                    >
                      {scheduleWaitingRoom && (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>Waiting room — approve guests before they join</span>
                  </label>

                  <div>
                    <label style={hs.fieldLabel}>
                      Invite{scheduleSelected.size > 0 ? ` (${scheduleSelected.size})` : ''}
                    </label>
                    <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 10 }}>
                      {allUsers.map(u => {
                        const checked = scheduleSelected.has(u.username);
                        return (
                          <button
                            key={u.username}
                            onClick={() => toggleScheduleUser(u.username)}
                            style={{ ...hs.listItem, background: checked ? 'var(--input-field-bg)' : hs.listItem.background }}
                          >
                            <div style={hs.contactAvatar}>{initials(u.username)}</div>
                            <div style={hs.itemInfo}><span style={hs.itemName}>{u.username}</span></div>
                            <div style={{
                              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                              border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-color)'}`,
                              background: checked ? 'var(--accent)' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {checked && (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
                    <button
                      onClick={() => setShowScheduleForm(false)}
                      style={{
                        flex: 1, background: 'var(--input-field-bg)', border: '1px solid var(--border-color)',
                        borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.84rem', padding: '10px 0', cursor: 'pointer',
                      }}
                    >Cancel</button>
                    <button
                      onClick={submitSchedule}
                      disabled={!scheduleWhen || scheduling}
                      style={{
                        flex: 1, background: !scheduleWhen ? 'var(--input-field-bg)' : 'var(--accent)',
                        color: !scheduleWhen ? 'var(--text-muted)' : '#fff', border: 'none',
                        borderRadius: 10, padding: '10px 0', fontSize: '0.84rem', fontWeight: 700,
                        cursor: !scheduleWhen || scheduling ? 'default' : 'pointer',
                      }}
                    >{scheduling ? 'Scheduling…' : 'Schedule'}</button>
                  </div>
                </div>
              )}
            </div>

            {meetingsError && (
              <div style={{ padding: '8px 16px', color: '#ef4444', fontSize: '0.78rem', flexShrink: 0 }}>{meetingsError}</div>
            )}

            {!showScheduleForm && (
              <div style={{ padding: 14, borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
                <button
                  onClick={async () => {
                    setShowScheduleForm(true);
                    if (allUsers.length === 0) {
                      setLoadingUsers(true);
                      try {
                        const users = await getUsers(token);
                        setAllUsers(users.filter(u => u.username !== username));
                      } catch {}
                      finally { setLoadingUsers(false); }
                    }
                  }}
                  style={{
                    width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
                    borderRadius: 10, padding: '11px 0', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                  }}
                >+ Schedule a meeting</button>
              </div>
            )}
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

const ci: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 950,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    background: '#141414', border: '1px solid #2a2a2a', borderRadius: 18,
    padding: '1.75rem', width: 360, display: 'flex', flexDirection: 'column', gap: 10,
  },
  kicker: { margin: 0, fontSize: '0.75rem', letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' },
  title: { margin: 0, color: '#fff', fontSize: '1.15rem' },
  people: { margin: 0, fontSize: '0.8rem', color: '#9ca3af' },
  hint: { margin: '4px 0 0', fontSize: '0.78rem', lineHeight: 1.45 },
  input: {
    background: '#0c0c0c', border: '1px solid #2a2a2a', borderRadius: 10,
    padding: '0.7rem 0.9rem', color: '#fff', fontSize: '0.9rem', outline: 'none',
  },
  row: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
  decline: {
    background: 'transparent', color: '#9ca3af', border: 'none',
    padding: '0.6rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem',
  },
  join: {
    background: '#25d366', color: '#062', border: 'none', borderRadius: 10,
    padding: '0.6rem 1.2rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem',
  },
};

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
  fieldLabel: {
    display: 'block',
    fontSize: '0.72rem',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    marginBottom: 6,
  },
  fieldInput: {
    width: '100%',
    background: 'var(--input-field-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    padding: '10px 12px',
    boxSizing: 'border-box',
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
