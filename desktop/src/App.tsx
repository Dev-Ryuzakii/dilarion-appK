import { useState } from 'react';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import './App.css';

export default function App() {
  const [token, setToken] = useState<string | null>(
    () => sessionStorage.getItem('d_token'),
  );
  const [username, setUsername] = useState<string>(
    () => sessionStorage.getItem('d_user') || '',
  );

  function handleLogin(t: string, u: string) {
    sessionStorage.setItem('d_token', t);
    sessionStorage.setItem('d_user', u);
    setToken(t);
    setUsername(u);
  }

  function handleLogout() {
    sessionStorage.clear();
    setToken(null);
    setUsername('');
  }

  if (!token) return <LoginScreen onLogin={handleLogin} />;
  return <HomeScreen token={token} username={username} onLogout={handleLogout} />;
}
