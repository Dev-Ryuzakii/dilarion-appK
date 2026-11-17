import { useEffect, useRef, useState } from 'react';

// Slide-in contact-info panel, opened from the chat header — avatar, call
// buttons, and quick rows into things that already exist elsewhere (starred
// messages, media count, per-chat archive/mute/lock/delete). Counts only for
// now: actual media/starred content stays behind the app's normal decrypt
// gate, this panel doesn't bypass it.

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function ImagesIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
function BellOffIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function ArchiveIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function Row({ icon, label, value, onClick, danger }: { icon: React.ReactNode; label: string; value?: React.ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, width: '100%', background: 'transparent',
        border: 'none', borderRadius: 8, padding: '10px 8px', fontFamily: 'inherit',
        cursor: onClick ? 'pointer' : 'default', textAlign: 'left',
      }}
    >
      <span style={{ width: 20, display: 'inline-flex', justifyContent: 'center', opacity: 0.75 }}>{icon}</span>
      <span style={{ flex: 1, fontSize: '0.9rem', color: danger ? '#ef4444' : 'var(--text-primary)', fontWeight: danger ? 600 : 400 }}>
        {label}
      </span>
      {value !== undefined && <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{value}</span>}
      {onClick && !danger && <ChevronIcon />}
    </button>
  );
}

const AVATAR_TINTS = ['#c0392b', '#b45309', '#0f766e', '#1d4ed8', '#7c3aed', '#be185d', '#4d7c0f', '#0369a1'];
function tint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length];
}

export default function ContactInfoPanel({
  username,
  online,
  mediaCount,
  starredCount,
  isMuted,
  isArchived,
  isLocked,
  onCall,
  onToggleMute,
  onToggleArchive,
  onToggleLock,
  onDeleteChat,
  onClose,
}: {
  username: string;
  online?: boolean;
  mediaCount: number;
  starredCount: number;
  isMuted: boolean;
  isArchived: boolean;
  isLocked: boolean;
  onCall: (type: 'audio' | 'video') => void;
  onToggleMute?: () => void;
  onToggleArchive?: () => void;
  onToggleLock?: () => void;
  onDeleteChat?: () => void;
  onClose: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sectionStyle: React.CSSProperties = { padding: '10px 16px', borderTop: '1px solid var(--border-color)' };

  return (
    // Docked on the right edge of the content card, like a profile sidebar.
    // The transparent layer only catches outside clicks to close it.
    <div
      className="mobile-drawer-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 940, background: 'transparent', display: 'flex', justifyContent: 'flex-end', padding: '10px 10px 10px 0' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="mobile-drawer"
        ref={panelRef}
        style={{
          width: 340, maxWidth: '90vw', height: '100%', background: 'var(--bg-panel)',
          borderLeft: '1px solid var(--border-color)', borderRadius: '0 18px 18px 0',
          boxShadow: '-12px 0 32px rgba(0,0,0,0.08)', overflowY: 'auto', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 12px', minHeight: 64 }}>
          <button onClick={onClose} style={{ background: 'var(--bg-card)', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Close profile sidebar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
            </svg>
          </button>
          <span style={{ flex: 1, fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {username}&rsquo;s profile
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px 22px' }}>
          <div style={{
            width: 132, height: 132, borderRadius: '50%', background: tint(username), color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.6rem', fontWeight: 700, marginBottom: 16,
            boxShadow: '0 0 0 6px var(--bg-card)',
          }}>
            {initials(username)}
          </div>
          <div style={{ fontSize: '1.45rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{username}</div>
          <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: 4 }}>Dilarion contact</div>
        </div>

        <div style={sectionStyle}>
          <Row
            icon={<span style={{ width: 9, height: 9, borderRadius: '50%', background: online ? '#22c55e' : 'var(--text-muted)', display: 'inline-block' }} />}
            label="Status"
            value={
              <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600, background: online ? 'rgba(34,197,94,0.14)' : 'var(--bg-card)', color: online ? '#15803d' : 'var(--text-muted)' }}>
                {online ? 'Active' : 'Offline'}
              </span>
            }
          />
          <Row icon={<ImagesIcon />} label="Media, links and docs" value={String(mediaCount)} />
          <Row icon={<StarIcon />} label="Starred" value={starredCount > 0 ? String(starredCount) : 'None'} />
        </div>

        <div style={sectionStyle}>
          {onToggleMute && (
            <Row icon={<BellOffIcon />} label={isMuted ? 'Unmute notifications' : 'Mute notifications'} onClick={onToggleMute} />
          )}
          {onToggleArchive && (
            <Row icon={<ArchiveIcon />} label={isArchived ? 'Unarchive chat' : 'Archive chat'} onClick={onToggleArchive} />
          )}
          {onToggleLock && (
            <Row icon={<LockIcon />} label={isLocked ? 'Unlock chat' : 'Lock chat'} onClick={onToggleLock} />
          )}
          {onDeleteChat && (confirmDelete ? (
            <Row icon={<TrashIcon />} label="Confirm delete chat" danger onClick={onDeleteChat} />
          ) : (
            <Row icon={<TrashIcon />} label="Delete chat" danger onClick={() => setConfirmDelete(true)} />
          ))}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', gap: 10, padding: 16, borderTop: '1px solid var(--border-color)' }}>
          {(['audio', 'video'] as const).map(type => (
            <button
              key={type}
              onClick={() => onCall(type)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--bg-panel)',
                border: '1px solid var(--border-color)', borderRadius: 10, padding: '10px 0', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 500, color: 'var(--text-primary)',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              {type === 'audio' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382v7.236a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              )}
              {type === 'audio' ? 'Call' : 'Video'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
