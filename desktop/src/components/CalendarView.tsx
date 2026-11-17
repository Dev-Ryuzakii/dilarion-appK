import { useEffect, useMemo, useState } from 'react';
import { isTauri } from '../services/platform';

// Open a URL in the user's real system browser. Inside the desktop app a plain
// window.open does nothing (no browser context), so use Tauri's opener plugin;
// on the web build fall back to a normal new tab.
async function openExternal(url: string) {
  if (isTauri()) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    } catch {
      // fall through to window.open as a last resort
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
import {
  getMeetingCalendar, CalendarOccurrence, PersonalPlan, GoogleCalendarEvent,
  createPersonalPlan, deletePersonalPlan,
  getGoogleCalendarStatus, getGoogleCalendarAuthorizeUrl, unlinkGoogleCalendar, GoogleCalendarStatus,
} from '../services/api';
import { userMessage } from '../services/errors';

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
      setPlanError(userMessage(err, "Couldn't create that plan. Please try again."));
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
      await openExternal(url);
    } catch (err: any) {
      setGoogleError(userMessage(err, "Couldn't link Google Calendar right now. Please try again."));
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

  const kindColor = (k: string) => (k === 'meeting' ? 'var(--accent)' : k === 'plan' ? '#7c3aed' : '#0891b2');
  const kindSoft = (k: string) => (k === 'meeting' ? 'rgba(216,52,40,0.10)' : k === 'plan' ? 'rgba(124,58,237,0.10)' : 'rgba(8,145,178,0.10)');
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const openNewPlan = () => { setPlanStart(toLocalInputValue(selectedDay)); setShowNewPlan(true); setPlanError(null); };

  return (
    <div className="calendar-layout" style={{ display: 'flex', height: '100%', background: 'var(--bg-base)' }}>
      <div className="calendar-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '22px 24px', minWidth: 0 }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
              {cursor.toLocaleDateString(undefined, { month: 'long' })}{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{cursor.getFullYear()}</span>
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
              <button aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={roundBtn}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={roundBtn}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
              <button onClick={() => { setCursor(new Date()); setSelectedDay(new Date()); }} style={{ ...pillBtn, marginLeft: 4 }}>Today</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {googleStatus?.linked ? (
              <button onClick={handleUnlinkGoogle} disabled={googleBusy} title={`${googleStatus.google_email || 'Google Calendar'} — click to unlink`} style={pillBtn}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block', marginRight: 6 }} />
                {googleBusy ? '…' : 'Google linked'}
              </button>
            ) : (
              <button onClick={handleLinkGoogle} disabled={googleBusy} style={pillBtn}>
                {googleBusy ? 'Opening…' : 'Link Google Calendar'}
              </button>
            )}
            <button onClick={openNewPlan} style={{ ...pillBtn, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', fontWeight: 700 }}>
              + New plan
            </button>
          </div>
        </div>
        {googleError && <p style={{ color: 'var(--accent)', fontSize: '0.75rem', marginTop: -10, marginBottom: 10 }}>{googleError}</p>}

        {/* Month grid: one bordered sheet, hairline grid lines */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border-color)' }}>
            {WEEKDAY_LABELS.map(w => (
              <div key={w} style={{ textAlign: 'center', fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 0' }}>{w}</div>
            ))}
          </div>
          <div className="calendar-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 1, background: 'var(--border-color)', flex: 1, minHeight: 0 }}>
            {days.map(day => {
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = isSameDay(day, today);
              const isSelected = isSameDay(day, selectedDay);
              const dayItems = itemsByDay.get(day.toDateString()) ?? [];
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDay(day)}
                  onDoubleClick={() => { setSelectedDay(day); setPlanStart(toLocalInputValue(day)); setShowNewPlan(true); setPlanError(null); }}
                  style={{
                    textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0,
                    background: isSelected ? 'rgba(216,52,40,0.06)' : inMonth ? 'var(--bg-panel)' : 'var(--bg-base)',
                    border: 'none', boxShadow: isSelected ? 'inset 0 0 0 2px var(--accent)' : 'none',
                    padding: '6px 6px 4px', cursor: 'pointer', overflow: 'hidden', fontFamily: 'inherit',
                  }}
                >
                  <span style={{
                    alignSelf: 'flex-start', minWidth: 24, height: 24, borderRadius: 12, padding: '0 6px', boxSizing: 'border-box',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.76rem', fontWeight: isToday ? 800 : 600,
                    background: isToday ? 'var(--accent)' : 'transparent',
                    color: isToday ? '#fff' : inMonth ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}>
                    {day.getDate()}
                  </span>
                  {dayItems.slice(0, 2).map(item => (
                    <span key={item.key} style={{
                      display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
                      fontSize: '0.66rem', fontWeight: 600, color: 'var(--text-primary)',
                      background: kindSoft(item.kind), borderRadius: 6, padding: '2px 6px',
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: kindColor(item.kind), flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.kind === 'meeting' ? (item.data.title || 'Meeting') : item.data.title}
                      </span>
                    </span>
                  ))}
                  {dayItems.length > 2 && (
                    <span style={{ fontSize: '0.64rem', fontWeight: 600, color: 'var(--text-muted)', paddingLeft: 6 }}>+{dayItems.length - 2} more</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {[['meeting', 'Meetings'], ['plan', 'Personal plans'], ['google', 'Google Calendar']].map(([k, label]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: kindColor(k) }} />{label}
            </span>
          ))}
          {loading && <span style={{ marginLeft: 'auto' }}>Loading…</span>}
        </div>
      </div>

      {/* Selected day agenda */}
      <div className="calendar-detail" style={{ width: 310, borderLeft: '1px solid var(--border-color)', background: 'var(--bg-panel)', padding: '22px 20px', flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 52, height: 56, borderRadius: 14, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: isSameDay(selectedDay, today) ? 'var(--accent)' : 'var(--bg-base)', border: '1px solid var(--border-color)',
            color: isSameDay(selectedDay, today) ? '#fff' : 'var(--text-primary)',
          }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.85 }}>
              {selectedDay.toLocaleDateString(undefined, { weekday: 'short' })}
            </span>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1 }}>{selectedDay.getDate()}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>
              {isSameDay(selectedDay, today) ? 'Today' : selectedDay.toLocaleDateString(undefined, { weekday: 'long' })}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {selectedDay.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
              {selectedItems.length > 0 && ` · ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>

        {selectedItems.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 10, padding: '30px 10px' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(216,52,40,0.08)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="3" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Nothing scheduled</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: 220 }}>Your meetings, plans and Google events for this day show up here.</div>
            <button onClick={openNewPlan} style={{ ...pillBtn, marginTop: 4 }}>+ Add a plan</button>
          </div>
        ) : (
          selectedItems.map(item => {
            const card: React.CSSProperties = {
              display: 'flex', gap: 12, width: '100%', textAlign: 'left', background: 'var(--bg-panel)',
              border: '1px solid var(--border-color)', borderRadius: 14, padding: '12px 12px 12px 0', marginBottom: 10,
              overflow: 'hidden', fontFamily: 'inherit',
            };
            const bar = (k: string) => <span style={{ width: 4, alignSelf: 'stretch', borderRadius: '0 4px 4px 0', background: kindColor(k), flexShrink: 0 }} />;
            const tag = (k: string, label: string) => (
              <span style={{ display: 'inline-block', marginTop: 8, fontSize: '0.64rem', fontWeight: 700, color: kindColor(k), background: kindSoft(k), borderRadius: 999, padding: '2px 8px' }}>{label}</span>
            );
            if (item.kind === 'meeting') {
              const occ = item.data;
              return (
                <button key={item.key} onClick={() => onJoinMeeting(occ)} style={{ ...card, cursor: 'pointer' }}>
                  {bar('meeting')}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)' }}>{timeOf(occ.occurrence_start)} · {occ.duration_minutes} min</div>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', marginTop: 2 }}>{occ.title || 'Meeting'}</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      Host {occ.creator_username}{occ.recurrence ? ` · repeats ${occ.recurrence}` : ''}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      {tag('meeting', 'Meeting')}
                      <span style={{ marginTop: 8, fontSize: '0.72rem', fontWeight: 700, color: '#fff', background: 'var(--accent)', borderRadius: 999, padding: '4px 12px' }}>Join</span>
                    </div>
                  </div>
                </button>
              );
            }
            if (item.kind === 'plan') {
              const plan = item.data;
              return (
                <div key={item.key} style={card}>
                  {bar('plan')}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed' }}>{plan.all_day ? 'All day' : timeOf(plan.starts_at)}</div>
                      <button onClick={() => handleDeletePlan(plan.plan_id)} title="Delete plan" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0, padding: 0 }}>✕</button>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', marginTop: 2 }}>{plan.title}</div>
                    {plan.notes && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>{plan.notes}</div>}
                    {tag('plan', 'Personal plan')}
                  </div>
                </div>
              );
            }
            const ev = item.data;
            return (
              <div key={item.key} style={card}>
                {bar('google')}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0891b2' }}>{ev.all_day ? 'All day' : timeOf(ev.occurrence_start)}</div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', marginTop: 2 }}>{ev.title}</div>
                  {ev.location && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>{ev.location}</div>}
                  {tag('google', 'Google Calendar')}
                </div>
              </div>
            );
          })
        )}
      </div>

      {showNewPlan && (
        <div
          className="responsive-overlay"
          style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewPlan(false); }}
        >
          <form className="responsive-dialog" onSubmit={handleCreatePlan} style={{ width: 380, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 18, padding: 22, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.18)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: 'rgba(124,58,237,0.10)', color: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="3" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" /></svg>
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>New personal plan</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Only you can see this</div>
              </div>
            </div>
            <label style={labelStyle}>Title
              <input autoFocus value={planTitle} onChange={e => setPlanTitle(e.target.value)} placeholder="e.g. Prepare quarterly report" required style={inputStyle} />
            </label>
            <label style={labelStyle}>Starts
              <input type="datetime-local" value={planStart} onChange={e => setPlanStart(e.target.value)} required style={inputStyle} />
            </label>
            <label style={labelStyle}>Notes
              <textarea value={planNotes} onChange={e => setPlanNotes(e.target.value)} placeholder="Optional" rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            </label>
            {planError && <span style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>{planError}</span>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="button" onClick={() => setShowNewPlan(false)} style={pillBtn}>Cancel</button>
              <button type="submit" disabled={planSaving || !planTitle.trim() || !planStart} style={{ ...pillBtn, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', fontWeight: 700, opacity: planSaving || !planTitle.trim() ? 0.6 : 1 }}>
                {planSaving ? 'Saving…' : 'Create plan'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 999,
  color: 'var(--text-primary)', padding: '7px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

const roundBtn: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', cursor: 'pointer', padding: 0,
};

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-primary)',
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border-color)',
  borderRadius: 10, color: 'var(--text-primary)', fontSize: '0.86rem', fontWeight: 400, padding: '10px 12px', outline: 'none',
};
