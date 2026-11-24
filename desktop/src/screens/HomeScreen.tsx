import { ACCENT_COLORS, DARK_VARIANTS, FONT_SIZES, AppearancePrefs, loadAppearance, applyAppearance, saveAppearance } from '../theme';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { presenceService, WsMessage } from '../services/presence';
import { notifySessionInvalid } from '../services/session';
import { setToken as setMonitorToken, handleCommand } from '../services/monitoring';
import { start as startAppPolicyMonitor, stop as stopAppPolicyMonitor } from '../services/appPolicyMonitor';
import {
  getConversations,
  getPendingDeviceCommands,
  getGroups,
  listChannels,
  browseChannels,
  createChannel,
  joinChannel,
  ChannelSummary,
  getCallHistory,
  getCallStatus,
  redialGroupCall,
  getUsers,
  confirmMasterToken,
  createMasterToken,
  getMasterToken2FAStatus,
  enableMasterToken2FA,
  disableMasterToken2FA,
  resetMasterToken2FAWithRecoveryCode,
  uploadVoiceIdentity,
  hasVoiceIdentity,
  listVoiceSpeech,
  createVoiceSpeech,
  fetchVoiceSpeech,
  deleteVoiceSpeech,
  deleteVoiceIdentity,
  VoiceSpeechClip,
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
  startGroupCall,
  conferenceInvite as apiConferenceInvite,
  createMeeting,
  getUpcomingMeetings,
  joinMeetingByCode,
  cancelMeeting,
  MeetingSummary,
  CalendarOccurrence,
  CALL_TERMINAL_STATUSES,
  getMonitoringConsent,
  setAppPolicyConsent,
  getDisappearSettings,
  setDisappearSettings,
  DisappearSettings,
  profilePictureUrl,
  getMyBio,
  setMyBio,
  uploadProfilePicture,
  deleteProfilePicture,
  setAvailabilityStatus,
  AvailabilityStatus,
  getChatSettings,
  updateChatSettings,
  deleteChatForMe,
  ChatSettingsItem,
  updateUsername,
  regenerateRecoveryCode,
  getMyOrgPrivileges,
  sendOrgBroadcast,
  getNotificationSettings,
  updateNotificationSettings,
  NotificationSettings,
  searchAll,
  SearchResults,
} from '../services/api';
import ChatItemMenu from '../components/ChatItemMenu';
import { Keypair, loadKeypair, saveKeypair, clearKeypair, parseExportedKey } from '../services/keys';
import ChatPanel from './ChatPanel';
import GroupPanel from './GroupPanel';
import { CreateGroupModal, JoinGroupModal } from '../components/GroupDialogs';
import { CallType, IncomingCall } from './CallModal';
import { openCallWindow, UPGRADE_TO_GALLERY_EVENT } from '../services/callWindow';
import { isTauri } from '../services/platform';
import InPageCallHost from '../components/InPageCallHost';
import type { GroupCallInfo } from '../callWindow/GroupCallView';
import type { JoinMeetingHandler } from '../components/MeetingCard';
import GalleryView from '../components/GalleryView';
import MeetingLobby from '../components/MeetingLobby';
import LoginApprovalPrompt from '../components/LoginApprovalPrompt';
import meetingsArt from '../assets/undraw_processing_bto8.svg';
import WaitingForHostScreen from '../components/WaitingForHostScreen';
import { fmtRange } from '../components/MeetingCard';
import CalendarView from '../components/CalendarView';
import TasksPanel from '../components/TasksPanel';
import AiSettingsSection from '../components/AiSettingsSection';
import AiPage, { AgentApprovalPopup, CopilotScheduleDraft } from '../components/AiPage';
import RemindersPanel, { ReminderAlerts } from '../components/RemindersPanel';
import WhiteboardPage from '../components/WhiteboardPage';
import {
  PhoneIncomingIcon,
  PhoneOutgoingIcon,
  PhoneMissedIcon,
  EyeIcon,
  EyeOffIcon,
  CloseIcon,
  SparkleIcon,
} from '../components/Icons';
import { userMessage } from '../services/errors';
import { applyProfileUpdate } from '../services/people';

interface Props {
  token: string;
  username: string;
  onLogout: () => void;
}

type Tab = 'chats' | 'groups' | 'channels' | 'meetings' | 'calendar' | 'tasks' | 'reminders' | 'whiteboard' | 'ai' | 'calls' | 'settings';
/** Tabs that own the whole main panel and have no list in the sidebar. */
const FULL_PAGE_TABS: Tab[] = ['calendar', 'tasks', 'reminders', 'whiteboard', 'ai'];

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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GroupTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function MeetingsTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}

function CalendarTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function TasksTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function ReminderTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3 2 6" /><path d="m22 6-3-3" />
    </svg>
  );
}

function WhiteboardTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="13" rx="2" /><path d="M7 13c2-3 3-1 5-4s3 0 5-2" /><path d="M12 17v3" /><path d="M8 21h8" />
    </svg>
  );
}

function AiTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
}

function CallTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function SettingsTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── Placeholder panels ─────────────────────────────────────────────────────────

const SECTION_TITLES: Record<Tab, string> = {
  chats: 'Direct messages', groups: 'Groups', channels: 'Your channels', meetings: 'Upcoming',
  calendar: 'Calendar', tasks: 'Tasks', reminders: 'Reminders', whiteboard: 'Whiteboards', ai: 'Dilarion AI', calls: 'Recent calls', settings: 'Settings',
};

function HashIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--accent)' : 'var(--text-secondary)'} strokeWidth="1.8" strokeLinecap="round">
      <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function SidebarSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 14 }}>
      <button onClick={onToggle} style={hs.sectionHeader} aria-expanded={open}>
        <span>{title}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}

function NavRow({ icon, label, active, badge, onClick, style }: {
  icon: React.ReactNode; label: string; active: boolean; badge?: number; onClick: () => void; style?: React.CSSProperties;
}) {
  return (
    <button className="app-nav-row" aria-label={label} style={{ ...hs.tabBtn, ...(active ? hs.tabBtnActive : {}), ...style }} onClick={onClick}>
      {icon}
      <span className="app-nav-label" style={hs.tabBtnLabel}>{label}</span>
      {!!badge && <span className="app-nav-badge" style={hs.tabBtnBadge}>{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

function WelcomePlaceholder({ children, art, title, subtitle, action, footer }: { children?: React.ReactNode; art?: React.ReactNode; title: string; subtitle: string; action?: React.ReactNode; footer?: React.ReactNode }) {
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
      position: 'relative',
    }}>
      {art ?? (
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
      )}
      <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>{title}</h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>{subtitle}</p>
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
      {footer && (
        <div style={{ position: 'absolute', bottom: '2.5rem', left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          {footer}
        </div>
      )}
    </div>
  );
}

// ── Resizable columns ──────────────────────────────────────────────────────────

const LAYOUT_KEY = 'dilarion_layout';
const NAV_WIDTH = { def: 260, min: 180, max: 380 };
const LIST_WIDTH = { def: 320, min: 220, max: 560 };

function loadLayout(): { nav: number; list: number } {
  try {
    const s = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    return {
      nav: clampWidth(Number(s.nav) || NAV_WIDTH.def, NAV_WIDTH),
      list: clampWidth(Number(s.list) || LIST_WIDTH.def, LIST_WIDTH),
    };
  } catch {
    return { nav: NAV_WIDTH.def, list: LIST_WIDTH.def };
  }
}

function clampWidth(w: number, range: { min: number; max: number }) {
  return Math.min(range.max, Math.max(range.min, Math.round(w)));
}

// Thin drag strip sitting on the border between two columns. Drag to resize
// the column on its left; double-click to snap back to the default width.
function ColumnResizer({ width, range, onChange }: {
  width: number;
  range: { def: number; min: number; max: number };
  onChange: (w: number) => void;
}) {
  const [active, setActive] = useState(false);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  return (
    <div
      className="app-column-resizer"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onPointerDown={e => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, startW: width };
        setActive(true);
      }}
      onPointerMove={e => {
        if (!drag.current) return;
        onChange(clampWidth(drag.current.startW + e.clientX - drag.current.startX, range));
      }}
      onPointerUp={() => { drag.current = null; setActive(false); }}
      onPointerCancel={() => { drag.current = null; setActive(false); }}
      onDoubleClick={() => onChange(range.def)}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => { if (!drag.current) setActive(false); }}
      style={{
        width: 7, marginLeft: -4, marginRight: -3, flexShrink: 0,
        position: 'relative', zIndex: 20, cursor: 'col-resize', touchAction: 'none',
        display: 'flex', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 2, height: '100%',
        background: active ? 'var(--accent)' : 'transparent',
        transition: 'background 0.12s',
      }} />
    </div>
  );
}

// ── Appearance ─────────────────────────────────────────────────────────────────

// ── Settings Panel ─────────────────────────────────────────────────────────────

const settingsPageStyle: React.CSSProperties = {
  flex: 1, overflowY: 'auto', padding: '36px max(40px, calc((100% - 760px) / 2)) 48px',
  display: 'flex', flexDirection: 'column', gap: 20, background: 'var(--bg-base)',
};

type SettingsPage = 'profile' | 'notifications' | 'security' | 'ai' | 'voice' | 'appearance' | 'account';

const SETTINGS_PAGES: { id: SettingsPage; label: string; hint: string; icon: string }[] = [
  { id: 'profile',       label: 'Profile',        hint: 'Photo, status and username',          icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|C12 7 4' },
  { id: 'notifications', label: 'Notifications',  hint: 'Alerts, quiet hours, disappearing',   icon: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9|M13.73 21a2 2 0 0 1-3.46 0' },
  { id: 'security',      label: 'Security',       hint: 'Master token, 2FA, encryption key',   icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  { id: 'ai',            label: 'Dilarion AI',    hint: 'Full control, agent permissions, chat history', icon: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z|M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z' },
  { id: 'voice',         label: 'Voice decoy',    hint: 'Your enrolled voice sample',           icon: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z|M19 10v2a7 7 0 0 1-14 0v-2|M12 19v4' },
  { id: 'appearance',    label: 'Appearance',     hint: 'Light or dark, accent, text size',    icon: 'C12 12 9|M12 3a9 9 0 0 0 0 18z' },
  { id: 'account',       label: 'Account',        hint: 'Delete account, log out',             icon: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|M16 17l5-5-5-5|M21 12H9' },
];

function SettingsGlyph({ spec }: { spec: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {spec.split('|').map((d, i) => {
        if (d.startsWith('C')) { const [x, y, r] = d.slice(1).split(' ').map(Number); return <circle key={i} cx={x} cy={y} r={r} />; }
        return <path key={i} d={d} />;
      })}
    </svg>
  );
}

function SettingsListPanel({ selected, onSelect }: { selected: SettingsPage; onSelect: (p: SettingsPage) => void }) {
  return (
    <section className="settings-list" style={{ marginTop: 14 }}>
      <div className="settings-list-title" style={{ ...hs.sectionHeader, cursor: 'default' }}>Settings</div>
      <div className="settings-list-card">
        {SETTINGS_PAGES.map(p => {
          const active = selected === p.id;
          return (
            <button
              key={p.id}
              className="settings-row"
              onClick={() => onSelect(p.id)}
              style={{ ...hs.sideRow, background: active ? 'var(--item-active-bg)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: active ? 600 : 500 }}
            >
              <span className="settings-row-icon" style={{ display: 'inline-flex', color: active ? 'var(--accent)' : 'var(--text-muted)' }}><SettingsGlyph spec={p.icon} /></span>
              <span className="settings-row-text" style={hs.sideRowLabel}>
                {p.label}
                <span className="settings-row-hint">{p.hint}</span>
              </span>
              <span className="settings-row-chevron" aria-hidden="true">›</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SettingsPageHeader({ page }: { page: SettingsPage }) {
  const meta = SETTINGS_PAGES.find(p => p.id === page)!;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 4 }}>
      <div style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{meta.label}</div>
      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{meta.hint}</div>
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
/**
 * Org device-policy monitoring consent. When on, this desktop checks its own
 * running processes against the org's admin-set blocklist and reports a
 * screenshot if a blocked app is found — see appPolicyMonitor.ts. Off by
 * default; nothing runs until this is explicitly turned on, and turning it
 * off stops the agent on the next poll tick.
 */
export function DevicePolicySection({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMonitoringConsent(token)
      .then(c => setEnabled(!!(c.consent_given && c.allow_app_policy_monitoring)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const next = !enabled;
      await setAppPolicyConsent(token, next);
      setEnabled(next);
    } catch (err: any) {
      setError(userMessage(err, "Couldn't save your changes. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>Organization Device Policy</div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          When enabled, this device checks its own running apps against your organization's list of
          disallowed software. If one is found running, a screenshot is taken as evidence and sent to your admin.
          Nothing else on this device is monitored by this setting.
        </span>
      </div>
      {loading ? (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading…</span>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: enabled ? '#25d366' : '#6b7280', flexShrink: 0 }} />
          <span style={{ fontSize: '0.85rem', color: enabled ? '#25d366' : 'var(--text-secondary)' }}>
            {enabled ? 'Enabled — this device is checked against the org policy' : 'Disabled'}
          </span>
          <button
            onClick={toggle}
            disabled={busy}
            style={{
              marginLeft: 'auto', background: enabled ? 'transparent' : 'var(--accent)',
              border: enabled ? '1px solid var(--border-color)' : 'none',
              color: enabled ? 'var(--text-muted)' : '#fff',
              borderRadius: 8, padding: '7px 16px', fontSize: '0.8rem', fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {busy ? 'Saving…' : enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      )}
      {error && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</span>}
    </div>
  );
}

/**
 * Default disappearing-message timers, applied automatically to whatever the
 * user sends next — separate knobs for text, media, and voice notes since
 * someone reasonably wants a photo to outlast a passing text, or vice versa.
 * Empty = off (never disappears) for that kind.
 */
function DisappearingMessagesSection({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [textHours, setTextHours] = useState('');
  const [mediaHours, setMediaHours] = useState('');
  const [voiceHours, setVoiceHours] = useState('');

  useEffect(() => {
    getDisappearSettings(token)
      .then(s => {
        setTextHours(s.text_hours != null ? String(s.text_hours) : '');
        setMediaHours(s.media_hours != null ? String(s.media_hours) : '');
        setVoiceHours(s.voice_hours != null ? String(s.voice_hours) : '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  function parseField(v: string): number | null {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const settings: DisappearSettings = {
        text_hours: parseField(textHours),
        media_hours: parseField(mediaHours),
        voice_hours: parseField(voiceHours),
      };
      await setDisappearSettings(token, settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(userMessage(err, "Couldn't save your changes. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: 90, background: 'var(--input-field-bg)', border: '1px solid var(--border-color)',
    borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.85rem', padding: '8px 10px',
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  };
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
  const labelStyle: React.CSSProperties = { fontSize: '0.85rem', color: 'var(--text-secondary)' };

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>Disappearing Messages</div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Applied automatically to everything you send from now on. Leave a field blank to keep that kind on forever.
        </span>
      </div>
      {loading ? (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Loading…</span>
      ) : (
        <>
          <div style={rowStyle}>
            <span style={labelStyle}>Text messages</span>
            <input type="number" min={1} placeholder="Off" value={textHours} onChange={e => setTextHours(e.target.value)} style={fieldStyle} />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Photos, videos & documents</span>
            <input type="number" min={1} placeholder="Off" value={mediaHours} onChange={e => setMediaHours(e.target.value)} style={fieldStyle} />
          </div>
          <div style={rowStyle}>
            <span style={labelStyle}>Voice notes</span>
            <input type="number" min={1} placeholder="Off" value={voiceHours} onChange={e => setVoiceHours(e.target.value)} style={fieldStyle} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: '0.8rem', fontWeight: 600, cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span style={{ fontSize: '0.78rem', color: '#25d366' }}>Saved</span>}
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Hours (e.g. 24 = 1 day)</span>
          </div>
        </>
      )}
      {error && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</span>}
    </div>
  );
}

/**
 * Username change + recovery code regenerate. A username change forces a
 * fresh login afterward rather than trying to hot-swap `username` through
 * every component that already closed over it (contacts, WS subscriptions,
 * the locally-stored keypair, which is keyed by username) — simpler and
 * far less error-prone than a live rename.
 */
function AccountIdentitySection({ token, username, onLogout }: { token: string; username: string; onLogout: () => void }) {
  const [newUsername, setNewUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [recCode, setRecCode] = useState<string | null>(null);
  const [recEmailed, setRecEmailed] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);

  async function handleUsernameSave() {
    const trimmed = newUsername.trim();
    if (!trimmed || trimmed === username) return;
    setSaving(true);
    setError(null);
    try {
      await updateUsername(token, trimmed);
      // Local keypair storage is keyed by username — move it so the next
      // login (under the new name) still finds the identity key.
      const kp = loadKeypair(username);
      if (kp) { await saveKeypair(trimmed, kp); await clearKeypair(username, false); }
      setDone(true);
      setTimeout(onLogout, 1500);
    } catch (err: any) {
      setError(userMessage(err, "Couldn't update your username. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    setRecBusy(true);
    setRecError(null);
    try {
      const res = await regenerateRecoveryCode(token);
      setRecCode(res.recovery_code);
      setRecEmailed(!!res.emailed);
      setAck(false);
    } catch (err: any) {
      setRecError(userMessage(err, "Couldn't generate a new recovery code. Please try again."));
    } finally {
      setRecBusy(false);
    }
  }

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)', marginBottom: 10 }}>Username</div>
        {done ? (
          <span style={{ fontSize: '0.85rem', color: '#25d366' }}>Username updated — signing you out to apply everywhere…</span>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              placeholder={username}
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              style={{ flex: 1, maxWidth: 260, background: 'var(--input-field-bg)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.85rem', padding: '9px 12px', fontFamily: 'inherit' }}
            />
            <button
              onClick={handleUsernameSave}
              disabled={saving || !newUsername.trim() || newUsername.trim() === username}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
        {error && <span style={{ display: 'block', marginTop: 8, fontSize: '0.75rem', color: '#ef4444' }}>{error}</span>}
      </div>

      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
        <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)', marginBottom: 8 }}>Recovery Code</div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 10px' }}>
          Lets you reset your access token yourself if you forget it, without an admin. Generating a new
          one invalidates any earlier code — do this if you're not sure your old one is still safe.
        </p>
        {recCode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--accent)', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.06em', textAlign: 'center' }}>
              {recCode}
            </div>
            {recEmailed && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>A copy was also sent to your email.</span>}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
              I've saved this code somewhere safe
            </label>
            <button
              onClick={() => setRecCode(null)}
              disabled={!ack}
              style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-muted)', borderRadius: 8, padding: '6px 14px', fontSize: '0.8rem', cursor: 'pointer', opacity: ack ? 1 : 0.5 }}
            >
              Done
            </button>
          </div>
        ) : (
          <button
            onClick={handleRegenerate}
            disabled={recBusy}
            style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {recBusy ? 'Generating…' : 'Generate new recovery code'}
          </button>
        )}
        {recError && <span style={{ display: 'block', marginTop: 8, fontSize: '0.75rem', color: '#ef4444' }}>{recError}</span>}
      </div>
    </div>
  );
}

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
      const stored = await saveKeypair(username, parsed);
      // Only publish a public key if the server has none; overwriting an existing
      // one would rotate the identity and break the user's other devices.
      if (parsed.publicKey) {
        const existing = await getPublicKey(token, username).catch(() => null);
        if (!existing) await updatePublicKey(token, parsed.publicKey).catch(() => {});
      }
      setKp(stored);
      setImporting(false);
      setBlob('');
    } catch (err: any) {
      setError(userMessage(err, "Couldn't import that key. Make sure you pasted the complete key and try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    await clearKeypair(username);
    setKp(null);
  }

  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>Encryption Key</div>

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
  onLogout: () => void;
  page: SettingsPage;
}

const hourSelectStyle: React.CSSProperties = {
  background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: 8,
  color: 'var(--text-primary)', fontSize: '0.82rem', padding: '6px 8px', cursor: 'pointer',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function SearchModal({ token, onClose, onPickPerson, onPickGroup }: {
  token: string;
  onClose: () => void;
  onPickPerson: (username: string) => void;
  onPickGroup: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes(null); setLoading(false); setError(false); return; }
    let cancelled = false;
    setRes(null);
    setError(false);
    setLoading(true);
    const id = setTimeout(() => {
      searchAll(token, t)
        .then(results => { if (!cancelled) setRes(results); })
        .catch(() => { if (!cancelled) setError(true); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q, token]);

  const empty = res && !res.people.length && !res.groups.length && !(res.channels || []).length && !res.files.length;
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', color: 'var(--text-primary)' };
  const sectionLabel: React.CSSProperties = { fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '12px 4px 4px' };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '8vh' }}>
      <div style={{ width: 'min(560px,94%)', maxHeight: '78vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel,#15151c)', border: '1px solid var(--border-color)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border-color)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search people, channels, files…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.95rem' }} />
          {loading && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>…</span>}
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>Esc</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 10px 14px' }}>
          {q.trim().length < 2 && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Type at least 2 characters.</div>}
          {error && <div role="alert" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Search is unavailable. Please try again.</div>}
          {empty && <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No matches. Message text is searched inside each chat.</div>}
          {res && res.people.length > 0 && <>
            <div style={sectionLabel}>People</div>
            {res.people.map(p => (
              <div key={p.username} style={rowStyle} onClick={() => onPickPerson(p.username)}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>
                  {(p.full_name || p.username).slice(0, 2).toUpperCase()}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.86rem' }}>{p.full_name || p.username}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>@{p.username}{p.department ? ` · ${p.department}` : ''}</span>
                </span>
              </div>
            ))}
          </>}
          {res && (res.channels || []).length > 0 && <>
            <div style={sectionLabel}>Channels</div>
            {(res.channels || []).map(c => (
              <div key={c.id} style={rowStyle} onClick={() => onPickGroup(c.id)}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>#</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.86rem' }}>#{c.name}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.topic || c.description || `${c.member_count} members`}</span>
                </span>
              </div>
            ))}
          </>}
          {res && res.groups.length > 0 && <>
            <div style={sectionLabel}>Groups</div>
            {res.groups.map(g => (
              <div key={g.id} style={rowStyle} onClick={() => onPickGroup(g.id)}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-card)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>#</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.86rem' }}>{g.name}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{g.member_count} members{g.description ? ` · ${g.description}` : ''}</span>
                </span>
              </div>
            ))}
          </>}
          {res && res.files.length > 0 && <>
            <div style={sectionLabel}>Files</div>
            {res.files.map(f => (
              <div key={f.media_id} style={{ ...rowStyle, cursor: 'default' }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>📎</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.86rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.filename}</span>
                  <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{f.media_type} · {fmtBytes(f.file_size)}</span>
                </span>
              </div>
            ))}
          </>}
        </div>
      </div>
    </div>
  );
}

// Bio: the line people see under your name in a chat header. Empty falls
// back to the job title the org set for you.
function BioCard({ token }: { token: string }) {
  const [bio, setBio] = useState('');
  const [jobTitle, setJobTitle] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    getMyBio(token).then(r => { setBio(r.bio ?? ''); setSaved(r.bio ?? ''); setJobTitle(r.job_title); }).catch(() => {});
  }, [token]);
  async function save() {
    setBusy(true); setNote(null);
    try {
      const r = await setMyBio(token, bio);
      setBio(r.bio ?? ''); setSaved(r.bio ?? ''); setNote('Saved');
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed to save bio');
    } finally { setBusy(false); }
  }
  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>Bio</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        Shown under your name at the top of chats.{jobTitle ? ` Leave it empty to show your job title (${jobTitle}).` : ''}
      </div>
      <textarea
        value={bio}
        maxLength={300}
        rows={2}
        onChange={e => { setBio(e.target.value); setNote(null); }}
        placeholder={jobTitle || 'Say something about yourself'}
        style={{ resize: 'vertical', background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: '0.85rem' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={save}
          disabled={busy || bio.trim() === saved.trim()}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: busy ? 'wait' : 'pointer', opacity: busy || bio.trim() === saved.trim() ? 0.5 : 1 }}
        >
          Save
        </button>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{bio.length}/300</span>
        {note && <span style={{ fontSize: '0.72rem', color: note === 'Saved' ? '#25d366' : '#ef4444' }}>{note}</span>}
      </div>
    </div>
  );
}

function SettingsMainPanel({ token, username, onLogout, page }: SettingsMainProps) {
  const [appearance, setAppearanceState] = useState<AppearancePrefs>(loadAppearance);

  function updateAppearance(patch: Partial<AppearancePrefs>) {
    setAppearanceState(prev => {
      const next: AppearancePrefs = { ...prev, ...patch };
      saveAppearance(next);
      return next;
    });
  }


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
  // Forgot the 2FA password → use the account recovery code instead.
  const [use2FARecovery, setUse2FARecovery] = useState(false);
  const [twoFaNewRecoveryCode, setTwoFaNewRecoveryCode] = useState<{ code: string; emailed: boolean } | null>(null);

  const [voiceIdentityEnrolled, setVoiceIdentityEnrolled] = useState(false);
  const [voiceIdentityLoading, setVoiceIdentityLoading] = useState(true);
  const [voiceIdentityUploading, setVoiceIdentityUploading] = useState(false);
  const [voiceIdentityError, setVoiceIdentityError] = useState<string | null>(null);
  const [isRecordingVoiceIdentity, setIsRecordingVoiceIdentity] = useState(false);
  const [voiceIdentitySeconds, setVoiceIdentitySeconds] = useState(0);
  const [voiceSpeechText, setVoiceSpeechText] = useState('');
  const [voiceClips, setVoiceClips] = useState<VoiceSpeechClip[]>([]);
  const [voiceSpeechBusy, setVoiceSpeechBusy] = useState(false);
  const [voiceSpeechError, setVoiceSpeechError] = useState<string | null>(null);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voicePreviewRef = useRef<string | null>(null);

  const [deletionStatus, setDeletionStatus] = useState<AccountDeletionStatus | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [pfpFailed, setPfpFailed] = useState(false);
  const [pfpVersion, setPfpVersion] = useState(0); // bumped to bust the <img> cache after upload/remove
  const [pfpUploading, setPfpUploading] = useState(false);
  const [pfpError, setPfpError] = useState<string | null>(null);
  const pfpInputRef = useRef<HTMLInputElement>(null);

  const [availabilityStatus, setAvailabilityStatusState] = useState<AvailabilityStatus>('available');
  const [statusText, setStatusText] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [notif, setNotif] = useState<NotificationSettings | null>(null);
  useEffect(() => { getNotificationSettings(token).then(setNotif).catch(() => {}); }, [token]);
  async function saveNotif(patch: Partial<NotificationSettings>) {
    const prev = notif;
    setNotif(n => (n ? { ...n, ...patch } : n));
    try {
      // Send the client's current UTC offset so the server evaluates quiet
      // hours in the user's local time.
      const offset = -new Date().getTimezoneOffset(); // minutes east of UTC
      const saved = await updateNotificationSettings(token, { ...patch, quiet_hours_utc_offset: offset });
      setNotif(saved);
    } catch {
      setNotif(prev);
    }
  }

  async function handlePfpSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPfpUploading(true);
    setPfpError(null);
    try {
      await uploadProfilePicture(token, file);
      setPfpFailed(false);
      setPfpVersion(v => v + 1);
    } catch (err: any) {
      setPfpError(userMessage(err, "Couldn't upload that picture. Please try again."));
    } finally {
      setPfpUploading(false);
    }
  }

  async function handlePfpRemove() {
    setPfpUploading(true);
    setPfpError(null);
    try {
      await deleteProfilePicture(token);
      setPfpFailed(true);
      setPfpVersion(v => v + 1);
    } catch (err: any) {
      setPfpError(userMessage(err, "Couldn't remove your picture. Please try again."));
    } finally {
      setPfpUploading(false);
    }
  }

  async function handleSetAvailability(status: AvailabilityStatus) {
    setStatusSaving(true);
    setStatusError(null);
    try {
      await setAvailabilityStatus(token, status, statusText.trim() || undefined);
      setAvailabilityStatusState(status);
    } catch (err: any) {
      setStatusError(userMessage(err, "Couldn't update your status. Please try again."));
    } finally {
      setStatusSaving(false);
    }
  }

  useEffect(() => {
    getMasterToken2FAStatus(token).then(setTwoFaEnabled).catch(() => {});
    getMyAccountDeletionStatus(token).then(setDeletionStatus).catch(() => {});
    setVoiceIdentityLoading(true);
    hasVoiceIdentity(token, username).then(setVoiceIdentityEnrolled).finally(() => setVoiceIdentityLoading(false));
  }, [token, username]);

  useEffect(() => {
    if (!voiceIdentityEnrolled) {
      setVoiceClips([]);
      return;
    }
    listVoiceSpeech(token).then(setVoiceClips).catch(() => setVoiceClips([]));
  }, [token, voiceIdentityEnrolled]);

  const MIN_VOICE_IDENTITY_SECONDS = 8;

  async function startVoiceIdentityRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunksRef.current = [];
      const rec = new MediaRecorder(stream);
      voiceRecorderRef.current = rec;
      rec.ondataavailable = e => { if (e.data.size) voiceChunksRef.current.push(e.data); };
      rec.start(100);
      setIsRecordingVoiceIdentity(true);
      setVoiceIdentitySeconds(0);
      setVoiceIdentityError(null);
      voiceTimerRef.current = setInterval(() => setVoiceIdentitySeconds(s => s + 1), 1000);
    } catch {
      setVoiceIdentityError('Microphone not available');
    }
  }

  async function stopAndUploadVoiceIdentity() {
    const rec = voiceRecorderRef.current;
    if (!rec) return;
    if (voiceTimerRef.current) { clearInterval(voiceTimerRef.current); voiceTimerRef.current = null; }
    setIsRecordingVoiceIdentity(false);
    const seconds = voiceIdentitySeconds;
    setVoiceIdentitySeconds(0);

    await new Promise<void>(resolve => {
      rec.onstop = () => resolve();
      rec.stop();
      rec.stream.getTracks().forEach(t => t.stop());
    });
    voiceRecorderRef.current = null;

    if (seconds < MIN_VOICE_IDENTITY_SECONDS) {
      setVoiceIdentityError(`Recording too short — need at least ${MIN_VOICE_IDENTITY_SECONDS}s`);
      return;
    }

    // WebKit (the macOS app) records MP4, Chromium records WebM.
    const mimeType = rec.mimeType || 'audio/webm';
    const blob = new Blob(voiceChunksRef.current, { type: mimeType });
    voiceChunksRef.current = [];
    setVoiceIdentityUploading(true);
    try {
      await uploadVoiceIdentity(token, blob, mimeType.includes('mp4') ? 'voice_identity.m4a' : 'voice_identity.webm');
      setVoiceIdentityEnrolled(true);
    } catch (err: any) {
      setVoiceIdentityError(userMessage(err, err?.message || "Couldn't save your voice sample. Please try again."));
    } finally {
      setVoiceIdentityUploading(false);
    }
  }

  function replaceVoicePreview(url: string | null) {
    if (voicePreviewRef.current) URL.revokeObjectURL(voicePreviewRef.current);
    voicePreviewRef.current = url;
    setVoicePreviewUrl(url);
  }

  async function generateOwnedSpeech() {
    const spoken = voiceSpeechText.trim();
    if (!spoken) {
      setVoiceSpeechError('Enter the words to speak');
      return;
    }
    setVoiceSpeechBusy(true);
    setVoiceSpeechError(null);
    try {
      await createVoiceSpeech(token, spoken);
      setVoiceSpeechText('');
      setVoiceClips(await listVoiceSpeech(token));
    } catch (err: any) {
      setVoiceSpeechError(userMessage(err, err?.message || "Couldn't generate speech. Please try again."));
    } finally {
      setVoiceSpeechBusy(false);
    }
  }

  async function previewOwnedSpeech(clipId: string) {
    setVoiceSpeechError(null);
    try {
      const blob = await fetchVoiceSpeech(token, clipId);
      replaceVoicePreview(URL.createObjectURL(blob));
    } catch (err: any) {
      setVoiceSpeechError(userMessage(err, err?.message || "Couldn't play that clip."));
    }
  }

  async function removeOwnedSpeech(clipId: string) {
    setVoiceSpeechError(null);
    try {
      await deleteVoiceSpeech(token, clipId);
      setVoiceClips(clips => clips.filter(clip => clip.id !== clipId));
    } catch (err: any) {
      setVoiceSpeechError(userMessage(err, err?.message || "Couldn't delete that clip."));
    }
  }

  async function deleteOwnedEnrollment() {
    setVoiceIdentityUploading(true);
    setVoiceIdentityError(null);
    try {
      await deleteVoiceIdentity(token);
      setVoiceIdentityEnrolled(false);
      setVoiceClips([]);
      replaceVoicePreview(null);
    } catch (err: any) {
      setVoiceIdentityError(userMessage(err, err?.message || "Couldn't delete your voice enrollment."));
    } finally {
      setVoiceIdentityUploading(false);
    }
  }

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
      setTwoFaError(userMessage(err, "Couldn't enable 2FA. Please try again."));
    } finally {
      setTwoFaLoading(false);
    }
  }

  async function handleDisable2FA() {
    if (!disable2FAPassword.trim()) return;
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      if (use2FARecovery) {
        const res = await resetMasterToken2FAWithRecoveryCode(token, disable2FAPassword.trim());
        setTwoFaNewRecoveryCode({ code: res.recovery_code, emailed: !!res.emailed });
        setUse2FARecovery(false);
      } else {
        await disableMasterToken2FA(token, disable2FAPassword.trim());
      }
      setTwoFaEnabled(false);
      setShowDisable2FA(false);
      setDisable2FAPassword('');
    } catch (err: any) {
      setTwoFaError(userMessage(err, "Couldn't disable 2FA. Please try again."));
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
      setDeleteError(userMessage(err, "Couldn't submit your request. Please try again."));
    } finally {
      setDeleteLoading(false);
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
      setCreateError(userMessage(err, "Couldn't create your master token. Please try again."));
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
      <div className="settings-scroll-page" style={settingsPageStyle}>
        <SettingsPageHeader page="appearance" />

        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 18 }}>
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
    <div className="settings-scroll-page" style={settingsPageStyle}>
      <SettingsPageHeader page={page} />
      {/* Profile */}
      <div style={{ display: page === 'profile' ? 'flex' : 'none', alignItems: 'center', gap: 20 }}>
        <div
          onClick={() => !pfpUploading && pfpInputRef.current?.click()}
          title="Change profile picture"
          style={{
            position: 'relative', width: 72, height: 72, borderRadius: '50%',
            background: 'var(--accent)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: '1.5rem', flexShrink: 0, overflow: 'hidden',
            cursor: pfpUploading ? 'wait' : 'pointer', opacity: pfpUploading ? 0.6 : 1,
          }}
        >
          {!pfpFailed && (
            <img
              key={pfpVersion}
              src={`${profilePictureUrl(username)}?v=${pfpVersion}`}
              onError={() => setPfpFailed(true)}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
          {pfpFailed && initials(username)}
          <div style={{
            position: 'absolute', bottom: 0, insetInline: 0, background: 'rgba(0,0,0,0.55)',
            color: '#fff', fontSize: '0.55rem', textAlign: 'center', padding: '2px 0',
          }}>
            Edit
          </div>
        </div>
        <input ref={pfpInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handlePfpSelected} />
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{username}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>Your account</div>
          {!pfpFailed && (
            <button
              onClick={handlePfpRemove}
              disabled={pfpUploading}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.72rem', cursor: 'pointer', padding: 0, marginTop: 6, textDecoration: 'underline' }}
            >
              Remove picture
            </button>
          )}
          {pfpError && <div style={{ fontSize: '0.72rem', color: '#ef4444', marginTop: 4 }}>{pfpError}</div>}
        </div>
      </div>

      {page === 'profile' && (<>
      <BioCard token={token} />
{/* Availability status */}
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>Status</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['available', 'busy', 'dnd', 'away'] as AvailabilityStatus[]).map(s => (
            <button
              key={s}
              onClick={() => handleSetAvailability(s)}
              disabled={statusSaving}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: availabilityStatus === s ? 'var(--accent)' : 'var(--bg-card)',
                color: availabilityStatus === s ? '#fff' : 'var(--text-primary)',
                border: '1px solid var(--border-color)', borderRadius: 20, padding: '6px 12px',
                fontSize: '0.78rem', fontWeight: 600, cursor: statusSaving ? 'wait' : 'pointer',
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: s === 'available' ? '#25d366' : s === 'busy' ? '#f59e0b' : s === 'dnd' ? '#ef4444' : '#9ca3af',
              }} />
              {s === 'dnd' ? 'Do Not Disturb' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <input
          value={statusText}
          onChange={e => setStatusText(e.target.value)}
          onBlur={() => handleSetAvailability(availabilityStatus)}
          placeholder="Custom status message (optional)"
          maxLength={100}
          style={{
            background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: 8,
            color: 'var(--text-primary)', fontSize: '0.82rem', padding: '8px 12px',
          }}
        />
        {statusError && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{statusError}</span>}
      </div>

      </>)}

      {page === 'notifications' && (<>
{/* Notifications */}
      {notif && (
        <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>Notifications</div>

          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
            <span>
              <span style={{ fontSize: '0.86rem', color: 'var(--text-primary)', fontWeight: 600 }}>Pause all notifications</span>
              <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>Silence messages, tasks and reminders. Calls still ring.</span>
            </span>
            <input type="checkbox" checked={notif.mute_all_notifications} onChange={e => saveNotif({ mute_all_notifications: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
            <span>
              <span style={{ fontSize: '0.86rem', color: 'var(--text-primary)', fontWeight: 600 }}>Quiet hours</span>
              <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>Mute non-urgent notifications during a daily window.</span>
            </span>
            <input type="checkbox" checked={notif.quiet_hours_enabled} onChange={e => saveNotif({ quiet_hours_enabled: e.target.checked })} style={{ width: 18, height: 18, accentColor: 'var(--accent)' }} />
          </label>

          {notif.quiet_hours_enabled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
              <span>From</span>
              <select value={notif.quiet_hours_start ?? 22} onChange={e => saveNotif({ quiet_hours_start: Number(e.target.value) })} style={hourSelectStyle}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
              <span>to</span>
              <select value={notif.quiet_hours_end ?? 7} onChange={e => saveNotif({ quiet_hours_end: Number(e.target.value) })} style={hourSelectStyle}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>your local time</span>
            </div>
          )}
        </div>
      )}

      </>)}

      {page === 'security' && (<>
{/* Master token section */}
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>Master Token</div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Your master token works across all your Dilarion devices. It is never stored on the server — only a secure hash is kept.
          </span>
        </div>


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
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>Master Token 2FA</div>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => { setUse2FARecovery(false); setShowDisable2FA(true); }}
              style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 8, padding: '6px 14px', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Disable 2FA
            </button>
            <button
              onClick={() => { setUse2FARecovery(true); setDisable2FAPassword(''); setTwoFaError(null); setShowDisable2FA(true); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--accent)', padding: 0, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
            >
              Forgot 2FA password? Reset with recovery code
            </button>
          </div>
        )}

        {twoFaEnabled && showDisable2FA && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type={use2FARecovery ? 'text' : 'password'}
              placeholder={use2FARecovery ? 'Recovery code (XXXX-XXXX-XXXX)' : 'Current 2FA password'}
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
                onClick={() => { setShowDisable2FA(false); setUse2FARecovery(false); setTwoFaError(null); }}
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {twoFaEnabled && showDisable2FA && (
          <button
            onClick={() => { setUse2FARecovery(v => !v); setDisable2FAPassword(''); setTwoFaError(null); }}
            style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: 'var(--accent)', padding: 0, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
          >
            {use2FARecovery ? 'Use my 2FA password instead' : 'Forgot your 2FA password? Use your recovery code'}
          </button>
        )}

        {twoFaNewRecoveryCode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--border-color)', borderRadius: 10, padding: '10px 12px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>2FA was turned off. Your old recovery code no longer works — here is your new one:</span>
            <code style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: 1, color: 'var(--text-primary)', userSelect: 'all' }}>{twoFaNewRecoveryCode.code}</code>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {twoFaNewRecoveryCode.emailed ? 'A copy was also sent to your email.' : 'Save it somewhere safe — no email address is on file for this account.'}
            </span>
            <button
              onClick={() => setTwoFaNewRecoveryCode(null)}
              style={{ alignSelf: 'flex-start', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '4px 12px', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              I saved it
            </button>
          </div>
        )}

        {twoFaError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{twoFaError}</span>}
      </div>

      </>)}

      {page === 'voice' && (<>
{/* AI Voice Decoy section */}
      <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '1rem', fontWeight: 650, color: 'var(--text-primary)' }}>AI Voice Decoy</div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 14px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Record a short sample of your own voice. Decoy voice notes use it, and you can type English text to preview speech in that voice. Another account cannot download the sample or the clips.
          </span>
        </div>

        {!voiceIdentityLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: voiceIdentityEnrolled ? '#25d366' : '#6b7280', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', color: voiceIdentityEnrolled ? '#25d366' : 'var(--text-muted)' }}>
              {voiceIdentityEnrolled ? 'Enrolled — decoys use your voice' : 'Not set — voice notes get a generic decoy'}
            </span>
          </div>
        )}

        {isRecordingVoiceIdentity ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{voiceIdentitySeconds}s</span>
            <button
              onClick={stopAndUploadVoiceIdentity}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Stop &amp; Save
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={startVoiceIdentityRecording}
              disabled={voiceIdentityUploading}
              style={{ alignSelf: 'flex-start', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: voiceIdentityUploading ? 'wait' : 'pointer', fontFamily: 'inherit' }}
            >
              {voiceIdentityEnrolled ? 'Re-record' : 'Record sample (8s+)'}
            </button>
            {voiceIdentityUploading && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Saving…</span>}
          </div>
        )}

        {voiceIdentityError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{voiceIdentityError}</span>}

        {voiceIdentityEnrolled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              value={voiceSpeechText}
              onChange={e => setVoiceSpeechText(e.target.value)}
              placeholder="Type what your voice should say"
              maxLength={400}
              rows={3}
              style={{ width: '100%', resize: 'vertical', background: 'var(--bg-card)', color: 'inherit', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 10px', fontFamily: 'inherit', fontSize: '0.85rem' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={generateOwnedSpeech}
                disabled={voiceSpeechBusy}
                style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: voiceSpeechBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
              >
                {voiceSpeechBusy ? 'Generating…' : 'Generate speech'}
              </button>
              <button
                onClick={deleteOwnedEnrollment}
                disabled={voiceIdentityUploading}
                style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Delete enrollment and clips
              </button>
            </div>
            {voiceSpeechError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{voiceSpeechError}</span>}
            {voicePreviewUrl && <audio src={voicePreviewUrl} controls autoPlay style={{ width: '100%' }} />}
            {voiceClips.map(clip => (
              <div key={clip.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontSize: '0.82rem' }}>{clip.text}</span>
                <button onClick={() => previewOwnedSpeech(clip.id)} style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 8, padding: '6px 10px', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}>Play</button>
                <button onClick={() => removeOwnedSpeech(clip.id)} style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 8, padding: '6px 10px', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      </>)}

      {/* Username + recovery code */}
      {page === 'profile' && <AccountIdentitySection token={token} username={username} onLogout={onLogout} />}

      {/* Disappearing message defaults */}
      {page === 'notifications' && <DisappearingMessagesSection token={token} />}

      {/* Org device-policy monitoring consent — hidden from Settings UI, all
          desktop devices are org-owned. Component/backend logic left intact. */}

      {/* Encryption key section */}
      {page === 'security' && <EncryptionKeySection token={token} username={username} />}
      {page === 'ai' && <AiSettingsSection token={token} />}

      {page === 'account' && (<>
{/* Danger zone: account deletion request */}
      <div style={{ background: 'var(--bg-panel)', border: '1px solid #ef4444', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '1rem', fontWeight: 650, color: '#dc2626' }}>Danger Zone</div>

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

      </>)}

      {/* Logout */}
      <div style={{ display: page === 'account' ? 'block' : 'none' }}>
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
        const isCompleted = call.duration > 0 || ['completed', 'end', 'ended', 'accept', 'accepted'].includes(call.status);
        const isActive = selectedCallId === call.id;
        const elsewhere = !!call.answered_elsewhere;
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
                {call.is_group ? (call.other_party_username || 'Group call') : call.other_party_username}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {callIcon}
                <span style={{ fontSize: '0.72rem', color: elsewhere ? 'var(--text-secondary)' : statusColor }}>
                  {call.is_group ? 'Group call' : elsewhere ? 'Answered on another device' : call.status}
                  {call.duration > 0 ? ` · ${fmtDuration(call.duration)}` : ''}
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

function CallDetailPanel({ call, onCall, onGroupCall }: {
  call: CallRecord | null;
  onCall: (partner: string, type: CallType) => void;
  onGroupCall?: (call: CallRecord) => void;
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
  const isCompleted = call.duration > 0 || ['completed', 'end', 'ended', 'accept', 'accepted'].includes(call.status);
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
        <div style={{ fontSize: '0.82rem', color: statusColor, marginTop: 4, textTransform: 'capitalize' }}>{call.is_group ? 'Group call' : call.status}</div>
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
        {call.answered_elsewhere && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Answered</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              On another device{call.answered_device_name ? ` (${call.answered_device_name})` : ''}
            </span>
          </div>
        )}
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

      {/* Redial straight from the history entry — the whole reason to open one.
          A group row rings everyone who was on it, not just one person. */}
      <div style={{ display: 'flex', gap: 10 }}>
        {call.is_group && call.conference_id && onGroupCall ? (
          <button
            onClick={() => onGroupCall(call)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#25d366', color: '#062', border: 'none', borderRadius: 10,
              padding: '0.6rem 1.1rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem',
            }}
          >
            Call back everyone
          </button>
        ) : null}
        {!call.is_group && <button
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
        </button>}
        {!call.is_group && <button
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
        </button>}
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

// Voice/video calls need the desktop or phone app (the web build has no call window).
const CALLS_UNAVAILABLE = 'Calling is not available on this version. Use the Dilarion phone or desktop app to make and receive calls.';

function ChannelBrowse({ token, onClose, onJoined }: { token: string; onClose: () => void; onJoined: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ChannelSummary[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { browseChannels(token, q).then(setRows).catch(() => setRows([])); }, [token, q]);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 420, maxHeight: '80vh', overflow: 'auto', background: 'var(--bg-panel)', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>Channels</strong><button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Close</button></div>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search public channels" style={{ width: '100%', marginTop: 8, padding: 8, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
        {rows.map(row => (
          <button key={row.id} onClick={() => joinChannel(token, row.id).then(onJoined).catch(err => setError(err.message))} style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 8, padding: 8, background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', cursor: 'pointer' }}>
            #{row.name}<span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{row.topic || row.description || 'Public'}</span>
          </button>
        ))}
        <form onSubmit={e => { e.preventDefault(); createChannel(token, { name, visibility: 'public', posting_policy: 'everyone' }).then(onJoined).catch(err => setError(err.message)); }} style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="New channel name" style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>Create</button>
        </form>
        {error && <div style={{ color: '#fca5a5', fontSize: '0.75rem', marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}

export default function HomeScreen({ token, username, onLogout }: Props) {
  // Calls work in the desktop app (own OS window) and now on the web build too
  // (rendered in-page via InPageCallHost over WebRTC/LiveKit). Only block when
  // the browser genuinely lacks WebRTC (very old browsers, non-secure context).
  const callsSupported = isTauri() || (
    typeof navigator !== 'undefined' && !!navigator.mediaDevices &&
    typeof RTCPeerConnection !== 'undefined'
  );
  // Version shown in the UI. Baked in at build time (__APP_VERSION__ from
  // tauri.conf.json) so it always shows, with the Tauri runtime value preferred
  // when available. Tracks OTA updates automatically either way.
  const [appVersion, setAppVersion] = useState<string>(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '',
  );
  useEffect(() => {
    import('@tauri-apps/api/app')
      .then(m => m.getVersion())
      .then(v => { if (v) setAppVersion(v); })
      .catch(() => {});
  }, []);
  const [activeTab, setActiveTab] = useState<Tab>('chats');
  const [mobilePane, setMobilePane] = useState<'list' | 'main'>('list');
  const [layout, setLayout] = useState(loadLayout);
  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* storage unavailable */ }
  }, [layout]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [sectionsOpen, setSectionsOpen] = useState({ channels: true, list: true });
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [showChannelBrowse, setShowChannelBrowse] = useState(false);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [connected, setConnected] = useState(false);
  // Latest official organization broadcast, shown as a dismissible banner.
  const [orgBroadcast, setOrgBroadcast] = useState<{ title?: string; message: string; from?: string } | null>(null);
  // Global incoming-message toasts — shown on EVERY page (tasks, settings, calls…)
  // so a user never has to be on the Chats tab to know a message arrived.
  const [toasts, setToasts] = useState<{ id: number; sender: string; group?: string }[]>([]);
  // Org-wide privileges this account holds — gates the broadcast composer.
  const [orgPrivileges, setOrgPrivileges] = useState<string[]>([]);
  const [showBroadcastCompose, setShowBroadcastCompose] = useState(false);
  const [broadcastForm, setBroadcastForm] = useState({ title: '', message: '' });
  const [broadcastState, setBroadcastState] = useState<{ sending: boolean; error: string; notice: string }>({ sending: false, error: '', notice: '' });
  const canBroadcast = orgPrivileges.includes('broadcast');

  async function submitBroadcast() {
    const message = broadcastForm.message.trim();
    if (!message) return;
    setBroadcastState({ sending: true, error: '', notice: '' });
    try {
      const r = await sendOrgBroadcast(token, message, broadcastForm.title.trim() || undefined);
      setBroadcastState({ sending: false, error: '', notice: `Sent to ${r.recipients} staff (${r.delivered_live} online now).` });
      setBroadcastForm({ title: '', message: '' });
      setTimeout(() => { setShowBroadcastCompose(false); setBroadcastState({ sending: false, error: '', notice: '' }); }, 1400);
    } catch (e: any) {
      setBroadcastState({ sending: false, error: userMessage(e, "Couldn't send the broadcast. Please try again."), notice: '' });
    }
  }
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('profile');

  // ── Per-chat settings: archive / mute / lock / delete-for-me ────────────────
  const [chatSettings, setChatSettings] = useState<ChatSettingsItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [lockPrompt, setLockPrompt] = useState<{ kind: 'contact' | 'group'; target: string | number } | null>(null);
  const [lockPromptInput, setLockPromptInput] = useState('');
  const [lockPromptError, setLockPromptError] = useState<string | null>(null);
  const [lockPromptBusy, setLockPromptBusy] = useState(false);

  function refreshChatSettings() {
    getChatSettings(token).then(setChatSettings).catch(() => {});
  }

  useEffect(() => { refreshChatSettings(); }, [token]);

  function settingsForContact(c: string): ChatSettingsItem | undefined {
    return chatSettings.find(s => s.peer_username === c);
  }
  function settingsForGroup(id: number): ChatSettingsItem | undefined {
    return chatSettings.find(s => s.group_id === id);
  }

  // ── Call state ───────────────────────────────────────────────────────────────
  // The 1:1 call itself now lives in its own OS window (see callWindow.ts /
  // CallWindowApp) — this just tracks whether one is currently open, to keep
  // gating the other call-related banners below the same way `activeCall`
  // used to.
  const [callWindowOpen, setCallWindowOpen] = useState(false);
  // LiveKit gallery-view group call — separate from the mesh-based call window above.
  const [activeGalleryCall, setActiveGalleryCall] = useState<{ conferenceId: number; initialMicOn?: boolean; initialCamOn?: boolean; displayName?: string; title?: string; isAdHocCall?: boolean } | null>(null);
  const [galleryMinimized, setGalleryMinimized] = useState(false);
  // Device-setup lobby shown before actually connecting to a group call.
  const [meetingLobby, setMeetingLobby] = useState<
    | { kind: 'instant' }
    | { kind: 'join'; joinCode: string; title: string | null }
    // Invited into a meeting that's already running: set up, then go straight in.
    | { kind: 'invite'; conferenceId: number; title: string | null; camOn: boolean }
    | null
  >(null);
  const [waitingRoomState, setWaitingRoomState] = useState<{ conferenceId: number; initialMicOn?: boolean; initialCamOn?: boolean; displayName?: string } | null>(null);
  const [chatJoinError, setChatJoinError] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  // The caller hanging up has to stop this ring even if the socket message
  // was missed. The status poll is that backup.
  useEffect(() => {
    const ringing = incomingCall;
    if (!ringing?.callId) return;
    let stopped = false;
    const t = window.setInterval(async () => {
      const st = await getCallStatus(token, ringing.callId);
      if (stopped || !st) return;
      if (CALL_TERMINAL_STATUSES.includes(st.status)) {
        stopRinging();
        setIncomingCall(cur => (cur?.callId === ringing.callId ? null : cur));
        setMissedCall({ from: ringing.from, callType: ringing.callType });
      }
    }, 1500);
    return () => { stopped = true; window.clearInterval(t); };
  }, [incomingCall?.callId, token]);
  // Someone adding us to a call already in progress. Rings and waits for the
  // master token — an invite must not open our microphone on its own.
  const [conferenceInvite, setConferenceInvite] = useState<
    { conferenceId: number; invitedBy: string; participants: string[]; groupId?: number; groupName?: string; callType?: 'voice' | 'video'; kind?: string } | null
  >(null);
  const [confTokenInput, setConfTokenInput] = useState('');
  const [confTokenRejected, setConfTokenRejected] = useState(false);
  const [confJoining, setConfJoining] = useState(false);

  async function joinConferenceCall() {
    const entered = confTokenInput.trim();
    if (!conferenceInvite || !entered) return;
    setConfJoining(true);
    try {
      const accepted = await conferenceAccept(
        token, conferenceInvite.conferenceId, entered,
      );
      stopRinging();
      const kind = accepted.kind || conferenceInvite.kind;
      const callType = accepted.call_type || conferenceInvite.callType;
      if (kind === 'group_call' || conferenceInvite.groupName) {
        // Group call (not a meeting): WhatsApp-style call window.
        openGroupCallWindow({
          conference_id: conferenceInvite.conferenceId,
          group_id: conferenceInvite.groupId ?? 0,
          group_name: conferenceInvite.groupName ?? 'Group',
          call_type: callType ?? 'voice',
        });
        setConferenceInvite(null);
        return;
      }
      // A meeting opens the meeting room. Anything else — a 1:1 that picked
      // up more people — stays a call, in the call window.
      if (kind === 'meeting') {
        setMeetingLobby({
          kind: 'invite',
          conferenceId: conferenceInvite.conferenceId,
          title: conferenceInvite.invitedBy ? `Meeting with ${conferenceInvite.invitedBy}` : null,
          camOn: callType === 'video',
        });
      } else {
        openGroupCallWindow({
          conference_id: conferenceInvite.conferenceId,
          group_id: 0,
          group_name: conferenceInvite.invitedBy || 'Call',
          call_type: callType === 'video' ? 'video' : 'voice',
        });
      }
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
  // Someone tried to sign in on another device and was blocked (one signed-in
  // device per platform) — show who, where and when.
  const [blockedLogin, setBlockedLogin] = useState<
    { deviceName: string | null; platform: string | null; location: string | null; ip: string | null; time: string | null } | null
  >(null);
  const [missedCall, setMissedCall] = useState<{ from: string; callType: CallType } | null>(null);
  const [callTokenInput, setCallTokenInput] = useState('');
  const [callTokenError, setCallTokenError] = useState<string | null>(null);
  const [callTokenLoading, setCallTokenLoading] = useState(false);
  // Token typed for THIS incoming call only. It is never written to the
  // session masterToken, so every call asks again, even from the same person.
  const [callAcceptToken, setCallAcceptToken] = useState<string | null>(null);
  useEffect(() => {
    setCallAcceptToken(null);
    setCallTokenInput('');
    setCallTokenError(null);
  }, [incomingCall?.callId]);

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
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [loadingMeetings, setLoadingMeetings] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleTitle, setScheduleTitle] = useState('');
  const [scheduleWhen, setScheduleWhen] = useState('');
  const [scheduleEndWhen, setScheduleEndWhen] = useState('');
  const [scheduleWaitingRoom, setScheduleWaitingRoom] = useState(false);
  const [scheduleSelected, setScheduleSelected] = useState<Set<string>>(new Set());
  const [scheduling, setScheduling] = useState(false);
  const [scheduleCopilotNote, setScheduleCopilotNote] = useState<string | null>(null);
  const [meetingsError, setMeetingsError] = useState<string | null>(null);

  // ── Badge count — update dock/taskbar icon when unread changes ─────────────────
  useEffect(() => {
    if (isTauri()) invoke('set_badge_count', { count: unread.size }).catch(() => {});
    // Web: the unread count goes in the tab title instead of a dock badge.
    else document.title = unread.size > 0 ? `(${unread.size}) Dilarion` : 'Dilarion';
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

  // Stable ref for chatSettings in WS handler (mute check)
  const chatSettingsRef = useRef(chatSettings);
  chatSettingsRef.current = chatSettings;

  // Stable ref for activeTab so the always-mounted WS handler knows which page
  // the user is on (whether to toast an incoming message).
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const selectedGroupRef = useRef(selectedGroup);
  selectedGroupRef.current = selectedGroup;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const usernameRef = useRef(username);
  usernameRef.current = username;

  // Show a dismissable toast for an incoming message, on any page, and an OS
  // notification when the window isn't focused. Auto-dismisses after 6s.
  const toastSeq = useRef(0);
  function pushMessageToast(sender: string, group?: string) {
    const id = ++toastSeq.current;
    setToasts(prev => [...prev.filter(t => t.sender !== sender || t.group !== group), { id, sender, group }].slice(-4));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000);
    // OS-level notification only when the app isn't in the foreground.
    try {
      if (typeof document !== 'undefined' && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const title = group ? `New message in ${group}` : `New message from ${sender}`;
        const body = group ? `${sender} sent a message` : 'Tap to open the chat';
        new Notification(title, { body });
      }
    } catch { /* notifications unavailable */ }
  }

  // ── Monitoring (silent background) ──────────────────────────────────────────
  useEffect(() => {
    setMonitorToken(token);
    startAppPolicyMonitor(token);
    presenceService.connect(token);
    getMyOrgPrivileges(token).then(setOrgPrivileges).catch(() => {});
    // Ask once for OS-notification permission so background messages can surface
    // even when the window is hidden.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } catch { /* unsupported */ }

    const ping = setInterval(() => {
      setConnected(presenceService.isConnected);
    }, 1000);

    const onMsg = async (msg: WsMessage) => {
      if (msg.type === 'connected' && isTauri()) {
        getPendingDeviceCommands(token).then(commands => {
          commands.forEach(command => {
            handleCommand(command.command_type, command.params ?? {}, command.command_id).catch(() => {});
          });
        }).catch(() => {});
        return;
      }
      if (msg.type === 'auth_expired') {
        // The presence socket gave up after repeated auth rejections — the
        // session is dead. Send the user back to login instead of looping.
        notifySessionInvalid('Your session expired or was replaced by a newer sign-in. Please sign in again.');
        return;
      }
      if (msg.type === 'org_broadcast') {
        const d = msg.data ?? {};
        setOrgBroadcast({ title: d.title as string | undefined, message: String(d.message ?? ''), from: d.from as string | undefined });
        try { playBeep(); } catch {}
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
        const kind = msg.data?.content_type as string | undefined;
        // A recording or notes card landed in my own "You" chat.
        if (sender && sender === username && (kind === 'meeting_recording' || kind === 'meeting_notes')) {
          const viewingSelf = activeTabRef.current === 'chats' && selectedChatRef.current === username;
          if (!viewingSelf) {
            try { playBeep(); } catch {}
            setUnread(prev => new Set(prev).add(username));
            pushMessageToast(username);
          }
          return;
        }
        if (sender && sender !== username) {
          const muted = chatSettingsRef.current.find(s => s.peer_username === sender)?.is_muted;
          if (!muted) playBeep();
          // Clear typing when message arrives
          setTypingUsers(prev => { const n = new Set(prev); n.delete(sender); return n; });
          setUnread(prev => {
            if (sender === selectedChatRef.current) return prev;
            const next = new Set(prev);
            next.add(sender);
            return next;
          });
          // Toast on any page unless the user is actively looking at that chat.
          const viewingThisChat = activeTabRef.current === 'chats' && selectedChatRef.current === sender;
          if (!muted && !viewingThisChat) pushMessageToast(sender);
          // Refresh contact list so new contacts appear
          setContacts(prev => {
            if (prev.some(c => c.username === sender)) return prev;
            return [...prev, { username: sender, is_active: true }];
          });
        }
      } else if (msg.type === 'profile_updated') {
        applyProfileUpdate(msg.data as { username?: string; bio?: string | null; job_title?: string | null });
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
          if (!callsSupported) {
            // Web build: don't ring a call this version can't answer.
            setChatJoinError(`${caller} is calling. Calling is not available on this version - answer on your phone or desktop app.`);
            return;
          }
          startRinging();
          setIncomingCall({ from: caller, callType, callId, offerSdp });
        }
      } else if (msg.type === 'login_attempt_blocked') {
        const d = (msg as any).data || {};
        setBlockedLogin({
          deviceName: d.device_name ?? null, platform: d.platform ?? null,
          location: d.location ?? null, ip: d.ip ?? null, time: d.time ?? null,
        });
        playBeep();
      } else if (msg.type === 'conference_invite') {
        const data = (msg as any).data || {};
        const confId = data.conference_id as number;
        const invitedBy = (data.invited_by as string) || '';
        const participants = (data.existing_participants as string[]) || [];
        const groupName = (data.group_name as string) || undefined;
        const groupId = (data.group_id as number) || undefined;
        const callType = data.call_type === 'voice' || data.call_type === 'video' ? data.call_type as 'voice' | 'video' : undefined;
        const kind = typeof data.kind === 'string' ? data.kind as string : undefined;
        if (confId) {
          if (!callsSupported && groupName) {
            setChatJoinError(`${invitedBy} started a group call in ${groupName}. Calling is not available on this version - join from your phone or desktop app.`);
            return;
          }
          startRinging();
          setConfTokenInput('');
          setConfTokenRejected(false);
          setConferenceInvite({ conferenceId: confId, invitedBy, participants, groupId, groupName, callType, kind });
        }
      } else if (msg.type === 'conference_answered_elsewhere') {
        // Joined the group call on another of this account's devices.
        const confId = (msg as any).data?.conference_id as number | undefined;
        setConferenceInvite(prev => {
          if (prev && (!confId || prev.conferenceId === confId)) {
            stopRinging();
            return null;
          }
          return prev;
        });
      } else if (msg.type === 'call_answered_elsewhere') {
        // Picked up on another of this account's devices - stop ringing here,
        // and don't record it as missed.
        const answeredId = (msg as any).data?.call_id as number | undefined;
        setIncomingCall(prev => {
          if (prev && (!answeredId || prev.callId === answeredId)) {
            stopRinging();
            return null;
          }
          return prev;
        });
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
      } else if (msg.type === 'conference_invite_cancelled' || msg.type === 'conference_ended') {
        const confId = Number((msg as any).data?.conference_id);
        setConferenceInvite(prev => {
          if (prev && (!confId || prev.conferenceId === confId)) {
            stopRinging();
            return null;
          }
          return prev;
        });
      } else if (msg.type === 'conference_upgraded') {
        // The call window itself switches onto the multi-person call. Opening
        // the meeting room here is what turned a call into a meeting.
        stopRinging();
        setIncomingCall(null);
      }
    };

    presenceService.addListener(onMsg);

    return () => {
      clearInterval(ping);
      presenceService.removeListener(onMsg);
      presenceService.disconnect();
      stopAppPolicyMonitor();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, username]);

  // The call window (its own OS window) asks to hand off into a group
  // conference — see CallWindowApp's onUpgradeToGallery.
  useEffect(() => {
    if (!isTauri()) {
      // Web: the in-page call hands off through a window event instead.
        const onUpgrade = (e: Event) => {
        const detail = (e as CustomEvent<{ conferenceId: number; camOn?: boolean; kind?: string }>).detail;
        const confId = detail?.conferenceId;
        if (!confId) return;
        setCallWindowOpen(false);
        setActiveGalleryCall({
          conferenceId: confId,
          initialCamOn: !!detail?.camOn,
          isAdHocCall: (detail?.kind ?? 'call') !== 'meeting',
        });
      };
      window.addEventListener(UPGRADE_TO_GALLERY_EVENT, onUpgrade);
      return () => window.removeEventListener(UPGRADE_TO_GALLERY_EVENT, onUpgrade);
    }
    const unlisten = listen<{ conferenceId: number; camOn?: boolean; kind?: string }>('dilarion://upgrade-to-gallery', (event) => {
      setCallWindowOpen(false);
      setActiveGalleryCall({
        conferenceId: event.payload.conferenceId,
        initialCamOn: !!event.payload.camOn,
        isAdHocCall: (event.payload.kind ?? 'call') !== 'meeting',
      });
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // ── Load contacts (conversations) ────────────────────────────────────────────
  useEffect(() => {
    setLoadingContacts(true);
    getConversations(token)
      .then(users => setContacts(withSelfChat(users, username)))
      // Not silent: an empty list used to look identical to a failed load, and
      // a retired session then hid as "signed in but nothing works".
      .catch(err => console.warn('[dilarion] conversations failed to load:', err))
      .finally(() => setLoadingContacts(false));
  }, [token, username]);

  // ── Load groups ──────────────────────────────────────────────────────────────
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showJoinGroup, setShowJoinGroup] = useState(false);

  const refreshChannels = useCallback(() => {
    return listChannels(token).then(setChannels).catch(() => setChannels([]));
  }, [token]);

  useEffect(() => { refreshChannels(); }, [refreshChannels]);

  const refreshGroups = useCallback(() => {
    return getGroups(token)
      .then(gs => setGroups(gs))
      .catch(err => console.warn('[dilarion] groups failed to load:', err));
  }, [token]);

  useEffect(() => {
    setLoadingGroups(true);
    refreshGroups().finally(() => setLoadingGroups(false));
  }, [refreshGroups]);

  // Self-service groups: membership/name/timer changes made by any group
  // admin arrive as group_updated — reload the list, and drop the open
  // thread if this user was removed or the group was deleted.
  useEffect(() => {
    const onGroupMsg = (msg: WsMessage) => {
      if (msg.type === 'new_group_message') {
        const gid = msg.data?.group_id as number | undefined;
        const sender = msg.data?.sender_username as string | undefined;
        if (!gid || (sender && sender === usernameRef.current)) return;
        const viewingThisGroup = activeTabRef.current === 'groups' && selectedGroupRef.current === gid;
        if (viewingThisGroup) return;
        const gName = groupsRef.current.find(g => g.id === gid)?.name || 'a group';
        try { playBeep(); } catch {}
        pushMessageToast(sender || 'Someone', gName);
        return;
      }
      if (msg.type !== 'group_updated') return;
      const gid = msg.data?.group_id as number | undefined;
      const ev = msg.data?.event as string | undefined;
      if (gid && (ev === 'deleted' || ev === 'removed')) {
        setSelectedGroup(cur => (cur === gid ? null : cur));
        setGroups(prev => prev.filter(g => g.id !== gid));
      }
      refreshGroups();
    };
    presenceService.addListener(onGroupMsg);
    return () => presenceService.removeListener(onGroupMsg);
  }, [refreshGroups]);

  function handleGroupReady(g: Group) {
    setShowCreateGroup(false);
    setShowJoinGroup(false);
    setGroups(prev => (prev.some(x => x.id === g.id) ? prev.map(x => (x.id === g.id ? { ...x, ...g } : x)) : [g, ...prev]));
    setSelectedGroup(g.id);
    setMobilePane('main');
    refreshGroups();
  }

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
    setMobilePane(FULL_PAGE_TABS.includes(tab) || tab === 'meetings' ? 'main' : 'list');
    if (tab !== 'chats') setSelectedChat(null);
    if (tab !== 'groups') setSelectedGroup(null);
    if (tab !== 'channels') setSelectedChannel(null);
    if (tab !== 'calls') setSelectedCallId(null);
    if (tab === 'meetings' && upcomingMeetings.length === 0 && !loadingMeetings) {
      loadUpcomingMeetings();
    }
    setSearch('');
  }

  function openContact(c: string, unlocked = false) {
    if (settingsForContact(c)?.is_locked && !unlocked) {
      setLockPrompt({ kind: 'contact', target: c });
      return;
    }
    setSelectedChat(c);
    setMobilePane('main');
    setUnread(prev => {
      const next = new Set(prev);
      next.delete(c);
      return next;
    });
  }

  function openGroup(id: number, unlocked = false) {
    if (settingsForGroup(id)?.is_locked && !unlocked) {
      setLockPrompt({ kind: 'group', target: id });
      return;
    }
    setSelectedGroup(id);
    setMobilePane('main');
  }

  async function handleLockPromptSubmit() {
    if (!lockPrompt || !lockPromptInput.trim()) return;
    setLockPromptBusy(true);
    setLockPromptError(null);
    try {
      const valid = await confirmMasterToken(token, lockPromptInput.trim());
      if (!valid) {
        setLockPromptError('Invalid master token');
        return;
      }
      if (lockPrompt.kind === 'contact') openContact(lockPrompt.target as string, true);
      else openGroup(lockPrompt.target as number, true);
      setLockPrompt(null);
      setLockPromptInput('');
    } catch {
      setLockPromptError('Failed to verify master token');
    } finally {
      setLockPromptBusy(false);
    }
  }

  async function toggleArchive(target: { peerUsername?: string; groupId?: number }, current?: ChatSettingsItem) {
    try {
      await updateChatSettings(token, target, { isArchived: !current?.is_archived });
      refreshChatSettings();
    } catch {}
  }
  async function toggleMute(target: { peerUsername?: string; groupId?: number }, current?: ChatSettingsItem) {
    try {
      await updateChatSettings(token, target, { isMuted: !current?.is_muted });
      refreshChatSettings();
    } catch {}
  }
  async function toggleLock(target: { peerUsername?: string; groupId?: number }, current?: ChatSettingsItem) {
    try {
      await updateChatSettings(token, target, { isLocked: !current?.is_locked });
      refreshChatSettings();
    } catch {}
  }
  async function deleteChat(target: { peerUsername?: string; groupId?: number }) {
    try {
      await deleteChatForMe(token, target);
      if (target.peerUsername && selectedChat === target.peerUsername) setSelectedChat(null);
      if (target.groupId && selectedGroup === target.groupId) setSelectedGroup(null);
      refreshChatSettings();
    } catch {}
  }

  function openGroupCallWindow(info: GroupCallInfo) {
    if (!callsSupported) { setChatJoinError(CALLS_UNAVAILABLE); return; }
    setCallWindowOpen(true);
    openCallWindow(
      {
        token, my_username: username, partner: info.group_name,
        call_type: info.call_type === 'video' ? 'video' : 'audio', is_incoming: false,
        group_call: info,
      },
      () => setCallWindowOpen(false),
    ).catch(() => setCallWindowOpen(false));
  }

  // WhatsApp-style group call (separate from meetings): rings every other
  // member and opens the dedicated call window — not the meeting gallery.
  async function handleStartGroupCall(group: Group, callType: 'voice' | 'video') {
    // Checked before the API call - starting one rings every member.
    if (!callsSupported) { setChatJoinError(CALLS_UNAVAILABLE); return; }
    if (activeGalleryCall || callWindowOpen) {
      setChatJoinError('You are already on a call');
      return;
    }
    setChatJoinError(null);
    try {
      const { conference_id, not_rung } = await startGroupCall(token, group.id, callType);
      openGroupCallWindow({ conference_id, group_id: group.id, group_name: group.name, call_type: callType });
      if (not_rung > 0) setChatJoinError(`Call is full — ${not_rung} member${not_rung === 1 ? '' : 's'} couldn't be rung`);
    } catch (err: any) {
      setChatJoinError(userMessage(err, "Couldn't start the group call. Check your connection and retry."));
    }
  }

  async function handleGroupRedial(call: CallRecord) {
    if (!callsSupported) { setChatJoinError(CALLS_UNAVAILABLE); return; }
    if (!call.conference_id) return;
    try {
      const res = await redialGroupCall(token, call.conference_id);
      const names = (res.participants || []).filter(n => n && n !== username).join(', ') || call.other_party_username;
      openGroupCallWindow({
        conference_id: res.conference_id,
        group_id: 0,
        group_name: names,
        call_type: res.call_type === 'video' ? 'video' : 'voice',
      });
    } catch (err: any) {
      setChatJoinError(userMessage(err, "Couldn't call them back. Check your connection and retry."));
    }
  }

  function handleCall(partner: string, callType: CallType) {
    if (!callsSupported) { setChatJoinError(CALLS_UNAVAILABLE); return; }
    setCallWindowOpen(true);
    openCallWindow(
      { token, my_username: username, partner, call_type: callType, is_incoming: false },
      () => setCallWindowOpen(false),
    ).catch(() => setCallWindowOpen(false));
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
      setChatJoinError(userMessage(err, "Couldn't start the group video call. Check your connection and retry."));
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
      setMeetingsError(userMessage(err, "Couldn't load your meetings. Check your connection and try again."));
    } finally {
      setLoadingMeetings(false);
    }
  }

  async function openMeetings() {
    setShowMeetings(true);
    await loadUpcomingMeetings();
  }

  /** Opens the Scheduled Meetings dialog straight on its "schedule" form. */
  async function openScheduleForm() {
    setShowMeetings(true);
    setShowScheduleForm(true);
    if (allUsers.length === 0) {
      setLoadingUsers(true);
      try {
        const users = await getUsers(token);
        setAllUsers(users.filter(u => u.username !== username));
      } catch {}
      finally { setLoadingUsers(false); }
    }
  }

  /** Accepts a bare code or a pasted invite link and opens the join lobby. */
  function joinWithCode() {
    const raw = joinCodeInput.trim();
    if (!raw) return;
    const code = (raw.match(/([A-Za-z0-9-]{4,})\/?$/)?.[1] ?? raw);
    if (callWindowOpen || activeGalleryCall) { setChatJoinError('You are already on a call'); return; }
    setMeetingLobby({ kind: 'join', joinCode: code, title: null });
    setJoinCodeInput('');
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
      setScheduleCopilotNote(null);
      const list = await getUpcomingMeetings(token);
      setUpcomingMeetings(list);
    } catch (err: any) {
      setMeetingsError(userMessage(err, "Couldn't schedule the meeting. Please try again."));
    } finally {
      setScheduling(false);
    }
  }

  /**
   * Turns free text into a prefilled schedule form — never creates the
   * meeting itself. The user still sees every field (including a
   * low-confidence warning when the model wasn't sure) and still has to
   * pick attendees and hit Schedule, same as manual entry.
   */
  /**
   * Hand-off from the AI page's meeting drafts — prefills the same schedule
   * form manual entry uses and opens it, but never creates the meeting or
   * picks attendees itself; the user still reviews and confirms.
   */
  async function applyCopilotDraft(draft: CopilotScheduleDraft) {
    setScheduleTitle(draft.title);
    setScheduleWhen(draft.scheduleWhen);
    setScheduleEndWhen(draft.scheduleEndWhen);
    setScheduleCopilotNote(draft.note);
    setShowMeetings(true);
    setShowScheduleForm(true);

    let users = allUsers;
    if (users.length === 0) {
      setLoadingUsers(true);
      try {
        const fetched = await getUsers(token);
        users = fetched.filter(u => u.username !== username);
        setAllUsers(users);
      } catch {}
      finally { setLoadingUsers(false); }
    }

    // Pre-select any real username mentioned in the request text ("with
    // dr.bright") so the user only has to confirm, not re-search for them —
    // matched client-side against actual usernames, never invented by the
    // model itself (it's explicitly told never to extract attendee names).
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedText = normalize(draft.rawText);
    const mentioned = users.filter(u => normalizedText.includes(normalize(u.username)));
    if (mentioned.length > 0) {
      setScheduleSelected(new Set(mentioned.map(u => u.username)));
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
      setChatJoinError(userMessage(err, "Couldn't join the meeting. Check your connection and retry."));
      setMeetingLobby(null);
    }
  }

  async function cancelScheduledMeeting(meetingId: number) {
    try {
      await cancelMeeting(token, meetingId);
      setUpcomingMeetings(prev => prev.filter(m => m.id !== meetingId));
    } catch (err: any) {
      setMeetingsError(userMessage(err, "Couldn't cancel the meeting. Please try again."));
    }
  }

  // Join tapped from a meeting card inside a chat/group thread. Instant
  // meetings still need the master-token accept gate (opening a mic without
  // consent is not okay) — reuse the same conferenceInvite overlay that
  // handles that. Scheduled meetings join directly, matching joinScheduledMeeting.
  function handleJoinMeetingFromChat(m: Parameters<JoinMeetingHandler>[0]) {
    setChatJoinError(null);
    if (m.kind === 'instant') {
      setConferenceInvite({ conferenceId: m.conferenceId, invitedBy: m.invitedBy, participants: [] });
      return;
    }
    if (m.kind === 'group_call' && !callsSupported) {
      setChatJoinError(CALLS_UNAVAILABLE);
      return;
    }
    if (m.kind === 'group_call') {
      if (callWindowOpen || activeGalleryCall) { setChatJoinError('You are already on a call'); return; }
      setConferenceInvite({
        conferenceId: m.conferenceId, invitedBy: m.invitedBy, participants: [],
        groupId: m.groupId, groupName: m.groupName, callType: m.callType,
      });
      return;
    }
    setMeetingLobby({ kind: 'join', joinCode: m.joinCode, title: null });
  }

  const filteredContacts = contacts
    .filter(c => c.username.toLowerCase().includes(search.toLowerCase()) || (c.is_self && 'you'.includes(search.toLowerCase().trim())))
    .filter(c => showArchived ? true : !settingsForContact(c.username)?.is_archived);

  const filteredGroups = groups
    .filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
    .filter(g => showArchived ? true : !settingsForGroup(g.id)?.is_archived);

  const archivedContactCount = contacts.filter(c => settingsForContact(c.username)?.is_archived).length;
  const archivedGroupCount = groups.filter(g => settingsForGroup(g.id)?.is_archived).length;

  // ── List Panel content ───────────────────────────────────────────────────────

  function renderListHeader() {
    return (
      <div style={hs.listHeader}>
        <button style={hs.workspacePill} onClick={() => switchTab('settings')} title="Workspace settings">
          <span style={hs.listHeaderTitle}>Dilarion</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            title={connected ? 'Connected' : 'Reconnecting…'}
            style={{ width: 8, height: 8, borderRadius: '50%', margin: '0 6px', background: connected ? '#22c55e' : '#f59e0b' }}
          />
          <button style={hs.headerIconBtn} onClick={() => setShowSearch(true)} title="Search">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
          </button>
          <button style={hs.headerIconBtn} onClick={() => { switchTab('chats'); openNewChat(); }} title="New message">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
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
          {archivedContactCount > 0 && (
            <button
              onClick={() => setShowArchived(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent',
                border: 'none', borderBottom: '1px solid var(--border-color)', cursor: 'pointer',
                padding: '10px 14px', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600,
              }}
            >
              {showArchived ? 'Hide archived' : `Archived (${archivedContactCount})`}
            </button>
          )}
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
                const cs = settingsForContact(c.username);
                return (
                  <div
                    key={c.username}
                    style={{
                      ...hs.listItem,
                      cursor: 'pointer',
                      background: isActive ? 'var(--item-active-bg)' : 'transparent',
                      opacity: cs?.is_archived ? 0.6 : 1,
                    }}
                    onClick={() => openContact(c.username)}
                  >
                    {c.is_self ? (
                      <div style={{ ...hs.contactAvatar, background: 'var(--accent, #c0392b)', color: '#fff', flexShrink: 0 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                      </div>
                    ) : (
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={hs.contactAvatar}>{initials(c.username)}</div>
                      <div style={{
                        position: 'absolute', bottom: -1, right: -1,
                        width: 9, height: 9, borderRadius: '50%',
                        background: c.is_active ? '#22c55e' : 'transparent',
                        border: c.is_active ? '2px solid var(--bg-panel)' : '1.5px solid var(--text-muted)',
                      }} />
                    </div>
                    )}
                    <div style={hs.itemInfo}>
                      <span style={{ ...hs.itemName, fontWeight: hasUnread ? 650 : 500, color: hasUnread || isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {c.is_self ? 'You' : c.username}
                        {cs?.is_locked && <LockBadge />}
                      </span>
                      {c.is_self && !isTyping && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Notes & meeting recordings</span>
                      )}
                      {isTyping && (
                        <span style={{ fontSize: '0.72rem', color: '#16a34a', fontStyle: 'italic' }}>typing…</span>
                      )}
                    </div>
                    {cs?.is_muted && <MuteBadge />}
                    {hasUnread && !isTyping && <div style={hs.unreadBadge}>1</div>}
                    <ChatItemMenu
                      isArchived={!!cs?.is_archived}
                      isMuted={!!cs?.is_muted}
                      isLocked={!!cs?.is_locked}
                      onToggleArchive={() => toggleArchive({ peerUsername: c.username }, cs)}
                      onToggleMute={() => toggleMute({ peerUsername: c.username }, cs)}
                      onToggleLock={() => toggleLock({ peerUsername: c.username }, cs)}
                      onDelete={() => deleteChat({ peerUsername: c.username })}
                    />
                  </div>
                );
              })
            )}
          </div>
        </>
      );
    }

    if (activeTab === 'channels') {
      return (
        <>
          {channels.map(c => {
            const unreadN = c.unread_count || 0;
            const active = selectedChannel === c.id;
            return (
              <button
                key={c.id}
                onClick={() => { setSelectedChannel(c.id); setMobilePane('main'); }}
                title={c.topic || `${c.member_count} members`}
                style={{ ...hs.sideRow, background: active ? 'var(--item-active-bg)' : 'transparent', opacity: c.is_archived ? 0.55 : 1 }}
              >
                <span style={hs.sideRowIcon}>{c.visibility === 'private' ? <LockGlyph /> : '#'}</span>
                <span style={{ ...hs.sideRowLabel, fontWeight: unreadN > 0 || active ? 600 : 500, color: unreadN > 0 || active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{c.name}</span>
                {unreadN > 0 && <span style={hs.tabBtnBadge}>{unreadN > 99 ? '99+' : unreadN}</span>}
              </button>
            );
          })}
          <button style={{ ...hs.sideRow, color: 'var(--text-muted)' }} onClick={() => setShowChannelBrowse(true)}>
            <span style={hs.sideRowIcon}>+</span>
            <span style={hs.sideRowLabel}>Browse channels</span>
          </button>
          {channels.length === 0 && <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: '0.8rem' }}>No channels yet.</div>}
          {showChannelBrowse && <ChannelBrowse token={token} onClose={() => setShowChannelBrowse(false)} onJoined={() => { setShowChannelBrowse(false); refreshChannels(); }} />}
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
          <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-color)' }}>
            <button
              onClick={() => setShowCreateGroup(true)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 10px',
                fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              New group
            </button>
            <button
              onClick={() => setShowJoinGroup(true)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8,
                padding: '8px 10px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Join via link
            </button>
          </div>
          {archivedGroupCount > 0 && (
            <button
              onClick={() => setShowArchived(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'transparent',
                border: 'none', borderBottom: '1px solid var(--border-color)', cursor: 'pointer',
                padding: '10px 14px', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600,
              }}
            >
              {showArchived ? 'Hide archived' : `Archived (${archivedGroupCount})`}
            </button>
          )}
          <div style={hs.listItems}>
            {loadingGroups ? (
              <ContactSkeleton />
            ) : filteredGroups.length === 0 ? (
              <div style={hs.emptyList}>No groups found</div>
            ) : (
              filteredGroups.map(g => {
                const isActive = selectedGroup === g.id;
                const cs = settingsForGroup(g.id);
                return (
                  <div
                    key={g.id}
                    style={{
                      ...hs.listItem,
                      cursor: 'pointer',
                      background: isActive ? 'var(--item-active-bg)' : 'transparent',
                      borderLeft: `3px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                      opacity: cs?.is_archived ? 0.6 : 1,
                    }}
                    onClick={() => openGroup(g.id)}
                  >
                    <div style={{ ...hs.groupAvatar, background: groupColor(g.id) }}>
                      {initials(g.name)}
                    </div>
                    <div style={hs.itemInfo}>
                      <span style={hs.itemName}>
                        {g.name}
                        {cs?.is_locked && <LockBadge />}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                        {g.member_count} members
                      </span>
                    </div>
                    {cs?.is_muted && <MuteBadge />}
                    <ChatItemMenu
                      isArchived={!!cs?.is_archived}
                      isMuted={!!cs?.is_muted}
                      isLocked={!!cs?.is_locked}
                      onToggleArchive={() => toggleArchive({ groupId: g.id }, cs)}
                      onToggleMute={() => toggleMute({ groupId: g.id }, cs)}
                      onToggleLock={() => toggleLock({ groupId: g.id }, cs)}
                      onDelete={() => deleteChat({ groupId: g.id })}
                    />
                  </div>
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
          onSelectCall={id => { setSelectedCallId(id); setMobilePane('main'); }}
        />
      );
    }

    if (activeTab === 'settings') {
      return <SettingsListPanel selected={settingsPage} onSelect={page => { setSettingsPage(page); setMobilePane('main'); }} />;
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
            onBack={() => { setSelectedChat(null); setMobilePane('list'); }}
            isMuted={!!settingsForContact(selectedChat)?.is_muted}
            isArchived={!!settingsForContact(selectedChat)?.is_archived}
            isLocked={!!settingsForContact(selectedChat)?.is_locked}
            onToggleMute={() => toggleMute({ peerUsername: selectedChat }, settingsForContact(selectedChat))}
            onToggleArchive={() => toggleArchive({ peerUsername: selectedChat }, settingsForContact(selectedChat))}
            onToggleLock={() => toggleLock({ peerUsername: selectedChat }, settingsForContact(selectedChat))}
            onDeleteChat={() => deleteChat({ peerUsername: selectedChat })}
          />
        );
      }
      return (
        <WelcomePlaceholder
          title="Dilarion"
          subtitle={appVersion ? `Version ${appVersion}` : 'Dilarion'}
          footer={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Your personal messages are <span style={{ color: '#25d366', fontWeight: 700 }}>end-to-end encrypted</span>
            </span>
          }
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </WelcomePlaceholder>
      );
    }

    if (activeTab === 'channels') {
      const channel = channels.find(c => c.id === selectedChannel);
      if (channel) {
        const asGroup: Group = {
          id: channel.id,
          name: channel.name,
          description: channel.description,
          member_count: channel.member_count,
          my_role: channel.my_role,
          kind: 'channel',
          topic: channel.topic,
          visibility: channel.visibility,
          posting_policy: channel.posting_policy,
          is_archived: channel.is_archived,
          unread_count: channel.unread_count,
        };
        return (
          <GroupPanel
            token={token}
            myUsername={username}
            group={asGroup}
            masterToken={null}
            onMasterTokenSaved={() => {}}
            onJoinMeeting={handleJoinMeetingFromChat}
            onBack={() => { setSelectedChannel(null); setMobilePane('list'); }}
            onGroupChanged={g => setChannels(prev => prev.map(c => c.id === g.id ? { ...c, name: g.name, topic: g.topic, description: g.description, is_archived: !!g.is_archived, my_role: g.my_role, member_count: g.member_count, visibility: g.visibility || c.visibility, posting_policy: g.posting_policy || c.posting_policy } : c))}
            onGroupGone={() => { setSelectedChannel(null); refreshChannels(); }}
            onStartGroupCall={handleStartGroupCall}
          />
        );
      }
      return <WelcomePlaceholder title="Channels" subtitle="Select a channel or browse public ones" />;
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
              onBack={() => { setSelectedGroup(null); setMobilePane('list'); }}
              onGroupChanged={g => setGroups(prev => prev.map(x => (x.id === g.id ? { ...x, ...g } : x)))}
              onGroupGone={() => {
                setGroups(prev => prev.filter(x => x.id !== group.id));
                setSelectedGroup(null);
                refreshGroups();
              }}
              onStartGroupCall={handleStartGroupCall}
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
      const now = Date.now();
      const sorted = upcomingMeetings
        .filter(m => new Date(m.scheduled_at).getTime() + m.duration_minutes * 60000 > now)
        .sort((x, y) => new Date(x.scheduled_at).getTime() - new Date(y.scheduled_at).getTime());
      const isLive = (m: MeetingSummary) => new Date(m.scheduled_at).getTime() <= now && now < new Date(m.scheduled_at).getTime() + m.duration_minutes * 60000;
      const dayKey = (iso: string) => {
        const d = new Date(iso); const t = new Date();
        const tm = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
        const dm = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        if (dm === tm) return 'Today';
        if (dm === tm + 86400000) return 'Tomorrow';
        return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      };
      const groupsByDay: Array<[string, MeetingSummary[]]> = [];
      for (const m of sorted) {
        const k = dayKey(m.scheduled_at);
        const last = groupsByDay[groupsByDay.length - 1];
        if (last && last[0] === k) last[1].push(m); else groupsByDay.push([k, [m]]);
      }
      const card: React.CSSProperties = {
        flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left',
        background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 18, padding: 18,
        cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text-primary)',
      };
      const tile = (bg: string, fg: string, icon: React.ReactNode) => (
        <div style={{ width: 42, height: 42, borderRadius: 13, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
      );
      return (
        <div style={{ flex: 1, height: '100%', overflowY: 'auto', background: 'var(--bg-base)' }}>
          <div className="meetings-page" style={{ maxWidth: 920, margin: '0 auto', padding: '28px 28px 40px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 22 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>Meetings</h1>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </div>
              </div>
              <button onClick={() => switchTab('calendar')} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '8px 14px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit' }}>
                Open calendar
              </button>
            </div>

            {/* Quick actions */}
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 30 }}>
              <button className="meeting-action" onClick={openNewMeeting} style={{ ...card, background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff', boxShadow: '0 10px 24px rgba(216,52,40,0.25)' }}>
                {tile('rgba(255,255,255,0.18)', '#fff', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>)}
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.98rem' }}>New meeting</div>
                  <div style={{ fontSize: '0.78rem', opacity: 0.85, marginTop: 2 }}>Start an instant video call</div>
                </div>
              </button>
              <button className="meeting-action" onClick={openScheduleForm} style={card}>
                {tile('rgba(216,52,40,0.10)', 'var(--accent)', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="3" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="12" y1="14" x2="12" y2="18" /><line x1="10" y1="16" x2="14" y2="16" /></svg>)}
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.98rem' }}>Schedule</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Plan a meeting and invite people</div>
                </div>
              </button>
              <div style={{ ...card, cursor: 'default' }}>
                {tile('rgba(216,52,40,0.10)', 'var(--accent)', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>)}
                <div style={{ fontWeight: 800, fontSize: '0.98rem' }}>Join with a code</div>
                <form onSubmit={e => { e.preventDefault(); joinWithCode(); }} style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={joinCodeInput}
                    onChange={e => setJoinCodeInput(e.target.value)}
                    placeholder="Code or link"
                    style={{ flex: 1, minWidth: 0, background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '8px 12px', fontSize: '0.8rem', color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit' }}
                  />
                  <button type="submit" disabled={!joinCodeInput.trim()} style={{ background: joinCodeInput.trim() ? 'var(--accent)' : 'var(--bg-base)', color: joinCodeInput.trim() ? '#fff' : 'var(--text-muted)', border: '1px solid ' + (joinCodeInput.trim() ? 'var(--accent)' : 'var(--border-color)'), borderRadius: 999, padding: '0 14px', fontSize: '0.78rem', fontWeight: 700, cursor: joinCodeInput.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>Join</button>
                </form>
              </div>
            </div>

            {/* Upcoming */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>Upcoming</h2>
              {sorted.length > 0 && <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{sorted.length} scheduled</span>}
            </div>
            {loadingMeetings && sorted.length === 0 ? (
              <ContactSkeleton />
            ) : sorted.length === 0 ? (
              <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 18, padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8 }}>
                <img src={meetingsArt} alt="" draggable={false} style={{ width: 200, maxWidth: '60%', height: 'auto', userSelect: 'none', marginBottom: 6 }} />
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>No upcoming meetings</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Schedule one and it will show up here and in your calendar.</div>
              </div>
            ) : (
              groupsByDay.map(([label, list]) => (
                <div key={label} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 4px 8px' }}>{label}</div>
                  <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 18, overflow: 'hidden' }}>
                    {list.map((m, i) => {
                      const live = isLive(m);
                      return (
                        <div key={m.id} className="meeting-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--border-color)' }}>
                          <div style={{ width: 64, flexShrink: 0 }}>
                            <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                              {new Date(m.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.duration_minutes} min</div>
                          </div>
                          <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: live ? '#16a34a' : 'var(--accent)', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title || 'Untitled meeting'}</span>
                              {live && <span style={{ fontSize: '0.64rem', fontWeight: 800, color: '#16a34a', background: 'rgba(22,163,74,0.12)', borderRadius: 999, padding: '2px 8px', flexShrink: 0 }}>LIVE</span>}
                            </div>
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              {fmtRange(m.scheduled_at, m.duration_minutes)} · hosted by {m.creator_username === username ? 'you' : m.creator_username}
                            </div>
                          </div>
                          <button
                            className="meeting-code-chip"
                            onClick={() => { navigator.clipboard?.writeText(m.join_code).catch(() => {}); }}
                            title="Copy join code"
                            style={{ background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '6px 12px', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}
                          >{m.join_code}</button>
                          <button
                            onClick={() => joinScheduledMeeting(m)}
                            style={{ background: live ? '#16a34a' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 18px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit' }}
                          >Join</button>
                          {m.creator_username === username && (
                            <button
                              onClick={() => cancelScheduledMeeting(m.id)}
                              title="Cancel meeting"
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0, display: 'flex', padding: 4 }}
                            ><CloseIcon size={15} color="var(--text-muted)" /></button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
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

    if (activeTab === 'tasks') {
      return <TasksPanel token={token} myUsername={username} groups={groups} />;
    }

    if (activeTab === 'reminders') {
      return <RemindersPanel token={token} />;
    }

    if (activeTab === 'whiteboard') {
      return <WhiteboardPage token={token} groups={groups} />;
    }

    if (activeTab === 'ai') {
      return <AiPage token={token} username={username} onMeetingDraft={draft => { switchTab('meetings'); applyCopilotDraft(draft); }} />;
    }

    if (activeTab === 'calls') {
      const selectedCall = calls.find(c => c.id === selectedCallId) ?? null;
      return <CallDetailPanel call={selectedCall} onCall={handleCall} onGroupCall={handleGroupRedial} />;
    }

    if (activeTab === 'settings') {
      return (
        <SettingsMainPanel
          token={token}
          username={username}
          onLogout={onLogout}
          page={settingsPage}
        />
      );
    }

    return null;
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={`app-shell mobile-pane-${mobilePane} tab-${activeTab}`} style={hs.root}>

      {/* Global incoming-message toasts — visible on every page */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 3200, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
          {toasts.map(t => (
            <div
              key={t.id}
              onClick={() => {
                setToasts(prev => prev.filter(x => x.id !== t.id));
                if (t.group) { switchTab('groups'); }
                else { switchTab('chats'); openContact(t.sender); }
              }}
              style={{
                background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderLeft: '3px solid var(--accent)',
                borderRadius: 10, padding: '10px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.28)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.group ? `${t.sender} · ${t.group}` : t.sender === username ? 'You' : t.sender}
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {t.group ? 'New group message — tap to open' : t.sender === username ? 'New meeting recording or notes — tap to open' : 'New message — tap to open'}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); setToasts(prev => prev.filter(x => x.id !== t.id)); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1 }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Official organization broadcast banner */}
      {orgBroadcast && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 3000,
          background: 'linear-gradient(90deg,var(--accent-dark,#b82a20),var(--accent,#d83428))', color: '#fff',
          padding: '10px 18px', display: 'flex', alignItems: 'flex-start', gap: 12,
          boxShadow: '0 4px 18px rgba(0,0,0,0.3)',
        }}>
          <div style={{ fontSize: '1.1rem', lineHeight: 1 }}>📢</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
              {orgBroadcast.title || 'Official announcement'}
              {orgBroadcast.from ? <span style={{ opacity: 0.8, fontWeight: 400 }}> · {orgBroadcast.from}</span> : null}
            </div>
            <div style={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap', opacity: 0.95 }}>{orgBroadcast.message}</div>
          </div>
          <button
            onClick={() => setOrgBroadcast(null)}
            style={{ background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff', borderRadius: 6, padding: '3px 9px', cursor: 'pointer', fontSize: '0.8rem' }}
          >Dismiss</button>
        </div>
      )}

      {/* Org broadcast composer — only shown to accounts with the broadcast privilege */}
      {showSearch && (
        <SearchModal
          token={token}
          onClose={() => setShowSearch(false)}
          onPickPerson={(u) => { setShowSearch(false); openContact(u); }}
          onPickGroup={(id) => { setShowSearch(false); if (channels.some(c => c.id === id)) { setSelectedChannel(id); switchTab('channels'); setSelectedChannel(id); } else openGroup(id); }}
        />
      )}

      {showBroadcastCompose && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowBroadcastCompose(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 3100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div style={{ width: 'min(520px,100%)', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 22, color: 'var(--text-primary)', boxShadow: '0 20px 50px rgba(0,0,0,0.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--accent-soft, rgba(216,52,40,0.1))', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>Official broadcast</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Goes to everyone in your organization on Dilarion</div>
              </div>
            </div>
            <input
              value={broadcastForm.title}
              onChange={(e) => setBroadcastForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Title (optional)"
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input, var(--bg-card))', border: '1px solid var(--border-color)', borderRadius: 10, color: 'var(--text-primary)', outline: 'none', padding: '10px 12px', fontSize: '0.88rem', marginBottom: 10, fontFamily: 'inherit' }}
            />
            <textarea
              value={broadcastForm.message}
              onChange={(e) => setBroadcastForm(f => ({ ...f, message: e.target.value }))}
              placeholder="Write your official announcement…"
              rows={5}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input, var(--bg-card))', border: '1px solid var(--border-color)', borderRadius: 10, color: 'var(--text-primary)', outline: 'none', padding: '10px 12px', fontSize: '0.88rem', resize: 'vertical', fontFamily: 'inherit' }}
            />
            {broadcastState.error && <div style={{ color: 'var(--accent)', fontSize: '0.8rem', marginTop: 8 }}>{broadcastState.error}</div>}
            {broadcastState.notice && <div style={{ color: '#16a34a', fontSize: '0.8rem', marginTop: 8 }}>{broadcastState.notice}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button onClick={() => setShowBroadcastCompose(false)} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 999, padding: '9px 18px', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 500, fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={submitBroadcast} disabled={broadcastState.sending || !broadcastForm.message.trim()} style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 999, padding: '9px 20px', cursor: 'pointer', fontSize: '0.84rem', fontWeight: 600, fontFamily: 'inherit', opacity: broadcastState.sending || !broadcastForm.message.trim() ? 0.6 : 1 }}>{broadcastState.sending ? 'Sending…' : 'Send broadcast'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── RAIL: brand frame column, app-level actions only ────────────── */}
      <nav className="app-tab-bar" aria-label="App" style={hs.rail}>
        <div className="rail-hide-mobile" style={hs.railLogo} title="Dilarion">
          <img src="/logo.jpg" alt="Dilarion" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        </div>
        <button className={`rail-btn${activeTab !== 'settings' && mobilePane === 'list' ? ' rail-btn-active' : ''}`} style={{ ...hs.railBtn, ...(activeTab !== 'settings' ? hs.railBtnActive : {}) }} title="Home" onClick={() => { switchTab('chats'); setMobilePane('list'); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>
        </button>
        <button className="rail-btn" style={hs.railBtn} title="Search people, channels and files" onClick={() => setShowSearch(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
        </button>
        <button className="rail-btn rail-btn-add" style={{ ...hs.railBtn, ...hs.railBtnAdd }} title="New chat" onClick={() => { switchTab('chats'); openNewChat(); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        {canBroadcast && (
          <button
            className="rail-btn"
            style={hs.railBtn}
            title="Send an official broadcast to all staff"
            onClick={() => { setBroadcastState({ sending: false, error: '', notice: '' }); setShowBroadcastCompose(true); }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 14-6v14L3 13z"/><path d="M3 11v2a2 2 0 0 0 2 2h1"/><path d="M11 18.5 9 19a2 2 0 0 1-2-2v-2"/></svg>
          </button>
        )}
        <div className="rail-hide-mobile" style={{ flex: 1 }} />
        <button className={`rail-btn${activeTab === 'settings' ? ' rail-btn-active' : ''}`} style={{ ...hs.railBtn, ...(activeTab === 'settings' ? hs.railBtnActive : {}) }} title="Settings" onClick={() => switchTab('settings')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
        <button
          className="rail-btn rail-hide-mobile"
          style={hs.railBtn}
          title="Log out"
          onClick={() => { if (window.confirm('Log out of Dilarion on this device?')) onLogout(); }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
        <button className="rail-hide-mobile" style={hs.railAvatarBtn} title={username} onClick={() => switchTab('settings')}>
          <span style={hs.railAvatar}>{initials(username)}</span>
          <span style={{ ...hs.railPresence, background: connected ? '#22c55e' : '#f59e0b' }} />
        </button>
      </nav>

      {/* ── CONTENT CARD: sidebar + main, white rounded sheet ───────────── */}
      <div className="app-card" style={hs.card}>
        <aside className="app-list-panel" style={{ ...hs.listPanel, width: layout.list }}>
          {renderListHeader()}
          <div style={hs.sidebarScroll}>
            <div className="app-nav-group" style={hs.navGroup}>
              <NavRow icon={<ChatTabIcon active={activeTab === 'chats'} />} label="Direct messages" active={activeTab === 'chats'} badge={unread.size} onClick={() => switchTab('chats')} />
              <NavRow icon={<GroupTabIcon active={activeTab === 'groups'} />} label="Groups" active={activeTab === 'groups'} onClick={() => switchTab('groups')} />
              <NavRow icon={<HashIcon active={activeTab === 'channels'} />} label="Channels" active={activeTab === 'channels'} badge={channels.reduce((n, c) => n + (c.unread_count || 0), 0)} onClick={() => switchTab('channels')} />
              <NavRow icon={<MeetingsTabIcon active={activeTab === 'meetings'} />} label="Meetings" active={activeTab === 'meetings'} onClick={() => switchTab('meetings')} />
              <NavRow icon={<CalendarTabIcon active={activeTab === 'calendar'} />} label="Calendar" active={activeTab === 'calendar'} onClick={() => switchTab('calendar')} />
              <NavRow icon={<TasksTabIcon active={activeTab === 'tasks'} />} label="Tasks" active={activeTab === 'tasks'} onClick={() => switchTab('tasks')} />
              <NavRow icon={<ReminderTabIcon active={activeTab === 'reminders'} />} label="Reminders" active={activeTab === 'reminders'} onClick={() => switchTab('reminders')} />
              <NavRow icon={<WhiteboardTabIcon active={activeTab === 'whiteboard'} />} label="Whiteboard" active={activeTab === 'whiteboard'} onClick={() => switchTab('whiteboard')} />
              <NavRow icon={<AiTabIcon active={activeTab === 'ai'} />} label="Dilarion AI" active={activeTab === 'ai'} onClick={() => switchTab('ai')} />
              <NavRow icon={<CallTabIcon active={activeTab === 'calls'} />} label="Calls" active={activeTab === 'calls'} onClick={() => switchTab('calls')} />
              <div className="mobile-settings-tab">
                <NavRow icon={<SettingsTabIcon active={activeTab === 'settings'} />} label="Settings" active={activeTab === 'settings'} onClick={() => switchTab('settings')} />
              </div>
            </div>
            {activeTab === 'chats' && channels.length > 0 && (
              <SidebarSection title="Channels" open={sectionsOpen.channels} onToggle={() => setSectionsOpen(o => ({ ...o, channels: !o.channels }))}>
                {channels.filter(c => !c.is_archived).map(c => (
                  <button
                    key={c.id}
                    style={hs.sideRow}
                    onClick={() => { setSelectedChannel(c.id); switchTab('channels'); setSelectedChannel(c.id); setMobilePane('main'); }}
                  >
                    <span style={hs.sideRowIcon}>{c.visibility === 'private' ? <LockGlyph /> : '#'}</span>
                    <span style={{ ...hs.sideRowLabel, fontWeight: (c.unread_count || 0) > 0 ? 650 : 500, color: (c.unread_count || 0) > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{c.name}</span>
                    {(c.unread_count || 0) > 0 && <span style={hs.tabBtnBadge}>{c.unread_count! > 99 ? '99+' : c.unread_count}</span>}
                  </button>
                ))}
                <button style={{ ...hs.sideRow, color: 'var(--text-muted)' }} onClick={() => { switchTab('channels'); setShowChannelBrowse(true); }}>
                  <span style={hs.sideRowIcon}>+</span>
                  <span style={hs.sideRowLabel}>Add channels</span>
                </button>
              </SidebarSection>
            )}
            {activeTab !== 'settings' && !FULL_PAGE_TABS.includes(activeTab) && (
              <SidebarSection title={SECTION_TITLES[activeTab]} open={sectionsOpen.list} onToggle={() => setSectionsOpen(o => ({ ...o, list: !o.list }))}>
                {renderListContent()}
              </SidebarSection>
            )}
            {activeTab === 'settings' && renderListContent()}
          </div>
        </aside>

        <ColumnResizer width={layout.list} range={LIST_WIDTH} onChange={list => setLayout(l => ({ ...l, list }))} />

        {/* ── MAIN PANEL (flex 1) ─────────────────────────────────────────── */}
        <main className="app-main-panel" style={hs.mainPanel}>
          {(['calls', 'settings', 'meetings', ...FULL_PAGE_TABS] as Tab[]).includes(activeTab) && mobilePane === 'main' && (
            <button className="mobile-pane-back" onClick={() => { if (activeTab === 'calls' || activeTab === 'settings') setMobilePane('list'); else switchTab('chats'); }}>
              <span aria-hidden="true">‹</span> {activeTab === 'calls' || activeTab === 'settings' ? (activeTab === 'calls' ? 'Calls' : 'Settings') : 'Home'}
            </button>
          )}
          {renderMainContent()}
        </main>
      </div>

      {chatJoinError && (
        <div
          className="app-toast"
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
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex' }}
          ><CloseIcon size={14} color="#fff" /></button>
        </div>
      )}

      {/* ── MEETING LOBBY (device setup before joining) ─────────────────────── */}
      {meetingLobby && (
        <MeetingLobby
          title={meetingLobby.kind === 'instant' ? 'Start Meeting' : (meetingLobby.title || 'Join Meeting')}
          subtitle="Check your camera, microphone and speaker before joining"
          defaultName={username}
          onCancel={() => setMeetingLobby(null)}
          onJoin={opts => {
            if (meetingLobby.kind === 'instant') confirmInstantMeeting(opts);
            else if (meetingLobby.kind === 'join') confirmScheduledJoin(meetingLobby.joinCode, opts);
            else {
              setMeetingLobby(null);
              setActiveGalleryCall({
                conferenceId: meetingLobby.conferenceId,
                initialMicOn: opts.micOn,
                initialCamOn: opts.camOn,
                displayName: opts.displayName,
                isAdHocCall: false,
              });
            }
          }}
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
          title={activeGalleryCall.title}
          isAdHocCall={activeGalleryCall.isAdHocCall}
          myUsername={username}
          masterToken={null}
          onMasterTokenSaved={() => {}}
          onClose={() => { setActiveGalleryCall(null); setGalleryMinimized(false); }}
          minimized={galleryMinimized}
          onMinimize={() => setGalleryMinimized(true)}
          onMaximize={() => setGalleryMinimized(false)}
        />
      )}

      {/* Call itself renders in its own OS window now — see CallWindowApp.
          callWindowOpen just gates the other call-related banners below,
          same as activeCall used to. */}

      {/* ── GROUP CALL INVITE ───────────────────────────────────────────── */}
      {conferenceInvite && !callWindowOpen && !activeGalleryCall && (
        <div className="responsive-overlay" style={ci.backdrop}>
          <div className="responsive-dialog" style={ci.card}>
<div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(216,52,40,0.10)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
            </div>
            <p style={ci.kicker}>
              {conferenceInvite.groupName
                ? (conferenceInvite.callType === 'video' ? 'Group video call' : conferenceInvite.callType === 'voice' ? 'Group voice call' : 'Group call')
                : conferenceInvite.kind === 'meeting'
                  ? 'Meeting'
                  : (conferenceInvite.callType === 'video' ? 'Video call' : conferenceInvite.callType === 'voice' ? 'Voice call' : 'Call')}
              {conferenceInvite.groupName ? ` · ${conferenceInvite.groupName}` : ''}
            </p>
            <h3 style={ci.title}>
              {conferenceInvite.groupName ? `${conferenceInvite.invitedBy} is calling` : `${conferenceInvite.invitedBy} is adding you`}
            </h3>
            {conferenceInvite.participants.length > 0 && (
              <p style={ci.people}>
                Already on the call: {conferenceInvite.participants.join(', ')}
              </p>
            )}
            <p style={{ ...ci.hint, color: confTokenRejected ? 'var(--accent)' : 'var(--text-muted)' }}>
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
                Ignore
              </button>
              <button
                style={{ ...ci.join, opacity: confTokenInput.trim() && !confJoining ? 1 : 0.5 }}
                disabled={!confTokenInput.trim() || confJoining}
                onClick={() => { joinConferenceCall(); }}
              >
                {confJoining ? 'Joining…' : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── LOCKED CHAT — MASTER TOKEN GATE ──────────────────────────────── */}
      {blockedLogin && (
        <div className="responsive-overlay" style={ci.backdrop}>
          <div className="responsive-dialog" style={ci.card}>
<div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(216,52,40,0.10)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            </div>
            <p style={ci.kicker}>Security alert</p>
            <h3 style={ci.title}>Sign-in attempt blocked</h3>
            <p style={{ ...ci.hint, color: 'var(--text-secondary, #9ca3af)', lineHeight: 1.6 }}>
              Someone tried to sign in to your account on another device. It was blocked because you are signed in here.
            </p>
            <div style={{ fontSize: '0.85rem', lineHeight: 1.8, color: 'var(--text-primary, #e5e7eb)', margin: '6px 0 10px' }}>
              <div><strong>Device:</strong> {blockedLogin.deviceName || 'Unknown'}{blockedLogin.platform ? ` (${blockedLogin.platform})` : ''}</div>
              <div><strong>Location:</strong> {blockedLogin.location || 'Unknown'}</div>
              {blockedLogin.ip && <div><strong>IP address:</strong> {blockedLogin.ip}</div>}
              <div><strong>Time:</strong> {blockedLogin.time ? new Date(blockedLogin.time).toLocaleString() : 'Just now'}</div>
            </div>
            <p style={{ ...ci.hint, color: 'var(--text-muted)' }}>If this wasn't you, change your login token now.</p>
            <div style={ci.row}>
              <button style={ci.join} onClick={() => setBlockedLogin(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      <LoginApprovalPrompt token={token} />

      {/* Web only: calls render here instead of in a separate OS window. */}
      {!isTauri() && <InPageCallHost />}

      {showCreateGroup && (
        <CreateGroupModal token={token} myUsername={username} onClose={() => setShowCreateGroup(false)} onCreated={handleGroupReady} />
      )}
      {showJoinGroup && (
        <JoinGroupModal token={token} onClose={() => setShowJoinGroup(false)} onJoined={handleGroupReady} />
      )}

      {lockPrompt && (
        <div className="responsive-overlay" style={ci.backdrop}>
          <div className="responsive-dialog" style={ci.card}>
<div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(216,52,40,0.10)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            </div>
            <p style={ci.kicker}>Locked chat</p>
            <h3 style={ci.title}>
              {lockPrompt.kind === 'contact' ? lockPrompt.target : groups.find(g => g.id === lockPrompt.target)?.name || 'Group'}
            </h3>
            <p style={{ ...ci.hint, color: lockPromptError ? 'var(--accent)' : 'var(--text-muted)' }}>
              {lockPromptError || 'Enter your master token to open this chat.'}
            </p>
            <input
              style={ci.input}
              type="password"
              autoFocus
              placeholder="Master token"
              value={lockPromptInput}
              disabled={lockPromptBusy}
              onChange={e => setLockPromptInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && lockPromptInput.trim()) handleLockPromptSubmit(); }}
            />
            <div style={ci.row}>
              <button
                style={ci.decline}
                disabled={lockPromptBusy}
                onClick={() => { setLockPrompt(null); setLockPromptInput(''); setLockPromptError(null); }}
              >
                Cancel
              </button>
              <button
                style={{ ...ci.join, opacity: lockPromptInput.trim() && !lockPromptBusy ? 1 : 0.5 }}
                disabled={!lockPromptInput.trim() || lockPromptBusy}
                onClick={handleLockPromptSubmit}
              >
                {lockPromptBusy ? 'Verifying…' : 'Unlock'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MISSED CALL — CALL BACK ──────────────────────────────────────── */}
      {missedCall && !incomingCall && !callWindowOpen && !activeGalleryCall && (
        <div style={{
          position: 'fixed', right: 24, bottom: 24, zIndex: 900,
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 18,
          boxShadow: '0 18px 48px rgba(15,23,42,0.18)', minWidth: 260,
          padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>Missed call</span>
          <span style={{ fontSize: '1rem', color: 'var(--text-primary)', fontWeight: 700 }}>{missedCall.from}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '0.45rem 0.95rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, fontFamily: 'inherit' }}
              onClick={() => setMissedCall(null)}
            >
              Dismiss
            </button>
            <button
              style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 999, padding: '0.45rem 1rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit' }}
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
      {incomingCall && !callWindowOpen && !activeGalleryCall && (
        <div className="incoming-call-overlay" style={{
          position: 'fixed', inset: 0, zIndex: 900,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
          padding: 24, pointerEvents: 'none',
        }}>
          <div className="incoming-call-card" style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: 22,
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            width: 330,
            boxShadow: '0 24px 64px rgba(15,23,42,0.22)',
            pointerEvents: 'all',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 52, height: 52, borderRadius: 16,
                background: 'var(--accent)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '1rem', flexShrink: 0,
                boxShadow: '0 0 0 6px rgba(216,52,40,0.12)', animation: 'dl-ring-pulse 1.6s ease-out infinite',
              }}>
                {initials(incomingCall.from)}
              </div>
              <div>
                <div style={{ fontSize: '1.02rem', fontWeight: 800, color: 'var(--text-primary)' }}>{incomingCall.from}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Incoming {incomingCall.callType} call…
                </div>
              </div>
            </div>

            {/* Master token required to accept, every call */}
            {!callAcceptToken && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                  Enter master token to accept
                </span>
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
                      if (ok) { setCallAcceptToken(trimmed); setCallTokenError(null); }
                      else setCallTokenError('Invalid master token');
                    }
                  }}
                  style={{
                    background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 12,
                    color: 'var(--text-primary)', fontSize: '0.86rem', padding: '10px 12px', outline: 'none', fontFamily: 'inherit',
                  }}
                  autoFocus
                />
                {callTokenError && <span style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>{callTokenError}</span>}
                {callTokenLoading && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Verifying…</span>}
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
                  flex: 1, background: 'var(--accent)', border: 'none', borderRadius: 999,
                  color: '#fff', fontWeight: 700, fontSize: '0.86rem', fontFamily: 'inherit',
                  padding: '11px 0', cursor: 'pointer'
                }}
              >
                Decline
              </button>
              <button
                disabled={!callAcceptToken}
                onClick={() => {
                  if (!callAcceptToken) return;
                  stopRinging();
                  setCallTokenInput('');
                  setCallTokenError(null);
                  setCallWindowOpen(true);
                  openCallWindow(
                    {
                      token, my_username: username, partner: incomingCall.from, call_type: incomingCall.callType,
                      is_incoming: true, call_id: incomingCall.callId, offer_sdp: incomingCall.offerSdp,
                      master_token: callAcceptToken,
                    },
                    () => setCallWindowOpen(false),
                  ).catch(() => setCallWindowOpen(false));
                  setCallAcceptToken(null);
                  setIncomingCall(null);
                }}
                style={{
                  flex: 1, background: callAcceptToken ? '#16a34a' : 'var(--bg-base)', border: callAcceptToken ? 'none' : '1px solid var(--border-color)', borderRadius: 999,
                  color: callAcceptToken ? '#fff' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.86rem', fontFamily: 'inherit',
                  padding: '11px 0', cursor: callAcceptToken ? 'pointer' : 'not-allowed',
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
          className="responsive-overlay"
          style={{
            position: 'fixed', inset: 0, zIndex: 800,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) { setShowNewChat(false); setUserSearch(''); } }}
        >
          <div className="responsive-dialog" style={{
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
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
              ><CloseIcon size={18} color="var(--text-muted)" /></button>
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
          className="responsive-overlay"
          style={{
            position: 'fixed', inset: 0, zIndex: 800,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) { setShowNewMeeting(false); setMeetingSearch(''); } }}
        >
          <div className="responsive-dialog" style={{
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
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
              ><CloseIcon size={18} color="var(--text-muted)" /></button>
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
          className="responsive-overlay"
          style={{
            position: 'fixed', inset: 0, zIndex: 800,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowMeetings(false); }}
        >
          <div className="responsive-dialog" style={{
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
                onClick={() => {
                  if (showScheduleForm) { setShowScheduleForm(false); setScheduleCopilotNote(null); }
                  else setShowMeetings(false);
                }}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
              ><CloseIcon size={18} color="var(--text-muted)" /></button>
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
                          style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', flexShrink: 0, display: 'flex' }}
                        ><CloseIcon size={15} color="#ef4444" /></button>
                      )}
                    </div>
                  ))
                )
              )}

              {showScheduleForm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {scheduleCopilotNote && (
                    <div style={{
                      background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
                      borderRadius: 8, padding: '8px 12px', fontSize: '0.76rem', color: '#f59e0b',
                      display: 'flex', alignItems: 'flex-start', gap: 6,
                    }}>
                      <SparkleIcon size={13} color="#f59e0b" />
                      <span>Copilot filled this in, but wasn't fully sure: {scheduleCopilotNote}</span>
                    </div>
                  )}
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
                  onClick={openScheduleForm}
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

      <ReminderAlerts token={token} onOpen={() => switchTab('reminders')} />
      <AgentApprovalPopup token={token} hidden={activeTab === 'ai'} onOpen={() => switchTab('ai')} />
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

function LockBadge() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6, verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function MuteBadge() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: 2 }}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const ci: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.40)', backdropFilter: 'blur(3px)', zIndex: 950,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 20,
    boxShadow: '0 24px 60px rgba(15,23,42,0.18)',
    padding: '26px 26px 22px', width: 380, display: 'flex', flexDirection: 'column', gap: 10,
  },
  kicker: { margin: 0, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent)', textTransform: 'uppercase' },
  title: { margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.02em' },
  people: { margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' },
  hint: { margin: '4px 0 0', fontSize: '0.8rem', lineHeight: 1.45 },
  input: {
    background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 12,
    padding: '0.75rem 0.95rem', color: 'var(--text-primary)', fontSize: '0.92rem', outline: 'none', fontFamily: 'inherit',
  },
  row: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 },
  decline: {
    background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 999,
    padding: '0.6rem 1.1rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit',
  },
  join: {
    background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 999,
    padding: '0.6rem 1.4rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'inherit',
    boxShadow: '0 6px 16px rgba(216,52,40,0.25)',
  },
};

const hs: Record<string, React.CSSProperties> = {
  // Brand frame: rail on the tinted background, white sheet beside it.
  root: {
    display: 'flex',
    flexDirection: 'row',
    height: '100vh',
    background: 'var(--frame-bg)',
    overflow: 'hidden',
    padding: '10px 10px 10px 0',
  },
  rail: {
    width: 68,
    minWidth: 68,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    padding: '6px 0 4px',
    color: 'var(--rail-fg)',
  },
  railLogo: {
    width: 42, height: 42, borderRadius: 12, overflow: 'hidden', marginBottom: 8,
    background: 'rgba(255,255,255,0.9)', boxShadow: '0 4px 14px rgba(0,0,0,0.25)', flexShrink: 0,
  },
  railBtn: {
    width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--rail-tile)', color: 'var(--rail-fg)', border: 'none', cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s', flexShrink: 0,
  },
  railBtnActive: { background: 'var(--rail-tile-active)', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)' },
  railBtnAdd: { background: 'rgba(255,255,255,0.08)', border: '1px dashed rgba(255,255,255,0.35)' },
  railAvatarBtn: { position: 'relative', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', marginTop: 4 },
  railAvatar: {
    width: 40, height: 40, borderRadius: '50%', background: '#fff', color: 'var(--accent)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem',
    boxShadow: '0 0 0 2px rgba(255,255,255,0.5)',
  },
  railPresence: { position: 'absolute', right: 0, bottom: 0, width: 11, height: 11, borderRadius: '50%', border: '2px solid #7a1d14' },
  card: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    background: 'var(--bg-panel)',
    borderRadius: 18,
    overflow: 'hidden',
    border: '1px solid var(--border-color)',
    boxShadow: '0 10px 40px rgba(0,0,0,0.22)',
  },
  sidebarScroll: { flex: 1, overflowY: 'auto', padding: '2px 10px 16px' },
  navGroup: { display: 'flex', flexDirection: 'column', gap: 1 },
  sectionHeader: {
    display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: 'pointer',
    color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 500, padding: '4px 10px 6px', fontFamily: 'inherit',
  },
  sideRow: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', borderRadius: 8,
    background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
    color: 'var(--text-secondary)', fontSize: '0.9rem',
  },
  sideRowIcon: { width: 18, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '1.05rem', flexShrink: 0 },
  sideRowLabel: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  workspacePill: {
    display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card)', border: 'none', borderRadius: 10,
    padding: '7px 12px', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'inherit',
  },
  headerIconBtn: {
    width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer',
  },

  tabBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '7px 10px',
    borderRadius: 8,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.12s',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
    fontWeight: 500,
    fontFamily: 'inherit',
    textAlign: 'left',
    flexShrink: 0,
  },
  tabBtnActive: {
    background: 'var(--tab-active-bg)',
    color: 'var(--text-primary)',
    fontWeight: 600,
  },
  tabBtnLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tabBtnBadge: {
    background: '#ef4444',
    color: '#fff',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    padding: '0 6px',
    fontSize: '0.7rem',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // List panel
  listPanel: {
    width: LIST_WIDTH.def,
    minWidth: LIST_WIDTH.min,
    flexShrink: 1,
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
    padding: '16px 14px 12px 14px',
    flexShrink: 0,
  },
  listHeaderTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '2px 0 6px',
    background: 'var(--bg-card)',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '6px 10px',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
  },
  listItems: {},
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
    gap: 10,
    width: '100%',
    padding: '6px 10px',
    borderRadius: 8,
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background 0.12s',
    border: 'none',
    fontFamily: 'inherit',
    background: 'transparent',
  },
  contactAvatar: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: 'var(--avatar-bg)',
    color: 'var(--avatar-text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.6rem',
    flexShrink: 0,
  },
  groupAvatar: {
    width: 26,
    height: 26,
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
    fontSize: '0.9rem',
    fontWeight: 500,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  unreadBadge: {
    background: '#ef4444',
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
    flex: '1 0 0',
    minWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'var(--bg-panel)',
  },
};

/** The "You" chat always sits first, even on servers that don't list it yet. */
function withSelfChat(list: Contact[], me: string): Contact[] {
  const fromServer = list.find(c => c.is_self || c.username === me);
  const self: Contact = { ...(fromServer ?? {}), username: me, is_active: true, is_self: true, display_name: 'You' };
  return [self, ...list.filter(c => !(c.is_self || c.username === me))];
}
