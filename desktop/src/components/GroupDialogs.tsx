import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Contact,
  Group,
  GroupInvite,
  GroupInvitePreview,
  GroupMember,
  GROUP_DISAPPEAR_OPTIONS,
  addGroupMember,
  createGroup,
  deleteGroup,
  demoteGroupMember,
  formatDisappear,
  getGroupInvite,
  getUsers,
  joinGroupViaInvite,
  leaveGroup,
  previewGroupInvite,
  promoteGroupMember,
  removeGroupMember,
  resetGroupInvite,
  updateGroup,
} from '../services/api';
import { CloseIcon } from './Icons';

// Self-service groups: any user creates and runs their own groups from the
// app — no admin website involved. The creator is the group's first admin;
// group admins edit info, set the disappearing timer, share the invite
// link/QR, and manage members.

// ── Shared bits ────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

function TimerIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2M9 2h6" />
    </svg>
  );
}

function LinkIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

const ds = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 960, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties,
  modal: {
    width: 440, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto',
    background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14,
    boxShadow: '0 20px 60px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column',
  } as React.CSSProperties,
  head: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 20px', borderBottom: '1px solid var(--border-color)',
  } as React.CSSProperties,
  title: { color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.95rem' } as React.CSSProperties,
  body: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 } as React.CSSProperties,
  label: {
    fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em',
  } as React.CSSProperties,
  input: {
    width: '100%', boxSizing: 'border-box', background: 'var(--bg-card)', border: '1px solid var(--border-color)',
    borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none',
  } as React.CSSProperties,
  primaryBtn: {
    background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px',
    fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  } as React.CSSProperties,
  ghostBtn: {
    background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 8,
    padding: '8px 14px', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit',
  } as React.CSSProperties,
  dangerBtn: {
    background: 'transparent', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8,
    padding: '8px 14px', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
  } as React.CSSProperties,
  closeBtn: {
    background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex',
  } as React.CSSProperties,
  error: { color: '#ef4444', fontSize: '0.75rem' } as React.CSSProperties,
  hint: { color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.5 } as React.CSSProperties,
  section: {
    background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10,
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
  } as React.CSSProperties,
  smallBtn: {
    background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 6,
    color: 'var(--text-primary)', fontSize: '0.7rem', padding: '4px 8px', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
  } as React.CSSProperties,
};

function DisappearPicker({ value, onChange, disabled }: { value: number | null; onChange: (h: number | null) => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {GROUP_DISAPPEAR_OPTIONS.map(o => {
        const active = (o.hours ?? null) === (value ?? null);
        return (
          <button
            key={o.label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.hours)}
            style={{
              borderRadius: 999, padding: '5px 12px', fontSize: '0.75rem', fontFamily: 'inherit',
              cursor: disabled ? 'not-allowed' : 'pointer',
              border: active ? '1px solid var(--accent)' : '1px solid var(--border-color)',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--text-primary)',
              opacity: disabled && !active ? 0.5 : 1,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function UserPicker({
  token, exclude, selected, onToggle,
}: { token: string; exclude: string[]; selected: string[]; onToggle: (u: string) => void }) {
  const [users, setUsers] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    getUsers(token).then(setUsers).catch(() => setUsers([])).finally(() => setLoading(false));
  }, [token]);

  const shown = useMemo(() => {
    const ex = new Set(exclude);
    return users
      .filter(u => !ex.has(u.username) && u.is_active !== false)
      .filter(u => u.username.toLowerCase().includes(q.trim().toLowerCase()))
      .slice(0, 100);
  }, [users, exclude, q]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input style={ds.input} placeholder="Search people" value={q} onChange={e => setQ(e.target.value)} />
      <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {loading ? (
          <div style={ds.hint}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={ds.hint}>No people found</div>
        ) : shown.map(u => {
          const on = selected.includes(u.username);
          return (
            <label
              key={u.username}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
                background: on ? 'var(--item-active-bg)' : 'transparent',
              }}
            >
              <input type="checkbox" checked={on} onChange={() => onToggle(u.username)} />
              <span style={{
                width: 26, height: 26, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: '0.65rem',
                fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{u.username.slice(0, 2).toUpperCase()}</span>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{u.username}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Create group ──────────────────────────────────────────────────────────────

export function CreateGroupModal({
  token, myUsername, onClose, onCreated,
}: { token: string; myUsername: string; onClose: () => void; onCreated: (g: Group) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timer, setTimer] = useState<number | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) { setError('Give the group a name'); return; }
    setBusy(true);
    setError(null);
    try {
      const g = await createGroup(token, {
        name: name.trim(), description: description.trim() || undefined, members, disappearAfterHours: timer,
      });
      onCreated(g);
    } catch (err: any) {
      setError(err?.message || 'Failed to create group');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={ds.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={ds.modal}>
        <div style={ds.head}>
          <span style={ds.title}>New group</span>
          <button style={ds.closeBtn} onClick={onClose} aria-label="Close"><CloseIcon size={16} /></button>
        </div>
        <div style={ds.body}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={ds.label}>Group name</span>
            <input style={ds.input} maxLength={100} autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Field Ops" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={ds.label}>Description</span>
            <textarea
              style={{ ...ds.input, minHeight: 64, resize: 'vertical' }}
              maxLength={500}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What's this group for? (optional)"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ ...ds.label, display: 'flex', alignItems: 'center', gap: 6 }}><TimerIcon size={13} /> Disappearing messages</span>
            <DisappearPicker value={timer} onChange={setTimer} />
            <span style={ds.hint}>New messages in this group disappear for everyone after the chosen time.</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={ds.label}>Add members {members.length > 0 && `(${members.length})`}</span>
            <UserPicker
              token={token}
              exclude={[myUsername]}
              selected={members}
              onToggle={u => setMembers(m => (m.includes(u) ? m.filter(x => x !== u) : [...m, u]))}
            />
            <span style={ds.hint}>You can also add people later or share an invite link.</span>
          </div>
          {error && <span style={ds.error}>{error}</span>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button style={ds.ghostBtn} onClick={onClose}>Cancel</button>
            <button style={{ ...ds.primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
              {busy ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Join via link ─────────────────────────────────────────────────────────────

export function JoinGroupModal({
  token, initialCode, onClose, onJoined,
}: { token: string; initialCode?: string; onClose: () => void; onJoined: (g: Group) => void }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [preview, setPreview] = useState<GroupInvitePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookUp() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await previewGroupInvite(token, code));
    } catch (err: any) {
      setError(err?.message || 'Invite link is invalid');
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    setBusy(true);
    setError(null);
    try {
      onJoined(await joinGroupViaInvite(token, code));
    } catch (err: any) {
      setError(err?.message || 'Failed to join group');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={ds.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={ds.modal}>
        <div style={ds.head}>
          <span style={ds.title}>Join a group</span>
          <button style={ds.closeBtn} onClick={onClose} aria-label="Close"><CloseIcon size={16} /></button>
        </div>
        <div style={ds.body}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={ds.label}>Invite link or code</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={ds.input}
                autoFocus
                value={code}
                onChange={e => { setCode(e.target.value); setPreview(null); }}
                onKeyDown={e => { if (e.key === 'Enter') lookUp(); }}
                placeholder="dilarion://join/…"
              />
              <button style={ds.ghostBtn} disabled={busy || !code.trim()} onClick={lookUp}>Check</button>
            </div>
          </div>
          {preview && (
            <div style={ds.section}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>{initials(preview.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem' }}>{preview.name}</div>
                  <div style={ds.hint}>
                    {preview.member_count} members
                    {preview.disappear_after_hours ? ` · Disappearing: ${formatDisappear(preview.disappear_after_hours)}` : ''}
                  </div>
                </div>
              </div>
              {preview.description && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>{preview.description}</div>
              )}
            </div>
          )}
          {error && <span style={ds.error}>{error}</span>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button style={ds.ghostBtn} onClick={onClose}>Cancel</button>
            {preview && (
              <button style={{ ...ds.primaryBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={join}>
                {preview.already_member ? 'Open group' : busy ? 'Joining…' : 'Join group'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Group info drawer (description, timer, invite, members) ───────────────────

function InviteSection({ token, groupId }: { token: string; groupId: number }) {
  const [invite, setInvite] = useState<GroupInvite | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getGroupInvite(token, groupId).then(setInvite).catch(err => setError(err?.message || 'Failed to load invite link'));
  }, [token, groupId]);

  useEffect(() => {
    if (!invite?.qr_payload) { setQr(''); return; }
    QRCode.toDataURL(invite.qr_payload, { width: 360, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [invite?.qr_payload]);

  async function reset() {
    if (!window.confirm('Reset the invite link? The current link and QR code will stop working.')) return;
    setBusy(true);
    setError(null);
    try {
      setInvite(await resetGroupInvite(token, groupId));
    } catch (err: any) {
      setError(err?.message || 'Failed to reset link');
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!invite) return;
    navigator.clipboard?.writeText(invite.invite_link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div style={ds.section}>
      <span style={{ ...ds.label, display: 'flex', alignItems: 'center', gap: 6 }}><LinkIcon size={13} /> Invite link</span>
      {error && <span style={ds.error}>{error}</span>}
      {invite ? (
        <>
          {qr && (
            <div style={{ alignSelf: 'center', background: '#fff', padding: 8, borderRadius: 10 }}>
              <img src={qr} alt="Group invite QR code" style={{ width: 180, height: 180, display: 'block' }} />
            </div>
          )}
          <div style={{
            fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.75rem', color: 'var(--text-primary)',
            background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 6, padding: '6px 8px',
            wordBreak: 'break-all',
          }}>{invite.invite_link}</div>
          <span style={ds.hint}>Anyone with this link or QR code can join the group.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={ds.ghostBtn} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
            <button style={ds.dangerBtn} disabled={busy} onClick={reset}>{busy ? 'Resetting…' : 'Reset link'}</button>
          </div>
        </>
      ) : !error && <span style={ds.hint}>Loading…</span>}
    </div>
  );
}

export function GroupInfoDrawer({
  token, myUsername, group, members, onClose, onGroupChanged, onMembersChanged, onGroupGone,
}: {
  token: string;
  myUsername: string;
  group: Group;
  members: GroupMember[];
  onClose: () => void;
  onGroupChanged: (g: Group) => void;
  onMembersChanged: () => void;
  onGroupGone: () => void;
}) {
  const iAmAdmin = members.find(m => m.username === myUsername)?.role === 'admin' || group.my_role === 'admin';
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? '');
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingTimer, setSavingTimer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [tab, setTab] = useState<'info' | 'invite'>('info');

  useEffect(() => {
    setName(group.name);
    setDescription(group.description ?? '');
  }, [group.name, group.description]);

  async function saveInfo() {
    if (!name.trim()) { setError('Group name cannot be empty'); return; }
    setSavingInfo(true);
    setError(null);
    try {
      onGroupChanged(await updateGroup(token, group.id, { name: name.trim(), description: description.trim() }));
      setEditing(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setSavingInfo(false);
    }
  }

  async function setTimer(hours: number | null) {
    if ((hours ?? null) === (group.disappear_after_hours ?? null)) return;
    setSavingTimer(true);
    setError(null);
    try {
      onGroupChanged(await updateGroup(token, group.id, { disappearAfterHours: hours }));
    } catch (err: any) {
      setError(err?.message || 'Failed to change timer');
    } finally {
      setSavingTimer(false);
    }
  }

  async function memberAction(username: string, fn: () => Promise<unknown>) {
    setMemberBusy(username);
    setError(null);
    try {
      await fn();
      onMembersChanged();
    } catch (err: any) {
      setError(err?.message || 'Action failed');
    } finally {
      setMemberBusy(null);
    }
  }

  async function addSelected() {
    if (toAdd.length === 0) return;
    setMemberBusy('__add__');
    setError(null);
    try {
      for (const u of toAdd) await addGroupMember(token, group.id, u);
      setToAdd([]);
      setAdding(false);
      onMembersChanged();
    } catch (err: any) {
      setError(err?.message || 'Failed to add members');
      onMembersChanged();
    } finally {
      setMemberBusy(null);
    }
  }

  async function handleLeave() {
    if (!window.confirm(`Leave "${group.name}"?`)) return;
    try {
      await leaveGroup(token, group.id);
      onGroupGone();
    } catch (err: any) {
      setError(err?.message || 'Failed to leave group');
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${group.name}" for everyone? All messages in it will be removed. This can't be undone.`)) return;
    try {
      await deleteGroup(token, group.id);
      onGroupGone();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete group');
    }
  }

  const sortedMembers = [...members].sort((a, b) =>
    (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) || a.username.localeCompare(b.username));

  return (
    <div
      className="mobile-drawer-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mobile-drawer" style={{ width: 360, maxWidth: '100vw', height: '100%', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,0.4)' }}>
        <div style={ds.head}>
          <span style={ds.title}>Group info</span>
          <button style={ds.closeBtn} onClick={onClose} aria-label="Close"><CloseIcon size={16} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Identity */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontWeight: 700,
              fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{initials(group.name)}</div>
            {editing ? (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                <span style={ds.label}>Name</span>
                <input style={ds.input} maxLength={100} value={name} onChange={e => setName(e.target.value)} />
                <span style={ds.label}>Description</span>
                <textarea
                  style={{ ...ds.input, minHeight: 72, resize: 'vertical' }}
                  maxLength={500}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Add a group description"
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button style={ds.ghostBtn} onClick={() => { setEditing(false); setName(group.name); setDescription(group.description ?? ''); }}>Cancel</button>
                  <button style={ds.primaryBtn} disabled={savingInfo} onClick={saveInfo}>{savingInfo ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem' }}>{group.name}</div>
                <div style={ds.hint}>Group · {members.length || group.member_count} members</div>
                <div style={{
                  color: group.description ? 'var(--text-secondary)' : 'var(--text-muted)', fontSize: '0.8rem',
                  whiteSpace: 'pre-wrap', lineHeight: 1.5, fontStyle: group.description ? 'normal' : 'italic',
                }}>
                  {group.description || (iAmAdmin ? 'No description yet' : 'No description')}
                </div>
                {iAmAdmin && <button style={ds.ghostBtn} onClick={() => setEditing(true)}>Edit name & description</button>}
              </>
            )}
          </div>

          {error && <span style={ds.error}>{error}</span>}

          {/* Disappearing messages */}
          <div style={ds.section}>
            <span style={{ ...ds.label, display: 'flex', alignItems: 'center', gap: 6 }}><TimerIcon size={13} /> Disappearing messages</span>
            {iAmAdmin ? (
              <>
                <DisappearPicker value={group.disappear_after_hours ?? null} onChange={setTimer} disabled={savingTimer} />
                <span style={ds.hint}>Applies to new messages from everyone in the group. Changing it posts a notice in the chat.</span>
              </>
            ) : (
              <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                {formatDisappear(group.disappear_after_hours)}
                <span style={{ ...ds.hint, display: 'block', marginTop: 4 }}>Only group admins can change this.</span>
              </span>
            )}
          </div>

          {iAmAdmin && (
            <div style={{ display: 'flex', gap: 6 }}>
              {(['info', 'invite'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    border: '1px solid var(--border-color)',
                    background: tab === t ? 'var(--item-active-bg)' : 'transparent',
                    color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {t === 'info' ? 'Members' : 'Invite via link / QR'}
                </button>
              ))}
            </div>
          )}

          {iAmAdmin && tab === 'invite' ? (
            <InviteSection token={token} groupId={group.id} />
          ) : (
            <div style={ds.section}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={ds.label}>Members ({members.length})</span>
                {iAmAdmin && !adding && <button style={ds.smallBtn} onClick={() => setAdding(true)}>+ Add</button>}
              </div>
              {adding && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <UserPicker
                    token={token}
                    exclude={members.map(m => m.username)}
                    selected={toAdd}
                    onToggle={u => setToAdd(s => (s.includes(u) ? s.filter(x => x !== u) : [...s, u]))}
                  />
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button style={ds.ghostBtn} onClick={() => { setAdding(false); setToAdd([]); }}>Cancel</button>
                    <button style={ds.primaryBtn} disabled={toAdd.length === 0 || memberBusy === '__add__'} onClick={addSelected}>
                      {memberBusy === '__add__' ? 'Adding…' : `Add ${toAdd.length || ''}`}
                    </button>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {sortedMembers.map(m => {
                  const isAdmin = m.role === 'admin';
                  const busy = memberBusy === m.username;
                  const isMe = m.username === myUsername;
                  return (
                    <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px' }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 700, flexShrink: 0,
                      }}>{m.username.slice(0, 2).toUpperCase()}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.username}{isMe ? ' (you)' : ''}
                        </div>
                        {isAdmin && <div style={{ fontSize: '0.66rem', color: 'var(--accent)', fontWeight: 600 }}>Group admin</div>}
                      </div>
                      {iAmAdmin && !isMe && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            style={{ ...ds.smallBtn, cursor: busy ? 'wait' : 'pointer' }}
                            disabled={busy}
                            onClick={() => memberAction(m.username, () =>
                              isAdmin ? demoteGroupMember(token, group.id, m.username) : promoteGroupMember(token, group.id, m.username))}
                          >
                            {busy ? '…' : isAdmin ? 'Dismiss admin' : 'Make admin'}
                          </button>
                          <button
                            style={{ ...ds.smallBtn, color: '#ef4444' }}
                            disabled={busy}
                            title={`Remove ${m.username}`}
                            onClick={() => {
                              if (window.confirm(`Remove ${m.username} from the group?`)) {
                                memberAction(m.username, () => removeGroupMember(token, group.id, m.username));
                              }
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <button style={ds.dangerBtn} onClick={handleLeave}>Leave group</button>
            {iAmAdmin && <button style={{ ...ds.dangerBtn, background: 'rgba(239,68,68,0.1)' }} onClick={handleDelete}>Delete group for everyone</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
