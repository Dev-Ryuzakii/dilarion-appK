import { useEffect, useMemo, useState } from 'react';
import {
  Reminder, Recurrence, listReminders, createReminder, updateReminder, snoozeReminder,
  completeReminder, dismissReminder, deleteReminder, errText,
} from '../services/workspace';
import { presenceService, WsMessage } from '../services/presence';

/** Personal alarms: "remind me to do X at Y". Separate from Calendar and Tasks. */

type Filter = 'upcoming' | 'done' | 'all';

const RECURRENCE_LABEL: Record<string, string> = {
  daily: 'Every day', weekdays: 'Weekdays', weekly: 'Every week', monthly: 'Every month',
};

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function quickTimes(): Array<[string, Date]> {
  const now = new Date();
  const inHour = new Date(now.getTime() + 60 * 60 * 1000);
  const tonight = new Date(now); tonight.setHours(20, 0, 0, 0);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date(now); monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7)); monday.setHours(9, 0, 0, 0);
  const out: Array<[string, Date]> = [['In 1 hour', inHour]];
  if (tonight > now) out.push(['Tonight 8pm', tonight]);
  out.push(['Tomorrow 9am', tomorrow], ['Next Monday', monday]);
  return out;
}

function dayLabel(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: diff > 300 ? 'numeric' : undefined });
}

const btn: React.CSSProperties = {
  border: '1px solid var(--border-color)', background: 'var(--bg-panel)', color: 'var(--text-secondary)',
  borderRadius: 8, padding: '6px 10px', fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

export default function RemindersPanel({ token }: { token: string }) {
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [showForm, setShowForm] = useState(false);

  function reload() {
    listReminders(token).then(setItems).catch(e => setError(errText(e))).finally(() => setLoading(false));
  }
  useEffect(() => { reload(); }, [token]);
  useEffect(() => {
    const onMsg = (m: WsMessage) => { if (m.type === 'reminder_due') reload(); };
    presenceService.addListener(onMsg);
    return () => presenceService.removeListener(onMsg);
  }, [token]);

  const shown = useMemo(() => {
    const list = items.filter(r =>
      filter === 'all' ? true : filter === 'done' ? (r.status === 'done' || r.status === 'dismissed') : (r.status === 'scheduled' || r.status === 'fired'));
    return list.sort((a, b) => +new Date(a.remind_at) - +new Date(b.remind_at));
  }, [items, filter]);

  const groups = useMemo(() => {
    const m = new Map<string, Reminder[]>();
    for (const r of shown) {
      const label = r.status === 'fired' ? 'Needs attention' : dayLabel(new Date(r.remind_at));
      m.set(label, [...(m.get(label) || []), r]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === 'Needs attention' ? -1 : b === 'Needs attention' ? 1 : 0));
  }, [shown]);

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try { await fn(); reload(); } catch (e) { setError(errText(e)); }
  }

  const upcomingCount = items.filter(r => r.status === 'scheduled' || r.status === 'fired').length;

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-base)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 28px 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>Reminders</h2>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {upcomingCount} upcoming · Dilarion alerts you on every signed-in device
            </div>
          </div>
          <button onClick={() => { setEditing(null); setShowForm(true); }} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 999, padding: '9px 16px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            + New reminder
          </button>
        </div>

        <div style={{ display: 'flex', gap: 2, marginBottom: 18, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 3, width: 'fit-content' }}>
          {([['upcoming', 'Upcoming'], ['done', 'Done'], ['all', 'All']] as Array<[Filter, string]>).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)} style={{
              border: 'none', borderRadius: 9, padding: '7px 14px', fontSize: '0.8rem', fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit',
              background: filter === f ? 'var(--item-active-bg)' : 'transparent', color: filter === f ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>{label}</button>
          ))}
        </div>

        {error && <div style={{ color: '#dc2626', fontSize: '0.82rem', marginBottom: 12 }}>{error}</div>}

        {showForm && (
          <ReminderForm
            initial={editing}
            onCancel={() => { setShowForm(false); setEditing(null); }}
            onSave={async (data) => {
              await act(async () => {
                if (editing) {
                  await updateReminder(token, editing.id, { title: data.title, remind_at: data.remind_at, note: data.note ?? '', clear_recurrence: data.recurrence === null, recurrence: data.recurrence ?? undefined });
                } else {
                  await createReminder(token, data);
                }
              });
              setShowForm(false); setEditing(null);
            }}
          />
        )}

        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>⏰</div>
            <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {filter === 'done' ? 'Nothing finished yet' : 'No reminders'}
            </div>
            <div style={{ fontSize: '0.82rem' }}>Set one and Dilarion will alert you at the exact time.</div>
          </div>
        ) : groups.map(([label, list]) => (
          <div key={label} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 750, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
              color: label === 'Needs attention' || label === 'Overdue' ? 'var(--accent)' : 'var(--text-muted)' }}>{label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map(r => {
                const at = new Date(r.remind_at);
                const finished = r.status === 'done' || r.status === 'dismissed';
                return (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14,
                    background: 'var(--bg-panel)', border: `1px solid ${r.status === 'fired' ? 'var(--accent)' : 'var(--border-color)'}`,
                    opacity: finished ? 0.6 : 1,
                  }}>
                    <button title={finished ? 'Done' : 'Mark done'} onClick={() => !finished && act(() => completeReminder(token, r.id))} style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1, cursor: finished ? 'default' : 'pointer',
                      border: `2px solid ${finished ? '#16a34a' : 'var(--border-color)'}`, background: r.status === 'done' ? '#16a34a' : 'transparent',
                      color: '#fff', fontSize: 12, lineHeight: '16px', padding: 0,
                    }}>{r.status === 'done' ? '✓' : ''}</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 650, color: 'var(--text-primary)', fontSize: '0.92rem', textDecoration: r.status === 'done' ? 'line-through' : 'none' }}>{r.title}</div>
                      {r.note && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{r.note}</div>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        <span>{at.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                        {r.recurrence && <span>· {RECURRENCE_LABEL[r.recurrence]}</span>}
                        {r.snooze_count > 0 && <span>· snoozed {r.snooze_count}×</span>}
                        {r.source === 'ai_agent' && <span style={{ color: 'var(--accent)' }}>· set by Dilarion AI</span>}
                      </div>
                    </div>
                    {!finished && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {r.status === 'fired' && <button style={btn} onClick={() => act(() => snoozeReminder(token, r.id, 10))}>Snooze 10m</button>}
                        <button style={btn} onClick={() => { setEditing(r); setShowForm(true); }}>Edit</button>
                        <button style={btn} onClick={() => act(() => dismissReminder(token, r.id))}>Dismiss</button>
                      </div>
                    )}
                    {finished && (
                      <button style={btn} onClick={() => act(() => deleteReminder(token, r.id))}>Delete</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReminderForm({ initial, onCancel, onSave }: {
  initial: Reminder | null;
  onCancel: () => void;
  onSave: (d: { title: string; remind_at: string; note: string | null; recurrence: Recurrence }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [when, setWhen] = useState(toLocalInput(initial ? new Date(initial.remind_at) : new Date(Date.now() + 3600_000)));
  const [recurrence, setRecurrence] = useState<Recurrence>(initial?.recurrence ?? null);
  const [saving, setSaving] = useState(false);
  const input: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-primary)',
    borderRadius: 10, padding: '10px 12px', fontSize: '0.86rem', fontFamily: 'inherit', outline: 'none',
  };
  const valid = title.trim() && when;
  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 18, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Remind me to…" style={{ ...input, fontSize: '0.95rem', fontWeight: 600 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {quickTimes().map(([label, d]) => (
          <button key={label} onClick={() => setWhen(toLocalInput(d))} style={{ ...btn, background: when === toLocalInput(d) ? 'var(--item-active-bg)' : 'var(--bg-panel)' }}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} style={{ ...input, flex: 2 }} />
        <select value={recurrence ?? ''} onChange={e => setRecurrence((e.target.value || null) as Recurrence)} style={{ ...input, flex: 1 }}>
          <option value="">Does not repeat</option>
          {Object.entries(RECURRENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" rows={2} style={{ ...input, resize: 'vertical' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button style={btn} onClick={onCancel}>Cancel</button>
        <button disabled={!valid || saving} onClick={async () => {
          setSaving(true);
          try { await onSave({ title: title.trim(), remind_at: new Date(when).toISOString(), note: note.trim() || null, recurrence }); }
          finally { setSaving(false); }
        }} style={{ ...btn, background: 'var(--accent)', color: '#fff', border: 'none', opacity: valid ? 1 : 0.5 }}>
          {saving ? 'Saving…' : initial ? 'Save' : 'Set reminder'}
        </button>
      </div>
    </div>
  );
}

/** Always mounted: pops an alert card (and an OS notification) when a reminder fires. */
export function ReminderAlerts({ token, onOpen }: { token: string; onOpen: () => void }) {
  const [due, setDue] = useState<Reminder[]>([]);
  useEffect(() => {
    const onMsg = (m: WsMessage) => {
      if (m.type !== 'reminder_due' || !m.data) return;
      const r = m.data as unknown as Reminder;
      setDue(prev => [...prev.filter(x => x.id !== r.id), r].slice(-3));
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Reminder', { body: r.title });
      } catch { /* unavailable */ }
    };
    presenceService.addListener(onMsg);
    return () => presenceService.removeListener(onMsg);
  }, []);
  if (!due.length) return null;
  const drop = (id: number) => setDue(prev => prev.filter(x => x.id !== id));
  return (
    <div style={{ position: 'fixed', top: 18, right: 18, zIndex: 960, display: 'flex', flexDirection: 'column', gap: 10, width: 320 }}>
      {due.map(r => (
        <div key={r.id} role="alert" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderLeft: '4px solid var(--accent)', borderRadius: 14, padding: '14px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.22)' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 750, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)' }}>⏰ Reminder</div>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', margin: '4px 0 2px' }}>{r.title}</div>
          {r.note && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{r.note}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button style={btn} onClick={() => { completeReminder(token, r.id).catch(() => {}); drop(r.id); }}>Done</button>
            <button style={btn} onClick={() => { snoozeReminder(token, r.id, 10).catch(() => {}); drop(r.id); }}>Snooze 10m</button>
            <button style={btn} onClick={() => { onOpen(); drop(r.id); }}>Open</button>
          </div>
        </div>
      ))}
    </div>
  );
}
