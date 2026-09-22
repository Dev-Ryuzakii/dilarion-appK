import { useEffect, useMemo, useState } from 'react';
import {
  getMeetingCalendar, CalendarOccurrence, PersonalPlan, GoogleCalendarEvent,
  createPersonalPlan, deletePersonalPlan,
  getGoogleCalendarStatus, getGoogleCalendarAuthorizeUrl, unlinkGoogleCalendar, GoogleCalendarStatus,
} from '../services/api';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59); }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// Local-time "YYYY-MM-DDTHH:mm" for a <input type="datetime-local">, seeded from a given day.
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type DayItem =
  | { kind: 'meeting'; key: string; start: string; data: CalendarOccurrence }
  | { kind: 'plan'; key: string; start: string; data: PersonalPlan }
  | { kind: 'google'; key: string; start: string; data: GoogleCalendarEvent };

export default function CalendarView({
  token,
  onJoinMeeting,
}: {
  token: string;
  onJoinMeeting: (occ: CalendarOccurrence) => void;
}) {
  const [cursor, setCursor] = useState(new Date());
  const [occurrences, setOccurrences] = useState<CalendarOccurrence[]>([]);
  const [plans, setPlans] = useState<PersonalPlan[]>([]);
  const [googleEvents, setGoogleEvents] = useState<GoogleCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [reloadTick, setReloadTick] = useState(0);

  const [googleStatus, setGoogleStatus] = useState<GoogleCalendarStatus | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [showNewPlan, setShowNewPlan] = useState(false);
  const [planTitle, setPlanTitle] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [planStart, setPlanStart] = useState('');
  const [planSaving, setPlanSaving] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  // Grid always shows full weeks — pad from the Sunday before month start to
  // the Saturday after month end, matching every Teams/Google Calendar view.
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const gridEnd = addDays(monthEnd, 6 - monthEnd.getDay());

  useEffect(() => {
    setLoading(true);
    getMeetingCalendar(token, gridStart.toISOString(), gridEnd.toISOString())
      .then(feed => {
        setOccurrences(feed.occurrences);
        setPlans(feed.plans);
        setGoogleEvents(feed.google_events);
      })
      .catch(() => { setOccurrences([]); setPlans([]); setGoogleEvents([]); })
      .finally(() => setLoading(false));
  }, [token, monthStart.getTime(), reloadTick]);

  useEffect(() => {
    getGoogleCalendarStatus(token).then(setGoogleStatus).catch(() => {});
  }, [token, reloadTick]);

  const days = useMemo(() => {
    const arr: Date[] = [];
    let d = gridStart;
    while (d <= gridEnd) { arr.push(d); d = addDays(d, 1); }
    return arr;
  }, [gridStart.getTime(), gridEnd.getTime()]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, DayItem[]>();
    const push = (key: string, item: DayItem) => {
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    };
    for (const occ of occurrences) {
      push(new Date(occ.occurrence_start).toDateString(), { kind: 'meeting', key: `m-${occ.meeting_id}-${occ.occurrence_start}`, start: occ.occurrence_start, data: occ });
    }
    for (const plan of plans) {
      push(new Date(plan.starts_at).toDateString(), { kind: 'plan', key: `p-${plan.plan_id}`, start: plan.starts_at, data: plan });
    }
    for (const ev of googleEvents) {
      push(new Date(ev.occurrence_start).toDateString(), { kind: 'google', key: `g-${ev.google_event_id}`, start: ev.occurrence_start, data: ev });
    }
    return map;
  }, [occurrences, plans, googleEvents]);

  const selectedItems = (itemsByDay.get(selectedDay.toDateString()) ?? []).sort((a, b) => a.start.localeCompare(b.start));
  const today = new Date();

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!planTitle.trim() || !planStart) return;
    setPlanSaving(true);
    setPlanError(null);
    try {
      await createPersonalPlan(token, {
        title: planTitle.trim(),
        notes: planNotes.trim() || undefined,
        starts_at: new Date(planStart).toISOString(),
      });
      setShowNewPlan(false);
      setPlanTitle('');
      setPlanNotes('');
      setReloadTick(t => t + 1);
    } catch (err: any) {
      setPlanError(err?.message || 'Failed to create plan');
    } finally {
      setPlanSaving(false);
    }
  }

  async function handleDeletePlan(planId: number) {
    try {
      await deletePersonalPlan(token, planId);
      setReloadTick(t => t + 1);
    } catch {}
  }

  async function handleLinkGoogle() {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      const url = await getGoogleCalendarAuthorizeUrl(token);
      window.open(url, '_blank');
    } catch (err: any) {
      setGoogleError(err?.message || 'Google Calendar linking is not available');
    } finally {
      setGoogleBusy(false);
    }
  }

  async function handleUnlinkGoogle() {
    setGoogleBusy(true);
    try {
      await unlinkGoogleCalendar(token);
      setReloadTick(t => t + 1);
    } catch {} finally {
      setGoogleBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, minWidth: 0 }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {googleStatus?.linked ? (
              <button onClick={handleUnlinkGoogle} disabled={googleBusy} title={googleStatus.google_email || undefined} style={{ ...navBtnStyle, color: '#25d366', borderColor: '#25d366' }}>
                {googleBusy ? '…' : 'Google Calendar linked ✓'}
              </button>
            ) : (
              <button onClick={handleLinkGoogle} disabled={googleBusy} style={navBtnStyle}>
                {googleBusy ? 'Opening…' : 'Link Google Calendar'}
              </button>
            )}
            <button onClick={() => { setPlanStart(toLocalInputValue(selectedDay)); setShowNewPlan(true); setPlanError(null); }} style={{ ...navBtnStyle, background: 'var(--accent)', color: '#fff', border: 'none' }}>
              + New plan
            </button>
            <button onClick={() => { setCursor(new Date()); setSelectedDay(new Date()); }} style={navBtnStyle}>Today</button>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={navBtnStyle}>‹</button>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={navBtnStyle}>›</button>
          </div>
        </div>
        {googleError && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: -10, marginBottom: 10 }}>{googleError}</p>}

        {/* Weekday header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {WEEKDAY_LABELS.map(w => (
            <div key={w} style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700, padding: '4px 0' }}>{w}</div>
          ))}
        </div>

        {/* Month grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 4, flex: 1, minHeight: 0 }}>
          {days.map(day => {
            const inMonth = day.getMonth() === cursor.getMonth();
            const isToday = isSameDay(day, today);
            const isSelected = isSameDay(day, selectedDay);
            const dayItems = itemsByDay.get(day.toDateString()) ?? [];
            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelectedDay(day)}
                style={{
                  textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2,
                  background: isSelected ? 'var(--item-active-bg)' : 'transparent',
                  border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                  borderRadius: 8, padding: 6, cursor: 'pointer', overflow: 'hidden',
                  opacity: inMonth ? 1 : 0.4,
                }}
              >
                <span style={{
                  fontSize: '0.75rem', fontWeight: isToday ? 800 : 500,
                  color: isToday ? 'var(--accent)' : 'var(--text-primary)',
                }}>
                  {day.getDate()}
                </span>
                {dayItems.slice(0, 2).map(item => (
                  <span key={item.key} style={{
                    fontSize: '0.62rem',
                    background: item.kind === 'meeting' ? 'var(--accent)' : item.kind === 'plan' ? '#7c3aed' : '#0891b2',
                    color: '#fff', borderRadius: 4,
                    padding: '1px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.kind === 'meeting' ? (item.data.title || 'Meeting') : item.data.title}
                  </span>
                ))}
                {dayItems.length > 2 && (
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>+{dayItems.length - 2} more</span>
                )}
              </button>
            );
          })}
        </div>
        {loading && <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 8 }}>Loading…</p>}
      </div>

      {/* Selected day panel */}
      <div style={{ width: 300, borderLeft: '1px solid var(--border-color)', padding: 20, flexShrink: 0, overflowY: 'auto' }}>
        <h3 style={{ margin: 0, marginBottom: 14, fontSize: '0.95rem', fontWeight: 700 }}>
          {selectedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </h3>
        {selectedItems.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Nothing scheduled.</p>
        ) : (
          selectedItems.map(item => {
            if (item.kind === 'meeting') {
              const occ = item.data;
              return (
                <button
                  key={item.key}
                  onClick={() => onJoinMeeting(occ)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)', borderRadius: 10, padding: 12, marginBottom: 8, cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{occ.title || 'Meeting'}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {new Date(occ.occurrence_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {occ.duration_minutes}min
                    {occ.recurrence && ` · repeats ${occ.recurrence}`}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>Host: {occ.creator_username}</div>
                </button>
              );
            }
            if (item.kind === 'plan') {
              const plan = item.data;
              return (
                <div key={item.key} style={{ background: 'var(--bg-card)', border: '1px solid #7c3aed', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{plan.title}</div>
                    <button onClick={() => handleDeletePlan(plan.plan_id)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', flexShrink: 0 }}>✕</button>
                  </div>
                  {!plan.all_day && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {new Date(plan.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  {plan.notes && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{plan.notes}</div>}
                  <div style={{ fontSize: '0.68rem', color: '#7c3aed', marginTop: 4, fontWeight: 600 }}>Personal plan</div>
                </div>
              );
            }
            const ev = item.data;
            return (
              <div key={item.key} style={{ background: 'var(--bg-card)', border: '1px solid #0891b2', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{ev.title}</div>
                {!ev.all_day && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {new Date(ev.occurrence_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
                {ev.location && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{ev.location}</div>}
                <div style={{ fontSize: '0.68rem', color: '#0891b2', marginTop: 4, fontWeight: 600 }}>Google Calendar</div>
              </div>
            );
          })
        )}
      </div>

      {showNewPlan && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewPlan(false); }}
        >
          <form onSubmit={handleCreatePlan} style={{ width: 340, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>New personal plan</div>
            <input
              autoFocus
              value={planTitle}
              onChange={e => setPlanTitle(e.target.value)}
              placeholder="Title"
              required
              style={inputStyle}
            />
            <input
              type="datetime-local"
              value={planStart}
              onChange={e => setPlanStart(e.target.value)}
              required
              style={inputStyle}
            />
            <textarea
              value={planNotes}
              onChange={e => setPlanNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
            {planError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{planError}</span>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowNewPlan(false)} style={{ ...navBtnStyle, background: 'transparent' }}>Cancel</button>
              <button type="submit" disabled={planSaving || !planTitle.trim() || !planStart} style={{ ...navBtnStyle, background: 'var(--accent)', color: '#fff', border: 'none', opacity: planSaving ? 0.6 : 1 }}>
                {planSaving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8,
  color: 'var(--text-primary)', padding: '6px 12px', fontSize: '0.78rem', cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)', border: '1px solid var(--border-color)',
  borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.85rem', padding: '8px 12px',
};
