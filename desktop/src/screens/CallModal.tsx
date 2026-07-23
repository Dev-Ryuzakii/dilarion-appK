import React, { useEffect, useRef, useState, useCallback } from 'react';
import { presenceService } from '../services/presence';
import { initiateCall, performCallAction, sendCallIceCandidate, setCallMediaState, getCallStatus, createConference, conferenceInvite, conferenceSignal, conferenceLeave, getUsers, getIceServers, Contact } from '../services/api';

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
  /** Set when joining a conference we were invited to — no dialling, just join. */
  conferenceIdProp?: number;
  conferenceParticipants?: string[];
  callId?: number;       // set for incoming calls
  offerSdp?: string;     // set for incoming calls
  /** No longer taken from stored state: answering prompts for it every time. */
  masterToken?: string;
  onEnd: () => void;
  minimized?: boolean;
  onMinimize?: () => void;
  onMaximize?: () => void;
}

// ── ICE gather helper — waits for 'complete' with timeout ────────────────────

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 3500): Promise<void> {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const timer = setTimeout(resolve, timeoutMs);
    const check = () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
    };
    pc.addEventListener('icegatheringstatechange', check);
  });
}

// ── ICE servers ───────────────────────────────────────────────────────────────
//
// Preferred source is GET /webrtc/ice-servers, which hands out TURN credentials
// that expire. FALLBACK_ICE_SERVERS below is only used when that call fails —
// its static credential is public (it ships in released builds), so treat it as
// an availability net, not as security.

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  // Own VPS TURN — by hostname (add DNS A record: turndilarion.eibstratoc.com → 41.242.60.238, grey cloud)
  { urls: 'turn:turndilarion.eibstratoc.com:3478',              username: 'dilarion', credential: 'dilarion2026' },
  { urls: 'turn:turndilarion.eibstratoc.com:3478?transport=tcp', username: 'dilarion', credential: 'dilarion2026' },
  // Own VPS TURN — raw IP fallback (works before DNS is set)
  { urls: 'turn:41.242.60.238:3478',              username: 'dilarion', credential: 'dilarion2026' },
  { urls: 'turn:41.242.60.238:3478?transport=tcp', username: 'dilarion', credential: 'dilarion2026' },
  // Public fallbacks
  { urls: 'turn:a.relay.metered.ca:80',               username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:80',               username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

// Last ICE config fetched from the backend, reused for the lifetime of the process.
let activeIceServers: RTCIceServer[] = FALLBACK_ICE_SERVERS;

async function ensureIceServers(token: string): Promise<void> {
  const fetched = await getIceServers(token);
  // Append, never replace: a backend that only knows about our own TURN would
  // otherwise strip the public relays below, leaving a call between two mobile
  // networks with no relay at all — signalling succeeds and no audio flows.
  if (fetched) activeIceServers = [...fetched, ...FALLBACK_ICE_SERVERS];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Answering asks for the master token every time, deliberately: it proves the
 * owner is the one picking up, so it is never stored or pre-filled.
 */
function MasterTokenPrompt({ rejected, onCancel, onConfirm }: {
  rejected: boolean;
  onCancel: () => void;
  onConfirm: (token: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div style={mt.backdrop} onClick={onCancel}>
      <div style={mt.card} onClick={e => e.stopPropagation()}>
        <h3 style={mt.title}>Enter master token</h3>
        <p style={{ ...mt.hint, color: rejected ? '#ef4444' : '#9ca3af' }}>
          {rejected
            ? 'That token was rejected. The call is still ringing — try again.'
            : 'Required to answer an encrypted call.'}
        </p>
        <input
          style={mt.input}
          type="password"
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onConfirm(value.trim()); }}
          placeholder="Master token"
        />
        <div style={mt.row}>
          <button style={mt.ghost} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...mt.primary, opacity: value.trim() ? 1 : 0.5 }}
            disabled={!value.trim()}
            onClick={() => onConfirm(value.trim())}
          >
            Answer
          </button>
        </div>
      </div>
    </div>
  );
}

const mt: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16,
    padding: '1.5rem', width: 320, display: 'flex', flexDirection: 'column', gap: 12,
  },
  title: { margin: 0, color: '#fff', fontSize: '1.05rem' },
  hint: { margin: 0, fontSize: '0.8rem', lineHeight: 1.45 },
  input: {
    background: '#0c0c0c', border: '1px solid #2a2a2a', borderRadius: 10,
    padding: '0.7rem 0.9rem', color: '#fff', fontSize: '0.9rem', outline: 'none',
  },
  row: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  ghost: {
    background: 'transparent', color: '#9ca3af', border: 'none',
    padding: '0.6rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem',
  },
  primary: {
    background: '#25d366', color: '#062', border: 'none', borderRadius: 10,
    padding: '0.6rem 1.1rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem',
  },
};

function fmtDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ── CallModal ─────────────────────────────────────────────────────────────────

export default function CallModal({ token, partner, callType, isIncoming, callId: incomingCallId, offerSdp: incomingOfferSdp, conferenceIdProp, conferenceParticipants, onEnd, minimized = false, onMinimize, onMaximize }: Props) {
  // calling = outgoing, waiting for callee to receive; ringing = callee's device is ringing; connecting = SDP negotiating
  const [state, setState] = useState<'calling' | 'ringing' | 'connecting' | 'connected' | 'ended'>(
    isIncoming ? 'ringing' : 'calling',
  );
  const [muted, setMuted] = useState(false);
  // Mic state of the other participants. WebRTC carries no signal for this —
  // a muted track is silence, indistinguishable from someone not talking — so
  // each side publishes its own state.
  const [peerMuted, setPeerMuted] = useState(false);
  const [mutedPeers, setMutedPeers] = useState<Set<string>>(new Set());
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [netQuality, setNetQuality] = useState<0 | 1 | 2 | 3 | 4>(4);
  const [reconnecting, setReconnecting] = useState(false);
  const iceRestartedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [conferenceId, setConferenceId] = useState<number | null>(null);
  const [confParticipants, setConfParticipants] = useState<string[]>([]);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [allUsers, setAllUsers] = useState<Contact[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  // Conference: one RTCPeerConnection per remote peer username
  const confPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const confAudioElemsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  // The remote MediaStream, kept so it can be re-attached whenever the audio/
  // video element remounts (state change, minimize, video<->audio). Without
  // this the element mounts fresh with no srcObject and audio goes silent.
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callIdRef = useRef<number | null>(incomingCallId ?? null);
  // Buffer outgoing ICE candidates before callId is set
  const iceBufRef = useRef<RTCIceCandidateInit[]>([]);
  // Buffer incoming ICE candidates before remote description is set
  const remoteIceBufRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescSetRef = useRef(false);
  const answerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Answer kept so a rejected master token can be retried without rebuilding it.
  const cachedAnswerRef = useRef<string | null>(null);
  const [showTokenPrompt, setShowTokenPrompt] = useState(false);
  const [tokenRejected, setTokenRejected] = useState(false);

  // ── WebRTC setup ─────────────────────────────────────────────────────────────

  const createPc = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: activeIceServers, iceCandidatePoolSize: 10 });

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
      remoteStreamRef.current = stream;
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

  // Apply the callee's answer, whether it arrives over WS or via the poll
  // fallback. Guarded so it only runs once.
  const applyAnswer = useCallback(async (sdp: string) => {
    const pc = pcRef.current;
    if (!pc || remoteDescSetRef.current) return;
    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
      remoteDescSetRef.current = true;
      const queued = remoteIceBufRef.current.splice(0);
      for (const c of queued) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
    } catch {}
  }, []);

  // Poll for the answer in case the WebSocket push was missed (reconnect churn).
  const startAnswerPoll = useCallback((callId: number) => {
    if (answerPollRef.current) clearInterval(answerPollRef.current);
    let ticks = 0;
    answerPollRef.current = setInterval(async () => {
      ticks += 1;
      if (remoteDescSetRef.current || ticks > 60) {   // stop once answered or ~2min
        if (answerPollRef.current) { clearInterval(answerPollRef.current); answerPollRef.current = null; }
        return;
      }
      const st = await getCallStatus(token, callId);
      if (!st) return;
      if (st.answer_sdp) {
        await applyAnswer(st.answer_sdp);
        setState(s => (s === 'calling' || s === 'ringing' ? 'connecting' : s));
      } else if (['declined', 'decline', 'end', 'busy'].includes(st.status)) {
        if (answerPollRef.current) { clearInterval(answerPollRef.current); answerPollRef.current = null; }
        handleEnd();
      }
    }, 2000);
  }, [token, applyAnswer]);

  // Caller: get media → create offer → wait for ICE gather → POST /calls/initiate
  const startCall = useCallback(async () => {
    await ensureIceServers(token);
    const stream = await startLocalMedia();
    if (!stream) return;
    const pc = createPc();
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // Wait for TURN relay candidates to be gathered (up to 3.5s) so SDP includes them
    await waitForIceGathering(pc);

    try {
      const { call_id } = await initiateCall(token, partner, callType, pc.localDescription!.sdp);
      callIdRef.current = call_id;
      // Flush any late-arriving candidates
      const buffered = iceBufRef.current.splice(0);
      buffered.forEach(c => sendCallIceCandidate(token, call_id, partner, c).catch(() => {}));
      startAnswerPoll(call_id);
    } catch (err: any) {
      setError(err?.message || 'Could not start call');
    }
  }, [startLocalMedia, createPc, token, partner, callType]);

  // Callee: accept → get media → handle offer SDP → wait for ICE gather → POST /calls/action accept
  const acceptCall = useCallback(async (enteredToken: string) => {
    setState('connecting');
    setTokenRejected(false);

    // Build the answer once. A rejected master token leaves the call ringing for
    // a retry, and setRemoteDescription cannot run twice on the same connection.
    let answerSdp = cachedAnswerRef.current ?? undefined;
    if (!answerSdp) {
      await ensureIceServers(token);
      const stream = await startLocalMedia();
      if (!stream) return;
      const pc = createPc();
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      if (incomingOfferSdp) {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: incomingOfferSdp }));
        remoteDescSetRef.current = true;
        // Flush ICE candidates that arrived before we accepted
        const queued = remoteIceBufRef.current.splice(0);
        for (const c of queued) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        // Wait for TURN relay candidates to be gathered before sending answer
        await waitForIceGathering(pc);
        answerSdp = pc.localDescription!.sdp;
        cachedAnswerRef.current = answerSdp;
      }
    }

    if (!callIdRef.current) return;
    try {
      await performCallAction(token, callIdRef.current, 'accept', answerSdp, enteredToken);
    } catch (err: any) {
      // Swallowing this left us "connected" while the caller kept ringing with
      // no audio. A wrong token is retryable; anything else ends the call.
      if (err?.status === 401) {
        setTokenRejected(true);
        setShowTokenPrompt(true);
        setState('ringing');
        return;
      }
      setError(err?.message || 'Could not accept the call');
      setState('ended');
    }
  }, [startLocalMedia, createPc, token, incomingOfferSdp]);

  // Re-attach the remote stream after any render that may have remounted the
  // audio/video elements — the fix for desktop calls going silent on state or
  // minimize changes.
  useEffect(() => {
    const stream = remoteStreamRef.current;
    if (!stream) return;
    if (remoteAudioRef.current && remoteAudioRef.current.srcObject !== stream) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.play().catch(() => {});
    }
    if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== stream) {
      remoteVideoRef.current.srcObject = stream;
    }
  });

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
          if (data.answer_sdp) await applyAnswer(data.answer_sdp);
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

      if (msg.type === 'call_media_state') {
        if (Number(data.call_id) === callIdRef.current) {
          setPeerMuted(Boolean(data.muted));
          const who = data.username as string | undefined;
          if (who) {
            setMutedPeers(prev => {
              const n = new Set(prev);
              if (data.muted) n.add(who); else n.delete(who);
              return n;
            });
          }
        }
      }

      // Legacy p2p fallback: call_end sent directly by other desktop client
      if (msg.type === 'call_end' && (msg.sender === partner || msg.from === partner)) {
        handleEnd();
      }

      // ── Conference signaling ────────────────────────────────────────────────
      if (msg.type === 'conference_invite') {
        // Only note it. Joining happens after the invitee answers and enters
        // their master token (HomeScreen); connecting here would attach the
        // microphone to a call nobody agreed to.
        const confId: number = data.conference_id;
        if (conferenceIdProp === confId) setConfParticipants(data.existing_participants || []);
      }

      if (msg.type === 'conference_peer_connect') {
        const confId: number = data.conference_id;
        const peer: string = data.peer_username;
        const role: string = data.role || 'offer';
        const pc = createConferencePeer(peer, confId);
        if (role === 'offer') {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await conferenceSignal(token, confId, peer, 'offer', { sdp: offer.sdp }).catch(() => {});
        }
        setConferenceId(confId);
      }

      if (msg.type === 'conference_signal') {
        const confId: number = data.conference_id;
        const fromUser: string = data.from;
        const signalType: string = data.signal_type;
        const signalData: any = data.data;
        const pc = confPeersRef.current.get(fromUser) || createConferencePeer(fromUser, confId);
        if (signalType === 'media_state') {
          setMutedPeers(prev => {
            const n = new Set(prev);
            if (signalData?.muted) n.add(fromUser); else n.delete(fromUser);
            return n;
          });
          return;
        }
        if (signalType === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signalData.sdp }));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await conferenceSignal(token, confId, fromUser, 'answer', { sdp: answer.sdp }).catch(() => {});
        } else if (signalType === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signalData.sdp }));
        } else if (signalType === 'ice_candidate') {
          try { await pc.addIceCandidate(new RTCIceCandidate(signalData)); } catch {}
        }
      }

      if (msg.type === 'conference_participant_left') {
        removeConferencePeer(data.username);
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

  // ── Conference peer helpers ───────────────────────────────────────────────────

  const createConferencePeer = useCallback((peerUsername: string, confId: number) => {
    if (confPeersRef.current.has(peerUsername)) return confPeersRef.current.get(peerUsername)!;
    const pc = new RTCPeerConnection({ iceServers: activeIceServers });

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      conferenceSignal(token, confId, peerUsername, 'ice_candidate', candidate.toJSON()).catch(() => {});
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      // Create / reuse a dedicated audio element per peer
      let audio = confAudioElemsRef.current.get(peerUsername);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        document.body.appendChild(audio);
        confAudioElemsRef.current.set(peerUsername, audio);
      }
      audio.srcObject = stream;
      audio.play().catch(() => {});
    };

    // Add local tracks so conference peer can hear us
    localStreamRef.current?.getTracks().forEach(t => {
      pc.addTrack(t, localStreamRef.current!);
    });

    confPeersRef.current.set(peerUsername, pc);
    setConfParticipants(p => [...new Set([...p, peerUsername])]);
    return pc;
  }, [token]);

  const removeConferencePeer = useCallback((peerUsername: string) => {
    confPeersRef.current.get(peerUsername)?.close();
    confPeersRef.current.delete(peerUsername);
    const audio = confAudioElemsRef.current.get(peerUsername);
    if (audio) { audio.srcObject = null; audio.remove(); confAudioElemsRef.current.delete(peerUsername); }
    setConfParticipants(p => p.filter(u => u !== peerUsername));
  }, []);

  async function openUserPicker() {
    try {
      const fetched = await getUsers(token);
      setAllUsers(fetched.filter(u => u.username !== partner));
    } catch {}
    setUserPickerOpen(true);
  }

  async function handleAddParticipant(username: string) {
    if (!username.trim() || !callIdRef.current) return;
    let confId = conferenceId;
    if (!confId) {
      const res = await createConference(token, callIdRef.current);
      confId = res.conference_id;
      setConferenceId(confId);
      setConfParticipants([partner]);
    }
    await conferenceInvite(token, confId, username.trim());
    setUserPickerOpen(false);
    setUserSearch('');
  }

  function stopAllMedia() {
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (answerPollRef.current) { clearInterval(answerPollRef.current); answerPollRef.current = null; }
    remoteStreamRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) { remoteAudioRef.current.pause(); remoteAudioRef.current.srcObject = null; }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    // Close all conference peer connections
    confPeersRef.current.forEach(pc => pc.close());
    confPeersRef.current.clear();
    confAudioElemsRef.current.forEach(audio => { audio.srcObject = null; audio.remove(); });
    confAudioElemsRef.current.clear();
    if (conferenceId) conferenceLeave(token, conferenceId).catch(() => {});
    pcRef.current?.close();
    pcRef.current = null;
  }

  // Start outgoing call on mount
  useEffect(() => {
    if (conferenceIdProp) {
      // Joining an existing conference: there is nobody to dial. Open the mic and
      // wait — the participants already on the call send us their offers.
      (async () => {
        setConferenceId(conferenceIdProp);
        setConfParticipants(conferenceParticipants ?? []);
        await ensureIceServers(token);
        await startLocalMedia();
        setState('connected');
        if (!timerRef.current) {
          timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
        }
      })();
    } else if (!isIncoming) {
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
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
    if (callIdRef.current) setCallMediaState(token, callIdRef.current, next);
    const confId = conferenceId;
    if (confId) {
      confParticipants.forEach(peer => {
        conferenceSignal(token, confId, peer, 'media_state', { muted: next }).catch(() => {});
      });
    }
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

  // Minimized: floating mini-pill at bottom-right — WebRTC keeps running
  if (minimized) {
    return (
      <div style={cs.miniPill}>
        <div style={cs.miniAvatar}>{partner.slice(0, 2).toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partner}</div>
          <div style={{ color: '#22c55e', fontSize: '0.72rem', marginTop: 2 }}>
            {state === 'connected' ? fmtDur(duration) : state === 'connecting' ? 'Connecting…' : 'Call…'}
          </div>
        </div>
        <button onClick={onMaximize} style={cs.miniBtn} title="Expand">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
        <button onClick={handleEnd} style={{ ...cs.miniBtn, background: '#ef4444' }} title="End call">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/><line x1="2" y1="2" x2="22" y2="22" stroke="#fff" strokeWidth="2"/></svg>
        </button>
        {/* Hidden audio elements keep playing */}
        <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />
      </div>
    );
  }

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
        <div style={{ ...cs.infoBar, position: 'relative' }}>
          {onMinimize && state !== 'ringing' && (
            <button
              onClick={onMinimize}
              title="Minimize"
              style={{ position: 'absolute', top: 12, right: 12, background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: '#9ca3af' }}
            >
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>
            </button>
          )}
          <span style={cs.partnerName}>{partner}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={cs.callStatus}>
              {state === 'calling'    && 'Calling…'}
              {state === 'ringing'    && (isIncoming ? 'Incoming call…' : 'Ringing…')}
              {state === 'connecting' && 'Connecting…'}
              {state === 'connected'  && (
                reconnecting ? 'Reconnecting…'
                : peerMuted ? `${partner} is muted · ${fmtDur(duration)}`
                : fmtDur(duration)
              )}
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
            <ControlBtn icon="accept" color="#25d366" label="Accept" onClick={() => setShowTokenPrompt(true)} />
            {showTokenPrompt && (
              <MasterTokenPrompt
                rejected={tokenRejected}
                onCancel={() => { setShowTokenPrompt(false); setTokenRejected(false); }}
                onConfirm={(t) => { setShowTokenPrompt(false); acceptCall(t); }}
              />
            )}
          </div>
        )}

        {/* Outgoing: calling/ringing — just show cancel */}
        {(state === 'calling' || (state === 'ringing' && !isIncoming)) && (
          <div style={cs.controls}>
            <ControlBtn icon="end" color="#ef4444" label="Cancel" onClick={handleEnd} />
          </div>
        )}

        {/* Conference participants list */}
        {confParticipants.length > 0 && (
          <div style={{ display: 'flex', gap: 6, padding: '8px 16px', flexWrap: 'wrap' }}>
            {confParticipants.map(p => {
              const isMuted = mutedPeers.has(p);
              return (
                <div key={p} style={{ background: '#1f2937', borderRadius: 20, padding: '4px 10px', fontSize: '0.75rem', color: isMuted ? '#9ca3af' : '#d1d5db', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: isMuted ? '#6b7280' : '#22c55e', display: 'inline-block' }} />
                  {p}
                  {isMuted && <span title="muted" style={{ fontSize: '0.7rem' }}>🔇</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* WhatsApp-style user picker modal */}
        {userPickerOpen && (
          <div style={cs.pickerOverlay}>
            <div style={cs.pickerModal}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #1f2937' }}>
                <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1rem' }}>Add to Call</span>
                <button onClick={() => { setUserPickerOpen(false); setUserSearch(''); }} style={cs.pickerClose}>✕</button>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <input
                  autoFocus
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Search users…"
                  style={cs.searchInput}
                />
              </div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {allUsers.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase())).map(u => (
                  <div key={u.username} onClick={() => handleAddParticipant(u.username)} style={cs.userRow}>
                    <div style={cs.userAvatar}>{u.username.slice(0, 2).toUpperCase()}</div>
                    <span style={{ color: '#f1f5f9', fontSize: '0.9rem', fontWeight: 600, flex: 1 }}>{u.username}</span>
                    <span style={{ color: '#22c55e', fontSize: '0.8rem', fontWeight: 600 }}>+ Add</span>
                  </div>
                ))}
                {allUsers.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase())).length === 0 && (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280', fontSize: '0.85rem' }}>
                    {allUsers.length === 0 ? 'Loading…' : 'No users found'}
                  </div>
                )}
              </div>
            </div>
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
            {state === 'connected' && (
              <ControlBtn icon="add-user" color={userPickerOpen ? '#3b82f6' : '#374151'} label="Add" onClick={openUserPicker} />
            )}
            <ControlBtn icon="end" color="#ef4444" label="End" onClick={handleEnd} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Control button ────────────────────────────────────────────────────────────

type IconName = 'mic' | 'mic-off' | 'cam' | 'cam-off' | 'screen' | 'end' | 'accept' | 'decline' | 'add-user';

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
    case 'add-user': return <svg viewBox="0 0 24 24" {...S}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>;
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
  miniPill: {
    position: 'fixed' as const,
    bottom: 24,
    right: 24,
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: 40,
    padding: '10px 14px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
    minWidth: 220,
    maxWidth: 320,
    cursor: 'default',
  },
  miniAvatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#c0392b',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: '0.8rem',
    flexShrink: 0,
  },
  miniBtn: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: '#374151',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pickerOverlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.75)',
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerModal: {
    background: '#111827',
    borderRadius: 16,
    width: 400,
    maxHeight: 500,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
  },
  searchInput: {
    width: '100%',
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 8,
    padding: '8px 12px',
    color: '#fff',
    fontSize: '0.9rem',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  userRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    cursor: 'pointer',
    borderBottom: '1px solid #1f2937',
    transition: 'background 0.1s',
  } as React.CSSProperties,
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#c0392b',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.75rem',
    fontWeight: 800 as const,
    flexShrink: 0,
  },
  pickerClose: {
    background: 'transparent',
    border: 'none',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '1rem',
    padding: 4,
    lineHeight: 1,
  },
};
