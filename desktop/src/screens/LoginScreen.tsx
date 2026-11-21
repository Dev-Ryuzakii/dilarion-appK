import { useEffect, useState } from 'react';
import { login, requestPasswordReset, signUp, resetWithRecoveryCode, activateAccount, loginOrganization, loginRequestStatus, loginRequestMasterToken, loginRequestCancel, LoginApprovalRequired } from '../services/api';
import OnboardingScreen from './OnboardingScreen';
import { userMessage } from '../services/errors';

interface Props {
  onLogin: (token: string, username: string) => void;
  onBack?: () => void;
  /** Open straight on a view, e.g. 'activate' from the link-device screen. */
  initialView?: View;
  /** Why the previous session ended, e.g. a newer sign-in replaced it. */
  notice?: string | null;
}

export type View = 'login' | 'forgot' | 'signup' | 'recovery' | 'activate';

export default function LoginScreen({ onLogin, onBack, initialView = 'login', notice }: Props) {
  const [view, setView] = useState<View>(initialView);

  // Invited staff: activation code + chosen token, then the mandatory profile.
  const [actCode, setActCode] = useState('');
  const [actToken, setActToken] = useState('');
  const [actConfirm, setActConfirm] = useState('');
  const [actError, setActError] = useState('');
  const [actLoading, setActLoading] = useState(false);
  // Signed in but the profile + live photo step is still owed.
  const [onboarding, setOnboarding] = useState<{ token: string; username: string } | null>(null);
  // Activation already signed the user in - after the recovery code is shown,
  // continue (to onboarding or the app) instead of back to the sign-in form.
  const [activated, setActivated] = useState<{ token: string; username: string; onboarding: boolean } | null>(null);

  const [username, setUsername]   = useState('');
  const [userToken, setUserToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  // Signed in elsewhere: this device waits for the owner to approve it.
  const [approval, setApproval]   = useState<LoginApprovalRequired | null>(null);
  const [approvalState, setApprovalState] = useState<'pending' | 'denied' | 'expired' | 'cancelled'>('pending');
  const [approvalError, setApprovalError] = useState('');
  const [showMasterToken, setShowMasterToken] = useState(false);
  const [mtInput, setMtInput] = useState('');
  const [mt2fa, setMt2fa] = useState('');
  const [mtBusy, setMtBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

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

  /** A finished /auth/login response (direct, or after approval). */
  function completeLogin(data: Record<string, any>) {
    const sessionToken = data.token || data.access_token || data.session_token;
    if (!sessionToken) throw new Error('No session token received');
    if (data.onboarding_required) {
      // Invited staff finish the live-photo profile right here; the server
      // refuses everything else until it's done.
      setOnboarding({ token: sessionToken, username: data.username || username });
      return;
    }
    onLogin(sessionToken, data.username || username);
  }

  // Poll until the owner approves (on a signed-in device or by email) or it ends.
  useEffect(() => {
    if (!approval || approvalState !== 'pending') return;
    let stopped = false;
    const tick = async () => {
      try {
        const st = await loginRequestStatus(approval.request_token);
        if (stopped) return;
        if (st.status === 'completed' && st.login) { setApproval(null); completeLogin(st.login); return; }
        if (st.status === 'denied' || st.status === 'expired' || st.status === 'cancelled') setApprovalState(st.status);
      } catch {
        // Network blip: keep polling until it expires.
      }
    };
    const id = setInterval(tick, 2500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    tick();
    return () => { stopped = true; clearInterval(id); clearInterval(clock); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval, approvalState]);

  async function submitMasterToken(e: React.FormEvent) {
    e.preventDefault();
    if (!approval || !mtInput.trim()) return;
    setMtBusy(true);
    setApprovalError('');
    try {
      const st = await loginRequestMasterToken(approval.request_token, mtInput.trim(), mt2fa);
      if (st.login) { setApproval(null); completeLogin(st.login); }
    } catch (err: any) {
      if (err?.status === 403) setApprovalState('denied');
      setApprovalError(err?.message || 'Wrong master token.');
    } finally {
      setMtBusy(false);
    }
  }

  function leaveApproval() {
    if (approval && approvalState === 'pending') loginRequestCancel(approval.request_token);
    setApproval(null);
    setApprovalState('pending');
    setApprovalError('');
    setShowMasterToken(false);
    setMtInput('');
    setMt2fa('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(username, userToken) as Record<string, any>;
      if (data.status === 'approval_required') {
        setApprovalState('pending');
        setApproval(data as LoginApprovalRequired);
        return;
      }
      completeLogin(data);
    } catch (err: any) {
      // Fall back to an organization-account login: the org account signs in
      // with username + password (typed in the token field) and now runs its
      // organization from inside the app.
      try {
        const org = await loginOrganization(username.trim().toLowerCase(), userToken);
        if (org?.token) {
          // Email sign-in works too; the server returns the real username.
          onLogin(org.token, org.username || username.trim().toLowerCase());
          return;
        }
      } catch {}
      setError(userMessage(err, err?.message || 'Invalid username or token. Please check your details and try again.'));
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
      setSignupError(userMessage(err, err?.message || "Couldn't create your account. Please try again."));
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
      setRecError(userMessage(err, err?.message || "Couldn't reset with that code. Please check it and try again."));
    } finally {
      setRecLoading(false);
    }
  }

  function dismissRevealedCode() {
    if (activated) {
      setRevealedCode(null);
      if (activated.onboarding) setOnboarding({ token: activated.token, username: activated.username });
      else onLogin(activated.token, activated.username);
      setActivated(null);
      return;
    }
    if (revealedCode) setUsername(revealedCode.username);
    setRevealedCode(null);
    setView('login');
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setActError('');
    if (!actCode.trim()) return setActError('Enter the activation code from your email or SMS');
    // Codes are long random strings; a username here is the usual mix-up.
    if (actCode.trim().length < 20 && !actCode.includes('code=')) return setActError("That isn't an activation code. Use the long code from your invitation email or SMS, not your username.");
    if (actToken.length < 8) return setActError('Your login token must be at least 8 characters');
    if (actToken !== actConfirm) return setActError('The two tokens do not match');
    setActLoading(true);
    try {
      const r = await activateAccount(actCode, actToken);
      setActivated({ token: r.token, username: r.username, onboarding: r.onboarding_required });
      if (r.recovery_code) {
        setRevealedCode({ username: r.username, code: r.recovery_code });
      } else if (r.onboarding_required) {
        setOnboarding({ token: r.token, username: r.username });
      } else {
        onLogin(r.token, r.username);
      }
    } catch (err: any) {
      setActError(userMessage(err, err?.message || "Couldn't activate your account. Please check the code and try again."));
    } finally {
      setActLoading(false);
    }
  }

  if (onboarding) {
    return (
      <OnboardingScreen
        sessionToken={onboarding.token}
        username={onboarding.username}
        onDone={() => onLogin(onboarding.token, onboarding.username)}
        onCancel={() => { setOnboarding(null); setView('login'); }}
      />
    );
  }

  if (approval) {
    const left = Math.max(0, Math.round((new Date(approval.expires_at).getTime() - now) / 1000));
    const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const ended = approvalState !== 'pending';
    return (
      <div className="auth-page" style={s.root}>
        <div className="auth-card" style={s.card}>
          <div style={s.logoWrap}>
            <img src="/logo.jpg" alt="Dilarion" style={s.logo} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          </div>
          <h1 style={s.title}>
            {approvalState === 'denied' ? 'Sign-in blocked' : approvalState === 'expired' ? 'Request expired' : 'Approve this sign-in'}
          </h1>
          <p style={{ ...s.sub, lineHeight: 1.6, textAlign: 'center' }}>
            {approvalState === 'denied'
              ? 'This sign-in was blocked from your account. If that was a mistake, try again and approve it.'
              : approvalState === 'expired'
                ? 'Nobody approved this sign-in in time. Try again.'
                : <>Your account is signed in on another device. On that device, tap <b>Yes, it's me</b>
                  {approval.email_sent ? <>, or use the link we just emailed you</> : null}.</>}
          </p>
          {!ended && (
            <div style={{ width: '100%', border: '1px solid var(--border-color)', borderRadius: 10, padding: '10px 14px', fontSize: '0.8rem', lineHeight: 1.7, marginBottom: '0.75rem' }}>
              <div><span style={{ color: 'var(--text-muted)' }}>This device:</span> {approval.device_name}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Location:</span> {approval.location}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Waiting:</span> expires in {mmss}</div>
            </div>
          )}
          {!ended && !showMasterToken && (
            <button type="button" style={s.linkBtn} onClick={() => setShowMasterToken(true)}>
              Can't reach your other device? Use your master token
            </button>
          )}
          {!ended && showMasterToken && (
            <form onSubmit={submitMasterToken} style={s.form}>
              <input style={s.input} type="password" placeholder="Master token" value={mtInput} onChange={e => setMtInput(e.target.value)} autoFocus />
              {approval.two_fa_required && (
                <input style={s.input} type="password" placeholder="2FA password" value={mt2fa} onChange={e => setMt2fa(e.target.value)} />
              )}
              <button style={s.btn} type="submit" disabled={mtBusy || !mtInput.trim() || (approval.two_fa_required && !mt2fa)}>
                {mtBusy ? 'Checking…' : 'Sign in with master token'}
              </button>
            </form>
          )}
          {approvalError && <p style={s.error}>{approvalError}</p>}
          <button type="button" style={ended ? s.btn : s.linkBtn} onClick={leaveApproval}>
            {ended ? 'Back to sign in' : 'Cancel'}
          </button>
        </div>
      </div>
    );
  }

  if (revealedCode) {
    return (
      <div className="auth-page" style={s.root}>
        <div className="auth-card" style={s.card}>
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
            {activated ? 'Continue' : 'Continue to sign in'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page" style={s.root}>
      <div className="auth-card" style={s.card}>
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
            : view === 'activate' ? 'Activate your account'
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
            {forgotMessage && <p style={{ ...s.error, color: 'var(--accent)' }}>{forgotMessage}</p>}
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

        {view === 'activate' && (
          <form onSubmit={handleActivate} style={s.form}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 4px', lineHeight: 1.5 }}>
              Your organization sent you an activation code by email or SMS. Enter it, then choose your private login token.
            </p>
            <input
              style={s.input}
              type="text"
              placeholder="Activation code"
              value={actCode}
              onChange={e => setActCode(e.target.value.trim())}
              autoComplete="one-time-code"
              required
            />
            <input
              style={s.input}
              type="password"
              placeholder="Choose a login token (min 8 characters)"
              value={actToken}
              onChange={e => setActToken(e.target.value)}
              autoComplete="new-password"
              required
            />
            <input
              style={s.input}
              type="password"
              placeholder="Confirm login token"
              value={actConfirm}
              onChange={e => setActConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
            {actError && <p style={s.error}>{actError}</p>}
            <button style={s.btn} type="submit" disabled={actLoading}>
              {actLoading ? 'Activating…' : 'Activate'}
            </button>
            <button type="button" style={{ ...s.linkBtn, border: 'none', padding: '4px 0' }} onClick={() => setView('login')}>
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

          {notice && <p style={s.notice}>{notice}</p>}

          {error && <p style={s.error}>{error}</p>}

          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          <button type="button" style={{ ...s.linkBtn, border: 'none', padding: '4px 0' }} onClick={() => setView('activate')}>
            Have an activation code? Activate account
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
    margin: '0.25rem 0', color: 'var(--text-muted)',
    borderTop: '1px solid var(--border-color)', position: 'relative',
  },
  dividerText: {
    position: 'absolute', left: '50%', top: -10, transform: 'translateX(-50%)',
    background: 'var(--bg-panel)', padding: '0 10px', fontSize: '0.72rem', color: 'var(--text-muted)',
  },
  linkBtn: {
    background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border-color)',
    borderRadius: 10, padding: '10px 0', width: '100%', fontSize: '0.85rem',
    fontWeight: 600, cursor: 'pointer',
  },
  root: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--frame-bg)',
    padding: '1.5rem',
    height: '100vh',
  },
  card: {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-color)',
    boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
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
    border: '1px solid var(--border-color)',
    marginBottom: '0.75rem',
    background: 'var(--bg-card)',
  },
  logo: { width: '100%', height: '100%', objectFit: 'cover' },
  title: {
    fontSize: '1.6rem',
    fontWeight: 800,
    letterSpacing: '-0.04em',
    color: 'var(--text-primary)',
  },
  sub: { fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  input: {
    background: 'var(--input-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 12,
    padding: '0.75rem 1rem',
    color: 'var(--text-primary)',
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
    background: 'var(--input-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 12,
    padding: '0.75rem 2.8rem 0.75rem 1rem',
    color: 'var(--text-primary)',
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
    color: 'var(--text-muted)',
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
  // End-of-session banner: informational, not a failure the user caused, so it
  // reads in muted text rather than the red of a bad token.
  notice: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary, #9ca3af)',
    textAlign: 'center',
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 10,
    padding: '8px 12px',
    lineHeight: 1.4,
  },
  btn: {
    background: 'var(--accent)',
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
    background: 'var(--input-bg)',
    border: '1px dashed var(--accent)',
    borderRadius: 12,
    padding: '1rem',
    color: 'var(--text-primary)',
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
    color: 'var(--text-muted)',
    width: '100%',
    marginBottom: '0.25rem',
  },
};
