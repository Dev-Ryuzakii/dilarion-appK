import { useEffect, useState } from 'react';
import LoginScreen from './screens/LoginScreen';
import LinkDeviceScreen from './screens/LinkDeviceScreen';
import HomeScreen from './screens/HomeScreen';
import LivenessGateHost from './components/LivenessGateHost';
import { ensureDeviceRegistered } from './services/keys';
import { isLivenessLockEnabled, requestLivenessCheck } from './services/liveness';
import './App.css';

const SESSION_KEY = 'dilarion_session';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

interface StoredSession {
  token: string;
  username: string;
  loginTime: number;
}

function loadSession(): { token: string; username: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s: StoredSession = JSON.parse(raw);
    if (Date.now() - s.loginTime > SESSION_TTL) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { token: s.token, username: s.username };
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(token: string, username: string) {
  const s: StoredSession = { token, username, loginTime: Date.now() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export default function App() {
  const [session, setSession] = useState<{ token: string; username: string } | null>(loadSession);
  // QR linking is the default entry, username/token sign-in is the fallback.
  const [usePassword, setUsePassword] = useState(false);

  // App-entry liveness gate — once per launch, not per window-focus (a desktop
  // app doesn't background/foreground the way a phone does, and re-checking on
  // every alt-tab would be unusable). Off unless opted into in Settings.
  const [appUnlocked, setAppUnlocked] = useState(() => !isLivenessLockEnabled());
  const [appLockFailed, setAppLockFailed] = useState(false);

  useEffect(() => {
    if (!session || appUnlocked) return;
    requestLivenessCheck().then(ok => {
      if (ok) setAppUnlocked(true);
      else setAppLockFailed(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function handleLogin(t: string, u: string) {
    saveSession(t, u);
    // Make sure this desktop has its own device key registered so others can
    // encrypt to it and it can find its own entry when decrypting.
    ensureDeviceRegistered(t, u).catch(() => {});
    setSession({ token: t, username: u });
    setUsePassword(false);
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  if (session && !appUnlocked) {
    return (
      <>
        <div style={{
          position: 'fixed', inset: 0, background: '#0b0b0b', display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
        }}>
          <div style={{ color: '#fff', fontSize: '1rem', fontWeight: 700 }}>Dilarion is locked</div>
          {appLockFailed && (
            <>
              <div style={{ color: '#9ca3af', fontSize: '0.82rem', maxWidth: 280, textAlign: 'center' }}>
                Liveness check didn't pass. Try again, or log out if this isn't your device.
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => { setAppLockFailed(false); requestLivenessCheck().then(ok => { if (ok) setAppUnlocked(true); else setAppLockFailed(true); }); }}
                  style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Try again
                </button>
                <button
                  onClick={handleLogout}
                  style={{ background: 'transparent', color: '#9ca3af', border: '1px solid #333', borderRadius: 8, padding: '8px 18px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
        <LivenessGateHost />
      </>
    );
  }

  if (session) {
    return (
      <>
        <HomeScreen token={session.token} username={session.username} onLogout={handleLogout} />
        <LivenessGateHost />
      </>
    );
  }
  if (usePassword) {
    return <LoginScreen onLogin={handleLogin} onBack={() => setUsePassword(false)} />;
  }
  return <LinkDeviceScreen onLinked={handleLogin} onUsePassword={() => setUsePassword(true)} />;
}
