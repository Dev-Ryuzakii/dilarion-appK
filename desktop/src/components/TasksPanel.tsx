import { useEffect, useState } from 'react';
import {
  TaskItem, TaskCreatePayload, Group, Contact,
  createTask, listTasks, updateTaskStatus, updateMyTaskStatus, submitMyReport, compileTask, getUsers,
  addTaskAssignees, deleteTask, getReportHistory, TaskReportRevision, downloadTaskReportDocx,
} from '../services/api';
import { saveBlob } from '../services/platform';
import { userMessage } from '../services/errors';

type StatusFilter = 'all' | 'open' | 'in_progress' | 'completed' | 'cancelled';

const STATUS_COLORS: Record<string, string> = {
  open: '#9ca3af', in_progress: '#0891b2', completed: '#16a34a', cancelled: '#d83428',
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

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = (filter === 'all' ? tasks : tasks.filter(t => t.status === filter))
    .filter(t => !q || t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q) || t.created_by.toLowerCase().includes(q));
  const selected = tasks.find(t => t.task_id === selectedId) ?? null;
  const countOf = (f: StatusFilter) => (f === 'all' ? tasks.length : tasks.filter(t => t.status === f).length);
  const FILTERS: Array<[StatusFilter, string]> = [['all', 'All'], ['open', 'Open'], ['in_progress', 'In progress'], ['completed', 'Done'], ['cancelled', 'Cancelled']];

  return (
    <div className="tasks-layout" style={{ display: 'flex', height: '100%', background: 'var(--bg-base)' }}>
      <div className="tasks-list" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '22px 18px 0', minWidth: 0, maxWidth: 440, borderRight: '1px solid var(--border-color)', background: 'var(--bg-panel)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '0 4px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>Tasks</h2>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {tasks.filter(t => t.status === 'open' || t.status === 'in_progress').length} active · {tasks.filter(t => t.status === 'completed').length} done
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 999, padding: '9px 16px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 6px 16px rgba(216,52,40,0.22)' }}>
            + New task
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '0 12px', marginBottom: 12 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks" style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', padding: '10px 0', fontSize: '0.84rem', color: 'var(--text-primary)', fontFamily: 'inherit' }} />
        </div>

        <div style={{ display: 'flex', gap: 2, marginBottom: 12, background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 3, overflowX: 'auto' }}>
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                flex: '1 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                background: filter === f ? 'var(--bg-panel)' : 'transparent',
                color: filter === f ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: filter === f ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                border: 'none', borderRadius: 9, padding: '6px 9px',
                fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}
            >
              {label}
              <span style={{ fontSize: '0.66rem', fontWeight: 700, color: filter === f ? 'var(--accent)' : 'var(--text-muted)' }}>{countOf(f)}</span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 16 }}>
          {loading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 4px' }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, margin: '0 auto 10px', background: 'rgba(216,52,40,0.08)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              </div>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{q ? 'No matching tasks' : filter === 'all' ? 'No tasks yet' : 'Nothing here'}</div>
              <div style={{ fontSize: '0.78rem', marginTop: 4 }}>{q ? 'Try a different search.' : 'Create a task and assign it to people or teams.'}</div>
            </div>
          ) : (
            filtered.map(t => {
              const isSel = selectedId === t.task_id;
              const overdue = !!t.due_at && new Date(t.due_at).getTime() < Date.now() && t.status !== 'completed' && t.status !== 'cancelled';
              const done = t.status === 'completed';
              const people = t.assignees.map(a => a.username);
              return (
                <button
                  key={t.task_id}
                  onClick={() => setSelectedId(t.task_id)}
                  style={{
                    display: 'flex', gap: 12, width: '100%', textAlign: 'left', fontFamily: 'inherit',
                    background: isSel ? 'rgba(216,52,40,0.06)' : 'var(--bg-panel)',
                    border: isSel ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                    borderRadius: 14, padding: '12px 14px', marginBottom: 8, cursor: 'pointer',
                  }}
                >
                  <span style={{
                    width: 20, height: 20, borderRadius: 10, flexShrink: 0, marginTop: 1,
                    border: `2px solid ${STATUS_COLORS[t.status]}`, background: done ? STATUS_COLORS[t.status] : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {done && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.88rem', color: done ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.title}</span>
                      {t.is_breakout && <span style={{ fontSize: '0.62rem', fontWeight: 700, background: 'rgba(124,58,237,0.10)', color: '#7c3aed', borderRadius: 999, padding: '2px 8px', flexShrink: 0 }}>Teams</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, borderRadius: 999, padding: '2px 8px', color: overdue ? 'var(--accent)' : 'var(--text-secondary)', background: overdue ? 'rgba(216,52,40,0.10)' : 'var(--bg-base)' }}>
                        {t.due_at ? `${overdue ? 'Overdue · ' : 'Due '}${new Date(t.due_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'No due date'}
                      </span>
                      {t.recurrence && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>↻ {t.recurrence}</span>}
                      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
                        {people.slice(0, 3).map((u, i) => (
                          <span key={u} title={u} style={{ width: 22, height: 22, borderRadius: 11, marginLeft: i ? -6 : 0, border: '2px solid var(--bg-panel)', background: AVATAR_TINTS[(u.charCodeAt(0) + u.length) % AVATAR_TINTS.length], color: '#fff', fontSize: '0.6rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            {u.charAt(0).toUpperCase()}
                          </span>
                        ))}
                        {people.length > 3 && <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginLeft: 4 }}>+{people.length - 3}</span>}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className={`tasks-detail${selected ? '' : ' tasks-detail-empty'}`} style={{ flex: 1, padding: '26px 30px', overflowY: 'auto' }}>
        {selected ? (
          <TaskDetail task={selected} myUsername={myUsername} token={token} onChanged={reload} />
        ) : (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 8, color: 'var(--text-muted)' }}>
            <div style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="3" /><line x1="8" y1="8" x2="16" y2="8" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="12" y2="16" /></svg>
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)' }}>Select a task</div>
            <div style={{ fontSize: '0.82rem', maxWidth: 280 }}>Pick a task on the left to see details, reports and who it's assigned to.</div>
          </div>
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

const AVATAR_TINTS = ['#c0392b', '#b45309', '#0f766e', '#1d4ed8', '#7c3aed', '#be185d', '#4d7c0f', '#0369a1'];

/** Task → team → staff → the compiled sections that cite that person's own
 *  report. A clearer, indented tree: rails connect each level, each staffer
 *  shows a submit dot and the sections they contributed to (clickable). */
function ReportTree({ task, onSectionClick, onPreview }: {
  task: TaskItem;
  onSectionClick: (index: number) => void;
  onPreview: (username: string, text: string) => void;
}) {
  const rail = '1.5px solid var(--border-color)';
  const attributed = task.compiled_sections.length > 0;
  const memberReport = (groupId: number, username: string) =>
    task.breakout_groups.find(g => g.group_id === groupId)?.members
      ?.find(m => m.username === username)?.report_text || null;

  return (
    <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
      <div style={{ fontWeight: 800, marginBottom: 8, fontSize: '0.9rem' }}>🗂 {task.title}</div>
      <div style={{ borderLeft: rail, marginLeft: 8, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {task.report_tree.map(team => (
          <div key={team.group_id} style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: -16, top: 10, width: 12, borderTop: rail }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, background: '#7c3aed14', color: '#7c3aed', borderRadius: 6, padding: '2px 8px' }}>👥 {team.team_name}</span>
              {!team.has_report && <span style={{ fontSize: '0.72rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>no reports yet</span>}
            </div>
            <div style={{ borderLeft: rail, marginLeft: 8, paddingLeft: 16, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {team.staff.map(st => {
                const text = memberReport(team.group_id, st.username);
                return (
                  <div key={st.username} style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: -16, top: 9, width: 12, borderTop: rail }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: st.submitted ? '#25d366' : '#9ca3af', flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>{st.username}</span>
                      {text && (
                        <button onClick={() => onPreview(st.username, text)} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '0.72rem', cursor: 'pointer', padding: 0 }}>
                          preview
                        </button>
                      )}
                      {!st.submitted && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>no report</span>}
                    </div>
                    {st.sections.length > 0 && (
                      <div style={{ marginLeft: 13, display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                        {st.sections.map(sec => (
                          <button
                            key={sec.index}
                            onClick={() => onSectionClick(sec.index)}
                            title={`Cited in section ${sec.index + 1}`}
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--accent)', padding: '1px 7px', fontSize: '0.68rem', cursor: 'pointer' }}
                          >
                            §{sec.index + 1} {sec.heading}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {!attributed && team.has_report && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Compile to see who each section cites.</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskDetail({ task, myUsername, token, onChanged }: { task: TaskItem; myUsername: string; token: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportView, setReportView] = useState<'report' | 'tree'>('report');
  const [highlightSection, setHighlightSection] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Add-people control
  const [showAdd, setShowAdd] = useState(false);
  const [allUsers, setAllUsers] = useState<Contact[]>([]);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [addGroupName, setAddGroupName] = useState<string>('');
  const [newTeamName, setNewTeamName] = useState<string>(''); // non-empty = create a new team
  // My own breakout report draft, and the staff-report preview popup.
  const [myReportDraft, setMyReportDraft] = useState<string>('');
  const [preview, setPreview] = useState<{ username: string; text: string } | null>(null);
  // Report revision history ("branch tree") for the previewed staffer.
  const [history, setHistory] = useState<TaskReportRevision[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function openHistory(username: string) {
    setHistoryLoading(true);
    setHistory(null);
    try {
      setHistory(await getReportHistory(token, task.task_id, username));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  const myAssignee = task.assignees.find(a => a.username === myUsername);
  // Which breakout team (if any) the current user is on, and their own report.
  const myGroup = task.breakout_groups.find(g => g.member_usernames.includes(myUsername)) || null;
  const myMember = myGroup?.members.find(m => m.username === myUsername) || null;

  useEffect(() => {
    if (showAdd && allUsers.length === 0) {
      getUsers(token).then(setAllUsers).catch(() => {});
    }
    if (showAdd && task.is_breakout && !addGroupName && task.breakout_groups.length > 0) {
      setAddGroupName(task.breakout_groups[0].name || `Group ${task.breakout_groups[0].group_id}`);
    }
  }, [showAdd]);

  // Seed my-report draft from whatever I last submitted.
  useEffect(() => { setMyReportDraft(myMember?.report_text || ''); }, [task.task_id, myMember?.report_text]);

  // Usernames already on the task (direct assignees or any breakout team).
  const existing = new Set<string>(
    task.is_breakout
      ? task.breakout_groups.flatMap(g => g.member_usernames)
      : task.assignees.map(a => a.username)
  );

  async function handleAddPeople() {
    if (toAdd.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    // For a breakout task, target either an existing team or a newly-named one.
    const targetTeam = task.is_breakout
      ? (newTeamName.trim() || addGroupName)
      : undefined;
    try {
      const updated = await addTaskAssignees(token, task.task_id, toAdd, targetTeam);
      const skipped = updated.skipped_assignees || [];
      if (skipped.length > 0) {
        setError(`Couldn't add: ${skipped.map(s => `${s.username} (${s.reason})`).join('; ')}`);
      } else {
        setNotice('Added.');
      }
      setToAdd([]);
      setNewTeamName('');
      setShowAdd(false);
      onChanged();
    } catch (err: any) {
      setError(userMessage(err, "Couldn't add those people. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleMyReport() {
    if (!myReportDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await submitMyReport(token, task.task_id, myReportDraft.trim());
      onChanged();
    } catch (err: any) {
      setError(userMessage(err, "Couldn't submit your report. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete task "${task.title}"? This removes all its teams and reports and cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTask(token, task.task_id);
      onChanged();
    } catch (err: any) {
      setError(userMessage(err, "Couldn't delete that task. Please try again."));
      setBusy(false);
    }
  }

  async function handleStatus(status: TaskItem['status']) {
    setBusy(true);
    setError(null);
    try {
      await updateTaskStatus(token, task.task_id, status);
      onChanged();
    } catch (err: any) {
      setError(userMessage(err, "Couldn't update the status. Please try again."));
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
      setError(userMessage(err, "Couldn't update the status. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const [compiling, setCompiling] = useState(false);
  async function handleCompile() {
    setBusy(true);
    setCompiling(true);
    setError(null);
    try {
      await compileTask(token, task.task_id);
      onChanged();
    } catch (err: any) {
      setError(userMessage(err, "Couldn't compile the report. Please try again."));
    } finally {
      setBusy(false);
      setCompiling(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { blob, filename } = await downloadTaskReportDocx(token, task.task_id);
      const path = await saveBlob(blob, filename);
      if (path) setNotice(`Saved to ${path}`);
    } catch (err: any) {
      setError(userMessage(err, "Couldn't export the report. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function jumpToSection(index: number) {
    setReportView('report');
    setHighlightSection(index);
    setTimeout(() => document.getElementById(`task-${task.task_id}-section-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', flex: 1 }}>{task.title}</h3>
        <span style={{ fontSize: '0.7rem', background: STATUS_COLORS[task.status], color: '#fff', borderRadius: 999, padding: '3px 10px', fontWeight: 700, textTransform: 'capitalize' }}>
          {task.status.replace('_', ' ')}
        </span>
        <button
          onClick={handleDelete}
          disabled={busy}
          title="Delete task"
          style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '5px 12px', fontSize: '0.74rem', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
        >
          Delete
        </button>
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
              border: task.status === s ? `1px solid ${STATUS_COLORS[s]}` : '1px solid var(--border-color)', borderRadius: 999, padding: '6px 12px',
              fontSize: '0.75rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}
          >
            Mark {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Add people to this existing task (creator/admin/org — server enforces) */}
      <div style={{ marginBottom: 16 }}>
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px dashed var(--border-color)', borderRadius: 999, padding: '7px 14px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Add people
          </button>
        ) : (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 12 }}>
            {task.is_breakout && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  Add to team:
                  <select
                    value={newTeamName ? '__new__' : addGroupName}
                    onChange={e => {
                      if (e.target.value === '__new__') { setNewTeamName('New team'); }
                      else { setNewTeamName(''); setAddGroupName(e.target.value); }
                    }}
                    style={{ marginLeft: 8, background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.78rem', padding: '3px 6px' }}
                  >
                    {task.breakout_groups.map(g => {
                      const n = g.name || `Group ${g.group_id}`;
                      return <option key={g.group_id} value={n}>{n}</option>;
                    })}
                    <option value="__new__">➕ New team…</option>
                  </select>
                </label>
                {newTeamName !== '' && (
                  <input
                    value={newTeamName}
                    onChange={e => setNewTeamName(e.target.value)}
                    placeholder="New team name"
                    autoFocus
                    style={{ marginTop: 6, width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: 6, color: 'var(--text-primary)', fontSize: '0.8rem', padding: '5px 8px' }}
                  />
                )}
              </div>
            )}
            <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 8 }}>
              {allUsers.filter(u => !existing.has(u.username)).map(u => {
                const checked = toAdd.includes(u.username);
                return (
                  <label key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: 'var(--text-primary)', padding: '3px 2px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setToAdd(prev => checked ? prev.filter(x => x !== u.username) : [...prev, u.username])}
                    />
                    {u.username}
                  </label>
                );
              })}
              {allUsers.filter(u => !existing.has(u.username)).length === 0 && (
                <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Everyone's already on this task.</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAddPeople}
                disabled={busy || toAdd.length === 0}
                style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: '0.78rem', fontWeight: 700, cursor: busy || toAdd.length === 0 ? 'default' : 'pointer', opacity: toAdd.length === 0 ? 0.5 : 1 }}
              >
                Add {toAdd.length > 0 ? `(${toAdd.length})` : ''}
              </button>
              <button
                onClick={() => { setShowAdd(false); setToAdd([]); }}
                style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '6px 12px', fontSize: '0.78rem', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginBottom: 12 }}>{error}</p>}
      {notice && !task.is_breakout && <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 12 }}>{notice}</p>}

      {task.is_breakout ? (
        <>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Breakout groups
          </div>
          {task.breakout_groups.map(g => {
            const iAmHere = g.member_usernames.includes(myUsername);
            const submittedCount = g.members.filter(m => m.submitted).length;
            return (
              <div key={g.group_id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>👥 {g.name || `Group ${g.group_id}`}</span>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{submittedCount}/{g.members.length} reported</span>
                </div>

                {/* Each staff member and their own report */}
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {g.members.map(m => (
                    <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.submitted ? '#25d366' : '#9ca3af', flexShrink: 0 }} />
                      <span style={{ color: 'var(--text-primary)', fontWeight: m.username === myUsername ? 700 : 400 }}>
                        {m.username}{m.username === myUsername ? ' (you)' : ''}
                      </span>
                      {m.submitted ? (
                        <button
                          onClick={() => setPreview({ username: m.username, text: m.report_text || '' })}
                          style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '0.72rem', cursor: 'pointer', padding: 0 }}
                        >
                          preview report
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>no report yet</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Legacy shared team report, if any */}
                {g.report_text && (
                  <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-primary)', background: 'var(--bg-panel)', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 4 }}>Team report (legacy) · {g.report_submitted_by}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{g.report_text}</div>
                  </div>
                )}

                {/* My own report box — only in the team I'm on */}
                {iAmHere && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                      {myMember?.submitted ? 'Your report (edit & resubmit)' : 'Your report'}
                    </div>
                    <textarea
                      value={myReportDraft}
                      onChange={e => setMyReportDraft(e.target.value)}
                      placeholder="Write your own report for this task…"
                      rows={3}
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.82rem', padding: 8, resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <button
                      onClick={handleMyReport}
                      disabled={busy || !myReportDraft.trim()}
                      style={{ alignSelf: 'flex-start', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: busy || !myReportDraft.trim() ? 'default' : 'pointer', opacity: myReportDraft.trim() ? 1 : 0.5 }}
                    >
                      {myMember?.submitted ? 'Update my report' : 'Submit my report'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {compiling && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-panel)', border: '1px solid var(--accent)', borderRadius: 10, padding: '12px 14px', marginBottom: 6 }}>
              <span style={{ width: 16, height: 16, border: '2px solid var(--border-color)', borderTopColor: 'var(--accent)', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>Compiling report with AI…</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Reading each staffer's report and writing a combined, cited report. This can take up to a minute.</div>
              </div>
            </div>
          )}

          {task.compiled_report ? (
            <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--accent)', borderRadius: 10, padding: 14, marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent)', flex: 1 }}>AI-compiled report</div>
                <div style={{ display: 'flex', border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
                  {(['report', 'tree'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setReportView(v)}
                      style={{ background: reportView === v ? 'var(--accent)' : 'transparent', color: reportView === v ? '#fff' : 'var(--text-primary)', border: 'none', padding: '4px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {v === 'report' ? 'Report' : 'Tree'}
                    </button>
                  ))}
                </div>
                <button onClick={handleExport} disabled={busy} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
                  Download .docx
                </button>
                <button onClick={handleCompile} disabled={busy} title="Re-run the AI over the latest team reports" style={{ background: 'transparent', color: 'var(--accent)', border: 'none', padding: '4px 4px', fontSize: '0.72rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
                  Recompile
                </button>
              </div>
              {notice && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 8 }}>{notice}</div>}
              {reportView === 'tree' ? (
                <ReportTree task={task} onSectionClick={jumpToSection} onPreview={(username, text) => setPreview({ username, text })} />
              ) : task.compiled_sections.length > 0 ? (
                task.compiled_sections.map((sec, i) => (
                  <div
                    key={i}
                    id={`task-${task.task_id}-section-${i}`}
                    style={{ marginBottom: 12, borderRadius: 8, padding: highlightSection === i ? 8 : 0, background: highlightSection === i ? 'var(--bg-card)' : 'transparent', transition: 'background 0.3s' }}
                  >
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>{i + 1}. {sec.heading}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '4px 0' }}>
                      {(sec.sources.length ? sec.sources : ['unattributed']).map(src => (
                        <span key={src} style={{ fontSize: '0.62rem', background: '#7c3aed22', color: '#7c3aed', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>{src}</span>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{sec.body}</div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{task.compiled_report}</div>
              )}
            </div>
          ) : (
            <button
              onClick={handleCompile}
              disabled={busy || task.breakout_groups.every(g => !g.has_report)}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 16px', fontSize: '0.8rem', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: task.breakout_groups.every(g => !g.has_report) ? 0.5 : 1 }}
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

      {/* Staff report preview + revision branch-tree */}
      {preview && (
        <div
          onClick={e => { if (e.target === e.currentTarget) { setPreview(null); setHistory(null); } }}
          style={{ position: 'fixed', inset: 0, zIndex: 955, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{ width: 480, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', flex: 1 }}>{preview.username}'s report</span>
              {history === null ? (
                <button onClick={() => openHistory(preview.username)} disabled={historyLoading} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 8, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>
                  {historyLoading ? 'Loading…' : '🌱 History'}
                </button>
              ) : (
                <button onClick={() => setHistory(null)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: 8, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer' }}>
                  Current
                </button>
              )}
              <button onClick={() => { setPreview(null); setHistory(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.1rem', cursor: 'pointer' }}>✕</button>
            </div>
            {history === null ? (
              <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{preview.text}</div>
            ) : history.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No earlier versions — this report was submitted once.</div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 10 }}>How this report evolved — newest at the top.</div>
                <div style={{ borderLeft: '2px solid var(--border-color)', marginLeft: 6, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {history.map((rev, i) => (
                    <div key={rev.version} style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: -23, top: 3, width: 12, height: 12, borderRadius: '50%', background: i === 0 ? 'var(--accent)' : 'var(--bg-card)', border: '2px solid var(--border-color)' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700 }}>v{rev.version}{i === 0 ? ' · current' : ''}</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rev.created_at ? new Date(rev.created_at).toLocaleString() : ''}</span>
                      </div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', color: i === 0 ? 'var(--text-primary)' : 'var(--text-muted)', marginTop: 3, lineHeight: 1.45 }}>{rev.report_text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
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
      const created = await createTask(token, payload);
      const skipped = created.skipped_assignees || [];
      if (skipped.length > 0) {
        // Task was created but some people couldn't be assigned — show why and
        // keep the modal open so it isn't missed.
        setError(`Task created, but couldn't assign: ${skipped.map(s => `${s.username} (${s.reason})`).join('; ')}`);
        setSaving(false);
        return;
      }
      onCreated();
    } catch (err: any) {
      setError(userMessage(err, "Couldn't create that task. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="responsive-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form className="responsive-dialog" onSubmit={handleSubmit} style={{ width: 420, maxHeight: '85vh', overflowY: 'auto', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14, padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                <UserSearchPicker users={users} selected={g.usernames} onToggle={u => toggleBreakoutMember(i, u)} />
              </div>
            ))}
            <button type="button" onClick={() => setBreakoutGroups(prev => [...prev, { name: `Team ${String.fromCharCode(65 + prev.length)}`, usernames: [] }])} style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}>
              + Add another group
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Assignees</span>
            <UserSearchPicker users={users} selected={assignees} onToggle={toggleAssignee} />
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

// Search-as-you-type picker: selected people show as removable chips, the
// list below filters by username so large orgs don't render every user.
function UserSearchPicker({ users, selected, onToggle }: { users: Contact[]; selected: string[]; onToggle: (username: string) => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = users.filter(u => !q || u.username.toLowerCase().includes(q));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {selected.map(u => (
            <button
              key={u}
              type="button"
              onClick={() => onToggle(u)}
              title={`Remove ${u}`}
              style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 14, padding: '3px 10px', fontSize: '0.72rem', cursor: 'pointer' }}
            >
              {u} ✕
            </button>
          ))}
        </div>
      )}
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          // Enter picks the first match instead of submitting the form.
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = matches.find(u => !selected.includes(u.username));
            if (first) { onToggle(first.username); setQuery(''); }
          }
        }}
        placeholder="Search people by username"
        style={inputStyle}
      />
      <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8 }}>
        {users.length === 0 ? (
          <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>No other users found</div>
        ) : matches.length === 0 ? (
          <div style={{ padding: '8px 12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>No match for "{query.trim()}"</div>
        ) : (
          matches.map(u => {
            const checked = selected.includes(u.username);
            return (
              <label
                key={u.username}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer',
                  fontSize: '0.8rem', color: 'var(--text-primary)',
                  background: checked ? 'var(--item-active-bg)' : 'transparent',
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => onToggle(u.username)} />
                {u.username}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--input-bg)', border: '1px solid var(--border-color)',
  borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.85rem', padding: '8px 12px',
};
