import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CaptionLanguage,
  CaptionSegment,
  CaptionsState,
  DEFAULT_CAPTION_LANGUAGES,
  getLiveCaptions,
  startLiveCaptions,
  stopLiveCaptions,
} from '../services/api';
import { presenceService, WsMessage } from '../services/presence';
import { userMessage } from '../services/errors';
import { CloseIcon } from './Icons';

// Live meeting transcript. The server transcribes each speaker on its own
// machine and pushes finished lines over the WebSocket; this file keeps the
// list, shows the last lines over the call, and the full transcript in a panel.

const MAX_KEPT = 1000;
const OVERLAY_LINES = 2;
const OVERLAY_TTL_MS = 9000;

const OFF: CaptionsState = { conference_id: 0, enabled: false, status: 'off', started_by: null };

export function useLiveCaptions(token: string, conferenceId: number, active: boolean) {
  const [state, setState] = useState<CaptionsState>(OFF);
  const [available, setAvailable] = useState(true);
  const [segments, setSegments] = useState<CaptionSegment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<CaptionLanguage[]>(DEFAULT_CAPTION_LANGUAGES);
  const lastId = useRef(0);

  const merge = useCallback((incoming: CaptionSegment[]) => {
    if (!incoming.length) return;
    setSegments(prev => {
      const seen = new Set(prev.map(s => s.id));
      const next = [...prev, ...incoming.filter(s => !seen.has(s.id))].sort((a, b) => a.id - b.id);
      if (next.length) lastId.current = next[next.length - 1].id;
      return next.slice(-MAX_KEPT);
    });
  }, []);

  // Initial load, and catch-up for anything missed while the socket was away.
  const refresh = useCallback(async () => {
    try {
      const body = await getLiveCaptions(token, conferenceId, lastId.current);
      setState({ conference_id: body.conference_id, enabled: body.enabled, status: body.status, started_by: body.started_by, language: body.language ?? null, error: body.error });
      setAvailable(body.available !== false);
      if (body.languages?.length) setLanguages(body.languages);
      merge(body.segments || []);
    } catch {
      // Older servers have no captions route: treat as unavailable, quietly.
      setAvailable(false);
    }
  }, [token, conferenceId, merge]);

  useEffect(() => {
    lastId.current = 0;
    setSegments([]);
    setState(OFF);
    if (!active) return;
    refresh();
  }, [active, refresh]);

  useEffect(() => {
    if (!active) return;
    const onMsg = (msg: WsMessage) => {
      const data = (msg.data || {}) as Record<string, any>;
      if (data.conference_id !== conferenceId) return;
      if (msg.type === 'meeting_caption') {
        merge([data as CaptionSegment]);
      } else if (msg.type === 'meeting_captions_state') {
        setState({ conference_id: conferenceId, enabled: !!data.enabled, status: data.status || 'off', started_by: data.started_by ?? null, language: data.language ?? null, error: data.error ?? null });
        if (data.enabled) refresh();
      }
    };
    presenceService.addListener(onMsg);
    return () => presenceService.removeListener(onMsg);
  }, [active, conferenceId, merge, refresh]);

  async function start(language?: string) {
    setBusy(true);
    setError(null);
    try { setState(await startLiveCaptions(token, conferenceId, language)); }
    catch (err) { setError(userMessage(err, "Couldn't start the live transcript.")); }
    finally { setBusy(false); }
  }

  /** While it's on: switch the spoken language (anyone in the meeting). */
  async function setLanguage(language: string) {
    setBusy(true);
    setError(null);
    try { setState(await startLiveCaptions(token, conferenceId, language)); }
    catch (err) { setError(userMessage(err, "Couldn't change the transcript language.")); }
    finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try { setState(await stopLiveCaptions(token, conferenceId)); }
    catch (err) { setError(userMessage(err, "Couldn't stop the live transcript.")); }
    finally { setBusy(false); }
  }

  return { state, available, segments, busy, error, setError, start, stop, setLanguage, languages };
}

/** The last couple of lines, over the call, fading out when people stop talking. */
export function CaptionsOverlay({ segments, starting }: { segments: CaptionSegment[]; starting: boolean }) {
  const [now, setNow] = useState(Date.now());
  const arrived = useRef(new Map<number, number>());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Age lines by when they reached this screen, so a clock difference between
  // server and laptop can't hide captions.
  for (const s of segments.slice(-OVERLAY_LINES)) {
    if (!arrived.current.has(s.id)) arrived.current.set(s.id, Date.now());
  }
  const visible = segments
    .slice(-OVERLAY_LINES)
    .filter(s => now - (arrived.current.get(s.id) ?? now) < OVERLAY_TTL_MS);

  if (!visible.length && !starting) return null;
  return (
    <div className="mtg-captions" aria-live="polite">
      {visible.length === 0 ? (
        <div className="mtg-caption-line muted">Live transcript is starting…</div>
      ) : visible.map(s => (
        <div key={s.id} className="mtg-caption-line">
          <span className="mtg-caption-name">{s.speaker_name || s.speaker_username}</span>
          <span>{s.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Full live transcript: search, copy, language and on/off (anyone in the meeting). */
export function TranscriptDrawer({
  segments, state, busy, error, onStart, onStop, onClose, available, languages, onLanguage,
}: {
  segments: CaptionSegment[];
  state: CaptionsState;
  busy: boolean;
  error: string | null;
  available: boolean;
  onStart: (language: string) => void;
  onStop: () => void;
  onClose: () => void;
  languages: CaptionLanguage[];
  onLanguage: (language: string) => void;
}) {
  const [query, setQuery] = useState('');
  // The host's pick before turning it on; once on, the server's value wins.
  const [chosen, setChosen] = useState('auto');
  const current = state.enabled ? (state.language || 'auto') : chosen;
  const languageName = (code: string) => languages.find(l => l.code === code)?.name ?? code;
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pinnedToBottom = useRef(true);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? segments.filter(s => s.text.toLowerCase().includes(q) || (s.speaker_name || '').toLowerCase().includes(q)) : segments;
  }, [segments, query]);

  // Follow new lines unless the reader scrolled up to look at something.
  useEffect(() => {
    const el = listRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  function copyAll() {
    const text = segments.map(s => `[${fmtTime(s.started_at)}] ${s.speaker_name || s.speaker_username}: ${s.text}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  const statusLine = state.enabled
    ? `${state.status === 'starting' ? 'Starting…' : `On${state.started_by ? ` · turned on by ${state.started_by}` : ''}`}${state.language && state.language !== 'auto' ? ` · ${languageName(state.language)}` : ''}`
    : 'Off';

  return (
    <div className="mtg-backdrop side" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mtg-sheet mtg-drawer" style={{ width: 'min(400px, 100vw)' }}>
        <div className="mtg-sheet-head">
          <div style={{ minWidth: 0 }}>
            <div className="mtg-sheet-title">Live transcript</div>
            <div className="mtg-sheet-sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {state.enabled && <span className="mtg-live-dot" style={state.status === 'starting' ? { background: '#f59e0b', boxShadow: 'none' } : undefined} />}
              {statusLine}
            </div>
          </div>
          <button className="mtg-x" onClick={onClose} title="Close"><CloseIcon size={15} color="#fff" /></button>
        </div>

        <div style={{ padding: '12px 20px 8px', display: 'flex', gap: 8 }}>
          <input className="mtg-input" placeholder="Search the transcript" value={query} onChange={e => setQuery(e.target.value)} />
          <button className="mtg-btn" onClick={copyAll} disabled={!segments.length} style={{ flexShrink: 0 }}>{copied ? 'Copied' : 'Copy'}</button>
        </div>

        <div
          ref={listRef}
          onScroll={e => {
            const el = e.currentTarget;
            pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {shown.length === 0 ? (
            <div className="mtg-sheet-sub" style={{ textAlign: 'center', marginTop: 40, lineHeight: 1.6 }}>
              {query
                ? `Nothing matches "${query}".`
                : state.enabled
                  ? 'Lines appear here a moment after each person finishes speaking.'
                  : available
                    ? 'Turn on the live transcript so everyone can follow along in text.'
                    : 'Live transcript isn’t available on this server yet.'}
            </div>
          ) : shown.map((s, i) => {
            const prev = shown[i - 1];
            const sameSpeaker = prev && prev.speaker_username === s.speaker_username;
            return (
              <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: sameSpeaker ? -6 : 0 }}>
                {!sameSpeaker && (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{s.speaker_name || s.speaker_username}</span>
                    <span className="mtg-person-tag">{fmtTime(s.started_at)}</span>
                  </div>
                )}
                <div style={{ fontSize: '0.86rem', lineHeight: 1.55, color: '#e9e2e1' }}>{s.text}</div>
              </div>
            );
          })}
        </div>

        {error && <div className="mtg-error" style={{ padding: '0 20px 8px' }}>{error}</div>}
        {state.error && !state.enabled && <div className="mtg-error" style={{ padding: '0 20px 8px' }}>{state.error}</div>}

        {available && (
          <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <label htmlFor="mtg-caption-lang" className="mtg-sheet-sub" style={{ marginTop: 0, flexShrink: 0 }}>Spoken language</label>
            <select
              id="mtg-caption-lang"
              className="mtg-input"
              value={current}
              disabled={busy}
              onChange={e => {
                const code = e.target.value;
                if (state.enabled) onLanguage(code); else setChosen(code);
              }}
              style={{ flex: 1 }}
            >
              {languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </div>
        )}

        {available && (
          <div className="mtg-sheet-foot">
            <span className="mtg-sheet-sub" style={{ marginTop: 0, flex: 1 }}>
              Transcribed on your organization’s server. Everyone in the meeting can see it.
            </span>
            {state.enabled
              ? <button className="mtg-btn danger" onClick={onStop} disabled={busy}>Turn off</button>
              : <button className="mtg-btn primary" onClick={() => onStart(chosen)} disabled={busy}>Turn on</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
