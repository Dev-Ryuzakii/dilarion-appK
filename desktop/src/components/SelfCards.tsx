import { useEffect, useRef, useState } from 'react';
import {
  ChatMessage,
  confirmMasterToken,
  NotesCardPayload,
  openRecordingFile,
  RecordingCardPayload,
  RecordingFileError,
} from '../services/api';
import { userMessage } from '../services/errors';
import MeetingNotesPanel from './MeetingNotesPanel';

// Cards the server drops into the personal "You" chat when a meeting recording
// or its AI notes are ready. Like every other DM they stay locked: the decoy
// line shows until the user unlocks with the master token, and the payload is
// decrypted on this device (encrypted_key/iv present). Older servers stored the
// card JSON unencrypted; those still sit behind the same unlock.

export function isSelfCard(ct: string | null | undefined): boolean {
  return ct === 'meeting_recording' || ct === 'meeting_notes';
}

const RELOCK_MS = 60_000;

type Payload = RecordingCardPayload | NotesCardPayload;

export default function SelfCardBubble({
  token,
  msg,
  masterToken,
  onDecrypt,
  onMasterTokenSaved,
}: {
  token: string;
  msg: ChatMessage;
  masterToken: string | null;
  onDecrypt: (mToken: string, messageId: number) => Promise<string>;
  onMasterTokenSaved: (t: string) => void;
}) {
  const isRecording = msg.content_type === 'meeting_recording';
  const [payload, setPayload] = useState<Payload | null>(null);
  const [askToken, setAskToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playing = useRef(false);

  function lock() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPayload(null);
  }

  // Relock after a minute of inactivity, but never while a video is playing.
  function armRelock() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!playing.current) lock(); }, RELOCK_MS);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function unlock(mToken: string) {
    setBusy(true);
    setError(null);
    try {
      const valid = masterToken === mToken ? true : await confirmMasterToken(token, mToken);
      if (!valid) { setError('Invalid master token'); return; }
      const text = msg.encrypted_key && msg.iv ? await onDecrypt(mToken, msg.id) : msg.content;
      const parsed = JSON.parse(text) as Payload;
      if (!parsed || (parsed.kind !== 'meeting_recording' && parsed.kind !== 'meeting_notes')) {
        throw new Error('This card could not be read.');
      }
      onMasterTokenSaved(mToken);
      setPayload(parsed);
      setAskToken(false);
      setTokenInput('');
      armRelock();
    } catch (err) {
      setError(userMessage(err, "Couldn't unlock this card. Check your master token and try again."));
    } finally {
      setBusy(false);
    }
  }

  function onLockedClick() {
    if (busy) return;
    if (masterToken) unlock(masterToken);
    else setAskToken(v => !v);
  }

  if (!payload) {
    return (
      <div style={sc.card}>
        <button onClick={onLockedClick} style={sc.lockedRow} title="Unlock">
          <span style={sc.iconBox}>{isRecording ? <FilmIcon /> : <NotesIcon />}</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1, textAlign: 'left' }}>
            <span style={sc.title}>{isRecording ? 'Meeting recording' : 'Meeting notes'}</span>
            <span style={sc.meta}>{busy ? 'Unlocking…' : 'Locked · tap to unlock'}</span>
          </span>
          <LockIcon />
        </button>
        {askToken && (
          <form
            onSubmit={e => { e.preventDefault(); if (tokenInput.trim()) unlock(tokenInput.trim()); }}
            style={{ display: 'flex', gap: 6, marginTop: 10 }}
          >
            <input
              autoFocus
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              placeholder="Master token"
              style={sc.input}
            />
            <button type="submit" disabled={busy || !tokenInput.trim()} style={sc.primaryBtn}>Unlock</button>
          </form>
        )}
        {error && <div style={sc.error}>{error}</div>}
      </div>
    );
  }

  return payload.kind === 'meeting_recording'
    ? <RecordingCard token={token} p={payload} onLock={lock} onActivity={armRelock} playingRef={playing} />
    : <NotesCard token={token} p={payload} onLock={lock} onActivity={armRelock} />;
}

function RecordingCard({ token, p, onLock, onActivity, playingRef }: {
  token: string;
  p: RecordingCardPayload;
  onLock: () => void;
  onActivity: () => void;
  playingRef: React.MutableRefObject<boolean>;
}) {
  const [video, setVideo] = useState<{ url: string; revoke: () => void } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => () => { video?.revoke(); playingRef.current = false; }, [video]);

  async function play() {
    onActivity();
    setLoading(true);
    setError(null);
    try { setVideo(await openRecordingFile(token, p.recording_id)); }
    catch (err) { setError(err instanceof RecordingFileError ? err.message : userMessage(err, "Couldn't open the recording.")); }
    finally { setLoading(false); }
  }

  async function download() {
    onActivity();
    setError(null);
    try {
      const file = video ?? await openRecordingFile(token, p.recording_id);
      const a = document.createElement('a');
      a.href = file.url;
      a.download = `${(p.meeting_title || 'Meeting').replace(/[^\w.-]+/g, '-')}.mp4`;
      a.click();
      if (!video) setTimeout(file.revoke, 60_000);
    } catch (err) {
      setError(err instanceof RecordingFileError ? err.message : userMessage(err, "Couldn't download the recording."));
    }
  }

  const meta = [fmtWhen(p.started_at), fmtDuration(p.duration_seconds), fmtSize(p.file_size)].filter(Boolean).join(' · ');

  return (
    <div style={sc.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={sc.iconBox}><FilmIcon /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={sc.eyebrow}>Meeting recording</div>
          <div style={sc.title}>{p.meeting_title || 'Meeting'}</div>
          <div style={sc.meta}>{meta}{p.host_username ? ` · recorded by ${p.host_username}` : ''}</div>
        </div>
        <button onClick={onLock} style={sc.ghostIcon} title="Lock"><LockIcon /></button>
      </div>

      {video ? (
        <video
          src={video.url}
          controls
          autoPlay
          onPlay={() => { playingRef.current = true; }}
          onPause={() => { playingRef.current = false; onActivity(); }}
          onEnded={() => { playingRef.current = false; onActivity(); }}
          onError={() => setError("This recording can't be played here. Try downloading it.")}
          style={sc.video}
        />
      ) : (
        <button onClick={play} disabled={loading} style={sc.poster} title="Play recording">
          <span style={sc.playDisc}>
            {loading ? <span style={sc.spinner} /> : <PlayIcon />}
          </span>
          <span style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.75)' }}>{loading ? 'Loading…' : 'Play recording'}</span>
        </button>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={download} style={sc.secondaryBtn}><DownloadIcon /> Download</button>
        <button onClick={() => { onActivity(); setShowNotes(true); }} style={sc.secondaryBtn}><NotesIcon size={14} /> Meeting notes</button>
      </div>
      {error && <div style={sc.error}>{error}</div>}
      {showNotes && <MeetingNotesPanel token={token} recordingId={p.recording_id} onClose={() => setShowNotes(false)} />}
    </div>
  );
}

function NotesCard({ token, p, onLock, onActivity }: {
  token: string;
  p: NotesCardPayload;
  onLock: () => void;
  onActivity: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={sc.card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={sc.iconBox}><NotesIcon /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={sc.eyebrow}>Meeting notes</div>
          <div style={sc.title}>{p.meeting_title || 'Meeting'}</div>
        </div>
        <button onClick={onLock} style={sc.ghostIcon} title="Lock"><LockIcon /></button>
      </div>
      {p.summary && <p style={{ margin: '10px 0 0', fontSize: '0.84rem', lineHeight: 1.55, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{p.summary}</p>}
      {p.key_points?.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {p.key_points.map((k, i) => <li key={i} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{k}</li>)}
        </ul>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        {p.action_item_count > 0 && (
          <span style={sc.pill}>{p.action_item_count} action item{p.action_item_count === 1 ? '' : 's'}</span>
        )}
        <button onClick={() => { onActivity(); setOpen(true); }} style={{ ...sc.primaryBtn, marginLeft: 'auto' }}>Open full notes</button>
      </div>
      {open && <MeetingNotesPanel token={token} recordingId={p.recording_id} onClose={() => setOpen(false)} />}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const sc: Record<string, React.CSSProperties> = {
  card: {
    width: 'min(420px, 100%)', background: 'var(--bg-card, var(--bg-panel))', border: '1px solid var(--border-color)',
    borderRadius: 14, padding: 12, boxSizing: 'border-box',
  },
  lockedRow: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'transparent', border: 'none',
    padding: 0, cursor: 'pointer', color: 'var(--text-muted)', fontFamily: 'inherit',
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'color-mix(in srgb, var(--accent, #c0392b) 14%, transparent)', color: 'var(--accent, #c0392b)',
  },
  eyebrow: { fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent, #c0392b)' },
  title: { fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { fontSize: '0.74rem', color: 'var(--text-muted)' },
  input: {
    flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 9, border: '1px solid var(--border-color)',
    background: 'var(--bg-panel)', color: 'var(--text-primary)', fontSize: '0.82rem', fontFamily: 'inherit',
  },
  primaryBtn: {
    background: 'var(--accent, #c0392b)', color: '#fff', border: 'none', borderRadius: 9, padding: '8px 14px',
    fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  },
  secondaryBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--text-primary)',
    border: '1px solid var(--border-color)', borderRadius: 9, padding: '7px 12px', fontSize: '0.78rem', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  ghostIcon: {
    width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-muted)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
  },
  poster: {
    marginTop: 10, width: '100%', aspectRatio: '16 / 9', borderRadius: 12, border: 'none', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
    background: 'radial-gradient(circle at 50% 40%, #3a1712 0%, #140c0b 70%)', fontFamily: 'inherit',
  },
  playDisc: {
    width: 54, height: 54, borderRadius: '50%', background: 'var(--accent, #c0392b)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
  },
  spinner: {
    width: 20, height: 20, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.35)', borderTopColor: '#fff',
    animation: 'spin 0.9s linear infinite', display: 'block',
  },
  video: { marginTop: 10, width: '100%', borderRadius: 12, background: '#000', display: 'block', maxHeight: 320 },
  pill: {
    fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent, #c0392b)', borderRadius: 999, padding: '3px 10px',
    background: 'color-mix(in srgb, var(--accent, #c0392b) 12%, transparent)',
  },
  error: { marginTop: 8, fontSize: '0.76rem', color: '#ef4444' },
};

function FilmIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 10l4.55-2.55A1 1 0 0 1 21 8.38v7.24a1 1 0 0 1-1.45.89L15 14" /><rect x="3" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
function NotesIcon({ size = 19 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function PlayIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>;
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
