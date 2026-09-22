import { useEffect, useState } from 'react';
import {
  TaskItem, TaskCreatePayload, Group, Contact,
  createTask, listTasks, updateTaskStatus, updateMyTaskStatus, submitBreakoutReport, compileTask, getUsers,
} from '../services/api';

type StatusFilter = 'all' | 'open' | 'in_progress' | 'completed' | 'cancelled';

const STATUS_COLORS: Record<string, string> = {
  open: '#6b7280', in_progress: '#0891b2', completed: '#25d366', cancelled: '#ef4444',
};

export default function TasksPanel({ token, myUsername, groups }: { token: string; myUsername: string; groups: Group[] }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function reload() {
    setLoading(true);
    listTasks(token).then(setTasks).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, [token]);

  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
  const selected = tasks.find(t => t.task_id === selectedId) ?? null;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20, minWidth: 0, maxWidth: 420, borderRight: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Tasks</h2>
          <button onClick={() => setShowCreate(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}>
            + New Task
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {(['all', 'open', 'in_progress', 'completed', 'cancelled'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? 'var(--accent)' : 'var(--bg-card)',
                color: filter === f ? '#fff' : 'var(--text-primary)',
                border: '1px solid var(--border-color)', borderRadius: 20, padding: '4px 10px',
                fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {f === 'all' ? 'All' : f.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No tasks.</p>
          ) : (
            filtered.map(t => (
              <button
                key={t.task_id}
                onClick={() => setSelectedId(t.task_id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: selectedId === t.task_id ? 'var(--item-active-bg)' : 'var(--bg-card)',
                  border: selectedId === t.task_id ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                  borderRadius: 10, padding: 12, marginBottom: 8, cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[t.status], flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                  {t.is_breakout && <span style={{ fontSize: '0.62rem', background: '#7c3aed', color: '#fff', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>breakout</span>}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {t.due_at ? `Due ${new Date(t.due_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'No due date'}
                  {t.recurrence && ` · repeats ${t.recurrence}`}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>By {t.created_by}</div>
              </button>
            ))
          )}
        </div>
      </div>

      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {selected ? (
          <TaskDetail task={selected} myUsername={myUsername} token={token} onChanged={reload} />
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Select a task to view details.</p>
        )}
      </div>

      {showCreate && (
        <CreateTaskModal
          token={token}
          myUsername={myUsername}
          groups={groups}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); reload(); }}
        />
      )}
    </div>
  );
}

function TaskDetail({ task, myUsername, token, onChanged }: { task: TaskItem; myUsername: string; token: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportDrafts, setReportDrafts] = useState<Record<number, string>>({});

  const myAssignee = task.assignees.find(a => a.username === myUsername);

  async function handleStatus(status: TaskItem['status']) {
    setBusy(true);
    setError(null);
    try {
      await updateTaskStatus(token, task.task_id, status);
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to update status');
    } finally {
      setBusy(false);
    }
  }

  async function handleMyStatus(status: 'assigned' | 'in_progress' | 'completed') {
    setBusy(true);
    setError(null);
    try {
      await updateMyTaskStatus(token, task.task_id, status);
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to update status');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitReport(groupId: number) {
    const text = (reportDrafts[groupId] || '').trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await submitBreakoutReport(token, task.task_id, groupId, text);
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit report');
    } finally {
      setBusy(false);
    }
  }

  async function handleCompile() {
    setBusy(true);
    setError(null);
    try {
      await compileTask(token, task.task_id);
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to compile report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{task.title}</h3>
        <span style={{ fontSize: '0.7rem', background: STATUS_COLORS[task.status], color: '#fff', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>
          {task.status.replace('_', ' ')}
        </span>
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12 }}>
        Created by {task.created_by}
        {task.due_at && ` · due ${new Date(task.due_at).toLocaleString()}`}
        {task.recurrence && ` · repeats ${task.recurrence}`}
      </div>
      {task.description && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 16 }}>{task.description}</p>
      )}

      {/* Task-level status controls (creator/admin) */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['open', 'in_progress', 'completed', 'cancelled'] as TaskItem['status'][]).map(s => (
          <button
            key={s}
            onClick={() => handleStatus(s)}
            disabled={busy || task.status === s}
            style={{
              background: task.status === s ? STATUS_COLORS[s] : 'var(--bg-card)',
              color: task.status === s ? '#fff' : 'var(--text-primary)',
              border: '1px solid var(--border-color)', borderRadius: 8, padding: '5px 10px',
              fontSize: '0.75rem', cursor: busy ? 'wait' : 'pointer', opacity: task.status === s ? 1 : 0.85,
            }}
          >
            Mark {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginBottom: 12 }}>{error}</p>}

      {task.is_breakout ? (
        <>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Breakout groups
          </div>
          {task.breakout_groups.map(g => {
            const isMember = g.member_usernames.includes(myUsername);
            return (
              <div key={g.group_id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{g.name || `Group ${g.group_id}`}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{g.member_usernames.join(', ')}</div>
                {g.report_text ? (
                  <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-primary)', background: 'var(--bg-panel)', borderRadius: 8, padding: 10 }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{g.report_text}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 6 }}>
                      Submitted by {g.report_submitted_by} {g.report_submitted_at && new Date(g.report_submitted_at).toLocaleString()}
                    </div>
                  </div>
                ) : isMember ? (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <textarea
                      value={reportDrafts[g.group_id] || ''}
                      onChange={e => setReportDrafts(prev => ({ ...prev, [g.group_id]: e.target.value }))}
                      placeholder="Write your group's report…"
                      rows={3}
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.82rem', padding: 8, resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <button
                      onClick={() => handleSubmitReport(g.group_id)}
                      disabled={busy || !(reportDrafts[g.group_id] || '').trim()}
                      style={{ alignSelf: 'flex-start', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      Submit report
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No report submitted yet.</div>
                )}
              </div>
            );
          })}

          {task.compiled_report ? (
            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--accent)', borderRadius: 10, padding: 14, marginTop: 6 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>AI-compiled report</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{task.compiled_report}</div>
            </div>
          ) : (
            <button
              onClick={handleCompile}
              disabled={busy || task.breakout_groups.every(g => !g.report_text)}
              style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: '0.8rem', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: task.breakout_groups.every(g => !g.report_text) ? 0.5 : 1 }}
            >
              Compile reports with AI
            </button>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Assignees
          </div>
          {task.assignees.map(a => (
            <div key={a.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLORS[a.status] || '#6b7280', flexShrink: 0 }} />
              <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', flex: 1 }}>{a.username}{a.username === myUsername ? ' (you)' : ''}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{a.status.replace('_', ' ')}</span>
            </div>
          ))}
          {myAssignee && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {(['assigned', 'in_progress', 'completed'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => handleMyStatus(s)}
                  disabled={busy || myAssignee.status === s}
                  style={{
                    background: myAssignee.status === s ? 'var(--accent)' : 'var(--bg-card)',
                    color: myAssignee.status === s ? '#fff' : 'var(--text-primary)',
                    border: '1px solid var(--border-color)', borderRadius: 8, padding: '5px 10px', fontSize: '0.75rem', cursor: busy ? 'wait' : 'pointer',
                  }}
                >
                  My status: {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CreateTaskModal({ token, myUsername, groups, onClose, onCreated }: { token: string; myUsername: string; groups: Group[]; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [groupId, setGroupId] = useState<number | ''>('');
  const [recurrence, setRecurrence] = useState<'' | 'daily' | 'weekly' | 'monthly'>('');
  const [isBreakout, setIsBreakout] = useState(false);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [breakoutGroups, setBreakoutGroups] = useState<{ name: string; usernames: string[] }[]>([{ name: 'Team A', usernames: [] }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Contact[]>([]);

  useEffect(() => {
    getUsers(token).then(us => setUsers(us.filter(u => u.username !== myUsername))).catch(() => {});
  }, [token, myUsername]);

  function toggleAssignee(username: string) {
    setAssignees(prev => prev.includes(username) ? prev.filter(u => u !== username) : [...prev, username]);
  }
  function toggleBreakoutMember(groupIndex: number, username: string) {
    setBreakoutGroups(prev => prev.map((g, i) => i !== groupIndex ? g : {
      ...g,
      usernames: g.usernames.includes(username) ? g.usernames.filter(u => u !== username) : [...g.usernames, username],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload: TaskCreatePayload = {
        title: title.trim(),
        description: description.trim() || undefined,
        due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
        group_id: groupId === '' ? undefined : groupId,
        recurrence: recurrence || undefined,
        is_breakout: isBreakout,
      };
      if (isBreakout) {
        payload.breakout_groups = breakoutGroups
          .filter(g => g.usernames.length > 0)
          .map(g => ({ name: g.name.trim() || 'Team', usernames: g.usernames }));
      } else {
        payload.assignee_usernames = assignees;
      }
      await createTask(token, payload);
      onCreated();
    } catch (err: any) {
      setError(err?.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form onSubmit={handleSubmit} style={{ width: 420, maxHeight: '85vh', overflowY: 'auto', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>New Task</div>

        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" required autoFocus style={inputStyle} />
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        <input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} style={inputStyle} />

        <select value={recurrence} onChange={e => setRecurrence(e.target.value as any)} style={inputStyle}>
          <option value="">No repeat</option>
          <option value="daily">Repeats daily</option>
          <option value="weekly">Repeats weekly</option>
          <option value="monthly">Repeats monthly</option>
        </select>

        <select value={groupId} onChange={e => setGroupId(e.target.value ? Number(e.target.value) : '')} style={inputStyle}>
          <option value="">Direct assignment (no group)</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={isBreakout} onChange={e => setIsBreakout(e.target.checked)} />
          Breakout task — split into sub-teams
        </label>

        {isBreakout ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {breakoutGroups.map((g, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  value={g.name}
                  onChange={e => setBreakoutGroups(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  placeholder="Team name"
                  style={inputStyle}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {users.length === 0 ? (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No other users found</span>
                  ) : (
                    users.map(u => {
                      const checked = g.usernames.includes(u.username);
                      return (
                        <button
                          key={u.username}
                          type="button"
                          onClick={() => toggleBreakoutMember(i, u.username)}
                          style={{
                            background: checked ? 'var(--accent)' : 'var(--bg-card)',
                            color: checked ? '#fff' : 'var(--text-primary)',
                            border: '1px solid var(--border-color)', borderRadius: 14, padding: '3px 10px', fontSize: '0.72rem', cursor: 'pointer',
                          }}
                        >
                          {u.username}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setBreakoutGroups(prev => [...prev, { name: `Team ${String.fromCharCode(65 + prev.length)}`, usernames: [] }])} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}>
              + Add another group
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Assignees</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {users.length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No other users found</span>
              ) : (
                users.map(u => {
                  const checked = assignees.includes(u.username);
                  return (
                    <button
                      key={u.username}
                      type="button"
                      onClick={() => toggleAssignee(u.username)}
                      style={{
                        background: checked ? 'var(--accent)' : 'var(--bg-card)',
                        color: checked ? '#fff' : 'var(--text-primary)',
                        border: '1px solid var(--border-color)', borderRadius: 14, padding: '3px 10px', fontSize: '0.72rem', cursor: 'pointer',
                      }}
                    >
                      {u.username}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {error && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</span>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 8, padding: '7px 14px', fontSize: '0.82rem', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !title.trim()} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: '0.82rem', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)', border: '1px solid var(--border-color)',
  borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.85rem', padding: '8px 12px',
};
