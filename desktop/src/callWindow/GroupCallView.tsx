import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, Participant } from 'livekit-client';
import { getLiveKitToken, getIceServers, conferenceLeave } from '../services/api';

// WhatsApp-style group call — deliberately NOT the meeting UI (GalleryView):
// no recording, breakout rooms, whiteboard, reactions, waiting room or
// meeting chat. Just the people in the group, their faces or avatars, and
// mute / camera / end. Runs in the dedicated call window like a 1:1 call,
// on the same LiveKit conference room the server stood up for the group.

export interface GroupCallInfo {
  conference_id: number;
  group_id: number;
  group_name: string;
  call_type: 'voice' | 'video';
}

const NO_ANSWER_MS = 60_000;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#c0392b', '#db2777', '#2563eb'];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function ParticipantTile({ participant, isLocal, speaking, version }: {
  participant: Participant; isLocal: boolean; speaking: boolean; version: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camPub = participant.getTrackPublication(Track.Source.Camera);
  const camTrack = camPub?.track;
  const camOn = !!camTrack && !camPub?.isMuted;
  const micOn = participant.isMicrophoneEnabled;
  const name = participant.name || participant.identity;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !camTrack || !camOn) return;
    camTrack.attach(el);
    return () => { camTrack.detach(el); };
  }, [camTrack, camOn, version]);

  return (
    <div style={{
      position: 'relative', background: '#1f2937', borderRadius: 14, overflow: 'hidden', minHeight: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      outline: speaking ? '3px solid #25d366' : '3px solid transparent', outlineOffset: -3,
      transition: 'outline-color 0.15s',
    }}>
      {camOn ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: isLocal ? 'scaleX(-1)' : undefined }}
        />
      ) : (
        <div style={{
          width: 'clamp(64px, 12vh, 120px)', height: 'clamp(64px, 12vh, 120px)', borderRadius: '50%',
          background: colorFor(name), color: '#fff', fontWeight: 800, fontSize: 'clamp(1.4rem, 4vh, 2.6rem)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{initials(name)}</div>
      )}
      <div style={{
        position: 'absolute', left: 10, bottom: 10, display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: '4px 10px', color: '#fff', fontSize: '0.8rem', fontWeight: 600,
      }}>
        {!micOn && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8" />
          </svg>
        )}
        {isLocal ? 'You' : name}
      </div>
    </div>
  );
}

function RoundBtn({ onClick, active, danger, title, children }: {
  onClick: () => void; active?: boolean; danger?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 58, height: 58, borderRadius: '50%', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: danger ? '#ef4444' : active ? '#fff' : 'rgba(255,255,255,0.14)',
        color: danger ? '#fff' : active ? '#111' : '#fff',
      }}
    >{children}</button>
  );
}

export default function GroupCallView({ token, myUsername, info, onEnd }: {
  token: string;
  myUsername: string;
  info: GroupCallInfo;
  onEnd: () => void;
}) {
  const roomRef = useRef<Room | null>(null);
  const [version, setVersion] = useState(0);
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>('connecting');
  const [endReason, setEndReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(info.call_type === 'video');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const everHadOthersRef = useRef(false);
  const endedRef = useRef(false);

  function bump() { setVersion(v => v + 1); }

  function finish(reason: string | null) {
    if (endedRef.current) return;
    endedRef.current = true;
    roomRef.current?.disconnect();
    roomRef.current = null;
    conferenceLeave(token, info.conference_id).catch(() => {});
    setEndReason(reason);
    setStatus('ended');
    setTimeout(onEnd, reason ? 1500 : 0);
  }

  useEffect(() => {
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const othersChanged = () => {
      const others = room.remoteParticipants.size;
      if (others > 0) {
        everHadOthersRef.current = true;
        setStatus('active');
        setStartedAt(prev => prev ?? Date.now());
      } else if (everHadOthersRef.current) {
        // Everyone else hung up — end it, like WhatsApp does.
        finish('Call ended');
      }
      bump();
    };

    room
      .on(RoomEvent.ParticipantConnected, othersChanged)
      .on(RoomEvent.ParticipantDisconnected, othersChanged)
      .on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) track.attach(); bump(); })
      .on(RoomEvent.TrackUnsubscribed, (track) => { track.detach(); bump(); })
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.ActiveSpeakersChanged, sp => setSpeaking(new Set(sp.map(p => p.identity))))
      .on(RoomEvent.Disconnected, () => { if (!endedRef.current) finish('Disconnected'); });

    (async () => {
      try {
        const [{ url, token: lkToken }, iceServers] = await Promise.all([
          getLiveKitToken(token, info.conference_id, myUsername),
          getIceServers(token),
        ]);
        if (cancelled) return;
        await room.connect(url, lkToken, {
          rtcConfig: iceServers && iceServers.length > 0 ? { iceServers } : undefined,
        });
        if (cancelled) { room.disconnect(); return; }
        await room.localParticipant.setMicrophoneEnabled(true);
        if (info.call_type === 'video') await room.localParticipant.setCameraEnabled(true);
        if (room.remoteParticipants.size === 0) setStatus('ringing');
        othersChanged();
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Could not connect the call');
          setStatus('ended');
        }
      }
    })();

    return () => {
      cancelled = true;
      room.disconnect();
      roomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.conference_id]);

  // Nobody picked up.
  useEffect(() => {
    if (status !== 'ringing') return;
    const t = setTimeout(() => {
      if (!everHadOthersRef.current) finish('No answer');
    }, NO_ANSWER_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (status !== 'active') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  async function toggleMic() {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!micOn).catch(() => {});
    setMicOn(v => !v);
    bump();
  }

  async function toggleCam() {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setCameraEnabled(!camOn).catch(() => {});
    setCamOn(v => !v);
    bump();
  }

  const room = roomRef.current;
  const participants: { p: Participant; isLocal: boolean }[] = room
    ? [{ p: room.localParticipant as Participant, isLocal: true }, ...Array.from(room.remoteParticipants.values()).map(p => ({ p: p as Participant, isLocal: false }))]
    : [];
  const count = participants.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;

  const statusText =
    status === 'connecting' ? 'Connecting…'
    : status === 'ringing' ? 'Ringing…'
    : status === 'active' && startedAt ? fmtDur(Math.max(0, Math.floor((now - startedAt) / 1000)))
    : status === 'ended' ? (error || endReason || 'Call ended')
    : '';

  const label = info.call_type === 'video' ? 'Group video call' : 'Group voice call';

  return (
    <div className="group-call" style={{ position: 'fixed', inset: 0, background: '#0b141a', display: 'flex', flexDirection: 'column', color: '#fff', fontFamily: 'inherit' }}>
      {/* Header */}
      <div className="group-call-header" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 22px', flexShrink: 0 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: colorFor(info.group_name),
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.9rem',
        }}>{initials(info.group_name)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.group_name}</div>
          <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
            {label} · {statusText}{status === 'active' ? ` · ${count} in call` : ''}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="group-call-body" style={{ flex: 1, minHeight: 0, padding: '0 16px 12px', display: 'flex' }}>
        {status === 'active' && count > 1 ? (
          <div style={{
            flex: 1, display: 'grid', gap: 10,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: 'minmax(0, 1fr)',
          }}>
            {participants.map(({ p, isLocal }) => (
              <ParticipantTile key={p.identity} participant={p} isLocal={isLocal} speaking={speaking.has(p.identity)} version={version} />
            ))}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, position: 'relative' }}>
            <div style={{
              width: 'clamp(110px, 22vh, 180px)', height: 'clamp(110px, 22vh, 180px)', borderRadius: '50%',
              background: colorFor(info.group_name), display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 'clamp(2.2rem, 6vh, 3.6rem)',
              boxShadow: status === 'ringing' ? '0 0 0 14px rgba(255,255,255,0.05), 0 0 0 28px rgba(255,255,255,0.03)' : undefined,
            }}>{initials(info.group_name)}</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{info.group_name}</div>
            <div style={{ fontSize: '0.9rem', color: '#9ca3af' }}>
              {status === 'ringing' ? 'Ringing group members…' : statusText}
            </div>
            {/* Own camera preview while waiting for others on a video call */}
            {room && camOn && status !== 'ended' && (
              <div style={{ position: 'absolute', right: 8, bottom: 8, width: 'clamp(160px, 24vw, 280px)', aspectRatio: '4 / 3' }}>
                <ParticipantTile participant={room.localParticipant} isLocal speaking={false} version={version} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 22, padding: '14px 0 26px', flexShrink: 0 }}>
        <RoundBtn onClick={toggleCam} active={camOn} title={camOn ? 'Turn camera off' : 'Turn camera on'}>
          {camOn ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382v7.236a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          )}
        </RoundBtn>
        <RoundBtn onClick={toggleMic} active={!micOn} title={micOn ? 'Mute' : 'Unmute'}>
          {micOn ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8"/></svg>
          )}
        </RoundBtn>
        <RoundBtn onClick={() => finish(null)} danger title="End call">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(135deg)' }}>
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </RoundBtn>
      </div>
    </div>
  );
}
