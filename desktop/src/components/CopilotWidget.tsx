import { useEffect, useRef, useState } from 'react';
import { parseScheduleCopilot } from '../services/api';
import { CloseIcon, SparkleIcon, CheckIcon } from './Icons';

export interface CopilotScheduleDraft {
  title: string;
  scheduleWhen: string;    // datetime-local value
  scheduleEndWhen: string; // datetime-local value
  note: string | null;
  rawText: string; // what the user typed — caller matches it against real usernames to pre-select attendees; never sent anywhere as an invite by itself
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  draft?: CopilotScheduleDraft;
  used?: boolean;
}

/**
 * Floating, always-reachable copilot — a chat bubble, not a form buried in a
 * menu. Right now it only does one thing (turn a scheduling sentence into a
 * prefilled New Meeting draft), so it says so up front rather than pretending
 * to be a general assistant. Never creates a meeting itself: "Use this" hands
 * the draft to the caller, which opens the real form — attendees and final
 * confirmation always go through that, same as typing it in by hand.
 */
export default function CopilotWidget({ token, onScheduleDraft }: {
  token: string;
  onScheduleDraft: (draft: CopilotScheduleDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', text: "Hi! Tell me about a meeting and I'll draft it — e.g. \"call with the team tomorrow at 3 for 30 min\"." },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setMessages(prev => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    setLoading(true);
    try {
      const result = await parseScheduleCopilot(token, trimmed);
      const start = new Date(result.scheduled_at);
      if (Number.isNaN(start.getTime())) throw new Error("I got a time back but couldn't parse it — try rephrasing.");
      const end = new Date(start.getTime() + result.duration_minutes * 60000);
      const pad = (n: number) => String(n).padStart(2, '0');
      const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const draft: CopilotScheduleDraft = {
        title: result.title,
        scheduleWhen: toLocalInput(start),
        scheduleEndWhen: toLocalInput(end),
        note: result.confidence === 'low' ? (result.note || "Wasn't fully sure about this one.") : null,
        rawText: trimmed,
      };
      const summary = `${result.title} — ${start.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${result.duration_minutes}m)`;
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: result.confidence === 'low'
          ? `Here's my best guess: ${summary}. ${draft.note}`
          : `Got it: ${summary}.`,
        draft,
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: err?.message || "Something went wrong — try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function useDraft(index: number, draft: CopilotScheduleDraft) {
    onScheduleDraft(draft);
    setMessages(prev => prev.map((m, i) => (i === index ? { ...m, used: true } : m)));
    setOpen(false);
  }

  return (
    <>
      {open && (
        <div style={{
          position: 'fixed', bottom: 92, right: 24, width: 340, height: 460, zIndex: 960,
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 16,
          boxShadow: '0 16px 48px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 16px', borderBottom: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <SparkleIcon size={16} color="var(--accent)" />
            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1 }}>Copilot</span>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
            ><CloseIcon size={16} color="var(--text-muted)" /></button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '88%', padding: '9px 12px', borderRadius: 12, fontSize: '0.82rem', lineHeight: 1.4,
                  background: m.role === 'user' ? 'var(--accent)' : 'var(--input-field-bg)',
                  color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                }}>
                  {m.text}
                </div>
                {m.draft && !m.used && (
                  <button
                    onClick={() => useDraft(i, m.draft!)}
                    style={{
                      marginTop: 6, background: 'var(--accent)', color: '#fff', border: 'none',
                      borderRadius: 8, padding: '7px 14px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
                    }}
                  >Use this — pick attendees</button>
                )}
                {m.draft && m.used && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckIcon size={11} color="var(--text-muted)" /> Opened in the schedule form
                  </span>
                )}
              </div>
            ))}
            {loading && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Thinking…</div>
            )}
          </div>

          <div style={{ padding: 10, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 8 }}>
            <input
              autoFocus
              placeholder="Ask copilot to schedule something…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              disabled={loading}
              style={{
                flex: 1, background: 'var(--input-field-bg)', border: '1px solid var(--border-color)',
                borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.82rem', padding: '8px 10px',
              }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              style={{
                background: !input.trim() ? 'var(--input-field-bg)' : 'var(--accent)',
                color: !input.trim() ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 8,
                padding: '0 14px', fontSize: '0.82rem', fontWeight: 700, cursor: !input.trim() || loading ? 'default' : 'pointer',
              }}
            >Send</button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        title="Copilot"
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 961,
          width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}
      >
        {open ? <CloseIcon size={22} color="#fff" /> : <SparkleIcon size={22} color="#fff" />}
      </button>
    </>
  );
}
