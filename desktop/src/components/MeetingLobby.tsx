import { useEffect, useRef, useState } from 'react';
import { CameraIcon } from './Icons';

// Pre-join device setup — matches Meet/Teams: preview your own mic/camera and
// pick their starting state before actually joining. Uses a plain getUserMedia
// preview stream, independent of the LiveKit Room (which doesn't connect until
// the "Join" button is pressed and GalleryView takes over).
export default function MeetingLobby({
  title,
  subtitle,
  defaultName,
  onJoin,
  onCancel,
}: {
  title: string;
  subtitle?: string;
  defaultName?: string;
  onJoin: (opts: { micOn: boolean; camOn: boolean; displayName: string }) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [displayName, setDisplayName] = useState(defaultName || '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setError('Could not access camera/microphone — check permissions.'));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach(t => { t.enabled = micOn; });
  }, [micOn]);

  useEffect(() => {
    streamRef.current?.getVideoTracks().forEach(t => { t.enabled = camOn; });
  }, [camOn]);

  function handleJoin() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    onJoin({ micOn, camOn, displayName: displayName.trim() });
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: '#0b0b10',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 20, color: '#fff', padding: 24,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{title}</div>
        {subtitle && <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>{subtitle}</div>}
      </div>

      <div
        style={{
          position: 'relative', width: 420, maxWidth: '90vw', aspectRatio: '16/9',
          borderRadius: 16, overflow: 'hidden', background: '#1a1a22',
        }}
      >
        {camOn ? (
          <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', background: 'var(--accent, #6d5efc)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CameraIcon size={28} color="#fff" />
            </div>
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', fontSize: '0.78rem', color: '#ef4444', background: 'rgba(0,0,0,0.6)' }}>
            {error}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 14 }}>
        <button onClick={() => setMicOn(v => !v)} title={micOn ? 'Mute' : 'Unmute'} style={ctrlBtnStyle(micOn)}>
          {micOn ? <MicIcon /> : <MicOffIcon />}
        </button>
        <button onClick={() => setCamOn(v => !v)} title={camOn ? 'Stop Video' : 'Start Video'} style={ctrlBtnStyle(camOn)}>
          {camOn ? <VideoIcon /> : <VideoOffIcon />}
        </button>
      </div>

      <input
        value={displayName}
        onChange={e => setDisplayName(e.target.value)}
        placeholder="Your name in this call"
        maxLength={50}
        style={{
          width: 260, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 10, color: '#fff', fontSize: '0.85rem', padding: '9px 12px', textAlign: 'center',
        }}
      />

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={onCancel}
          style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 10, padding: '10px 20px', color: '#fff', fontSize: '0.85rem', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={handleJoin}
          style={{ background: 'var(--accent, #6d5efc)', border: 'none', borderRadius: 10, padding: '10px 24px', color: '#fff', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
        >
          Join now
        </button>
      </div>
    </div>
  );
}

function ctrlBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '50%',
    color: '#fff',
    width: 44,
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  };
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 19v3" />
    </svg>
  );
}
function MicOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
      <path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2M12 19v3" />
    </svg>
  );
}
function VideoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  );
}
function VideoOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
