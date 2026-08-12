// Meeting invite/status shown inline in a chat or group thread — the way
// Meet/Teams surface a call card rather than a plain text line. This message's
// content_type is "meeting", not "encrypted" — it's a system-generated notice
// (same non-E2E precedent as group admin announcements), so it renders
// unlocked, always visible, with an immediate Join action.

export interface MeetingCardPayload {
  kind: 'instant' | 'scheduled';
  conference_id?: number;
  meeting_id?: number;
  join_code?: string;
  title?: string | null;
  scheduled_at?: string;
  duration_minutes?: number;
}

export type JoinMeetingHandler = (
  m:
    | { kind: 'instant'; conferenceId: number; invitedBy: string }
    | { kind: 'scheduled'; joinCode: string },
) => void;

export function fmtRange(scheduledAt: string, durationMinutes: number): string {
  const start = new Date(scheduledAt);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  const dateStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const startStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endStr = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} · ${startStr} – ${endStr}`;
}

export default function MeetingCard({
  content,
  senderUsername,
  onJoin,
}: {
  content: string;
  senderUsername: string;
  onJoin: JoinMeetingHandler;
}) {
  let payload: MeetingCardPayload | null = null;
  try {
    payload = JSON.parse(content);
  } catch {
    payload = null;
  }

  if (!payload) {
    return <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Meeting update</span>;
  }

  const isInstant = payload.kind === 'instant';
  const title = payload.title || (isInstant ? 'Instant meeting' : 'Scheduled meeting');
  const subtitle = isInstant
    ? 'Group video call'
    : payload.scheduled_at && payload.duration_minutes
      ? fmtRange(payload.scheduled_at, payload.duration_minutes)
      : '';

  function handleJoin() {
    if (!payload) return;
    if (isInstant && payload.conference_id != null) {
      onJoin({ kind: 'instant', conferenceId: payload.conference_id, invitedBy: senderUsername });
    } else if (!isInstant && payload.join_code) {
      onJoin({ kind: 'scheduled', joinCode: payload.join_code });
    }
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        minWidth: 220, padding: '4px 2px',
      }}
    >
      <div
        style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{subtitle}</div>
        )}
      </div>
      <button
        onClick={handleJoin}
        style={{
          background: 'var(--accent)', color: '#fff', border: 'none',
          borderRadius: 8, padding: '6px 14px', fontSize: '0.78rem',
          fontWeight: 700, cursor: 'pointer', flexShrink: 0,
        }}
      >
        Join
      </button>
    </div>
  );
}
