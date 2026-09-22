import { useState } from 'react';
import { login, requestPasswordReset, signUp, resetWithRecoveryCode } from '../services/api';

interface Props {
  onLogin: (token: string, username: string) => void;
  onBack?: () => void;
}

type View = 'login' | 'forgot' | 'signup' | 'recovery';

export default function LoginScreen({ onLogin, onBack }: Props) {
  const [view, setView] = useState<View>('login');

  const [username, setUsername]   = useState('');
  const [userToken, setUserToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  const [forgotPhone, setForgotPhone] = useState('');
  const [forgotReason, setForgotReason] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);

  const [signupUsername, setSignupUsername] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupToken, setSignupToken] = useState('');
  const [signupError, setSignupError] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);

  const [recUsername, setRecUsername] = useState('');
  const [recCode, setRecCode] = useState('');
  const [recNewToken, setRecNewToken] = useState('');
  const [recError, setRecError] = useState('');
  const [recLoading, setRecLoading] = useState(false);

  // Shown once after signup or a recovery-code reset — the same reveal
  // screen either way, since both hand back a fresh code that never comes
  // back again.
  const [revealedCode, setRevealedCode] = useState<{ username: string; code: string } | null>(null);
  const [savedAck, setSavedAck] = useState(false);

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotLoading(true);
    setForgotMessage(null);
    try {
      await requestPasswordReset(forgotPhone.trim(), forgotReason.trim() || undefined);
      setForgotMessage('If that phone number is registered, an administrator has been notified and will reach out with a new access token.');
      setForgotPhone('');
      setForgotReason('');
    } catch {
      setForgotMessage('Something went wrong submitting the request — try again in a moment.');
    } finally {
      setForgotLoading(false);
    }
  }

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

  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSignupError('');
    setSignupLoading(true);
    try {
      const result = await signUp(signupUsername.trim(), signupPhone.trim(), signupToken);
      setRevealedCode({ username: result.username, code: result.recovery_code });
      setSavedAck(false);
      setSignupUsername(''); setSignupPhone(''); setSignupToken('');
    } catch (err: any) {
      setSignupError(err.message || 'Failed to create account');
    } finally {
      setSignupLoading(false);
    }
  }

  async function handleRecoverySubmit(e: React.FormEvent) {
    e.preventDefault();
    setRecError('');
    setRecLoading(true);
    try {
      const result = await resetWithRecoveryCode(recUsername.trim(), recCode.trim(), recNewToken);
      setRevealedCode({ username: result.username, code: result.recovery_code });
      setSavedAck(false);
      setRecUsername(''); setRecCode(''); setRecNewToken('');
    } catch (err: any) {
      setRecError(err.message || 'Failed to reset');
    } finally {
      setRecLoading(false);
    }
  }

  function dismissRevealedCode() {
    if (revealedCode) setUsername(revealedCode.username);
    setRevealedCode(null);
    setView('login');
  }

  if (revealedCode) {
    return (
      <div style={s.root}>
        <div style={s.card}>
          <div style={s.logoWrap}>
            <img src="/logo.jpg" alt="Dilarion" style={s.logo} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          </div>
          <h1 style={s.title}>Save your recovery code</h1>
          <p style={{ ...s.sub, marginBottom: '0.5rem' }}>
            This is shown once. If you lose your access token later, this code is the only way to
            get back in without an admin. Write it down or save it somewhere safe now.
          </p>
          <div style={s.codeBox}>{revealedCode.code}</div>
          <button
            type="button"
            style={{ ...s.linkBtn, marginBottom: '0.5rem' }}
            onClick={() => navigator.clipboard?.writeText(revealedCode.code).catch(() => {})}
          >
            Copy code
          </button>
          <label style={s.ackRow}>
            <input type="checkbox" checked={savedAck} onChange={e => setSavedAck(e.target.checked)} />
            I've saved this code somewhere safe
          </label>
          <button style={{ ...s.btn, opacity: savedAck ? 1 : 0.5 }} disabled={!savedAck} onClick={dismissRevealedCode}>
            Continue to sign in
          </button>
        </div>
      </div>
    );
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
        <p style={s.sub}>
          {view === 'forgot' ? 'Request a token reset'
            : view === 'signup' ? 'Create your account'
            : view === 'recovery' ? 'Reset with your recovery code'
            : 'Sign in to continue'}
        </p>

        {view === 'forgot' && (
          <form onSubmit={handleForgotSubmit} style={s.form}>
            <input
              style={s.input}
              type="tel"
              placeholder="Phone number (used at signup)"
              value={forgotPhone}
              onChange={e => setForgotPhone(e.target.value)}
              required
            />
            <input
              style={s.input}
              type="text"
              placeholder="Reason (optional)"
              value={forgotReason}
              onChange={e => setForgotReason(e.target.value)}
            />
            {forgotMessage && <p style={{ ...s.error, color: '#93c5fd' }}>{forgotMessage}</p>}
            <button style={s.btn} type="submit" disabled={forgotLoading || !forgotPhone.trim()}>
              {forgotLoading ? 'Submitting…' : 'Submit Request'}
            </button>
            <button type="button" style={s.linkBtn} onClick={() => setView('recovery')}>
              I have a recovery code instead
            </button>
            <button type="button" style={s.linkBtn} onClick={() => { setView('login'); setForgotMessage(null); }}>
              Back to sign in
            </button>
          </form>
        )}

        {view === 'recovery' && (
          <form onSubmit={handleRecoverySubmit} style={s.form}>
            <input
              style={s.input}
              type="text"
              placeholder="Username"
              value={recUsername}
              onChange={e => setRecUsername(e.target.value)}
              required
            />
            <input
              style={{ ...s.input, textTransform: 'uppercase' }}
              type="text"
              placeholder="Recovery code (XXXX-XXXX-XXXX)"
              value={recCode}
              onChange={e => setRecCode(e.target.value)}
              required
            />
            <input
              style={s.input}
              type="password"
              placeholder="New access token"
              value={recNewToken}
              onChange={e => setRecNewToken(e.target.value)}
              minLength={6}
              required
            />
            {recError && <p style={s.error}>{recError}</p>}
            <button style={s.btn} type="submit" disabled={recLoading}>
              {recLoading ? 'Resetting…' : 'Reset access'}
            </button>
            <button type="button" style={s.linkBtn} onClick={() => { setView('login'); setRecError(''); }}>
              Back to sign in
            </button>
          </form>
        )}

        {view === 'signup' && (
          <form onSubmit={handleSignupSubmit} style={s.form}>
            <input
              style={s.input}
              type="text"
              placeholder="Choose a username"
              value={signupUsername}
              onChange={e => setSignupUsername(e.target.value)}
              minLength={3}
              required
            />
            <input
              style={s.input}
              type="tel"
              placeholder="Phone number"
              value={signupPhone}
              onChange={e => setSignupPhone(e.target.value)}
              required
            />
            <input
              style={s.input}
              type="password"
              placeholder="Choose an access token"
              value={signupToken}
              onChange={e => setSignupToken(e.target.value)}
              minLength={6}
              required
            />
            {signupError && <p style={s.error}>{signupError}</p>}
            <button style={s.btn} type="submit" disabled={signupLoading}>
              {signupLoading ? 'Creating account…' : 'Create account'}
            </button>
            <button type="button" style={s.linkBtn} onClick={() => { setView('login'); setSignupError(''); }}>
              Back to sign in
            </button>
          </form>
        )}

        {view === 'login' && (
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
          <button type="button" style={{ ...s.linkBtn, border: 'none', padding: '4px 0' }} onClick={() => setView('signup')}>
            Don't have an account? Sign up
          </button>
          <button type="button" style={{ ...s.linkBtn, border: 'none', padding: '4px 0' }} onClick={() => setView('forgot')}>
            Forgot your access token?
          </button>
        </form>
        )}

        {view === 'login' && onBack && (
          <>
            <div style={s.divider}><span style={s.dividerText}>or</span></div>
            <button type="button" style={s.linkBtn} onClick={onBack}>
              Link with phone (scan QR) instead
            </button>
          </>
        )}
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
  divider: {
    display: 'flex', alignItems: 'center', width: '100%',
    margin: '0.25rem 0', color: '#3a3a3a',
    borderTop: '1px solid #1e1e1e', position: 'relative',
  },
  dividerText: {
    position: 'absolute', left: '50%', top: -10, transform: 'translateX(-50%)',
    background: '#141414', padding: '0 10px', fontSize: '0.72rem', color: '#6b7280',
  },
  linkBtn: {
    background: 'transparent', color: '#93c5fd', border: '1px solid #1e1e1e',
    borderRadius: 10, padding: '10px 0', width: '100%', fontSize: '0.85rem',
    fontWeight: 600, cursor: 'pointer',
  },
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
  codeBox: {
    width: '100%',
    background: '#0c0c0c',
    border: '1px dashed #c0392b',
    borderRadius: 12,
    padding: '1rem',
    color: '#fff',
    fontSize: '1.15rem',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textAlign: 'center',
    fontFamily: 'monospace',
    marginBottom: '0.5rem',
  },
  ackRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: '0.8rem',
    color: '#9ca3af',
    width: '100%',
    marginBottom: '0.25rem',
  },
};
