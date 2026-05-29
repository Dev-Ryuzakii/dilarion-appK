import { useState } from 'react';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
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

  function handleLogin(t: string, u: string) {
    saveSession(t, u);
    setSession({ token: t, username: u });
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }

  if (!session) return <LoginScreen onLogin={handleLogin} />;
  return <HomeScreen token={session.token} username={session.username} onLogout={handleLogout} />;
}
