import { useEffect, useRef, useState } from 'react';

// Small "..." dropdown for a chat-list row — Archive/Mute/Lock/Delete, all
// purely local to this user (never visible to or affecting the other party).

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
function ArchiveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}
function MuteIcon2() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4V5Z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
function LockIcon2() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function TrashIcon2() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
    </svg>
  );
}

interface Props {
  isArchived: boolean;
  isMuted: boolean;
  isLocked: boolean;
  onToggleArchive: () => void;
  onToggleMute: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}

export default function ChatItemMenu({ isArchived, isMuted, isLocked, onToggleArchive, onToggleMute, onToggleLock, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) { setOpen(false); setConfirmDelete(false); }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const items = [
    { key: 'archive', icon: <ArchiveIcon />, label: isArchived ? 'Unarchive chat' : 'Archive chat', onClick: onToggleArchive },
    { key: 'mute', icon: isMuted ? <BellIcon /> : <MuteIcon2 />, label: isMuted ? 'Unmute notifications' : 'Mute notifications', onClick: onToggleMute },
    { key: 'lock', icon: <LockIcon2 />, label: isLocked ? 'Unlock chat' : 'Lock chat', onClick: onToggleLock },
  ];

  return (
    <div ref={rootRef} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Chat options"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
          width: 26, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        <DotsIcon />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 28, right: 0, zIndex: 60, minWidth: 200,
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)', padding: 4, display: 'flex', flexDirection: 'column',
        }}>
          {items.map(item => (
            <button
              key={item.key}
              onClick={() => { item.onClick(); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none',
                borderRadius: 6, padding: '8px 10px', fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.06))')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {item.icon}{item.label}
            </button>
          ))}
          <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />
          {confirmDelete ? (
            <button
              onClick={() => { onDelete(); setOpen(false); setConfirmDelete(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(239,68,68,0.12)', border: 'none', borderRadius: 6, padding: '8px 10px', fontSize: '0.82rem', color: '#ef4444', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}
            >
              <TrashIcon2 /> Confirm delete chat
            </button>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', borderRadius: 6, padding: '8px 10px', fontSize: '0.82rem', color: '#ef4444', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <TrashIcon2 /> Delete chat
            </button>
          )}
        </div>
      )}
    </div>
  );
}
