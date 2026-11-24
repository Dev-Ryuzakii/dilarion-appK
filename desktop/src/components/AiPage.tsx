import { useEffect, useRef, useState } from 'react';
import {
  AgentRun, AiConversation, AiMessage, AiStep, listConversations, createConversation, getConversation,
  deleteConversation, sendAiMessage, listAgentRuns, startAgent, approveAgent, cancelAgent, editAgentPlan, errText,
  getAiPreferences, setAiPreferences,
} from '../services/workspace';
import { presenceService, WsMessage } from '../services/presence';
import { AgentIcon, AlarmIcon, ArrowUpIcon, CalendarIcon, CheckIcon, CloseIcon, SparkleIcon, TaskIcon, WhiteboardIcon } from './Icons';

/**
 * Dilarion AI: its own page (replaces the floating copilot widget).
 * Left: chat history. Centre: the conversation. Right: agents you've sent out,
 * with their plan, approval and step-by-step results.
 */

/** Prefill for the existing New Meeting form. Never books the meeting itself. */
export interface CopilotScheduleDraft {
  title: string;
  scheduleWhen: string;    // datetime-local value
  scheduleEndWhen: string; // datetime-local value
  note: string | null;
  rawText: string;         // matched against real usernames to pre-select attendees
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function draftFromStep(s: AiStep): CopilotScheduleDraft | null {
  const d = (s.result as { draft?: { title?: string; scheduled_at?: string; duration_minutes?: number; participants?: string[] } } | undefined)?.draft;
  if (s.tool !== 'draft_meeting' || s.status !== 'done' || !d?.scheduled_at) return null;
  const start = new Date(d.scheduled_at);
  const end = new Date(start.getTime() + (d.duration_minutes || 30) * 60000);
  return { title: d.title || 'Meeting', scheduleWhen: toLocalInput(start), scheduleEndWhen: toLocalInput(end),
    note: 'Drafted by Dilarion AI. Check the details and attendees.', rawText: (d.participants || []).join(' ') };
}

const SUGGESTIONS = [
  { icon: <AlarmIcon />, title: 'Set a reminder', text: 'Remind me to send the weekly report every Friday at 4pm' },
  { icon: <TaskIcon />, title: 'Assign a task', text: 'Create a task for the ops team to review the vendor contracts by Thursday' },
  { icon: <WhiteboardIcon />, title: 'Fill a whiteboard', text: 'Add sticky notes for each phase of our product launch to the org whiteboard' },
  { icon: <CalendarIcon />, title: 'Draft a meeting', text: 'Draft a 30 minute sync with the design team tomorrow at 10am' },
];

const TOOL_LABEL: Record<string, string> = {
  create_reminder: 'Set reminder', create_task: 'Create task', add_whiteboard_note: 'Whiteboard note',
  draft_meeting: 'Draft meeting', find_people: 'Find people',
};

const STATUS_STYLE: Record<AgentRun['status'], { label: string; color: string }> = {
  planning: { label: 'Planning…', color: 'var(--accent)' },
  awaiting_approval: { label: 'Needs your approval', color: '#f59e0b' },
  running: { label: 'Working…', color: 'var(--accent)' },
  completed: { label: 'Done', color: '#16a34a' },
  failed: { label: 'Failed', color: '#dc2626' },
  cancelled: { label: 'Cancelled', color: '#71717a' },
};

export default function AiPage({ token, username, onMeetingDraft }: { token: string; username: string; onMeetingDraft: (d: CopilotScheduleDraft) => void }) {
  const [convs, setConvs] = useState<AiConversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [input, setInput] = useState('');
  const [agentMode, setAgentMode] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const [autoApprove, setAutoApprove] = useState(false);

  useEffect(() => {
    listConversations(token).then(setConvs).catch(e => setError(errText(e)));
    listAgentRuns(token).then(setRuns).catch(() => {});
    getAiPreferences(token).then(p => setAutoApprove(p.auto_approve)).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (activeId == null) { setMessages([]); return; }
    getConversation(token, activeId).then(c => setMessages(c.messages ?? [])).catch(e => setError(errText(e)));
  }, [token, activeId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length, sending]);

  useEffect(() => {
    const onMsg = (m: WsMessage) => {
      if (m.type !== 'ai_agent_progress' && m.type !== 'ai_agent_finished') return;
      const run = m.data as unknown as AgentRun;
      setRuns(prev => [run, ...prev.filter(r => r.id !== run.id)].sort((a, b) => b.id - a.id));
    };
    presenceService.addListener(onMsg);
    return () => presenceService.removeListener(onMsg);
  }, []);

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || sending) return;
    setError(''); setSending(true); setInput('');
    try {
      if (agentMode) {
        const run = await startAgent(token, text, true);
        setRuns(prev => [run, ...prev]);
        setAgentMode(false);
        return;
      }
      let id = activeId;
      if (id == null) {
        const c = await createConversation(token);
        id = c.id; setActiveId(c.id); setConvs(prev => [c, ...prev]);
      }
      setMessages(prev => [...prev, { id: -Date.now(), role: 'user', content: text, agent_run_id: null, created_at: null }]);
      const r = await sendAiMessage(token, id, text);
      setMessages(prev => [...prev.filter(m => m.id > 0), r.user_message, r.assistant_message]);
      setConvs(prev => prev.map(c => c.id === id ? { ...c, title: r.title } : c));
      if (r.agent_run) setRuns(prev => [r.agent_run!, ...prev.filter(x => x.id !== r.agent_run!.id)]);
    } catch (e) {
      setError(errText(e));
      setMessages(prev => prev.filter(m => m.id > 0));
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  function patchRun(run: AgentRun) { setRuns(prev => prev.map(r => r.id === run.id ? run : r)); }

  const runsById = Object.fromEntries(runs.map(r => [r.id, r]));
  const shownConvs = convs.filter(c => !query.trim() || c.title.toLowerCase().includes(query.trim().toLowerCase()));
  const pending = runs.filter(r => r.status === 'awaiting_approval').length;
  const firstName = username.charAt(0).toUpperCase() + username.slice(1);

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-base)' }}>
      {/* History */}
      <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border-color)', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '22px 14px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={aiBadge(26)}><SparkleIcon size={13} /></span>
            <span style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Dilarion AI</span>
          </div>
          <button onClick={() => { setActiveId(null); setAgentMode(false); }} style={{ width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-primary)', borderRadius: 10, padding: '9px 12px', fontSize: '0.84rem', fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            + New chat
          </button>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search chats" style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-primary)', borderRadius: 10, padding: '8px 12px', fontSize: '0.8rem', fontFamily: 'inherit', outline: 'none' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
          {shownConvs.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '6px 8px' }}>No chats yet</div>}
          {shownConvs.map(c => (
            <div key={c.id} className="ai-conv-row" style={{ display: 'flex', alignItems: 'center', borderRadius: 9, background: activeId === c.id ? 'var(--item-active-bg)' : 'transparent' }}>
              <button onClick={() => setActiveId(c.id)} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</button>
              <button title="Delete chat" onClick={() => {
                if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
                deleteConversation(token, c.id).then(() => { setConvs(prev => prev.filter(x => x.id !== c.id)); if (activeId === c.id) setActiveId(null); }).catch(e => setError(errText(e)));
              }} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 8px', fontSize: 13 }}>×</button>
            </div>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 28px 16px' }}>
            {messages.length === 0 && !sending ? (
              <div style={{ paddingTop: '8vh' }}>
                <span style={aiBadge(48)}><SparkleIcon size={24} /></span>
                <h1 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', margin: '18px 0 6px', color: 'var(--text-primary)' }}>Hi {firstName}, what can I do for you?</h1>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.92rem', marginBottom: 26 }}>
                  Ask anything, or send an agent to set reminders, assign tasks, fill whiteboards and draft meetings.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                  {SUGGESTIONS.map(s => (
                    <button key={s.title} onClick={() => { setInput(s.text); }} style={{ textAlign: 'left', border: '1px solid var(--border-color)', background: 'var(--bg-panel)', borderRadius: 14, padding: '14px 16px', cursor: 'pointer', fontFamily: 'inherit' }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', marginBottom: 10, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>{s.icon}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--text-primary)', marginBottom: 3 }}>{s.title}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{s.text}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {messages.map(m => (
                  <div key={m.id} style={{ display: 'flex', gap: 12, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    {m.role === 'assistant' && <span style={aiBadge(28)}><SparkleIcon size={14} /></span>}
                    <div style={{ maxWidth: '78%' }}>
                      <div style={{
                        padding: m.role === 'user' ? '10px 14px' : '4px 0', borderRadius: 16, whiteSpace: 'pre-wrap', fontSize: '0.92rem', lineHeight: 1.55,
                        background: m.role === 'user' ? 'var(--item-active-bg)' : 'transparent', color: 'var(--text-primary)',
                      }}>{m.content}</div>
                      {m.agent_run_id && runsById[m.agent_run_id] && (
                        <div style={{ marginTop: 10 }}>
                          <RunCard token={token} run={runsById[m.agent_run_id]} onChange={patchRun} onError={setError} onMeetingDraft={onMeetingDraft} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div style={{ display: 'flex', gap: 12 }}><span style={aiBadge(28)}><SparkleIcon size={14} /></span><span style={{ color: 'var(--text-muted)', fontSize: '0.88rem', paddingTop: 5 }}>Thinking…</span></div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: '0 28px 22px', boxSizing: 'border-box' }}>
          {error && <div style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: 8 }}>{error}</div>}
          <div style={{ border: `1px solid ${agentMode ? 'var(--accent)' : 'var(--border-color)'}`, background: 'var(--bg-panel)', borderRadius: 18, padding: '12px 14px 10px', boxShadow: '0 8px 24px rgba(0,0,0,0.06)' }}>
            <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={agentMode ? 'Describe the job for the agent…' : 'Ask Dilarion AI anything…'}
              style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', resize: 'none', color: 'var(--text-primary)', fontSize: '0.92rem', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
              <button onClick={() => setAgentMode(a => !a)} title="Send this as a job for an AI agent" style={{
                border: `1px solid ${agentMode ? 'var(--accent)' : 'var(--border-color)'}`, background: agentMode ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                color: agentMode ? 'var(--accent)' : 'var(--text-secondary)', borderRadius: 999, padding: '5px 12px', fontSize: '0.76rem', fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              }}><AgentIcon size={14} /> {agentMode ? 'Agent mode on' : 'Send as agent'}</button>
              <button onClick={() => send()} disabled={!input.trim() || sending} style={{
                width: 34, height: 34, borderRadius: '50%', border: 'none', cursor: input.trim() ? 'pointer' : 'default',
                background: input.trim() ? 'var(--accent)' : 'var(--border-color)', color: '#fff', display: 'grid', placeItems: 'center',
              }}><ArrowUpIcon size={16} /></button>
            </div>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
            Agents show you their plan before they act. Documents, sheets and slides are coming later.
          </div>
        </div>
      </div>

      {/* Agents */}
      <div style={{ width: 340, flexShrink: 0, borderLeft: '1px solid var(--border-color)', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '22px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>Agents</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{pending ? `${pending} waiting for approval` : 'Jobs you sent out'}</div>
          </div>
          <button onClick={() => setAgentMode(true)} style={{ border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 999, padding: '7px 12px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ New agent</button>
        </div>
        <label title="Agents act straight away without asking first. They can still only do what your role allows." style={{
          display: 'flex', alignItems: 'center', gap: 10, margin: '0 12px 12px', padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
          border: `1px solid ${autoApprove ? 'var(--accent)' : 'var(--border-color)'}`, background: autoApprove ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'var(--bg-base)',
        }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Full control</span>
            <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{autoApprove ? 'Agents run without asking' : 'Agents ask before they act'}</span>
          </span>
          <Switch on={autoApprove} onChange={v => { setAutoApprove(v); setAiPreferences(token, v).catch(e => { setAutoApprove(!v); setError(errText(e)); }); }} />
        </label>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {runs.length === 0 && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '20px 6px', lineHeight: 1.5 }}>
              No agents yet. Turn on “Send as agent” and describe a job, like “remind the team to submit timesheets Friday at 3pm”.
            </div>
          )}
          {runs.map(r => <RunCard key={r.id} token={token} run={r} onChange={patchRun} onError={setError} onMeetingDraft={onMeetingDraft} compact />)}
        </div>
      </div>
    </div>
  );
}

function RunCard({ token, run, onChange, onError, onMeetingDraft, compact }: { token: string; run: AgentRun; onChange: (r: AgentRun) => void; onError: (s: string) => void; onMeetingDraft: (d: CopilotScheduleDraft) => void; compact?: boolean }) {
  const [open, setOpen] = useState(!compact || run.status === 'awaiting_approval');
  const st = STATUS_STYLE[run.status];
  const steps: AiStep[] = run.steps?.length ? run.steps : run.plan ?? [];
  const act = (p: Promise<AgentRun>) => p.then(onChange).catch(e => onError(errText(e)));
  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 14, background: 'var(--bg-base)', overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '12px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: st.color }}>{st.label}</span>
        </div>
        <div style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--text-primary)', marginTop: 4 }}>{run.title || run.instruction}</div>
        {run.summary && open && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 3 }}>{run.summary}</div>}
      </button>
      {open && (
        <div style={{ padding: '0 14px 12px' }}>
          {run.error && <div style={{ fontSize: '0.78rem', color: '#dc2626', marginBottom: 8 }}>{run.error}</div>}
          {steps.length === 0 && run.status !== 'planning' && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>The agent couldn't find anything it can do for this yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.78rem', padding: '7px 9px', borderRadius: 9, background: 'var(--bg-panel)', border: '1px solid var(--border-color)' }}>
                <span style={{ flexShrink: 0, width: 16, textAlign: 'center', color: s.status === 'done' ? '#16a34a' : s.status === 'failed' ? '#dc2626' : 'var(--text-muted)' }}>
                  {s.status === 'done' ? <CheckIcon size={12} /> : s.status === 'failed' ? <CloseIcon size={12} /> : i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650, color: 'var(--text-primary)' }}>{TOOL_LABEL[s.tool] ?? s.tool}</div>
                  <div style={{ color: 'var(--text-muted)', wordBreak: 'break-word' }}>{describeArgs(s)}</div>
                  {s.error && <div style={{ color: '#dc2626', marginTop: 2 }}>{s.error}</div>}
                  {draftFromStep(s) && (
                    <button onClick={() => onMeetingDraft(draftFromStep(s)!)} style={{ marginTop: 6, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 7, padding: '5px 10px', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Open in scheduler</button>
                  )}
                </div>
                {run.status === 'awaiting_approval' && (
                  <button title="Remove this step" onClick={() => act(editAgentPlan(token, run.id, run.plan.filter((_, j) => j !== i)))}
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>×</button>
                )}
              </div>
            ))}
          </div>
          {(run.status === 'awaiting_approval' || run.status === 'planning' || run.status === 'running') && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {run.status === 'awaiting_approval' && run.plan.length > 0 && (
                <button onClick={() => act(approveAgent(token, run.id))} style={{ flex: 1, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 9, padding: '8px 0', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Approve & run</button>
              )}
              <button onClick={() => act(cancelAgent(token, run.id))} style={{ flex: run.status === 'awaiting_approval' ? 0 : 1, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: 9, padding: '8px 14px', fontSize: '0.8rem', fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={e => { e.preventDefault(); onChange(!on); }} style={{
      width: 36, height: 20, borderRadius: 999, border: 'none', padding: 2, cursor: 'pointer', flexShrink: 0,
      background: on ? 'var(--accent)' : 'var(--border-color)', transition: 'background .15s',
    }}>
      <span style={{ display: 'block', width: 16, height: 16, borderRadius: '50%', background: '#fff', transform: on ? 'translateX(16px)' : 'none', transition: 'transform .15s' }} />
    </button>
  );
}

/**
 * Always mounted (outside the AI page): when an agent is waiting for approval,
 * a card pops up wherever the user is, so they can approve on the spot.
 */
export function AgentApprovalPopup({ token, hidden, onOpen }: { token: string; hidden: boolean; onOpen: () => void }) {
  const [queue, setQueue] = useState<AgentRun[]>([]);
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onMsg = (m: WsMessage) => {
      if (m.type !== 'ai_agent_progress' && m.type !== 'ai_agent_finished') return;
      const run = m.data as unknown as AgentRun;
      setQueue(prev => {
        const rest = prev.filter(r => r.id !== run.id);
        if (run.status === 'awaiting_approval') return [...rest, run];
        // Keep the card briefly to show the outcome of a run approved from here.
        if (prev.some(r => r.id === run.id) && (run.status === 'running' || run.status === 'completed' || run.status === 'failed')) {
          if (run.status !== 'running') setTimeout(() => setQueue(q => q.filter(r => r.id !== run.id)), 4000);
          return prev.map(r => (r.id === run.id ? run : r));
        }
        return rest;
      });
    };
    presenceService.addListener(onMsg);
    return () => presenceService.removeListener(onMsg);
  }, []);

  const run = queue[0];
  if (!run || hidden) return null;
  const waiting = run.status === 'awaiting_approval';
  const st = STATUS_STYLE[run.status];
  const drop = () => setQueue(q => q.filter(r => r.id !== run.id));

  async function approve() {
    setBusy(true); setError('');
    try {
      if (always) await setAiPreferences(token, true);
      const r = await approveAgent(token, run.id);
      setQueue(q => q.map(x => (x.id === r.id ? r : x)));
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setError('');
    try { await cancelAgent(token, run.id); drop(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  const steps = run.steps?.length ? run.steps : run.plan;
  return (
    <div role="dialog" aria-label="Agent needs approval" style={{
      position: 'fixed', right: 18, bottom: 18, zIndex: 955, width: 360, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
      background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 16, boxShadow: '0 16px 40px rgba(0,0,0,0.25)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
        <span style={aiBadge(28)}><SparkleIcon size={14} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: st.color }}>{waiting ? 'Agent needs your approval' : st.label}</div>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.title || run.instruction}</div>
        </div>
        <button title="Hide" onClick={drop} style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'grid' }}><CloseIcon size={14} /></button>
      </div>
      <div style={{ overflowY: 'auto', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: '0.78rem', padding: '7px 9px', borderRadius: 9, background: 'var(--bg-base)', border: '1px solid var(--border-color)' }}>
            <span style={{ width: 16, flexShrink: 0, display: 'grid', placeItems: 'center', color: s.status === 'done' ? '#16a34a' : s.status === 'failed' ? '#dc2626' : 'var(--text-muted)' }}>
              {s.status === 'done' ? <CheckIcon size={12} /> : s.status === 'failed' ? <CloseIcon size={12} /> : i + 1}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650, color: 'var(--text-primary)' }}>{TOOL_LABEL[s.tool] ?? s.tool}</div>
              <div style={{ color: 'var(--text-muted)', wordBreak: 'break-word' }}>{describeArgs(s)}</div>
              {s.error && <div style={{ color: '#dc2626' }}>{s.error}</div>}
            </div>
          </div>
        ))}
        {steps.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>The agent didn't find anything it can do for this.</div>}
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: '0.78rem', padding: '8px 16px 0' }}>{error}</div>}
      {waiting ? (
        <div style={{ padding: '12px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={always} onChange={e => setAlways(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
            Always allow: give agents full control from now on
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {steps.length > 0 && <button disabled={busy} onClick={approve} style={{ flex: 1, border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 9, padding: '9px 0', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{busy ? 'Starting…' : 'Approve & run'}</button>}
            <button disabled={busy} onClick={cancel} style={{ border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: 9, padding: '9px 14px', fontSize: '0.82rem', fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={() => { onOpen(); drop(); }} style={{ border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: 9, padding: '9px 12px', fontSize: '0.82rem', fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit' }}>Review</button>
          </div>
        </div>
      ) : <div style={{ height: 14 }} />}
    </div>
  );
}

function describeArgs(s: AiStep): string {
  const a = s.args as Record<string, unknown>;
  const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  switch (s.tool) {
    case 'create_reminder': return `“${a.title}” · ${when(a.remind_at)}${a.for && a.for !== 'me' ? ` · for ${a.for}` : ''}`;
    case 'create_task': return `“${a.title}”${Array.isArray(a.assignees) && a.assignees.length ? ` → ${a.assignees.join(', ')}` : ''}${a.due_at ? ` · due ${when(a.due_at)}` : ''}`;
    case 'add_whiteboard_note': return `${a.board === 'org' ? 'Org board' : a.board}: “${a.text}”`;
    case 'draft_meeting': return `“${a.title}” · ${when(a.scheduled_at)}`;
    case 'find_people': return `Search “${a.query}”`;
    default: return JSON.stringify(a);
  }
}

function aiBadge(size: number): React.CSSProperties {
  return {
    width: size, height: size, borderRadius: size * 0.3, flexShrink: 0, display: 'inline-grid', placeItems: 'center',
    background: 'var(--accent)', color: '#fff',
  };
}
