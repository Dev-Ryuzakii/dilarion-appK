import { useEffect, useRef, useState } from 'react';
import './meeting.css';
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
      .catch(() => setError("Couldn't access your camera or microphone. Check that Dilarion has permission and try again."));

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
      className="meeting-lobby mtg-scope"
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', padding: 24, overflowY: 'auto',
      }}
    >
      <div className="mtg-lobby-card">
        <div className="mtg-tile mtg-preview">
          {camOn ? (
            <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
              <div className="mtg-avatar" style={{ width: 76, height: 76, fontSize: '1.6rem' }}>
                {displayName.trim() ? displayName.trim().slice(0, 1).toUpperCase() : <CameraIcon size={28} color="#fff" />}
              </div>
              <span className="mtg-sheet-sub">Camera is off</span>
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', fontSize: '0.8rem', color: '#ff8a80', background: 'rgba(10,8,8,0.72)' }}>
              {error}
            </div>
          )}
          <div className="mtg-preview-ctrls">
            <button className={`mtg-ctrl${micOn ? '' : ' off'}`} onClick={() => setMicOn(v => !v)} title={micOn ? 'Mute' : 'Unmute'}>
              {micOn ? <MicIcon /> : <MicOffIcon />}
            </button>
            <button className={`mtg-ctrl${camOn ? '' : ' off'}`} onClick={() => setCamOn(v => !v)} title={camOn ? 'Stop video' : 'Start video'}>
              {camOn ? <VideoIcon /> : <VideoOffIcon />}
            </button>
          </div>
        </div>

        <div className="mtg-lobby-side">
          <span className="mtg-eyebrow">Ready to join?</span>
          <div className="mtg-lobby-title">{title}</div>
          {subtitle && <div className="mtg-sheet-sub" style={{ marginTop: -6 }}>{subtitle}</div>}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <span className="mtg-section-label">Your name in this call</span>
            <input
              className="mtg-input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleJoin(); }}
              placeholder="Add your name"
              maxLength={50}
            />
          </label>
          <span className="mtg-sheet-sub">
            {micOn ? 'Mic on' : 'Mic off'} · {camOn ? 'camera on' : 'camera off'}
          </span>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="mtg-btn big" onClick={onCancel}>Cancel</button>
            <button className="mtg-btn big primary" style={{ flex: 1 }} onClick={handleJoin}>Join now</button>
          </div>
        </div>
      </div>
    </div>
  );
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
