import React, { useEffect, useRef, useState, useCallback } from 'react';
import { presenceService } from '../services/presence';
import { initiateCall, performCallAction, sendCallIceCandidate } from '../services/api';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CallType = 'audio' | 'video';

export interface IncomingCall {
  from: string;
  callType: CallType;
  callId: number;
  offerSdp?: string;
}

interface Props {
  token: string;
  myUsername: string;
  partner: string;
  callType: CallType;
  isIncoming: boolean;
  callId?: number;       // set for incoming calls
  offerSdp?: string;     // set for incoming calls
  masterToken?: string;  // required by backend to accept calls
  onEnd: () => void;
}

// ── ICE servers (STUN) ────────────────────────────────────────────────────────

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // TURN relay — required for calls across different networks (WiFi ↔ mobile data)
  { urls: 'turn:a.relay.metered.ca:80',             username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:a.relay.metered.ca:443',            username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ── CallModal ─────────────────────────────────────────────────────────────────

export default function CallModal({ token, partner, callType, isIncoming, callId: incomingCallId, offerSdp: incomingOfferSdp, masterToken, onEnd }: Props) {
  // calling = outgoing, waiting for callee to receive; ringing = callee's device is ringing; connecting = SDP negotiating
  const [state, setState] = useState<'calling' | 'ringing' | 'connecting' | 'connected' | 'ended'>(
    isIncoming ? 'ringing' : 'calling',
  );
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [netQuality, setNetQuality] = useState<0 | 1 | 2 | 3 | 4>(4);
  const [reconnecting, setReconnecting] = useState(false);
  const iceRestartedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callIdRef = useRef<number | null>(incomingCallId ?? null);
  // Buffer outgoing ICE candidates before callId is set
  const iceBufRef = useRef<RTCIceCandidateInit[]>([]);
  // Buffer incoming ICE candidates before remote description is set
  const remoteIceBufRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);

  // ── WebRTC setup ─────────────────────────────────────────────────────────────

  const createPc = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      if (callIdRef.current) {
        sendCallIceCandidate(token, callIdRef.current, partner, candidate.toJSON()).catch(() => {});
      } else {
        // callId not yet available — buffer until initiateCall() returns
        iceBufRef.current.push(candidate.toJSON());
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      // Dedicated audio element ensures audio plays even when video element is hidden
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(() => {});
      }
    };

    const markConnected = () => {
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      setReconnecting(false);
      iceRestartedRef.current = false;
      setState(s => {
        if (s === 'connected') return s;
        if (!timerRef.current) timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
        return 'connected';
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        markConnected();
      } else if (pc.connectionState === 'failed') {
        if (!iceRestartedRef.current) {
          // One reconnect attempt: wait 5s then end if not recovered
          iceRestartedRef.current = true;
          setReconnecting(true);
          reconnectTimerRef.current = setTimeout(() => {
            if (pcRef.current?.connectionState !== 'connected') handleEnd();
          }, 5000);
        } else {
          handleEnd();
        }
      } else if (pc.connectionState === 'closed') {
        handleEnd();
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') markConnected();
    };

    pcRef.current = pc;
    return pc;
  }, [partner, token]);

  const startLocalMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video',
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch {
      setError('Could not access camera/microphone');
      return null;
    }
  }, [callType]);

  // Caller: get media → create offer → POST /calls/initiate → wait for call_status_update
  const startCall = useCallback(async () => {
    const stream = await startLocalMedia();
    if (!stream) return;
    const pc = createPc();
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    // Create offer SDP
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    try {
      const { call_id } = await initiateCall(token, partner, callType, offer.sdp);
      callIdRef.current = call_id;
      // Flush buffered ICE candidates now that we have the call_id
      const buffered = iceBufRef.current.splice(0);
      buffered.forEach(c => sendCallIceCandidate(token, call_id, partner, c).catch(() => {}));
    } catch (err: any) {
      setError(err?.message || 'Could not start call');
    }
  }, [startLocalMedia, createPc, token, partner, callType]);

  // Callee: accept → get media → handle offer SDP → POST /calls/action accept
  const acceptCall = useCallback(async () => {
    setState('connecting');
    const stream = await startLocalMedia();
    if (!stream) return;
    const pc = createPc();
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    let answerSdp: string | undefined;
    if (incomingOfferSdp) {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: incomingOfferSdp }));
      remoteDescSetRef.current = true;
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      answerSdp = answer.sdp;
    }

    if (callIdRef.current) {
      await performCallAction(token, callIdRef.current, 'accept', answerSdp, masterToken).catch(() => {});
    }
  }, [startLocalMedia, createPc, token, incomingOfferSdp, masterToken]);

  // Handle backend WebSocket signaling events
  useEffect(() => {
    const handler = async (msg: any) => {
      const data = msg.data || {};

      // call_status_update — caller gets answer_sdp when callee accepts
      if (msg.type === 'call_status_update' && Number(data.call_id) === callIdRef.current) {
        if (data.status === 'calling') {
          // Callee's device received the notification — upgrade from "Calling..." to "Ringing..."
          setState(s => (s === 'calling' ? 'ringing' : s));
        } else if (data.status === 'ringing') {
          // Callee's app is showing the incoming call UI
          setState(s => (s === 'calling' || s === 'ringing' ? 'ringing' : s));
        } else if (data.status === 'accept' || data.status === 'accepted') {
          setState('connecting');
          if (data.answer_sdp && pcRef.current) {
            try {
              await pcRef.current.setRemoteDescription(
                new RTCSessionDescription({ type: 'answer', sdp: data.answer_sdp }),
              );
              remoteDescSetRef.current = true;
              // Flush any ICE candidates that arrived before remote desc was set
              const queued = remoteIceBufRef.current.splice(0);
              for (const c of queued) {
                try { await pcRef.current.addIceCandidate(new RTCIceCandidate(c)); } catch {}
              }
            } catch {}
          }
        } else if (['declined', 'decline', 'end', 'busy'].includes(data.status)) {
          handleEnd();
        }
        return;
      }

      // ice_candidate from backend — queue if remote desc not yet set
      if (msg.type === 'ice_candidate' && Number(data.call_id) === callIdRef.current) {
        const pc = pcRef.current;
        if (!pc || !data.candidate) return;
        if (!remoteDescSetRef.current) {
          remoteIceBufRef.current.push(data.candidate);
        } else {
          try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
        }
        return;
      }

      // Legacy p2p fallback: call_end sent directly by other desktop client
      if (msg.type === 'call_end' && (msg.sender === partner || msg.from === partner)) {
        handleEnd();
      }
    };

    presenceService.addListener(handler);
    return () => presenceService.removeListener(handler);
  }, [partner]);

  // ── Calling tone (outgoing only, while waiting for answer) ───────────────────

  useEffect(() => {
    if (isIncoming || (state !== 'calling' && state !== 'ringing')) return;
    let ctx: AudioContext | null = null;
    let osc1: OscillatorNode | null = null;
    let osc2: OscillatorNode | null = null;
    let gain: GainNode | null = null;
    let intervalId: ReturnType<typeof setInterval>;

    try {
      ctx = new AudioContext();
      gain = ctx.createGain();
      gain.connect(ctx.destination);
      osc1 = ctx.createOscillator(); osc1.frequency.value = 440; osc1.connect(gain); osc1.start();
      osc2 = ctx.createOscillator(); osc2.frequency.value = 480; osc2.connect(gain); osc2.start();

      const ring = () => {
        if (!gain || !ctx) return;
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.setValueAtTime(0, now + 1.2);
      };
      ring();
      intervalId = setInterval(ring, 4000);
    } catch {}

    return () => {
      clearInterval(intervalId!);
      try { osc1?.stop(); osc2?.stop(); ctx?.close(); } catch {}
    };
  }, [state, isIncoming]);

  // ── Network quality (poll getStats every 2s while connected) ─────────────────

  useEffect(() => {
    if (state !== 'connected') return;
    const id = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        let loss = 0;
        let jitter = 0;
        stats.forEach((r: any) => {
          if (r.type === 'inbound-rtp' && r.kind === 'audio') {
            const total = (r.packetsLost ?? 0) + (r.packetsReceived ?? 1);
            loss = (r.packetsLost ?? 0) / total;
            jitter = r.jitter ?? 0;
          }
        });
        if (loss > 0.15 || jitter > 0.1)       setNetQuality(0);
        else if (loss > 0.08 || jitter > 0.05)  setNetQuality(1);
        else if (loss > 0.04 || jitter > 0.02)  setNetQuality(2);
        else if (loss > 0.01 || jitter > 0.01)  setNetQuality(3);
        else                                     setNetQuality(4);
      } catch {}
    }, 2000);
    return () => clearInterval(id);
  }, [state]);

  function stopAllMedia() {
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) { remoteAudioRef.current.pause(); remoteAudioRef.current.srcObject = null; }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }

  // Start outgoing call on mount
  useEffect(() => {
    if (!isIncoming) {
      startCall();
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopAllMedia();
    };
  }, []);

  // ── Controls ─────────────────────────────────────────────────────────────────

  function handleEnd() {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (callIdRef.current) {
      performCallAction(token, callIdRef.current, 'end').catch(() => {});
    }
    setState('ended');
    if (timerRef.current) clearInterval(timerRef.current);
    stopAllMedia();
    setTimeout(onEnd, 400);
  }

  function toggleMute() {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = muted; });
    setMuted(m => !m);
  }

  function toggleCamera() {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = cameraOff; });
    setCameraOff(c => !c);
  }

  async function toggleScreenShare() {
    const pc = pcRef.current;
    if (!pc) return;

    if (sharing) {
      // Restore camera
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        sender?.replaceTrack(camTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      }
      setSharing(false);
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        screenStreamRef.current = screen;
        const screenTrack = screen.getVideoTracks()[0];
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        sender?.replaceTrack(screenTrack);
        if (localVideoRef.current) localVideoRef.current.srcObject = screen;
        screenTrack.onended = () => { if (sharing) toggleScreenShare(); };
        setSharing(true);
      } catch {}
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const isVideo = callType === 'video';

  return (
    <div style={cs.overlay}>
      <div style={cs.modal}>

        {/* Video area */}
        {isVideo && (
          <div style={cs.videoArea}>
            {/* Remote video — audio comes via remoteAudioRef to avoid WKWebView autoplay issues */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted
              style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000', borderRadius: 14 }}
            />
            {/* Local PiP */}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={cs.localPip}
            />
            {/* Dedicated audio output for remote stream */}
            <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />
          </div>
        )}

        {/* Audio-only avatar area */}
        {!isVideo && (
          <div style={cs.avatarArea}>
            <div style={cs.bigAvatar}>
              {partner.slice(0, 2).toUpperCase()}
            </div>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ display: 'none' }} />
            <video ref={remoteVideoRef} autoPlay playsInline style={{ display: 'none' }} />
            <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />
          </div>
        )}

        {/* Info bar */}
        <div style={cs.infoBar}>
          <span style={cs.partnerName}>{partner}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={cs.callStatus}>
              {state === 'calling'    && 'Calling…'}
              {state === 'ringing'    && (isIncoming ? 'Incoming call…' : 'Ringing…')}
              {state === 'connecting' && 'Connecting…'}
              {state === 'connected'  && (reconnecting ? 'Reconnecting…' : fmtDur(duration))}
              {state === 'ended'      && 'Call ended'}
            </span>
            {state === 'connected' && !reconnecting && <SignalBars quality={netQuality} />}
          </div>
          {error && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</span>}
        </div>

        {/* Incoming ringing buttons */}
        {state === 'ringing' && isIncoming && (
          <div style={cs.controls}>
            <ControlBtn icon="decline" color="#ef4444" label="Decline" onClick={handleEnd} />
            <ControlBtn icon="accept" color="#25d366" label="Accept" onClick={acceptCall} />
          </div>
        )}

        {/* Outgoing: calling/ringing — just show cancel */}
        {(state === 'calling' || (state === 'ringing' && !isIncoming)) && (
          <div style={cs.controls}>
            <ControlBtn icon="end" color="#ef4444" label="Cancel" onClick={handleEnd} />
          </div>
        )}

        {/* Active call controls */}
        {(state === 'connecting' || state === 'connected') && (
          <div style={cs.controls}>
            <ControlBtn icon={muted ? 'mic-off' : 'mic'} color={muted ? '#ef4444' : '#374151'} label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} />
            {isVideo && (
              <ControlBtn icon={cameraOff ? 'cam-off' : 'cam'} color={cameraOff ? '#ef4444' : '#374151'} label={cameraOff ? 'Cam On' : 'Cam Off'} onClick={toggleCamera} />
            )}
            {isVideo && (
              <ControlBtn icon="screen" color={sharing ? '#3b82f6' : '#374151'} label={sharing ? 'Stop Share' : 'Share Screen'} onClick={toggleScreenShare} />
            )}
            <ControlBtn icon="end" color="#ef4444" label="End" onClick={handleEnd} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Control button ────────────────────────────────────────────────────────────

type IconName = 'mic' | 'mic-off' | 'cam' | 'cam-off' | 'screen' | 'end' | 'accept' | 'decline';

function ControlBtn({ icon, color, label, onClick }: { icon: IconName; color: string; label: string; onClick: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <button onClick={onClick} style={{ ...cs.ctrlBtn, background: color }}>
        <CtrlIcon name={icon} />
      </button>
      <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>{label}</span>
    </div>
  );
}

function CtrlIcon({ name }: { name: IconName }) {
  const S = { width: 22, height: 22, fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'mic': return <svg viewBox="0 0 24 24" {...S}><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M9 22h6"/></svg>;
    case 'mic-off': return <svg viewBox="0 0 24 24" {...S}><line x1="2" y1="2" x2="22" y2="22"/><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M17 10a5 5 0 0 1-8.39 3.61M5 10a7 7 0 0 0 11.95 5M12 19v3M9 22h6"/></svg>;
    case 'cam': return <svg viewBox="0 0 24 24" {...S}><path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382v7.236a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
    case 'cam-off': return <svg viewBox="0 0 24 24" {...S}><line x1="2" y1="2" x2="22" y2="22"/><path d="M16 10l4.553-2.553A1 1 0 0 1 22 8.382v7.236a1 1 0 0 1-1.447.894L16 14M3 7a2 2 0 0 0-1 1.73v6.54A2 2 0 0 0 4 17h10l-10-9z"/></svg>;
    case 'screen': return <svg viewBox="0 0 24 24" {...S}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M8 7l4-4 4 4M12 3v10"/></svg>;
    case 'end': return <svg viewBox="0 0 24 24" {...S}><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.5-3.5m-1.4-4A19.79 19.79 0 0 1 3 3.83 2 2 0 0 1 4.11 1.9"/><line x1="2" y1="2" x2="22" y2="22" stroke="#ef4444" strokeWidth="2.5"/></svg>;
    case 'accept': return <svg viewBox="0 0 24 24" {...S}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>;
    case 'decline': return <svg viewBox="0 0 24 24" {...S}><line x1="2" y1="2" x2="22" y2="22"/><path d="M16.5 9.4l-6.9-6.9M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/></svg>;
  }
}

// ── Signal quality bars ───────────────────────────────────────────────────────

function SignalBars({ quality }: { quality: 0 | 1 | 2 | 3 | 4 }) {
  const barColor = quality <= 1 ? '#ef4444' : quality <= 2 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
      {([1, 2, 3, 4] as const).map(i => (
        <div
          key={i}
          style={{
            width: 3,
            height: 4 + i * 3,
            background: i <= quality ? barColor : '#374151',
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cs: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.85)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    background: '#111827',
    borderRadius: 20,
    width: 520,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
  },
  videoArea: {
    position: 'relative',
    width: '100%',
    height: 320,
    background: '#000',
    flexShrink: 0,
  },
  localPip: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 120,
    height: 90,
    objectFit: 'cover',
    borderRadius: 10,
    border: '2px solid #1f2937',
    background: '#000',
  },
  avatarArea: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
    background: '#0f172a',
    flexShrink: 0,
  },
  bigAvatar: {
    width: 96,
    height: 96,
    borderRadius: '50%',
    background: '#c0392b',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: '2rem',
  },
  infoBar: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '18px 24px 12px',
  },
  partnerName: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: '#f1f5f9',
  },
  callStatus: {
    fontSize: '0.8rem',
    color: '#6b7280',
  },
  controls: {
    display: 'flex',
    justifyContent: 'center',
    gap: 20,
    padding: '12px 24px 24px',
  },
  ctrlBtn: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
};
