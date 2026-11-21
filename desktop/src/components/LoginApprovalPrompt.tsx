import React, { useCallback, useEffect, useState } from 'react';
import { presenceService, WsMessage } from '../services/presence';
import { decideLoginRequest, getPendingLoginRequests, PendingLoginRequest } from '../services/api';

/**
 * "Are you the one trying to sign in on <device>?" Shown on every device that
 * is already signed in when the account tries to sign in somewhere new. The
 * new device stays waiting until one of them (or the email link) answers.
 */
export default function LoginApprovalPrompt({ token }: { token: string }) {
  const [queue, setQueue] = useState<PendingLoginRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const pending = await getPendingLoginRequests(token);
    setQueue(pending);
  }, [token]);

  useEffect(() => {
    refresh();
    const onMsg = (msg: WsMessage) => {
      const d = (msg as any).data || {};
      if (msg.type === 'login_approval_request' && d.request_id) {
        setQueue(prev => prev.some(r => r.request_id === d.request_id) ? prev : [...prev, d as PendingLoginRequest]);
        try { window.focus(); } catch {}
      } else if (msg.type === 'login_approval_resolved' && d.request_id) {
        // Answered on another device, by email, or it expired.
        setQueue(prev => prev.filter(r => r.request_id !== d.request_id));
      }
    };
    presenceService.addListener(onMsg);
    // Requests made while this device was offline or asleep.
    const onFocus = () => { refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { presenceService.removeListener(onMsg); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  // Drop requests once their 10 minutes are up.
  useEffect(() => {
    if (!queue.length) return;
    const id = setInterval(() => {
      setQueue(prev => prev.filter(r => new Date(r.expires_at).getTime() > Date.now()));
    }, 5000);
    return () => clearInterval(id);
  }, [queue.length]);

  const req = queue[0];
  if (!req) return null;

  async function answer(approve: boolean) {
    setBusy(true);
    setError('');
    try {
      await decideLoginRequest(token, req.request_id, approve);
      setQueue(prev => prev.filter(r => r.request_id !== req.request_id));
    } catch (e: any) {
      setError(e?.message || "Couldn't send your answer.");
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="responsive-overlay" style={st.backdrop}>
      <div className="responsive-dialog" style={st.card} role="alertdialog" aria-labelledby="login-approval-title">
        <div style={st.icon}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        </div>
        <p style={st.kicker}>New sign-in request</p>
        <h3 id="login-approval-title" style={st.title}>Is this you signing in on {req.device_name}?</h3>
        <div style={st.details}>
          <div><strong>Device:</strong> {req.device_name}{req.platform ? ` (${req.platform})` : ''}</div>
          <div><strong>Location:</strong> {req.location || 'Unknown'}</div>
          {req.ip && <div><strong>IP address:</strong> {req.ip}</div>}
          <div><strong>Time:</strong> {req.time ? new Date(req.time).toLocaleString() : 'Just now'}</div>
        </div>
        <p style={st.hint}>
          You stay signed in here either way. If this wasn't you, block it and change your login token.
        </p>
        {error && <p style={{ ...st.hint, color: 'var(--accent)' }}>{error}</p>}
        <div style={st.row}>
          <button style={st.deny} disabled={busy} onClick={() => answer(false)}>No, block it</button>
          <button style={st.approve} disabled={busy} onClick={() => answer(true)}>Yes, it's me</button>
        </div>
        {queue.length > 1 && <p style={{ ...st.hint, textAlign: 'right' }}>{queue.length - 1} more waiting</p>}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)', zIndex: 960,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 20,
    boxShadow: '0 24px 60px rgba(15,23,42,0.18)', padding: '26px 26px 22px', width: 400, maxWidth: 'calc(100vw - 32px)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  icon: {
    width: 44, height: 44, borderRadius: 14, background: 'rgba(216,52,40,0.10)', color: 'var(--accent)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  kicker: { margin: 0, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent)', textTransform: 'uppercase' },
  title: { margin: 0, color: 'var(--text-primary)', fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.3 },
  details: { fontSize: '0.85rem', lineHeight: 1.8, color: 'var(--text-primary)', margin: '6px 0 4px' },
  hint: { margin: 0, fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-muted)' },
  row: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 },
  deny: {
    background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 999,
    padding: '0.6rem 1.1rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit',
  },
  approve: {
    background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 999,
    padding: '0.6rem 1.4rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'inherit',
  },
};
