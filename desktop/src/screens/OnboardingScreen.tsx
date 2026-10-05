import { useEffect, useRef, useState } from 'react';
import { completeOnboarding } from '../services/api';

/**
 * First-run profile for invited organization staff: details plus a LIVE
 * camera photo (no file upload). The server refuses every other request until
 * this is done, so it runs right after activation or the first sign-in -
 * on desktop and web the same as on the phone.
 */
export default function OnboardingScreen({ sessionToken, username, onDone, onCancel }: {
  sessionToken: string;
  username: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [photo, setPhoto] = useState<{ dataUrl: string; at: string } | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  async function startCamera() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      setCameraOn(true); // the <video> mounts on this render; the effect below attaches the stream
    } catch {
      setCameraError('Camera not available. Allow camera access for Dilarion and try again.');
    }
  }

  useEffect(() => () => stopCamera(), []);

  // Attach the camera only once the <video> element exists - it is rendered
  // conditionally on cameraOn, so it isn't there yet when the stream arrives.
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!cameraOn || !video || !stream) return;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [cameraOn]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError('Camera is still starting - try again in a second.');
      return;
    }
    const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), at: new Date().toISOString() });
    stopCamera();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobTitle.trim()) return setError('Enter your job title');
    if (address.trim().length < 5) return setError('Enter your address');
    if (contactName.trim().length < 2) return setError('Enter an emergency contact name');
    if (contactPhone.trim().length < 10) return setError('Enter a valid emergency contact phone number');
    if (!photo) return setError('Take a live photo with your camera');
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding(sessionToken, {
        jobTitle: jobTitle.trim(),
        address: address.trim(),
        emergencyContactName: contactName.trim(),
        emergencyContactPhone: contactPhone.trim(),
        cameraImageBase64: photo.dataUrl.split(',')[1],
        capturedAt: photo.at,
      });
      onDone();
    } catch (err: any) {
      setError(err?.message || 'Could not save your profile');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="onboarding-page" style={o.root}>
      <form className="onboarding-card" style={o.card} onSubmit={submit}>
        <h1 style={o.title}>Complete your profile</h1>
        <p style={o.sub}>Welcome, {username}. Your organization requires these details and a live photo before you can start using Dilarion.</p>

        <div style={o.photoBox}>
          {cameraOn ? (
            <video ref={videoRef} autoPlay muted playsInline style={{ ...o.media, transform: 'scaleX(-1)' }} />
          ) : photo ? (
            <img src={photo.dataUrl} alt="Your photo" style={o.media} />
          ) : (
            <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>No photo yet</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {cameraOn ? (
            <>
              <button type="button" style={o.btn} onClick={capture}>Take photo</button>
              <button type="button" style={o.ghost} onClick={stopCamera}>Cancel</button>
            </>
          ) : (
            <button type="button" style={o.ghost} onClick={startCamera}>{photo ? 'Retake photo' : 'Open camera'}</button>
          )}
        </div>
        {cameraError && <p style={o.error}>{cameraError}</p>}
        <p style={o.hint}>Photos from files are not accepted - it must be taken now with your camera.</p>

        <input style={o.input} placeholder="Job title" value={jobTitle} onChange={e => setJobTitle(e.target.value)} maxLength={120} />
        <textarea style={{ ...o.input, minHeight: 64, resize: 'vertical' }} placeholder="Address" value={address} onChange={e => setAddress(e.target.value)} maxLength={1000} />
        <input style={o.input} placeholder="Emergency contact name" value={contactName} onChange={e => setContactName(e.target.value)} maxLength={255} />
        <input style={o.input} type="tel" placeholder="Emergency contact phone" value={contactPhone} onChange={e => setContactPhone(e.target.value)} maxLength={20} />

        {error && <p style={o.error}>{error}</p>}
        <button style={{ ...o.btn, width: '100%', padding: '11px 0', opacity: busy ? 0.6 : 1 }} type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Finish setup'}
        </button>
        <button type="button" style={o.link} onClick={() => { stopCamera(); onCancel(); }}>Back to sign in</button>
      </form>
    </div>
  );
}

const o: Record<string, React.CSSProperties> = {
  root: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #0c0c0c)', padding: 16, boxSizing: 'border-box' },
  card: { width: 420, maxWidth: '100%', background: 'var(--bg-panel, #141414)', border: '1px solid var(--border-color, #262626)', borderRadius: 14, padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 10 },
  title: { margin: 0, fontSize: '1.2rem', color: 'var(--text-primary, #f3f4f6)', textAlign: 'center' },
  sub: { margin: '0 0 6px', fontSize: '0.8rem', color: '#9ca3af', textAlign: 'center', lineHeight: 1.5 },
  photoBox: { alignSelf: 'center', width: 220, height: 165, borderRadius: 12, overflow: 'hidden', background: '#0b0b0b', border: '1px solid var(--border-color, #262626)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  media: { width: '100%', height: '100%', objectFit: 'cover' },
  input: { background: 'var(--input-bg, #0f0f0f)', border: '1px solid var(--border-color, #262626)', borderRadius: 8, color: 'var(--text-primary, #f3f4f6)', fontSize: '0.85rem', padding: '9px 12px', fontFamily: 'inherit' },
  btn: { background: 'var(--accent, #c0392b)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  ghost: { background: 'transparent', color: 'var(--text-primary, #f3f4f6)', border: '1px solid var(--border-color, #333)', borderRadius: 8, padding: '8px 16px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  link: { background: 'none', border: 'none', color: '#9ca3af', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  hint: { margin: 0, fontSize: '0.72rem', color: '#6b7280', textAlign: 'center' },
  error: { margin: 0, fontSize: '0.78rem', color: '#ef4444' },
};
