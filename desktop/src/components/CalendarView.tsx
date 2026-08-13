import { useEffect, useMemo, useState } from 'react';
import { getMeetingCalendar, CalendarOccurrence } from '../services/api';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59); }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function CalendarView({
  token,
  onJoinMeeting,
}: {
  token: string;
  onJoinMeeting: (occ: CalendarOccurrence) => void;
}) {
  const [cursor, setCursor] = useState(new Date());
  const [occurrences, setOccurrences] = useState<CalendarOccurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  // Grid always shows full weeks — pad from the Sunday before month start to
  // the Saturday after month end, matching every Teams/Google Calendar view.
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const gridEnd = addDays(monthEnd, 6 - monthEnd.getDay());

  useEffect(() => {
    setLoading(true);
    getMeetingCalendar(token, gridStart.toISOString(), gridEnd.toISOString())
      .then(setOccurrences)
      .catch(() => setOccurrences([]))
      .finally(() => setLoading(false));
  }, [token, monthStart.getTime()]);

  const days = useMemo(() => {
    const arr: Date[] = [];
    let d = gridStart;
    while (d <= gridEnd) { arr.push(d); d = addDays(d, 1); }
    return arr;
  }, [gridStart.getTime(), gridEnd.getTime()]);

  const occurrencesByDay = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>();
    for (const occ of occurrences) {
      const key = new Date(occ.occurrence_start).toDateString();
      const list = map.get(key) ?? [];
      list.push(occ);
      map.set(key, list);
    }
    return map;
  }, [occurrences]);

  const selectedOccurrences = occurrencesByDay.get(selectedDay.toDateString()) ?? [];
  const today = new Date();

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, minWidth: 0 }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setCursor(new Date()); setSelectedDay(new Date()); }} style={navBtnStyle}>Today</button>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={navBtnStyle}>‹</button>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={navBtnStyle}>›</button>
          </div>
        </div>

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
            const dayOccs = occurrencesByDay.get(day.toDateString()) ?? [];
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
                {dayOccs.slice(0, 2).map(occ => (
                  <span key={`${occ.meeting_id}-${occ.occurrence_start}`} style={{
                    fontSize: '0.62rem', background: 'var(--accent)', color: '#fff', borderRadius: 4,
                    padding: '1px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {occ.title || 'Meeting'}
                  </span>
                ))}
                {dayOccs.length > 2 && (
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>+{dayOccs.length - 2} more</span>
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
        {selectedOccurrences.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No meetings.</p>
        ) : (
          selectedOccurrences
            .sort((a, b) => a.occurrence_start.localeCompare(b.occurrence_start))
            .map(occ => (
              <button
                key={`${occ.meeting_id}-${occ.occurrence_start}`}
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
            ))
        )}
      </div>
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8,
  color: 'var(--text-primary)', padding: '6px 12px', fontSize: '0.78rem', cursor: 'pointer',
};
