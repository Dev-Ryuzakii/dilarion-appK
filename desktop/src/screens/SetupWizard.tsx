import { useEffect, useRef, useState } from 'react';
import {
  hasVoiceIdentity, uploadVoiceIdentity,
  getMasterTokenStatus, createMasterToken,
  getMasterToken2FAStatus, enableMasterToken2FA,
  confirmMasterToken,
} from '../services/api';

/**
 * First-run security setup, shown after the profile/camera onboarding and on
 * every sign-in until it's finished. Three steps — voice decoy recording,
 * master token, master-token 2FA — each auto-skipped if already done on the
 * server, so a returning user only sees whatever they still owe. When nothing
 * is outstanding it renders its children (the app) immediately.
 */

type StepId = 'voice' | 'master' | 'twofa';

export default function SetupWizard({ token, username, children }: {
  token: string;
  username: string;
  children: React.ReactNode;
}) {
  const [phase, setPhase] = useState<'loading' | 'wizard' | 'done'>('loading');
  const [steps, setSteps] = useState<StepId[]>([]);
  const [idx, setIdx] = useState(0);
  // Master token captured in this session, so the 2FA step can reuse it
  // without asking again when the user just set it here.
  const masterRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [voice, mt, twofa] = await Promise.all([
        hasVoiceIdentity(token, username).catch(() => false),
        getMasterTokenStatus(token).catch(() => ({ exists: false, twofa_enabled: false })),
        getMasterToken2FAStatus(token).catch(() => false),
      ]);
      if (cancelled) return;
      const todo: StepId[] = [];
      if (!voice) todo.push('voice');
      if (!mt.exists) todo.push('master');
      if (!(twofa || mt.twofa_enabled)) todo.push('twofa');
      setSteps(todo);
      setPhase(todo.length ? 'wizard' : 'done');
    })();
    return () => { cancelled = true; };
  }, [token, username]);

  function next() {
    setIdx(i => {
      const ni = i + 1;
      if (ni >= steps.length) setPhase('done');
      return ni;
    });
  }

  if (phase === 'loading') {
    return (
      <div style={s.root}>
        <div style={s.card}><p style={s.sub}>Preparing your account…</p></div>
      </div>
    );
  }
  if (phase === 'done') return <>{children}</>;

  const current = steps[idx];
  const stepNo = idx + 1;
  const total = steps.length;

  return (
    <div style={s.root}>
      <div style={s.logoWrap}>
        <img src="/logo.jpg" alt="Dilarion" style={s.logo} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      </div>
      <h1 style={s.heading}>Secure your account</h1>
      <div style={s.progress}>Step {stepNo} of {total}</div>
      <div style={s.card}>
        {current === 'voice' && <VoiceStep token={token} onDone={next} onSkip={next} />}
        {current === 'master' && <MasterStep token={token} onDone={(t) => { masterRef.current = t; next(); }} onSkip={next} />}
        {current === 'twofa' && <TwoFaStep token={token} presetMaster={masterRef.current} onDone={next} onSkip={next} />}
      </div>
    </div>
  );
}

// ── Step 1: voice decoy recording ───────────────────────────────────────────
function VoiceStep({ token, onDone, onSkip }: { token: string; onDone: () => void; onSkip: () => void }) {
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [secs, setSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        setBlob(new Blob(chunksRef.current, { type: mime || 'audio/webm' }));
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setSecs(0);
      const started = Date.now();
      const tick = setInterval(() => {
        const el = Math.floor((Date.now() - started) / 1000);
        setSecs(el);
        if (el >= 8) { clearInterval(tick); stop(); }   // auto-stop at 8s
      }, 250);
    } catch {
      setError('Microphone not available. Allow mic access for Dilarion and try again.');
    }
  }

  function stop() {
    try { recRef.current?.stop(); } catch {}
    setRecording(false);
  }

  async function submit() {
    if (!blob) return;
    setBusy(true);
    setError(null);
    try {
      await uploadVoiceIdentity(token, blob, 'voice_identity.webm');
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not save your voice recording');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={s.title}>Set up your voice</h1>
      <p style={s.sub}>Record a short voice sample (a few seconds of normal speech). It powers Dilarion's voice features and decoy protection.</p>
      <div style={s.mediaBox}>
        <span style={{ fontSize: '2rem' }}>{recording ? '🔴' : blob ? '✅' : '🎙️'}</span>
        <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: 6 }}>
          {recording ? `Recording… ${secs}s` : blob ? 'Recorded' : 'Not recorded yet'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {recording ? (
          <button type="button" style={s.btn} onClick={stop}>Stop</button>
        ) : (
          <button type="button" style={s.ghost} onClick={start}>{blob ? 'Re-record' : 'Start recording'}</button>
        )}
      </div>
      <p style={s.hint}>Speak a sentence or two. Recording stops automatically at 8 seconds.</p>
      {error && <p style={s.error}>{error}</p>}
      <button style={{ ...s.btn, width: '100%', opacity: (!blob || busy) ? 0.6 : 1 }} disabled={!blob || busy} onClick={submit}>
        {busy ? 'Saving…' : 'Save & continue'}
      </button>
      <button type="button" style={s.link} onClick={onSkip}>Skip for now</button>
    </>
  );
}

// ── Step 2: master token ─────────────────────────────────────────────────────
function MasterStep({ token, onDone, onSkip }: { token: string; onDone: (mt: string) => void; onSkip: () => void }) {
  const [value, setValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const v = value.trim();
    if (v.length < 6) return setError('Master token must be at least 6 characters');
    if (v !== confirm.trim()) return setError('The two entries do not match');
    setBusy(true);
    setError(null);
    try {
      await createMasterToken(token, v);
      onDone(v);
    } catch (e: any) {
      setError(e?.message || 'Could not set your master token');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={s.title}>Set your master token</h1>
      <p style={s.sub}>A separate secret used to answer calls and unlock locked chats. Keep it private — it is never shown again.</p>
      <input style={s.input} type="password" placeholder="Master token" value={value} onChange={e => setValue(e.target.value)} maxLength={128} />
      <input style={s.input} type="password" placeholder="Confirm master token" value={confirm} onChange={e => setConfirm(e.target.value)} maxLength={128} />
      {error && <p style={s.error}>{error}</p>}
      <button style={{ ...s.btn, width: '100%', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
        {busy ? 'Saving…' : 'Save & continue'}
      </button>
      <button type="button" style={s.link} onClick={onSkip}>Skip for now</button>
    </>
  );
}

// ── Step 3: master-token 2FA ─────────────────────────────────────────────────
function TwoFaStep({ token, presetMaster, onDone, onSkip }: { token: string; presetMaster: string | null; onDone: () => void; onSkip: () => void }) {
  const [master, setMaster] = useState(presetMaster || '');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const m = master.trim();
    if (!m) return setError('Enter your master token');
    if (pw.trim().length < 6) return setError('2FA password must be at least 6 characters');
    if (pw.trim() !== pw2.trim()) return setError('The two passwords do not match');
    setBusy(true);
    setError(null);
    try {
      // Verify the master token first so the error is clear if it's wrong.
      const ok = await confirmMasterToken(token, m).catch(() => false);
      if (!ok) { setError('That master token is incorrect'); setBusy(false); return; }
      await enableMasterToken2FA(token, m, pw.trim());
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not enable 2FA');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 style={s.title}>Protect your master token (2FA)</h1>
      <p style={s.sub}>Add a second password that's required to change your master token, so a stolen session alone can't reset it. Optional but recommended.</p>
      {!presetMaster && (
        <input style={s.input} type="password" placeholder="Your master token" value={master} onChange={e => setMaster(e.target.value)} maxLength={128} />
      )}
      <input style={s.input} type="password" placeholder="2FA password" value={pw} onChange={e => setPw(e.target.value)} maxLength={128} />
      <input style={s.input} type="password" placeholder="Confirm 2FA password" value={pw2} onChange={e => setPw2(e.target.value)} maxLength={128} />
      {error && <p style={s.error}>{error}</p>}
      <button style={{ ...s.btn, width: '100%', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
        {busy ? 'Enabling…' : 'Enable 2FA & finish'}
      </button>
      <button type="button" style={s.link} onClick={onSkip}>Skip for now</button>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'var(--bg, #0c0c0c)', padding: 24, boxSizing: 'border-box' },
  logoWrap: { width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', background: '#1e1e1e', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  logo: { width: '100%', height: '100%', objectFit: 'cover' },
  heading: { margin: '6px 0 0', fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary, #f3f4f6)', textAlign: 'center' },
  card: { width: 420, maxWidth: '100%', background: 'var(--bg-panel, #141414)', border: '1px solid var(--border-color, #262626)', borderRadius: 14, padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 },
  progress: { fontSize: '0.72rem', color: '#6b7280', textAlign: 'center', letterSpacing: '0.04em', textTransform: 'uppercase' },
  title: { margin: 0, fontSize: '1.2rem', color: 'var(--text-primary, #f3f4f6)', textAlign: 'center' },
  sub: { margin: '0 0 6px', fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center', lineHeight: 1.5 },
  mediaBox: { alignSelf: 'center', width: 220, height: 110, borderRadius: 12, background: '#0b0b0b', border: '1px solid var(--border-color, #262626)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  input: { background: 'var(--input-bg, #0f0f0f)', border: '1px solid var(--border-color, #262626)', borderRadius: 8, color: 'var(--text-primary, #f3f4f6)', fontSize: '0.85rem', padding: '9px 12px', fontFamily: 'inherit' },
  btn: { background: 'var(--accent, #c0392b)', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  ghost: { background: 'transparent', color: 'var(--text-primary, #f3f4f6)', border: '1px solid var(--border-color, #333)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  link: { background: 'none', border: 'none', color: '#9ca3af', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  hint: { margin: 0, fontSize: '0.72rem', color: '#6b7280', textAlign: 'center' },
  error: { margin: 0, fontSize: '0.78rem', color: '#ef4444' },
};
