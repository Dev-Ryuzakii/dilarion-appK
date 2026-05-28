import { useState } from 'react';
import { login } from '../services/api';

interface Props { onLogin: (token: string, username: string) => void; }

export default function LoginScreen({ onLogin }: Props) {
  const [username, setUsername]   = useState('');
  const [userToken, setUserToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(username, userToken) as Record<string, string>;
      const sessionToken = data.token || data.access_token || data.session_token;
      if (!sessionToken) throw new Error('No session token received');
      onLogin(sessionToken, username);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.root}>
      <div style={s.card}>
        <div style={s.logoWrap}>
          <img
            src="/logo.jpg"
            alt="Dilarion"
            style={s.logo}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
        <h1 style={s.title}>Dilarion</h1>
        <p style={s.sub}>Sign in to continue</p>

        <form onSubmit={handleSubmit} style={s.form}>
          <input
            style={s.input}
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            required
          />

          <div style={s.tokenWrap}>
            <input
              style={s.tokenInput}
              type={showToken ? 'text' : 'password'}
              placeholder="Access Token"
              value={userToken}
              onChange={e => setUserToken(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              style={s.eyeBtn}
              onClick={() => setShowToken(v => !v)}
              tabIndex={-1}
              aria-label={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          {error && <p style={s.error}>{error}</p>}

          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0c0c0c',
    padding: '1.5rem',
    height: '100vh',
  },
  card: {
    background: '#141414',
    border: '1px solid #1e1e1e',
    borderRadius: 20,
    padding: '2.5rem 2rem',
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
  },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: 18,
    overflow: 'hidden',
    border: '1px solid #2a2a2a',
    marginBottom: '0.75rem',
    background: '#1e1e1e',
  },
  logo: { width: '100%', height: '100%', objectFit: 'cover' },
  title: {
    fontSize: '1.6rem',
    fontWeight: 800,
    letterSpacing: '-0.04em',
    color: '#fff',
  },
  sub: { fontSize: '0.8rem', color: '#6b7280', marginBottom: '1rem' },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  input: {
    background: '#0c0c0c',
    border: '1px solid #2a2a2a',
    borderRadius: 12,
    padding: '0.75rem 1rem',
    color: '#fff',
    fontSize: '0.9rem',
    width: '100%',
  },
  tokenWrap: {
    position: 'relative',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
  },
  tokenInput: {
    background: '#0c0c0c',
    border: '1px solid #2a2a2a',
    borderRadius: 12,
    padding: '0.75rem 2.8rem 0.75rem 1rem',
    color: '#fff',
    fontSize: '0.9rem',
    width: '100%',
    fontFamily: 'inherit',
    outline: 'none',
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    background: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    outline: 'none',
    lineHeight: 0,
  },
  error: {
    fontSize: '0.78rem',
    color: '#ef4444',
    textAlign: 'center',
  },
  btn: {
    background: '#c0392b',
    color: '#fff',
    borderRadius: 12,
    padding: '0.85rem',
    fontSize: '0.95rem',
    fontWeight: 700,
    marginTop: '0.25rem',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
