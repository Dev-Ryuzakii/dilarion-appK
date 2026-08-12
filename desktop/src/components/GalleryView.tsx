import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, RemoteParticipant, TrackPublication, Participant } from 'livekit-client';
import {
  getLiveKitToken, getIceServers, getUsers, conferenceInvite as apiConferenceInvite, Contact,
  getWaitingRoom, admitFromWaitingRoom, denyFromWaitingRoom, WaitingParticipant,
} from '../services/api';
import { presenceService, WsMessage } from '../services/presence';
import WhiteboardModal from './WhiteboardModal';

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
}

export default function GalleryView({
  token,
  conferenceId,
  onClose,
  initialMicOn = true,
  initialCamOn = true,
  displayName,
}: {
  token: string;
  conferenceId: number;
  onClose: () => void;
  initialMicOn?: boolean;
  initialCamOn?: boolean;
  displayName?: string;
}) {
  const roomRef = useRef<Room | null>(null);
  const [tiles, setTiles] = useState<Record<string, Tile>>({});
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [micOn, setMicOn] = useState(initialMicOn);
  const [camOn, setCamOn] = useState(initialCamOn);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const [showParticipants, setShowParticipants] = useState(false);
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [allUsers, setAllUsers] = useState<Contact[]>([]);
  const [addSearch, setAddSearch] = useState('');
  const [inviting, setInviting] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const [waiting, setWaiting] = useState<WaitingParticipant[]>([]);
  const [admitting, setAdmitting] = useState<number | null>(null);

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
              const el = videoRefs.current[participant.identity];
              if (el) track.attach(el);
            } else if (track.kind === Track.Kind.Audio) {
              track.attach();
            }
          })
          .on(RoomEvent.TrackMuted, (pub, participant) => setTrackState(participant, pub, false))
          .on(RoomEvent.TrackUnmuted, (pub, participant) => setTrackState(participant, pub, true))
          .on(RoomEvent.LocalTrackPublished, pub => {
            if (pub.kind === Track.Kind.Video) {
              const el = videoRefs.current[room.localParticipant.identity];
              if (el && pub.track) pub.track.attach(el);
            }
            setTrackState(room.localParticipant, pub, true);
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
    getWaitingRoom(token, conferenceId).then(setWaiting).catch(() => {});
    const onMsg = (msg: WsMessage) => {
      if (msg.type !== 'conference_join_request') return;
      const data = msg.data || {};
      if (data.conference_id !== conferenceId) return;
      setWaiting(prev => (prev.some(w => w.user_id === data.user_id) ? prev : [...prev, { user_id: data.user_id, username: data.username }]));
    };
    presenceService.addListener(onMsg);
    return () => presenceService.removeListener(onMsg);
  }, [token, conferenceId]);

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
        <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem' }}>
          Group Video {tileList.length > 0 && `· ${tileList.length}`}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
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
            onClick={() => setShowWhiteboard(true)}
            title="Whiteboard"
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, color: '#fff', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          ><WhiteboardIcon /></button>
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
              <TileCard tile={tileList[0]} videoRefs={videoRefs} fill />
            </div>
          ) : null;
        }

        if (tileList.length === 2) {
          return (
            <div style={{ flex: 1, display: 'flex', gap: 10, padding: 16, minHeight: 0 }}>
              {tileList.map(tile => (
                <div key={tile.identity} style={{ flex: 1, minWidth: 0 }}>
                  <TileCard tile={tile} videoRefs={videoRefs} fill />
                </div>
              ))}
            </div>
          );
        }

        const mainTile =
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
                  <TileCard key={tile.identity} tile={tile} videoRefs={videoRefs} compact />
                ))}
              </div>
            )}
            {mainTile && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <TileCard tile={mainTile} videoRefs={videoRefs} fill />
              </div>
            )}
          </div>
        );
      })()}

      {!connecting && !error && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, padding: '16px 0 24px' }}>
          <button onClick={toggleMic} title={micOn ? 'Mute' : 'Unmute'} style={ctrlBtnStyle(micOn)}>{micOn ? <MicIcon /> : <MicOffIcon />}</button>
          <button onClick={toggleCam} title={camOn ? 'Stop Video' : 'Start Video'} style={ctrlBtnStyle(camOn)}>{camOn ? <VideoIcon /> : <VideoOffIcon />}</button>
          <button onClick={openParticipants} title="Add people" style={ctrlBtnStyle(true)}><PersonAddIcon /></button>
          <button onClick={leave} title="Leave" style={{ ...ctrlBtnStyle(false), background: '#ef4444' }}><HangupIcon /></button>
        </div>
      )}

      {showWhiteboard && (
        <WhiteboardModal token={token} target={{ conferenceId }} onClose={() => setShowWhiteboard(false)} />
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
  compact,
  fill,
}: {
  tile: Tile;
  videoRefs: React.MutableRefObject<Record<string, HTMLVideoElement | null>>;
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
        ref={el => { videoRefs.current[tile.identity] = el; }}
        autoPlay
        playsInline
        muted={tile.isLocal}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: tile.camOn ? 'block' : 'none' }}
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
      {!tile.micOn && (
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
function WhiteboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}
