import { useState } from 'react';
import { login } from '../services/api';
import { LockIcon } from './Icons';

// Shown after the idle timeout logs the user out. Asks for the access token
// (same as the username/token sign-in) and starts a fresh session.
export default function IdleLockScreen({ username, onUnlocked, onSwitchAccount }: {
  username: string;
  onUnlocked: (sessionToken: string, username: string) => void;
  onSwitchAccount: () => void;
}) {
  const [accessToken, setAccessToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await login(username, accessToken.trim()) as Record<string, string>;
      const sessionToken = data.token || data.access_token || data.session_token;
      if (!sessionToken) throw new Error('No session token received');
      setAccessToken('');
      onUnlocked(sessionToken, username);
    } catch (err: any) {
      setError(err?.message || 'Invalid access token');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <form onSubmit={submit} style={{
        width: 360, maxWidth: '100%', background: 'var(--bg-panel)', border: '1px solid var(--border-color)',
        borderRadius: 16, padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'stretch',
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
      }}>
        <div style={{
          alignSelf: 'center', width: 52, height: 52, borderRadius: '50%', background: 'var(--bg-card)',
          border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <LockIcon size={22} color="var(--accent)" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.05rem' }}>Session timed out</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 6, lineHeight: 1.5 }}>
            You were logged out after being inactive. Enter your access token to continue as <strong style={{ color: 'var(--text-primary)' }}>{username}</strong>.
          </div>
        </div>
        <input
          type="password"
          autoFocus
          placeholder="Access token"
          value={accessToken}
          onChange={e => setAccessToken(e.target.value)}
          style={{
            background: 'var(--input-field-bg, var(--bg-card))', border: '1px solid var(--border-color)', borderRadius: 8,
            color: 'var(--text-primary)', fontSize: '0.88rem', padding: '10px 12px', fontFamily: 'inherit',
          }}
        />
        {error && <span style={{ color: '#ef4444', fontSize: '0.78rem' }}>{error}</span>}
        <button
          type="submit"
          disabled={busy || !accessToken.trim()}
          style={{
            background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 0',
            fontSize: '0.88rem', fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy || !accessToken.trim() ? 0.7 : 1,
            fontFamily: 'inherit',
          }}
        >
          {busy ? 'Signing in…' : 'Unlock'}
        </button>
        <button
          type="button"
          onClick={onSwitchAccount}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Not you? Sign in with a different account
        </button>
      </form>
    </div>
  );
}
