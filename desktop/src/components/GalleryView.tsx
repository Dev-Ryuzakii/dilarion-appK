import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, RemoteParticipant, TrackPublication, Participant } from 'livekit-client';
import {
  getLiveKitToken, getIceServers, getUsers, conferenceInvite as apiConferenceInvite, Contact,
  getWaitingRoom, admitFromWaitingRoom, denyFromWaitingRoom, WaitingParticipant,
  startConferenceRecording, stopConferenceRecording,
  sendWhiteboardOpen, sendWhiteboardClose,
} from '../services/api';
import { presenceService, WsMessage } from '../services/presence';
import WhiteboardModal from './WhiteboardModal';
import MeetingChatPanel from './MeetingChatPanel';

// Group video via self-hosted LiveKit — the SFU room every group call (2+
// people) now renders through, replacing the old mesh-WebRTC conference path
// (mesh's O(n^2) cost capped calls at 4; LiveKit doesn't have that ceiling).
// This is the "home" for all in-call tools: gallery grid, mute/camera,
// participants list, adding someone new mid-call, and leaving.
// Breakout rooms / together-mode / recording / captions are explicitly out
// of scope for this round.

interface Tile {
  identity: string;
  displayName: string;
  isLocal: boolean;
  isSpeaking: boolean;
  micOn: boolean;
  camOn: boolean;
  isScreenShare?: boolean;
}

const SCREEN_SHARE_SUFFIX = '::screen';

interface FloatingReaction {
  id: number;
  emoji: string;
  from: string;
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '👏', '🎉', '😮'];

export default function GalleryView({
  token,
  conferenceId,
  onClose,
  initialMicOn = true,
  initialCamOn = true,
  displayName,
  myUsername,
  masterToken,
  onMasterTokenSaved,
  minimized = false,
  onMinimize,
  onMaximize,
}: {
  token: string;
  conferenceId: number;
  onClose: () => void;
  initialMicOn?: boolean;
  initialCamOn?: boolean;
  displayName?: string;
  myUsername: string;
  masterToken: string | null;
  onMasterTokenSaved: (t: string) => void;
  minimized?: boolean;
  onMinimize?: () => void;
  onMaximize?: () => void;
}) {
  const roomRef = useRef<Room | null>(null);
  const [tiles, setTiles] = useState<Record<string, Tile>>({});
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [micOn, setMicOn] = useState(initialMicOn);
  const [camOn, setCamOn] = useState(initialCamOn);
  const [screenSharing, setScreenSharing] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  // Whichever happens first — the track publishing, or the tile's <video>
  // element mounting — completes the attach. Without this, a track that
  // publishes before its tile has rendered (common for the LOCAL camera,
  // which publishes right after the tile is added to state) never gets
  // attached: remote participants still see it fine via their own
  // TrackSubscribed, but the local preview stays blank.
  const trackRefs = useRef<Record<string, Track>>({});

  const [showParticipants, setShowParticipants] = useState(false);
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  // Who's presenting the whiteboard to the room — null means nobody. Sharing
  // it announces + auto-opens it for everyone, and stopping auto-closes it
  // for everyone, matching screen share's semantics rather than a plain
  // "each person opens it themselves" toggle.
  const [whiteboardOwner, setWhiteboardOwner] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [allUsers, setAllUsers] = useState<Contact[]>([]);
  const [addSearch, setAddSearch] = useState('');
  const [inviting, setInviting] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const [waiting, setWaiting] = useState<WaitingParticipant[]>([]);
  const [admitting, setAdmitting] = useState<number | null>(null);

  const [isHost, setIsHost] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Direct UDP fails on plenty of real-world networks (restrictive NATs,
    // some corporate/mobile networks) — the same TURN relay the 1:1 mesh
    // calls already use lets LiveKit fall back to it instead of just hanging.
    let room: Room;

    function upsertTile(p: Participant, isLocal: boolean) {
      setTiles(prev => ({
        ...prev,
        [p.identity]: {
          identity: p.identity, displayName: p.name || p.identity, isLocal,
          isSpeaking: prev[p.identity]?.isSpeaking ?? false,
          micOn: p.isMicrophoneEnabled,
          camOn: p.isCameraEnabled,
        },
      }));
    }

    function removeTile(identity: string) {
      setTiles(prev => {
        const next = { ...prev };
        delete next[identity];
        return next;
      });
    }

    // Screen share gets its own tile (participant::screen) rather than
    // replacing the camera tile — a person's camera and their screen are
    // both worth seeing at once, matching Meet/Teams.
    function upsertScreenTile(identity: string, displayName: string, isLocal: boolean) {
      const key = identity + SCREEN_SHARE_SUFFIX;
      setTiles(prev => ({
        ...prev,
        [key]: {
          identity: key, displayName: `${displayName}'s screen`, isLocal,
          isSpeaking: false, micOn: false, camOn: true, isScreenShare: true,
        },
      }));
    }

    function removeScreenTile(identity: string) {
      removeTile(identity + SCREEN_SHARE_SUFFIX);
      delete trackRefs.current[identity + SCREEN_SHARE_SUFFIX];
    }

    function setTrackState(participant: Participant, pub: TrackPublication, enabled: boolean) {
      setTiles(prev => {
        const t = prev[participant.identity];
        if (!t) return prev;
        if (pub.kind === Track.Kind.Audio) return { ...prev, [participant.identity]: { ...t, micOn: enabled } };
        if (pub.kind === Track.Kind.Video) return { ...prev, [participant.identity]: { ...t, camOn: enabled } };
        return prev;
      });
    }

    (async () => {
      try {
        const [{ url, token: lkToken }, iceServers] = await Promise.all([
          getLiveKitToken(token, conferenceId, displayName),
          getIceServers(token),
        ]);
        if (cancelled) return;

        room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;

        room
          .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => upsertTile(p, false))
          .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => removeTile(p.identity))
          .on(RoomEvent.ActiveSpeakersChanged, speakers => {
            const speaking = new Set(speakers.map(s => s.identity));
            setTiles(prev => {
              const next = { ...prev };
              for (const id of Object.keys(next)) next[id] = { ...next[id], isSpeaking: speaking.has(id) };
              return next;
            });
          })
          .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
            if (track.kind === Track.Kind.Video) {
              if (track.source === Track.Source.ScreenShare) {
                const key = participant.identity + SCREEN_SHARE_SUFFIX;
                trackRefs.current[key] = track;
                upsertScreenTile(participant.identity, participant.name || participant.identity, false);
                const el = videoRefs.current[key];
                if (el) track.attach(el);
                return;
              }
              trackRefs.current[participant.identity] = track;
              const el = videoRefs.current[participant.identity];
              if (el) track.attach(el);
            } else if (track.kind === Track.Kind.Audio) {
              track.attach();
            }
          })
          .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
            if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
              removeScreenTile(participant.identity);
            }
          })
          .on(RoomEvent.TrackMuted, (pub, participant) => setTrackState(participant, pub, false))
          .on(RoomEvent.TrackUnmuted, (pub, participant) => setTrackState(participant, pub, true))
          .on(RoomEvent.LocalTrackPublished, pub => {
            if (pub.kind === Track.Kind.Video && pub.track) {
              if (pub.source === Track.Source.ScreenShare) {
                const key = room.localParticipant.identity + SCREEN_SHARE_SUFFIX;
                trackRefs.current[key] = pub.track;
                upsertScreenTile(room.localParticipant.identity, myUsername, true);
                const el = videoRefs.current[key];
                if (el) pub.track.attach(el);
                return;
              }
              trackRefs.current[room.localParticipant.identity] = pub.track;
              const el = videoRefs.current[room.localParticipant.identity];
              if (el) pub.track.attach(el);
            }
            setTrackState(room.localParticipant, pub, true);
          })
          .on(RoomEvent.LocalTrackUnpublished, pub => {
            if (pub.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
              removeScreenTile(room.localParticipant.identity);
              setScreenSharing(false);
            }
          })
          .on(RoomEvent.DataReceived, (payload, participant) => {
            try {
              const msg = JSON.parse(new TextDecoder().decode(payload));
              if (msg?.type === 'reaction' && typeof msg.emoji === 'string') {
                const from = participant?.name || participant?.identity || 'Someone';
                const id = Date.now() + Math.random();
                setFloatingReactions(prev => [...prev, { id, emoji: msg.emoji, from }]);
                setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 2500);
              }
            } catch {}
          });

        if (cancelled) return;
        await room.connect(url, lkToken, {
          rtcConfig: iceServers && iceServers.length > 0 ? { iceServers } : undefined,
        });
        if (cancelled) { room.disconnect(); return; }
        upsertTile(room.localParticipant, true);
        for (const p of room.remoteParticipants.values()) upsertTile(p, false);
        await room.localParticipant.setMicrophoneEnabled(initialMicOn);
        await room.localParticipant.setCameraEnabled(initialCamOn);
        setConnecting(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || 'Failed to join group video');
          setConnecting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      room?.disconnect();
      roomRef.current = null;
    };
  }, [token, conferenceId]);

  // Host-only in practice — the backend 403s admit/deny for non-hosts, so this
  // just silently finds nothing to show for a guest. Refreshes on load and on
  // every "someone wants to join" WS push instead of polling.
  useEffect(() => {
    getWaitingRoom(token, conferenceId).then(list => { setWaiting(list); setIsHost(true); }).catch(() => {});
    const onMsg = (msg: WsMessage) => {
      if (msg.type === 'conference_join_request') {
        const data = msg.data || {};
        if (data.conference_id !== conferenceId) return;
        setWaiting(prev => (prev.some(w => w.user_id === data.user_id) ? prev : [...prev, { user_id: data.user_id, username: data.username }]));
      } else if (msg.type === 'conference_recording_started') {
        if (msg.data?.conference_id === conferenceId) setRecording(true);
      } else if (msg.type === 'conference_recording_stopped') {
        if (msg.data?.conference_id === conferenceId) setRecording(false);
      } else if (msg.type === 'whiteboard_opened') {
        const data = msg.data || {};
        if (data.conference_id !== conferenceId) return;
        setWhiteboardOwner(data.from);
        setShowWhiteboard(true);
      } else if (msg.type === 'whiteboard_closed') {
        const data = msg.data || {};
        if (data.conference_id !== conferenceId) return;
        setWhiteboardOwner(null);
        setShowWhiteboard(false);
      }
    };
    presenceService.addListener(onMsg);
    return () => presenceService.removeListener(onMsg);
  }, [token, conferenceId]);

  async function toggleRecording() {
    setRecordingBusy(true);
    setRecordingError(null);
    try {
      if (recording) {
        await stopConferenceRecording(token, conferenceId);
        setRecording(false);
      } else {
        await startConferenceRecording(token, conferenceId);
        setRecording(true);
      }
    } catch (err: any) {
      setRecordingError(err?.message || 'Recording failed');
    }
    setRecordingBusy(false);
  }

  async function admitGuest(userId: number) {
    setAdmitting(userId);
    try {
      await admitFromWaitingRoom(token, conferenceId, userId);
      setWaiting(prev => prev.filter(w => w.user_id !== userId));
    } catch {}
    setAdmitting(null);
  }

  async function denyGuest(userId: number) {
    setAdmitting(userId);
    try {
      await denyFromWaitingRoom(token, conferenceId, userId);
      setWaiting(prev => prev.filter(w => w.user_id !== userId));
    } catch {}
    setAdmitting(null);
  }

  async function toggleMic() {
    const room = roomRef.current;
    if (!room) return;
    const next = !micOn;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  async function toggleCam() {
    const room = roomRef.current;
    if (!room) return;
    const next = !camOn;
    await room.localParticipant.setCameraEnabled(next);
    setCamOn(next);
  }

  async function toggleScreenShare() {
    const room = roomRef.current;
    if (!room) return;
    const next = !screenSharing;
    try {
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenSharing(next);
    } catch {
      // user cancelled the OS share picker — leave state as-is
    }
  }

  function toggleWhiteboard() {
    if (showWhiteboard) {
      // Only the presenter stopping actually ends it for the room — a viewer
      // closing their own window just leaves the view, same as no longer
      // looking at someone else's shared screen.
      if (whiteboardOwner === myUsername) {
        sendWhiteboardClose(token, conferenceId);
        setWhiteboardOwner(null);
      }
      setShowWhiteboard(false);
    } else if (!whiteboardOwner) {
      sendWhiteboardOpen(token, conferenceId);
      setWhiteboardOwner(myUsername);
      setShowWhiteboard(true);
    } else {
      // Someone else is already sharing — just view it.
      setShowWhiteboard(true);
    }
  }

  function sendReaction(emoji: string) {
    const room = roomRef.current;
    if (!room) return;
    setShowReactionPicker(false);
    const id = Date.now() + Math.random();
    setFloatingReactions(prev => [...prev, { id, emoji, from: 'You' }]);
    setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 2500);
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'reaction', emoji }));
    room.localParticipant.publishData(payload, { reliable: false });
  }

  function leave() {
    roomRef.current?.disconnect();
    onClose();
  }

  async function openParticipants() {
    setShowParticipants(true);
    setAddError(null);
    if (allUsers.length === 0) {
      try { setAllUsers(await getUsers(token)); } catch {}
    }
  }

  async function invite(username: string) {
    setInviting(username);
    setAddError(null);
    try {
      await apiConferenceInvite(token, conferenceId, username);
    } catch (err: any) {
      setAddError(err?.message || `Could not invite ${username}`);
    } finally {
      setInviting(null);
    }
  }

  const tileList = Object.values(tiles);
  const inCallNames = new Set(tileList.map(t => t.identity));
  const invitable = allUsers.filter(
    u => !inCallNames.has(u.username) && u.username.toLowerCase().includes(addSearch.toLowerCase()),
  );

  // Minimized: floating mini-pill bottom-right, same pattern as 1:1 CallModal
  // — the LiveKit room stays connected in the background (this is the same
  // component instance, its connect effect never re-runs), just nothing here
  // renders the video tiles while collapsed.
  if (minimized) {
    return (
      <div style={miniPillStyle}>
        <div style={miniAvatarStyle}>{tileList.length}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {connecting ? 'Connecting…' : 'In meeting'}
          </div>
          <div style={{ color: '#22c55e', fontSize: '0.72rem', marginTop: 2 }}>
            {tileList.length} participant{tileList.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button onClick={onMaximize} style={miniBtnStyle} title="Expand">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
        <button onClick={leave} style={{ ...miniBtnStyle, background: '#ef4444' }} title="Leave meeting">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/><line x1="2" y1="2" x2="22" y2="22" stroke="#fff" strokeWidth="2"/></svg>
        </button>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: '#0b0b10',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', flexShrink: 0,
      }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          Group Video {tileList.length > 0 && `· ${tileList.length}`}
          {recording && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 20, padding: '2px 10px', fontSize: '0.7rem', color: '#ef4444', fontWeight: 700 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444' }} />
              REC
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {isHost && (
            <button
              onClick={toggleRecording}
              disabled={recordingBusy}
              title={recording ? 'Stop recording' : 'Start recording'}
              style={{ background: recording ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, color: '#fff', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: recordingBusy ? 'wait' : 'pointer', opacity: recordingBusy ? 0.6 : 1 }}
            ><RecordIcon active={recording} /></button>
          )}
          <button
            onClick={openParticipants}
            title="Participants"
            style={{ position: 'relative', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, color: '#fff', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <PeopleIcon />
            {waiting.length > 0 && (
              <span style={{
                position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8,
                background: '#ef4444', color: '#fff', fontSize: '0.65rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              }}>
                {waiting.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowChat(true)}
            title="Chat"
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, color: '#fff', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          ><ChatIcon /></button>
          <button
            onClick={toggleWhiteboard}
            title={
              whiteboardOwner === myUsername ? 'Stop sharing whiteboard'
              : whiteboardOwner ? `${whiteboardOwner} is sharing the whiteboard`
              : 'Share whiteboard'
            }
            style={{ background: whiteboardOwner ? 'rgba(109,94,252,0.35)' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, color: '#fff', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          ><WhiteboardIcon /></button>
          {onMinimize && (
            <button
              onClick={onMinimize}
              title="Minimize"
              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, color: '#fff', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            ><MinimizeIcon /></button>
          )}
          <button
            onClick={leave}
            title="Close"
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, color: '#fff', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          ><CloseIcon /></button>
        </div>
      </div>

      {connecting && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.9rem' }}>
          Connecting…
        </div>
      )}
      {error && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontSize: '0.9rem', padding: 20, textAlign: 'center' }}>
          {error}
        </div>
      )}

      {!connecting && !error && (() => {
        // Solo: one big centered card. Two people: an even split — a giant
        // card plus one tiny thumbnail reads as broken with exactly one other
        // participant. 3+: a thumbnail strip down the left, the active
        // speaker (or first remote participant) large on the right —
        // Meet/Teams' adaptive layout, not a uniform grid.
        if (tileList.length <= 1) {
          return tileList[0] ? (
            <div style={{ flex: 1, padding: 16, minHeight: 0 }}>
              <TileCard tile={tileList[0]} videoRefs={videoRefs} trackRefs={trackRefs} fill />
            </div>
          ) : null;
        }

        if (tileList.length === 2) {
          return (
            <div style={{ flex: 1, display: 'flex', gap: 10, padding: 16, minHeight: 0 }}>
              {tileList.map(tile => (
                <div key={tile.identity} style={{ flex: 1, minWidth: 0 }}>
                  <TileCard tile={tile} videoRefs={videoRefs} trackRefs={trackRefs} fill />
                </div>
              ))}
            </div>
          );
        }

        const mainTile =
          tileList.find(t => t.isScreenShare) ??
          tileList.find(t => t.isSpeaking && !t.isLocal) ??
          tileList.find(t => !t.isLocal) ??
          tileList[0];
        const sideTiles = tileList.filter(t => t.identity !== mainTile?.identity);

        return (
          <div style={{ flex: 1, display: 'flex', gap: 10, padding: 16, overflow: 'hidden' }}>
            {sideTiles.length > 0 && (
              <div style={{
                width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column',
                gap: 10, overflowY: 'auto',
              }}>
                {sideTiles.map(tile => (
                  <TileCard key={tile.identity} tile={tile} videoRefs={videoRefs} trackRefs={trackRefs} compact />
                ))}
              </div>
            )}
            {mainTile && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <TileCard tile={mainTile} videoRefs={videoRefs} trackRefs={trackRefs} fill />
              </div>
            )}
          </div>
        );
      })()}

      {recordingError && (
        <div style={{ position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 970, background: '#2a1414', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8, padding: '8px 14px', color: '#fca5a5', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          {recordingError}
          <button onClick={() => setRecordingError(null)} style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Floating reactions — rise and fade, purely decorative, no persistence */}
      <div style={{ position: 'fixed', right: 24, bottom: 100, zIndex: 960, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, pointerEvents: 'none' }}>
        {floatingReactions.map(r => (
          <div key={r.id} className="reaction-float" style={{ fontSize: '1.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{r.emoji}</span>
            <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.6)' }}>{r.from}</span>
          </div>
        ))}
      </div>

      {!connecting && !error && (
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', gap: 14, padding: '16px 0 24px' }}>
          {showReactionPicker && (
            <div
              style={{
                position: 'absolute', bottom: '100%', marginBottom: 8, left: '50%', transform: 'translateX(-50%)',
                background: '#1a1a22', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12,
                padding: '8px 10px', display: 'flex', gap: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}
            >
              {REACTION_EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => sendReaction(e)}
                  style={{ background: 'transparent', border: 'none', fontSize: '1.3rem', cursor: 'pointer', padding: 2 }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          <button onClick={toggleMic} title={micOn ? 'Mute' : 'Unmute'} style={ctrlBtnStyle(micOn)}>{micOn ? <MicIcon /> : <MicOffIcon />}</button>
          <button onClick={toggleCam} title={camOn ? 'Stop Video' : 'Start Video'} style={ctrlBtnStyle(camOn)}>{camOn ? <VideoIcon /> : <VideoOffIcon />}</button>
          <button onClick={toggleScreenShare} title={screenSharing ? 'Stop sharing' : 'Share screen'} style={ctrlBtnStyle(!screenSharing)}><ScreenShareIcon /></button>
          <button onClick={() => setShowReactionPicker(v => !v)} title="React" style={ctrlBtnStyle(true)}><ReactionIcon /></button>
          <button onClick={openParticipants} title="Add people" style={ctrlBtnStyle(true)}><PersonAddIcon /></button>
          <button onClick={leave} title="Leave" style={{ ...ctrlBtnStyle(false), background: '#ef4444' }}><HangupIcon /></button>
        </div>
      )}

      {showWhiteboard && (
        <WhiteboardModal
          token={token}
          target={{ conferenceId }}
          sharedByLabel={whiteboardOwner === myUsername ? 'You are sharing' : whiteboardOwner ? `${whiteboardOwner} is sharing` : undefined}
          onClose={toggleWhiteboard}
        />
      )}

      {showChat && (
        <MeetingChatPanel
          token={token}
          conferenceId={conferenceId}
          myUsername={myUsername}
          participantUsernames={tileList.filter(t => !t.isLocal).map(t => t.identity)}
          masterToken={masterToken}
          onMasterTokenSaved={onMasterTokenSaved}
          onClose={() => setShowChat(false)}
        />
      )}

      {showParticipants && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end' }}
          onClick={e => { if (e.target === e.currentTarget) setShowParticipants(false); }}
        >
          <div style={{
            width: 320, height: '100%', background: '#16161c',
            display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,0.4)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem' }}>Participants ({tileList.length})</span>
              <button onClick={() => setShowParticipants(false)} style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: '1rem', cursor: 'pointer' }}>✕</button>
            </div>
            {waiting.length > 0 && (
              <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.78rem' }}>Waiting to join ({waiting.length})</span>
                {waiting.map(w => (
                  <div key={w.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', color: '#e8e8ee', fontSize: '0.82rem' }}>
                    <span style={{ flex: 1 }}>{w.username}</span>
                    <button
                      onClick={() => admitGuest(w.user_id)}
                      disabled={admitting === w.user_id}
                      style={{ background: 'var(--accent, #6d5efc)', border: 'none', borderRadius: 6, color: '#fff', padding: '4px 10px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                    >Admit</button>
                    <button
                      onClick={() => denyGuest(w.user_id)}
                      disabled={admitting === w.user_id}
                      style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, color: '#e8e8ee', padding: '4px 10px', fontSize: '0.72rem', cursor: 'pointer' }}
                    >Deny</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ padding: '10px 14px', maxHeight: '35%', overflowY: 'auto', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              {tileList.map(t => (
                <div key={t.identity} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', color: '#e8e8ee', fontSize: '0.82rem' }}>
                  <span style={{ flex: 1 }}>{t.displayName}{t.isLocal ? ' (you)' : ''}</span>
                  {!t.micOn && <span style={{ color: '#aaa', fontSize: '0.72rem' }}>muted</span>}
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 14px', flexShrink: 0 }}>
              <input
                autoFocus
                value={addSearch}
                onChange={e => setAddSearch(e.target.value)}
                placeholder="Add people to this call"
                style={{
                  width: '100%', background: '#0f0f14', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: '0.8rem',
                }}
              />
            </div>
            {addError && <div style={{ padding: '0 14px 8px', color: '#ef4444', fontSize: '0.75rem' }}>{addError}</div>}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
              {invitable.map(u => (
                <button
                  key={u.username}
                  onClick={() => invite(u.username)}
                  disabled={inviting === u.username}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    background: 'transparent', border: 'none', borderRadius: 8, padding: '8px 8px',
                    color: '#e8e8ee', fontSize: '0.82rem', cursor: inviting ? 'default' : 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ flex: 1 }}>{u.username}</span>
                  <span style={{ color: 'var(--accent, #6d5efc)', fontSize: '0.75rem', fontWeight: 700 }}>
                    {inviting === u.username ? 'Inviting…' : 'Invite'}
                  </span>
                </button>
              ))}
              {addSearch && invitable.length === 0 && (
                <div style={{ padding: 10, color: '#888', fontSize: '0.78rem' }}>No matching users</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TileCard({
  tile,
  videoRefs,
  trackRefs,
  compact,
  fill,
}: {
  tile: Tile;
  videoRefs: React.MutableRefObject<Record<string, HTMLVideoElement | null>>;
  trackRefs: React.MutableRefObject<Record<string, Track>>;
  compact?: boolean;
  fill?: boolean;
}) {
  return (
    <div
      style={{
        position: 'relative', background: '#1a1a22', borderRadius: 12, overflow: 'hidden',
        outline: tile.isSpeaking ? '2px solid #25d366' : 'none',
        ...(fill ? { height: '100%' } : { aspectRatio: '16/9', flexShrink: 0 }),
      }}
    >
      <video
        ref={el => {
          videoRefs.current[tile.identity] = el;
          if (el) {
            const track = trackRefs.current[tile.identity];
            if (track) track.attach(el);
          }
        }}
        autoPlay
        playsInline
        muted={tile.isLocal}
        style={{ width: '100%', height: '100%', objectFit: tile.isScreenShare ? 'contain' : 'cover', display: tile.camOn ? 'block' : 'none' }}
      />
      {!tile.camOn && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: compact ? 30 : 56, height: compact ? 30 : 56, borderRadius: '50%',
            background: 'var(--accent, #6d5efc)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: compact ? '0.7rem' : '1.1rem',
          }}>
            {tile.displayName.slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}
      {!tile.micOn && !tile.isScreenShare && (
        <div style={{
          position: 'absolute', top: 6, right: 6,
          width: compact ? 16 : 22, height: compact ? 16 : 22, borderRadius: '50%',
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width={compact ? 9 : 12} height={compact ? 9 : 12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
            <path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2M12 19v3" />
          </svg>
        </div>
      )}
      {!compact && (
        <div style={{
          position: 'absolute', bottom: 8, left: 10,
          color: '#fff', fontSize: '0.75rem', fontWeight: 600,
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        }}>
          {tile.displayName}{tile.isLocal ? ' (you)' : ''}
        </div>
      )}
    </div>
  );
}

const miniPillStyle: React.CSSProperties = {
  position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
  display: 'flex', alignItems: 'center', gap: 10,
  background: '#111827', border: '1px solid #1f2937', borderRadius: 40,
  padding: '10px 14px', boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
  minWidth: 220, maxWidth: 320, cursor: 'default',
};
const miniAvatarStyle: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%', background: '#6d5efc', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0,
};
const miniBtnStyle: React.CSSProperties = {
  width: 30, height: 30, borderRadius: '50%', background: '#374151', border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};

function ctrlBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '50%',
    color: '#fff',
    width: 46,
    height: 46,
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
function ScreenShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /><path d="M12 7v6M9 10l3-3 3 3" />
    </svg>
  );
}
function ReactionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}
function PersonAddIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" /><line x1="17" y1="11" x2="23" y2="11" />
    </svg>
  );
}
function HangupIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.869.31 1.76.53 2.67.65A2 2 0 0 1 22 17.72V21a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 3h3.28a2 2 0 0 1 2 1.72c.12.91.34 1.8.65 2.67a2 2 0 0 1-.45 2.11z" transform="rotate(135 12 12)" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function MinimizeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>
    </svg>
  );
}
function WhiteboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}
function RecordIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2" />
      <circle cx="12" cy="12" r="5" fill={active ? '#ef4444' : 'none'} stroke={active ? '#ef4444' : '#fff'} strokeWidth="2" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
