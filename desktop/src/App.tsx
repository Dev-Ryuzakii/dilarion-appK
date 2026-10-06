import { useEffect, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isTauri } from './services/platform';
import LoginScreen, { View as LoginView } from './screens/LoginScreen';
import LinkDeviceScreen from './screens/LinkDeviceScreen';
import HomeScreen from './screens/HomeScreen';
import IdleLockScreen from './components/IdleLockScreen';
import { ensureDeviceRegistered } from './services/keys';
import { logoutSession } from './services/api';
import { getLockedUser, isIdleExpired, markActive, setLockedUser } from './services/idleLock';
import { runUpdateCheck } from './services/updater';
import {
  SESSION_KEY,
  SESSION_INVALID_EVENT,
  clearStoredSession,
  takeInvalidReason,
} from './services/session';
import './App.css';

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

// App reopened after sitting idle past the timeout: treat it exactly like
// an in-app idle logout before anything renders.
function initialSession(): { token: string; username: string } | null {
  const s = loadSession();
  if (s && isIdleExpired()) {
    localStorage.removeItem(SESSION_KEY);
    setLockedUser(s.username);
    return null;
  }
  return s;
}

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'focus'] as const;

export default function App() {
  const [session, setSession] = useState<{ token: string; username: string } | null>(initialSession);
  const [lockedUser, setLockedUserState] = useState<string | null>(() => (session ? null : getLockedUser()));
  // Set when the server retires the token out from under us, so the sign-in
  // screen can say why instead of the app silently emptying itself.
  const [sessionEndedNotice, setSessionEndedNotice] = useState<string | null>(() => takeInvalidReason());
  // QR linking is the default entry, username/token sign-in is the fallback.
  const [usePassword, setUsePassword] = useState(false);
  const [startView, setStartView] = useState<LoginView>('login');

  // ── OTA auto-update (production desktop build only) ────────────────────────
  useEffect(() => {
    runUpdateCheck();
  }, []);

  // ── Session retired server-side ──────────────────────────────────────────
  // A newer sign-in in the same platform group, or an expiry, deactivates this
  // token. apiFetch reports it; all we can do is drop the dead session and ask
  // the user to sign in again.
  useEffect(() => {
    const onInvalid = () => {
      const reason = takeInvalidReason();
      if (!session) return; // Nothing of ours to drop - leave the reason cleared.
      clearStoredSession();
      setSessionEndedNotice(reason);
      setLockedUserState(null);
      setSession(null);
    };
    window.addEventListener(SESSION_INVALID_EVENT, onInvalid);
    return () => window.removeEventListener(SESSION_INVALID_EVENT, onInvalid);
  }, [session]);

  // ── Idle auto-logout ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    markActive();
    let lastWrite = Date.now();
    const onActivity = () => {
      const now = Date.now();
      // Throttle storage writes; precision of a few seconds is plenty.
      if (now - lastWrite > 5000) { lastWrite = now; markActive(now); }
    };
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));

    const check = setInterval(async () => {
      // Media playing in this window (voice note, video) or an open call
      // window counts as activity — never log someone out mid-call.
      const mediaPlaying = Array.from(document.querySelectorAll('video, audio'))
        .some(el => !(el as HTMLMediaElement).paused);
      const callOpen = isTauri()
        ? await WebviewWindow.getByLabel('call').then(w => !!w).catch(() => false)
        : !!document.querySelector('[data-in-page-call]');
      if (mediaPlaying || callOpen) { markActive(); return; }
      if (isIdleExpired()) lockForIdle();
    }, 15_000);

    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity));
      clearInterval(check);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function lockForIdle() {
    if (!session) return;
    clearStoredSession();
    setLockedUser(session.username);
    setLockedUserState(session.username);
    setSession(null);
  }

  function handleLogin(t: string, u: string) {
    saveSession(t, u);
    // Make sure this desktop has its own device key registered so others can
    // encrypt to it and it can find its own entry when decrypting.
    ensureDeviceRegistered(t, u).catch(() => {});
    markActive();
    setSessionEndedNotice(null);
    setLockedUser(null);
    setLockedUserState(null);
    setSession({ token: t, username: u });
    setUsePassword(false);
  }

  function handleLogout() {
    if (session) logoutSession(session.token);
    clearStoredSession();
    setLockedUser(null);
    setLockedUserState(null);
    setSession(null);
  }

  if (session) {
    return <HomeScreen token={session.token} username={session.username} onLogout={handleLogout} />;
  }
  if (lockedUser) {
    return (
      <IdleLockScreen
        username={lockedUser}
        onUnlocked={handleLogin}
        onSwitchAccount={() => { setLockedUser(null); setLockedUserState(null); }}
      />
    );
  }
  if (usePassword) {
    return <LoginScreen onLogin={handleLogin} onBack={() => { setUsePassword(false); setStartView('login'); }} initialView={startView} notice={sessionEndedNotice} />;
  }
  return (
    <LinkDeviceScreen
      onLinked={handleLogin}
      onUsePassword={() => { setStartView('login'); setUsePassword(true); }}
      onActivate={() => { setStartView('activate'); setUsePassword(true); }}
    />
  );
}
