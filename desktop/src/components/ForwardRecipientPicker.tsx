import { useEffect, useMemo, useState } from 'react';
import { Contact, getConversations, getUsers } from '../services/api';

const RECENT_LIMIT = 4;

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

function Avatar({ username }: { username: string }) {
  return (
    <span style={{
      width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
    }}>
      {initials(username)}
    </span>
  );
}

function ContactRow({ username, selected, onClick }: { username: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        background: selected ? 'rgba(124,58,237,0.15)' : 'transparent',
        border: 'none', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', textAlign: 'left',
      }}
    >
      <Avatar username={username} />
      <span style={{ flex: 1, color: 'var(--text-primary)', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {username}
      </span>
      {selected && <span style={{ color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 700 }}>✓</span>}
    </button>
  );
}

/**
 * WhatsApp-style forward recipient picker: recent/frequent contacts up front
 * (as many as exist, up to RECENT_LIMIT), a search box, and the rest of the
 * contact list below — tap to pick, instead of typing a username by hand.
 */
export default function ForwardRecipientPicker({
  token, onCancel, onConfirm, busy = false, error,
}: {
  token: string;
  onCancel: () => void;
  onConfirm: (username: string) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [recent, setRecent] = useState<Contact[]>([]);
  const [all, setAll] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [conv, users] = await Promise.all([
        getConversations(token).catch(() => []),
        getUsers(token).catch(() => []),
      ]);
      if (cancelled) return;
      setRecent(conv.slice(0, RECENT_LIMIT));
      setAll(users);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const recentUsernames = useMemo(() => new Set(recent.map(c => c.username)), [recent]);
  const rest = useMemo(() => all.filter(c => !recentUsernames.has(c.username)), [all, recentUsernames]);

  const q = search.trim().toLowerCase();
  const filteredRecent = q ? recent.filter(c => c.username.toLowerCase().includes(q)) : recent;
  const filteredRest = q ? rest.filter(c => c.username.toLowerCase().includes(q)) : rest;

  return (
    <div className="responsive-overlay" style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="responsive-dialog" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 20, width: 340, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: '0.95rem' }}>Forward message</h3>
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search a contact…"
          style={{ width: '100%', background: 'var(--input-field-bg)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.85rem', padding: '8px 10px', marginBottom: 10, flexShrink: 0 }}
        />
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 100 }}>
          {loading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '20px 0' }}>Loading contacts…</p>
          ) : (
            <>
              {filteredRecent.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  {!q && <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', margin: '4px 10px' }}>Recent</p>}
                  {filteredRecent.map(c => (
                    <ContactRow key={c.username} username={c.username} selected={selected === c.username} onClick={() => setSelected(c.username)} />
                  ))}
                </div>
              )}
              {filteredRest.length > 0 && (
                <div>
                  {!q && <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', margin: '4px 10px' }}>All contacts</p>}
                  {filteredRest.map(c => (
                    <ContactRow key={c.username} username={c.username} selected={selected === c.username} onClick={() => setSelected(c.username)} />
                  ))}
                </div>
              )}
              {filteredRecent.length === 0 && filteredRest.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '20px 0' }}>No contacts found</p>
              )}
            </>
          )}
        </div>
        {error && <p style={{ color: '#ef4444', fontSize: '0.75rem', margin: '10px 0 0' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, flexShrink: 0 }}>
          <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', padding: '7px 14px', cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || busy}
            style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, color: '#fff', padding: '7px 14px', cursor: 'pointer', fontSize: '0.8rem', opacity: (!selected || busy) ? 0.6 : 1 }}
          >
            {busy ? 'Forwarding…' : 'Forward'}
          </button>
        </div>
      </div>
    </div>
  );
}
