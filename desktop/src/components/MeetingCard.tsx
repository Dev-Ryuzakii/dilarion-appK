// Meeting invite/status shown inline in a chat or group thread — the way
// Meet/Teams surface a call card rather than a plain text line. This message's
// content_type is "meeting", not "encrypted" — it's a system-generated notice
// (same non-E2E precedent as group admin announcements), so it renders
// unlocked, always visible, with an immediate Join action.

export interface MeetingCardPayload {
  /** 'group_call' = WhatsApp-style call to a whole group, not a meeting. */
  kind: 'instant' | 'scheduled' | 'group_call';
  call_type?: 'voice' | 'video';
  group_id?: number;
  group_name?: string;
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
    | { kind: 'scheduled'; joinCode: string }
    | { kind: 'group_call'; conferenceId: number; invitedBy: string; groupId: number; groupName: string; callType: 'voice' | 'video' },
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

  if (payload.kind === 'group_call') {
    return <GroupCallCard payload={payload} senderUsername={senderUsername} onJoin={onJoin} />;
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

// Group call notice — a call, styled like a call (phone/camera icon, who
// started it), not like a meeting invite.
function GroupCallCard({ payload, senderUsername, onJoin }: {
  payload: MeetingCardPayload; senderUsername: string; onJoin: JoinMeetingHandler;
}) {
  const isVideo = payload.call_type === 'video';
  function join() {
    if (payload.conference_id == null) return;
    onJoin({
      kind: 'group_call',
      conferenceId: payload.conference_id,
      invitedBy: senderUsername,
      groupId: payload.group_id ?? 0,
      groupName: payload.group_name || 'Group',
      callType: isVideo ? 'video' : 'voice',
    });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 220, padding: '4px 2px' }}>
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0, background: '#25d366',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {isVideo ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {isVideo ? 'Group video call' : 'Group voice call'}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Started by {senderUsername}</div>
      </div>
      <button
        onClick={join}
        style={{
          background: '#25d366', color: '#fff', border: 'none', borderRadius: 999, padding: '6px 16px',
          fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0,
        }}
      >
        Join
      </button>
    </div>
  );
}
