import { useCallback, useEffect, useRef, useState } from 'react';
import './meeting.css';
import { CameraIcon } from './Icons';
import { isTauri } from '../services/platform';
import { loadMediaPrefs, saveMediaPrefs } from '../services/mediaPrefs';

// Setup room shown before every meeting: check camera, microphone and
// speaker, pick devices, and sort out permissions before joining. Uses its own
// getUserMedia preview, independent of the LiveKit Room (which doesn't connect
// until "Join now" and GalleryView takes over). The devices chosen here are
// saved and used by GalleryView when it connects.

type Perm = 'checking' | 'granted' | 'prompt' | 'denied' | 'missing' | 'error';

interface Devices {
  cams: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

function permFromError(err: unknown): Perm {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
  return 'error';
}

async function queryPerm(name: 'camera' | 'microphone'): Promise<PermissionState | null> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    return status.state;
  } catch {
    return null; // Not supported here (Safari/WebKit): ask by trying instead.
  }
}

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
  const videoStream = useRef<MediaStream | null>(null);
  const audioStream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const meterRaf = useRef<number | null>(null);
  const saved = useRef(loadMediaPrefs());

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [displayName, setDisplayName] = useState(defaultName || '');
  const [camPerm, setCamPerm] = useState<Perm>('checking');
  const [micPerm, setMicPerm] = useState<Perm>('checking');
  const [devices, setDevices] = useState<Devices>({ cams: [], mics: [], speakers: [] });
  const [camId, setCamId] = useState(saved.current.videoInput || '');
  const [micId, setMicId] = useState(saved.current.audioInput || '');
  const [speakerId, setSpeakerId] = useState(saved.current.audioOutput || '');
  const [level, setLevel] = useState(0);
  const [heardMic, setHeardMic] = useState(false);
  const [playing, setPlaying] = useState(false);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        cams: list.filter(d => d.kind === 'videoinput'),
        mics: list.filter(d => d.kind === 'audioinput'),
        speakers: list.filter(d => d.kind === 'audiooutput'),
      });
    } catch {
      // Leave the pickers empty; the default devices still work.
    }
  }, []);

  // ── Camera ────────────────────────────────────────────────────────────
  const startCamera = useCallback(async (deviceId: string) => {
    videoStream.current?.getTracks().forEach(t => t.stop());
    videoStream.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      videoStream.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamPerm('granted');
      const actual = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (actual) setCamId(actual);
      refreshDevices();
    } catch (err) {
      // A saved camera that's gone: fall back to the default one.
      if (deviceId && permFromError(err) === 'missing') return startCamera('');
      setCamPerm(permFromError(err));
    }
  }, [refreshDevices]);

  // ── Microphone + level meter ──────────────────────────────────────────
  const stopMeter = useCallback(() => {
    if (meterRaf.current) cancelAnimationFrame(meterRaf.current);
    meterRaf.current = null;
    audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    setLevel(0);
  }, []);

  const startMic = useCallback(async (deviceId: string) => {
    stopMeter();
    audioStream.current?.getTracks().forEach(t => t.stop());
    audioStream.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      audioStream.current = stream;
      setMicPerm('granted');
      const actual = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (actual) setMicId(actual);
      refreshDevices();

      const ctx = new AudioContext();
      audioCtx.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
        const rms = Math.sqrt(sum / data.length);
        const next = Math.min(1, rms * 4);
        setLevel(next);
        if (next > 0.15) setHeardMic(true);
        meterRaf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      if (deviceId && permFromError(err) === 'missing') return startMic('');
      setMicPerm(permFromError(err));
    }
  }, [refreshDevices, stopMeter]);

  // First look: ask for both. Each is asked separately so a missing camera
  // doesn't also block the microphone.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cam, mic] = await Promise.all([queryPerm('camera'), queryPerm('microphone')]);
      if (cancelled) return;
      if (cam === 'denied') setCamPerm('denied'); else startCamera(saved.current.videoInput || '');
      if (mic === 'denied') setMicPerm('denied'); else startMic(saved.current.audioInput || '');
    })();
    const onChange = () => refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
      videoStream.current?.getTracks().forEach(t => t.stop());
      audioStream.current?.getTracks().forEach(t => t.stop());
      videoStream.current = null;
      audioStream.current = null;
      stopMeter();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-attach after the preview element remounts (camera toggled back on).
  useEffect(() => {
    if (camOn && videoRef.current && videoStream.current) videoRef.current.srcObject = videoStream.current;
  }, [camOn, camPerm]);

  useEffect(() => {
    audioStream.current?.getAudioTracks().forEach(t => { t.enabled = micOn; });
    videoStream.current?.getVideoTracks().forEach(t => { t.enabled = camOn; });
  }, [micOn, camOn]);

  // ── Speaker test ──────────────────────────────────────────────────────
  async function playTestSound() {
    if (playing) return;
    setPlaying(true);
    try {
      const ctx = new AudioContext();
      const sink = (ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId;
      if (speakerId && sink) await sink.call(ctx, speakerId).catch(() => {});
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        osc.connect(gain);
        const t = ctx.currentTime + i * 0.28;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        osc.start(t);
        osc.stop(t + 0.27);
      });
      setTimeout(() => { ctx.close().catch(() => {}); setPlaying(false); }, notes.length * 280 + 150);
    } catch {
      setPlaying(false);
    }
  }

  function handleJoin() {
    saveMediaPrefs({ videoInput: camId || undefined, audioInput: micId || undefined, audioOutput: speakerId || undefined });
    videoStream.current?.getTracks().forEach(t => t.stop());
    audioStream.current?.getTracks().forEach(t => t.stop());
    videoStream.current = null;
    audioStream.current = null;
    stopMeter();
    // No permission means joining with that device off; they can still listen.
    onJoin({
      micOn: micOn && micPerm === 'granted',
      camOn: camOn && camPerm === 'granted',
      displayName: displayName.trim(),
    });
  }

  const blockedHelp = isTauri()
    ? 'Open System Settings › Privacy & Security, allow Dilarion under Camera and Microphone, then try again.'
    : 'Click the lock or camera icon in the address bar, allow camera and microphone for this site, then try again.';
  const showPreview = camOn && camPerm === 'granted';

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div className="mtg-tile mtg-preview">
            {showPreview ? (
              <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center' }}>
                <div className="mtg-avatar" style={{ width: 76, height: 76, fontSize: '1.6rem' }}>
                  {displayName.trim() ? displayName.trim().slice(0, 1).toUpperCase() : <CameraIcon size={28} color="#fff" />}
                </div>
                <span className="mtg-sheet-sub">
                  {!camOn ? 'Camera is off'
                    : camPerm === 'checking' ? 'Starting camera…'
                    : camPerm === 'denied' ? 'Camera access is blocked'
                    : camPerm === 'missing' ? 'No camera found'
                    : 'Camera unavailable'}
                </span>
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

          {/* Mic level: proves the mic picks you up before anyone else hears it. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <MicIcon />
            <div style={{ flex: 1, height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
              <div style={{
                width: `${Math.round((micOn ? level : 0) * 100)}%`, height: '100%', borderRadius: 99,
                background: '#22c55e', transition: 'width 80ms linear',
              }} />
            </div>
            <span className="mtg-sheet-sub" style={{ marginTop: 0, minWidth: 92, textAlign: 'right' }}>
              {micPerm !== 'granted' ? 'Mic not ready' : !micOn ? 'Muted' : heardMic ? 'We hear you' : 'Say something'}
            </span>
          </div>
        </div>

        <div className="mtg-lobby-side">
          <span className="mtg-eyebrow">Setup room</span>
          <div className="mtg-lobby-title">{title}</div>
          {subtitle && <div className="mtg-sheet-sub" style={{ marginTop: -6 }}>{subtitle}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <PermRow label="Camera" perm={camPerm} onAllow={() => startCamera(camId)} />
            <PermRow label="Microphone" perm={micPerm} onAllow={() => startMic(micId)} />
            {(camPerm === 'denied' || micPerm === 'denied') && (
              <div style={{ fontSize: '0.76rem', lineHeight: 1.5, color: '#ffb4a8' }}>{blockedHelp}</div>
            )}
          </div>

          {camPerm === 'granted' && devices.cams.length > 1 && (
            <DevicePicker label="Camera" value={camId} devices={devices.cams}
              onChange={id => { setCamId(id); startCamera(id); }} />
          )}
          {micPerm === 'granted' && devices.mics.length > 0 && (
            <DevicePicker label="Microphone" value={micId} devices={devices.mics}
              onChange={id => { setMicId(id); setHeardMic(false); startMic(id); }} />
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            {devices.speakers.length > 0 && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <DevicePicker label="Speaker" value={speakerId} devices={devices.speakers} onChange={setSpeakerId} />
              </div>
            )}
            <button className="mtg-btn" onClick={playTestSound} disabled={playing} style={{ flexShrink: 0, height: 38 }}>
              {playing ? 'Playing…' : 'Test speaker'}
            </button>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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

          {(micPerm !== 'granted' || camPerm !== 'granted') && micPerm !== 'checking' && camPerm !== 'checking' && (
            <span className="mtg-sheet-sub" style={{ marginTop: 0 }}>
              You can still join; anything without access stays off until you allow it.
            </span>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="mtg-btn big" onClick={onCancel}>Cancel</button>
            <button className="mtg-btn big primary" style={{ flex: 1 }} onClick={handleJoin}>Join now</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PermRow({ label, perm, onAllow }: { label: string; perm: Perm; onAllow: () => void }) {
  const ok = perm === 'granted';
  const text = ok ? 'Allowed'
    : perm === 'checking' ? 'Checking…'
    : perm === 'denied' ? 'Blocked'
    : perm === 'missing' ? 'Not found'
    : perm === 'prompt' ? 'Not allowed yet'
    : "Couldn't start";
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--mtg-line-2)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, flexShrink: 0, background: ok ? '#22c55e' : perm === 'checking' ? '#f59e0b' : '#e5392b' }} />
      <span style={{ fontSize: '0.84rem', fontWeight: 600, flex: 1 }}>{label}</span>
      <span className="mtg-sheet-sub" style={{ marginTop: 0 }}>{text}</span>
      {!ok && perm !== 'checking' && (
        <button className="mtg-btn small primary" onClick={onAllow}>{perm === 'missing' ? 'Retry' : 'Allow'}</button>
      )}
    </div>
  );
}

function DevicePicker({ label, value, devices, onChange }: {
  label: string; value: string; devices: MediaDeviceInfo[]; onChange: (id: string) => void;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span className="mtg-section-label">{label}</span>
      <select className="mtg-input" value={value} onChange={e => onChange(e.target.value)}>
        {!devices.some(d => d.deviceId === value) && <option value="">System default</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>
        ))}
      </select>
    </label>
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
