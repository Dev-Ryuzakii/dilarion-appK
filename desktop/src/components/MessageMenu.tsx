import { useState } from 'react';

// Real line icons for message actions — WhatsApp's own menu uses icons, not
// emoji, for everything except the reaction choices themselves (those stay
// real emoji, rendered in ReactionBar below).

export function ReplyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  );
}
export function ForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 17 20 12 15 7" /><path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </svg>
  );
}
export function StarIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? '#f59e0b' : 'none'} stroke={filled ? '#f59e0b' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
export function PinIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79L16 12V5a1 1 0 0 1 1-1 1 1 0 0 0 0-2H7a1 1 0 0 0 0 2 1 1 0 0 1 1 1v7l-1.89 1.45A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}
export function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
export function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
export function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
export function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
export function SmileyIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}
export function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
export function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** Floating row of real emoji — clicking one reacts and closes. Matches
 * WhatsApp's reaction bar exactly: real emoji for the choices themselves,
 * everything else in this file is a line icon. */
export function ReactionBar({ onPick, style }: { onPick: (emoji: string) => void; style?: React.CSSProperties }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg-panel)',
      border: '1px solid var(--border-color)', borderRadius: 24, padding: '4px 6px',
      boxShadow: '0 6px 20px rgba(0,0,0,0.35)', ...style,
    }}>
      {REACTION_EMOJIS.map(e => (
        <button
          key={e}
          onClick={() => onPick(e)}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.15rem', padding: 4, borderRadius: '50%', lineHeight: 1 }}
          onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.08))')}
          onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

interface MenuAction {
  key: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** WhatsApp-style vertical dropdown — trigger is a small chevron that only
 * appears on hover; the menu itself is a plain icon+label list. */
export function MessageMenuTrigger({
  isMine,
  onReact,
  onReply,
  onForward,
  onCopy,
  onInfo,
  onPinToggle,
  onStarToggle,
  onEdit,
  onDelete,
  isPinned,
  isStarred,
}: {
  isMine: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onForward: () => void;
  onCopy: () => void;
  onInfo: () => void;
  onPinToggle: () => void;
  onStarToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isPinned: boolean;
  isStarred: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showReactionBar, setShowReactionBar] = useState(false);

  const actions: MenuAction[] = [
    { key: 'reply', icon: <ReplyIcon />, label: 'Reply', onClick: onReply },
    { key: 'react', icon: <SmileyIcon />, label: 'React', onClick: () => { setOpen(false); setShowReactionBar(true); } },
    { key: 'star', icon: <StarIcon filled={isStarred} />, label: isStarred ? 'Unstar' : 'Star', onClick: onStarToggle },
    { key: 'pin', icon: <PinIcon filled={isPinned} />, label: isPinned ? 'Unpin' : 'Pin', onClick: onPinToggle },
    { key: 'forward', icon: <ForwardIcon />, label: 'Forward', onClick: onForward },
    { key: 'copy', icon: <CopyIcon />, label: 'Copy', onClick: onCopy },
    { key: 'info', icon: <InfoIcon />, label: 'Info', onClick: onInfo },
    ...(isMine && onEdit ? [{ key: 'edit', icon: <EditIcon />, label: 'Edit', onClick: onEdit }] : []),
    ...(isMine && onDelete ? [{ key: 'delete', icon: <TrashIcon />, label: 'Delete', onClick: onDelete, danger: true }] : []),
  ];

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(v => !v); setShowReactionBar(false); }}
        title="More"
        style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: '50%',
          width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'var(--text-muted)',
        }}
      >
        <ChevronDownIcon />
      </button>

      {showReactionBar && (
        <div style={{ position: 'absolute', top: '100%', marginTop: 6, [isMine ? 'right' : 'left']: 0, zIndex: 25 } as React.CSSProperties}>
          <ReactionBar onPick={emoji => { onReact(emoji); setShowReactionBar(false); }} />
        </div>
      )}

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute', top: '100%', marginTop: 4, [isMine ? 'right' : 'left']: 0, zIndex: 25,
              background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)', minWidth: 168, padding: 4, overflow: 'hidden',
            } as React.CSSProperties}
          >
            {actions.map(a => (
              <button
                key={a.key}
                onClick={() => { a.onClick(); if (a.key !== 'react') setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none', borderRadius: 6, padding: '8px 10px',
                  cursor: 'pointer', fontSize: '0.82rem', color: a.danger ? '#ef4444' : 'var(--text-primary)',
                }}
                onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.06))')}
                onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
              >
                <span style={{ display: 'flex', color: a.danger ? '#ef4444' : 'var(--text-muted)' }}>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function MessageReactionPills({ reactions, onToggle }: { reactions: { emoji: string; count: number; reacted_by_me: boolean }[] | undefined; onToggle: (emoji: string) => void }) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
      {reactions.map(r => (
        <button
          key={r.emoji}
          onClick={() => onToggle(r.emoji)}
          style={{
            display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.72rem',
            background: r.reacted_by_me ? 'var(--accent)' : 'var(--bg-card)',
            border: '1px solid var(--border-color)', borderRadius: 12,
            padding: '1px 7px', cursor: 'pointer', color: r.reacted_by_me ? '#fff' : 'var(--text-secondary)',
          }}
        >
          <span>{r.emoji}</span><span>{r.count}</span>
        </button>
      ))}
    </div>
  );
}
