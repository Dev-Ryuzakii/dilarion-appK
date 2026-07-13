import { useState } from 'react';
import LoginScreen from './screens/LoginScreen';
import LinkDeviceScreen from './screens/LinkDeviceScreen';
import HomeScreen from './screens/HomeScreen';
import { ensureDeviceRegistered } from './services/keys';
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
  // Desktop is a linked device (WhatsApp-style): QR linking is the default entry.
  // Username/token sign-in stays only as a fallback.
  const [usePassword, setUsePassword] = useState(false);

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

  if (session) {
    return <HomeScreen token={session.token} username={session.username} onLogout={handleLogout} />;
  }
  if (usePassword) {
    return <LoginScreen onLogin={handleLogin} onBack={() => setUsePassword(false)} />;
  }
  return <LinkDeviceScreen onLinked={handleLogin} onUsePassword={() => setUsePassword(true)} />;
}
