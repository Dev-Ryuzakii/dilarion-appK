import { decryptMessage as decryptMessageLocal, resolveEncryptedKey } from './crypto';

// VITE_API_BASE comes from .env.production / .env.test (see package.json build:test).
// Falls back to production so a plain `npm run build` with no mode flag never
// silently points at the test backend.
const BASE = import.meta.env.VITE_API_BASE || 'https://apidilarion.eibstratoc.com';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MessageReaction {
  emoji: string;
  count: number;
  reacted_by_me: boolean;
}

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
  reactions?: MessageReaction[];
  reply_to_message_id?: number | null;
  forwarded_from_message_id?: number | null;
  is_edited?: boolean;
  is_deleted?: boolean;
  is_pinned?: boolean;
  mentions?: string[];
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

// Reserved key under which every send also wraps the message's AES key, so
// admin/superadmin accounts can decrypt it server-side. Cached in-memory for
// the process lifetime — this key doesn't rotate during a session.
let _adminPublicKeyCache: string | null = null;

export async function getAdminPublicKey(token: string): Promise<string | null> {
  if (_adminPublicKeyCache) return _adminPublicKeyCache;
  try {
    const res = await fetch(`${BASE}/encryption/admin-public-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    _adminPublicKeyCache = body.public_key ?? null;
    return _adminPublicKeyCache;
  } catch {
    return null;
  }
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
  opts: { encryptedKey: string; iv: string; decoyContent: string; replyToMessageId?: number; forwardedFromMessageId?: number; mentions?: string[]; contentType?: 'gif' | 'sticker' },
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
      reply_to_message_id: opts.replyToMessageId ?? null,
      forwarded_from_message_id: opts.forwardedFromMessageId ?? null,
      mentions: opts.mentions ?? null,
      content_type: opts.contentType ?? null,
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

export async function downloadDecoyVoice(token: string, mediaId: string): Promise<Blob> {
  const res = await fetch(`${BASE}/media/decoy-voice/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // The backend uses the same 404 for two different reasons ("Media not
    // found" vs "No audio available to build a decoy from") — surface its
    // actual detail so a failure is diagnosable instead of a generic guess.
    let detail = 'Failed to load decoy';
    try { const b = await res.json(); detail = b.detail || detail; } catch {}
    throw Object.assign(new Error(detail), { status: res.status });
  }
  return res.blob();
}

// Stand-in still photo shown before a master-token reveal, for both locked
// photos and videos (a fake video is not worth generating — a still covers
// the same "nothing hints a decoy exists" requirement). Reusable, cached
// server-side, never deletes the real file.
export async function downloadDecoyImage(token: string, mediaId: string): Promise<Blob> {
  const res = await fetch(`${BASE}/media/decoy-image/${encodeURIComponent(mediaId)}`, {
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
  opts: { encryptedKey: string; iv: string; decoyContent: string; replyToMessageId?: number; forwardedFromMessageId?: number; mentions?: string[]; contentType?: 'gif' | 'sticker' },
  addressedToUsername?: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    group_id: groupId,
    message,
    encrypted_key: opts.encryptedKey,
    iv: opts.iv,
    decoy_content: opts.decoyContent,
    reply_to_message_id: opts.replyToMessageId ?? null,
    forwarded_from_message_id: opts.forwardedFromMessageId ?? null,
    mentions: opts.mentions ?? null,
    content_type: opts.contentType ?? null,
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

/**
 * Every call_status_update status that means "this call is over".
 *
 * The server reports a caller who hangs up before the callee picks up as
 * "missed", not "end" — a client that only listens for "end"/"declined" keeps
 * ringing forever after the other side gives up.
 */
export const CALL_TERMINAL_STATUSES = [
  'end', 'ended', 'decline', 'declined', 'missed', 'busy', 'cancelled', 'canceled',
];

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

// ── Copilot ──────────────────────────────────────────────────────────────────
// Never reads message content — `text` is whatever the user typed directly
// into the copilot box. Doesn't create anything itself; the caller prefills
// the existing New Meeting form with the result and still requires the user
// to pick attendees and confirm.

export interface CopilotScheduleResult {
  title: string;
  scheduled_at: string;
  duration_minutes: number;
  confidence: 'high' | 'low';
  note: string;
}

export async function parseScheduleCopilot(token: string, text: string): Promise<CopilotScheduleResult> {
  // Local wall-clock ISO, no offset — matches the datetime-local inputs the
  // result gets dropped into, and lets the model resolve "tomorrow"/"3pm"
  // against the same clock the user is reading, not a UTC instant that could
  // land on the wrong calendar day depending on timezone.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const currentTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const res = await fetch(`${BASE}/copilot/parse-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, current_time: currentTime }),
  });
  if (!res.ok) {
    let detail = `Copilot request failed (${res.status})`;
    try { const b = await res.json(); detail = b.detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function copilotPost<T>(token: string, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `Copilot request failed (${res.status})`;
    try { const b = await res.json(); detail = b.detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export async function summarizeThreadCopilot(token: string, text: string): Promise<string> {
  const r = await copilotPost<{ summary: string }>(token, '/copilot/summarize', { text });
  return r.summary;
}

export async function composeReplyCopilot(token: string, context: string, instruction?: string): Promise<string[]> {
  const r = await copilotPost<{ suggestions: string[] }>(token, '/copilot/compose', { context, instruction: instruction ?? null });
  return r.suggestions;
}

export async function documentQACopilot(token: string, documentText: string, question: string): Promise<string> {
  const r = await copilotPost<{ answer: string }>(token, '/copilot/document-qa', { document_text: documentText, question });
  return r.answer;
}

export async function translateCopilot(token: string, text: string, targetLanguage: string): Promise<string> {
  const r = await copilotPost<{ translated: string }>(token, '/copilot/translate', { text, target_language: targetLanguage });
  return r.translated;
}

export async function transcribeCopilot(token: string, audioBlob: Blob, filename = 'voice.m4a'): Promise<string> {
  const form = new FormData();
  form.append('file', audioBlob, filename);
  const res = await fetch(`${BASE}/copilot/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    let detail = `Transcription failed (${res.status})`;
    try { const b = await res.json(); detail = b.detail || detail; } catch {}
    throw new Error(detail);
  }
  const body = await res.json();
  return body.transcript;
}

export async function getUpcomingMeetings(token: string): Promise<MeetingSummary[]> {
  const res = await fetch(`${BASE}/meetings/upcoming`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load meetings (${res.status})`);
  const body = await res.json();
  return body.meetings ?? [];
}

export interface CalendarOccurrence {
  meeting_id: number;
  title: string | null;
  occurrence_start: string;
  occurrence_end: string;
  duration_minutes: number;
  recurrence: string | null;
  status: 'upcoming' | 'live' | 'ended' | 'cancelled';
  join_code: string;
  creator_username: string;
  group_id: number | null;
  waiting_room_enabled: boolean;
}

export interface PersonalPlan {
  plan_id: number;
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}

export interface GoogleCalendarEvent {
  google_event_id: string;
  title: string;
  occurrence_start: string;
  occurrence_end: string;
  all_day: boolean;
  location: string | null;
  html_link: string | null;
}

export interface CalendarFeed {
  occurrences: CalendarOccurrence[];
  plans: PersonalPlan[];
  google_events: GoogleCalendarEvent[];
}

export async function getMeetingCalendar(token: string, start: string, end: string): Promise<CalendarFeed> {
  const res = await fetch(`${BASE}/meetings/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to load calendar (${res.status})`);
  const body = await res.json();
  return { occurrences: body.occurrences ?? [], plans: body.plans ?? [], google_events: body.google_events ?? [] };
}

// ── Personal calendar plans ───────────────────────────────────────────────────

export async function createPersonalPlan(token: string, plan: { title: string; notes?: string; starts_at: string; ends_at?: string; all_day?: boolean }): Promise<PersonalPlan> {
  const res = await fetch(`${BASE}/calendar/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(plan),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to create plan');
  }
  return res.json();
}

export async function updatePersonalPlan(token: string, planId: number, plan: Partial<{ title: string; notes: string; starts_at: string; ends_at: string; all_day: boolean }>): Promise<PersonalPlan> {
  const res = await fetch(`${BASE}/calendar/plans/${planId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(plan),
  });
  if (!res.ok) throw new Error('Failed to update plan');
  return res.json();
}

export async function deletePersonalPlan(token: string, planId: number): Promise<void> {
  const res = await fetch(`${BASE}/calendar/plans/${planId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to delete plan');
}

// ── Google Calendar linking ───────────────────────────────────────────────────

export async function getGoogleCalendarAuthorizeUrl(token: string): Promise<string> {
  const res = await fetch(`${BASE}/calendar/google/authorize`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Google Calendar linking is not available');
  }
  const body = await res.json();
  return body.authorize_url;
}

export interface GoogleCalendarStatus {
  linked: boolean;
  google_email?: string | null;
  last_synced_at?: string | null;
}

export async function getGoogleCalendarStatus(token: string): Promise<GoogleCalendarStatus> {
  const res = await fetch(`${BASE}/calendar/google/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to check Google Calendar status');
  return res.json();
}

export async function unlinkGoogleCalendar(token: string): Promise<void> {
  const res = await fetch(`${BASE}/calendar/google/unlink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to unlink Google Calendar');
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

// ── Recording ──────────────────────────────────────────────────────────────────
// Host-only. Backend drives LiveKit Egress; the file never touches this
// client — it lands directly on the VPS, visible only via the superadmin
// Drive site.

export async function startConferenceRecording(token: string, conferenceId: number): Promise<void> {
  const res = await fetch(`${BASE}/calls/conference/${conferenceId}/recording/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `Failed to start recording (${res.status})`);
}

export async function stopConferenceRecording(token: string, conferenceId: number): Promise<void> {
  const res = await fetch(`${BASE}/calls/conference/${conferenceId}/recording/stop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `Failed to stop recording (${res.status})`);
}

// ── In-meeting chat ────────────────────────────────────────────────────────────
// Scoped to a conference_id instead of a group/DM. Reuses the same encrypted_
// content/decoy_content/encrypted_key/iv model as DMs and group chat.

export interface ConferenceChatMessage {
  id: number;
  sender: string;
  content: string;
  content_type: string;
  timestamp: string;
  decoy_content?: string;
  encrypted_key?: string | null;
  iv?: string | null;
}

export async function getConferenceMessages(token: string, conferenceId: number): Promise<ConferenceChatMessage[]> {
  const res = await fetch(`${BASE}/messages/conference/${conferenceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch conference messages');
  const body = await res.json();
  return body.messages ?? body;
}

export async function sendConferenceMessage(
  token: string,
  conferenceId: number,
  message: string,
  opts: { encryptedKey: string; iv: string; decoyContent: string },
): Promise<void> {
  const res = await fetch(`${BASE}/messages/conference/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      conference_id: conferenceId,
      message,
      encrypted_key: opts.encryptedKey,
      iv: opts.iv,
      decoy_content: opts.decoyContent,
    }),
  });
  if (!res.ok) throw new Error('Failed to send conference message');
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

// Announces the whiteboard to everyone in the meeting the moment it's shared/
// stopped — surfaces it for the room the way starting/stopping a screen share
// does, instead of each participant needing to separately open it themselves.
export async function sendWhiteboardOpen(token: string, conferenceId: number): Promise<void> {
  await fetch(`${BASE}/whiteboard/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conference_id: conferenceId }),
  }).catch(() => {});
}

export async function sendWhiteboardClose(token: string, conferenceId: number): Promise<void> {
  await fetch(`${BASE}/whiteboard/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conference_id: conferenceId }),
  }).catch(() => {});
}

// ── Remote control (in-meeting screen/input control) ─────────────────────────
// Pure signaling — the actual input events travel over the meeting's LiveKit
// data channel (see GalleryView.tsx), never through this server.

export async function requestRemoteControl(token: string, conferenceId: number, targetUsername: string): Promise<void> {
  const res = await fetch(`${BASE}/calls/conference/${conferenceId}/control/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conference_id: conferenceId, target_username: targetUsername }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || 'Failed to request control');
}

export async function respondRemoteControl(token: string, conferenceId: number, requesterUsername: string, approved: boolean): Promise<void> {
  await fetch(`${BASE}/calls/conference/${conferenceId}/control/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conference_id: conferenceId, requester_username: requesterUsername, approved }),
  }).catch(() => {});
}

export async function endRemoteControl(token: string, conferenceId: number, otherUsername: string): Promise<void> {
  await fetch(`${BASE}/calls/conference/${conferenceId}/control/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ conference_id: conferenceId, other_username: otherUsername }),
  }).catch(() => {});
}

// ── Disappearing message defaults ─────────────────────────────────────────────
// Per-sender defaults applied automatically when you don't override per-send —
// see _resolve_disappear_hours on the backend. Separate knobs for text, media
// (photos/videos/docs), and voice notes.

export interface DisappearSettings {
  text_hours: number | null;
  media_hours: number | null;
  voice_hours: number | null;
}

export async function getDisappearSettings(token: string): Promise<DisappearSettings> {
  const res = await fetch(`${BASE}/users/me/disappear-settings`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to load disappearing message settings');
  return res.json();
}

export async function setDisappearSettings(token: string, settings: DisappearSettings): Promise<DisappearSettings> {
  const res = await fetch(`${BASE}/users/me/disappear-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || 'Failed to update disappearing message settings');
  return res.json();
}

/** Clears an entire 1:1 conversation for both people (bulk tombstone, same
 * mechanism as a single-message delete). Returns how many were cleared. */
export async function clearConversation(token: string, otherUsername: string): Promise<number> {
  const res = await fetch(`${BASE}/messages/clear/${encodeURIComponent(otherUsername)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to clear conversation');
  const data = await res.json();
  return data.count ?? 0;
}

// ── Monitoring consent (org device policy) ───────────────────────────────────

export interface MonitoringConsentState {
  consent_given: boolean;
  allow_live_listen?: boolean;
  allow_recording?: boolean;
  allow_app_policy_monitoring: boolean;
  consented_at?: string | null;
  revoked_at?: string | null;
}

export async function getMonitoringConsent(token: string): Promise<MonitoringConsentState> {
  const res = await fetch(`${BASE}/monitoring/consent`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to load consent status');
  return res.json();
}

export async function setAppPolicyConsent(token: string, allow: boolean): Promise<MonitoringConsentState> {
  const res = await fetch(`${BASE}/monitoring/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ consent_given: allow, allow_app_policy_monitoring: allow }),
  });
  if (!res.ok) throw new Error('Failed to update consent');
  return res.json();
}

// ── Org device-policy compliance agent ────────────────────────────────────────
// See AppComplianceMonitor.tsx — polls the blocklist and reports a match with
// a screenshot, only while allow_app_policy_monitoring is true.

export async function getPolicyBlocklist(token: string): Promise<string[]> {
  const res = await fetch(`${BASE}/monitoring/policy/blocklist`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.blocked || [];
}

export async function reportPolicyViolation(token: string, processName: string, deviceHostname: string, screenshotBase64: string): Promise<void> {
  const bytes = atob(screenshotBase64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: 'image/png' });
  const form = new FormData();
  form.append('file', blob, 'violation.png');
  form.append('process_name', processName);
  form.append('device_hostname', deviceHostname);
  await fetch(`${BASE}/monitoring/policy/violation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
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

export async function createMasterToken(token: string, masterToken: string, twoFaPassword?: string): Promise<void> {
  const res = await fetch(`${BASE}/mastertoken/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mastertoken: masterToken, two_fa_password: twoFaPassword || null }),
  });
  if (!res.ok) {
    let detail = 'Failed to create master token';
    try { const b = await res.json(); detail = b.detail || detail; } catch {}
    throw new Error(detail);
  }
}

// ── Master-token 2FA ─────────────────────────────────────────────────────────

// ── Voice identity (AI Voice Decoy) ─────────────────────────────────────────
// Enrolled sample is cloned server-side (voice_scrambler.py) to generate a
// decoy voice note in the user's own voice for every real one sent. The
// sample itself never comes back down — see media/decoy-voice.

export async function uploadVoiceIdentity(token: string, blob: Blob, filename = 'voice_identity.webm'): Promise<void> {
  const form = new FormData();
  form.append('file', blob, filename);
  const res = await fetch(`${BASE}/users/me/voice-identity`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error('Failed to save voice sample');
}

export async function hasVoiceIdentity(token: string, username: string): Promise<boolean> {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}/voice-identity`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

export async function getMasterToken2FAStatus(token: string): Promise<boolean> {
  const res = await fetch(`${BASE}/mastertoken/2fa/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch 2FA status');
  const body = await res.json();
  return !!body.enabled;
}

export async function enableMasterToken2FA(token: string, masterToken: string, twoFaPassword: string): Promise<void> {
  const res = await fetch(`${BASE}/mastertoken/2fa/enable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mastertoken: masterToken, two_fa_password: twoFaPassword }),
  });
  if (!res.ok) {
    let detail = 'Failed to enable 2FA';
    try { const b = await res.json(); detail = b.detail || detail; } catch {}
    throw new Error(detail);
  }
}

export async function disableMasterToken2FA(token: string, twoFaPassword: string): Promise<void> {
  const res = await fetch(`${BASE}/mastertoken/2fa/disable`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ two_fa_password: twoFaPassword }),
  });
  if (!res.ok) {
    let detail = 'Failed to disable 2FA';
    try { const b = await res.json(); detail = b.detail || detail; } catch {}
    throw new Error(detail);
  }
}

// ── Account deletion requests ────────────────────────────────────────────────

export interface AccountDeletionStatus {
  status: 'pending' | 'approved' | 'denied' | null;
  request_id?: number;
  requested_at?: string;
  processed_at?: string;
}

export async function requestAccountDeletion(token: string, reason?: string): Promise<void> {
  const res = await fetch(`${BASE}/account/delete-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason: reason || null }),
  });
  if (!res.ok) {
    let detail = 'Failed to submit deletion request';
    try { const b = await res.json(); detail = b.detail || detail; } catch {}
    throw new Error(detail);
  }
}

export async function getMyAccountDeletionStatus(token: string): Promise<AccountDeletionStatus> {
  const res = await fetch(`${BASE}/account/delete-request/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch deletion request status');
  return res.json();
}

// ── Chat collaboration: reactions, edit, delete, pin, star ─────────────────────

export async function toggleReaction(token: string, messageId: number, emoji: string): Promise<'added' | 'removed'> {
  const res = await fetch(`${BASE}/messages/${messageId}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw new Error('Failed to react');
  const body = await res.json();
  return body.status;
}

export async function editMessage(
  token: string,
  messageId: number,
  ciphertext: string,
  opts: { encryptedKey?: string; iv?: string; decoyContent?: string },
): Promise<void> {
  const res = await fetch(`${BASE}/messages/${messageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      message: ciphertext,
      encrypted_key: opts.encryptedKey ?? null,
      iv: opts.iv ?? null,
      decoy_content: opts.decoyContent ?? null,
    }),
  });
  if (!res.ok) throw new Error('Failed to edit message');
}

export async function deleteMessage(token: string, messageId: number): Promise<void> {
  const res = await fetch(`${BASE}/messages/${messageId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to delete message');
}

export async function pinMessage(token: string, messageId: number): Promise<void> {
  const res = await fetch(`${BASE}/messages/${messageId}/pin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to pin message');
}

export async function unpinMessage(token: string, messageId: number): Promise<void> {
  const res = await fetch(`${BASE}/messages/${messageId}/unpin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to unpin message');
}

export async function getPinnedMessages(token: string, opts: { username?: string; groupId?: number }): Promise<ChatMessage[]> {
  const q = new URLSearchParams();
  if (opts.username) q.set('username', opts.username);
  if (opts.groupId) q.set('group_id', String(opts.groupId));
  const res = await fetch(`${BASE}/messages/pinned?${q.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch pinned messages');
  const body = await res.json();
  return body.messages ?? [];
}

export async function starMessage(token: string, messageId: number): Promise<void> {
  const res = await fetch(`${BASE}/messages/${messageId}/star`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to star message');
}

export async function unstarMessage(token: string, messageId: number): Promise<void> {
  const res = await fetch(`${BASE}/messages/${messageId}/star`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to unstar message');
}

export interface StarredMessageItem extends ChatMessage {
  group_id?: number | null;
  group_name?: string | null;
  starred_at?: string;
}

export async function getStarredMessages(token: string): Promise<StarredMessageItem[]> {
  const res = await fetch(`${BASE}/messages/starred`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch starred messages');
  const body = await res.json();
  return body.messages ?? [];
}

// ── Group admins (chat-embedded, separate from site-wide is_admin) ──────────

export async function promoteGroupMember(token: string, groupId: number, username: string): Promise<void> {
  const res = await fetch(`${BASE}/groups/${groupId}/members/${encodeURIComponent(username)}/promote`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to promote member');
  }
}

export async function demoteGroupMember(token: string, groupId: number, username: string): Promise<void> {
  const res = await fetch(`${BASE}/groups/${groupId}/members/${encodeURIComponent(username)}/demote`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to demote member');
  }
}

// ── Profile picture ───────────────────────────────────────────────────────────

export function profilePictureUrl(username: string): string {
  return `${BASE}/users/${encodeURIComponent(username)}/profile-picture`;
}

export async function uploadProfilePicture(token: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/users/me/profile-picture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to upload profile picture');
  }
}

export async function deleteProfilePicture(token: string): Promise<void> {
  const res = await fetch(`${BASE}/users/me/profile-picture`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to remove profile picture');
}

// ── Availability status ───────────────────────────────────────────────────────

export type AvailabilityStatus = 'available' | 'busy' | 'dnd' | 'away' | 'offline';

export async function setAvailabilityStatus(token: string, status: AvailabilityStatus, statusText?: string): Promise<void> {
  const res = await fetch(`${BASE}/users/me/availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ availability_status: status, status_text: statusText || null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to update status');
  }
}

// ── Forgot / reset password ───────────────────────────────────────────────────
// No email on file for accounts — this creates a request an admin has to act
// on (same shape as account-deletion requests), not a real self-service reset.

export async function requestPasswordReset(phoneNumber: string, reason?: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number: phoneNumber, reason: reason || null }),
  });
  if (!res.ok) throw new Error('Failed to submit request');
}

// ── Self-service signup / recovery code ──────────────────────────────────────
// Open signup, no verification (deliberate for this deployment). The
// recovery code in each response is shown to the account holder exactly
// once — it's never retrievable again after this call.

export interface SignUpResult {
  username: string;
  phone_number: string;
  recovery_code: string;
}

export async function signUp(username: string, phoneNumber: string, token: string): Promise<SignUpResult> {
  const res = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, phone_number: phoneNumber, token }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to create account');
  }
  return res.json();
}

export async function resetWithRecoveryCode(username: string, recoveryCode: string, newToken: string): Promise<{ username: string; recovery_code: string }> {
  const res = await fetch(`${BASE}/auth/reset-with-recovery-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, recovery_code: recoveryCode, new_token: newToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to reset');
  }
  return res.json();
}

export async function regenerateRecoveryCode(token: string): Promise<{ recovery_code: string }> {
  const res = await fetch(`${BASE}/users/me/recovery-code/regenerate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to generate a new recovery code');
  return res.json();
}

export async function updateUsername(token: string, newUsername: string): Promise<{ username: string }> {
  const res = await fetch(`${BASE}/users/me/username`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ new_username: newUsername }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to update username');
  }
  return res.json();
}

export interface PasswordResetRequestItem {
  id: number;
  username: string;
  phone_number: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'denied';
  requested_at: string;
  processed_by: string | null;
  processed_at: string | null;
}

export async function getPasswordResetRequests(token: string, status?: string): Promise<PasswordResetRequestItem[]> {
  const url = status ? `${BASE}/admin/password-reset-requests?status=${status}` : `${BASE}/admin/password-reset-requests`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to load password reset requests');
  const body = await res.json();
  return body.requests ?? [];
}

export async function approvePasswordReset(token: string, requestId: number): Promise<{ username: string; new_token: string }> {
  const res = await fetch(`${BASE}/admin/password-reset-requests/${requestId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to approve request');
  }
  return res.json();
}

export async function denyPasswordReset(token: string, requestId: number, reason?: string): Promise<void> {
  const res = await fetch(`${BASE}/admin/password-reset-requests/${requestId}/deny`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason: reason || null }),
  });
  if (!res.ok) throw new Error('Failed to deny request');
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface TaskAssigneeItem {
  user_id: number;
  username: string;
  status: 'assigned' | 'in_progress' | 'completed';
  assigned_at: string | null;
  completed_at: string | null;
}

export interface TaskBreakoutGroupItem {
  group_id: number;
  name: string | null;
  member_usernames: string[];
  report_text: string | null;
  report_submitted_by: string | null;
  report_submitted_at: string | null;
}

export interface TaskItem {
  task_id: number;
  title: string;
  description: string | null;
  due_at: string | null;
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  is_breakout: boolean;
  group_id: number | null;
  created_by: string;
  created_at: string | null;
  assignees: TaskAssigneeItem[];
  breakout_groups: TaskBreakoutGroupItem[];
  compiled_report: string | null;
  compiled_report_at: string | null;
  recurrence: string | null;
  next_occurrence?: TaskItem;
}

export interface TaskCreatePayload {
  title: string;
  description?: string;
  due_at?: string;
  group_id?: number;
  assignee_usernames?: string[];
  is_breakout?: boolean;
  breakout_groups?: { name: string; usernames: string[] }[];
  recurrence?: 'daily' | 'weekly' | 'monthly';
}

async function taskRequest(res: Response): Promise<TaskItem> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Task request failed');
  }
  return res.json();
}

export async function createTask(token: string, payload: TaskCreatePayload): Promise<TaskItem> {
  const res = await fetch(`${BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  return taskRequest(res);
}

export async function listTasks(token: string): Promise<TaskItem[]> {
  const res = await fetch(`${BASE}/tasks`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Failed to load tasks');
  const body = await res.json();
  return body.tasks ?? [];
}

export async function getTask(token: string, taskId: number): Promise<TaskItem> {
  const res = await fetch(`${BASE}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${token}` } });
  return taskRequest(res);
}

export async function updateTaskStatus(token: string, taskId: number, status: TaskItem['status']): Promise<TaskItem> {
  const res = await fetch(`${BASE}/tasks/${taskId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
  return taskRequest(res);
}

export async function updateMyTaskStatus(token: string, taskId: number, status: TaskAssigneeItem['status']): Promise<TaskItem> {
  const res = await fetch(`${BASE}/tasks/${taskId}/my-status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
  return taskRequest(res);
}

export async function submitBreakoutReport(token: string, taskId: number, groupId: number, reportText: string): Promise<TaskItem> {
  const res = await fetch(`${BASE}/tasks/${taskId}/groups/${groupId}/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ report_text: reportText }),
  });
  return taskRequest(res);
}

export async function compileTask(token: string, taskId: number): Promise<TaskItem> {
  const res = await fetch(`${BASE}/tasks/${taskId}/compile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return taskRequest(res);
}

// ── Meeting breakout rooms ────────────────────────────────────────────────────

export interface BreakoutRoomItem {
  breakout_conference_id: number;
  name: string | null;
  usernames: string[];
}

export async function startBreakoutRooms(token: string, conferenceId: number, groups: { name: string; usernames: string[] }[]): Promise<BreakoutRoomItem[]> {
  const res = await fetch(`${BASE}/meetings/${conferenceId}/breakout/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ groups }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to start breakout rooms');
  }
  const body = await res.json();
  return body.rooms ?? [];
}

export async function autoBreakoutRooms(token: string, conferenceId: number, numRooms: number): Promise<BreakoutRoomItem[]> {
  const res = await fetch(`${BASE}/meetings/${conferenceId}/breakout/auto?num_rooms=${numRooms}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to start breakout rooms');
  }
  const body = await res.json();
  return body.rooms ?? [];
}

export async function endBreakoutRooms(token: string, conferenceId: number): Promise<void> {
  const res = await fetch(`${BASE}/meetings/${conferenceId}/breakout/end`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to end breakout rooms');
}

export async function listBreakoutRooms(token: string, conferenceId: number): Promise<BreakoutRoomItem[]> {
  const res = await fetch(`${BASE}/meetings/${conferenceId}/breakout`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load breakout rooms');
  const body = await res.json();
  return body.rooms ?? [];
}

// ── GIF search (GIPHY, proxied server-side) ──────────────────────────────────

export interface GifResult {
  id: string;
  title: string;
  url: string;
  preview_url: string;
  width: string;
  height: string;
}

export async function searchGifs(token: string, query: string, limit = 24): Promise<GifResult[]> {
  const res = await fetch(`${BASE}/integrations/giphy/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'GIF search failed');
  }
  const body = await res.json();
  return body.results ?? [];
}

export async function getTrendingGifs(token: string, limit = 24): Promise<GifResult[]> {
  const res = await fetch(`${BASE}/integrations/giphy/trending?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'GIF search failed');
  }
  const body = await res.json();
  return body.results ?? [];
}

// ── Per-chat settings: archive / mute / lock / delete-for-me ────────────────
// All local to the caller — never visible to or affecting the other party.

export interface ChatSettingsItem {
  peer_username: string | null;
  group_id: number | null;
  is_archived: boolean;
  is_muted: boolean;
  muted_until: string | null;
  is_locked: boolean;
  deleted_before: string | null;
}

export async function getChatSettings(token: string): Promise<ChatSettingsItem[]> {
  const res = await fetch(`${BASE}/chats/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to load chat settings');
  const body = await res.json();
  return body.settings ?? [];
}

export async function updateChatSettings(
  token: string,
  target: { peerUsername?: string; groupId?: number },
  patch: { isArchived?: boolean; isMuted?: boolean; mutedUntil?: string; isLocked?: boolean },
): Promise<ChatSettingsItem> {
  const res = await fetch(`${BASE}/chats/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      peer_username: target.peerUsername ?? null,
      group_id: target.groupId ?? null,
      is_archived: patch.isArchived ?? null,
      is_muted: patch.isMuted ?? null,
      muted_until: patch.mutedUntil ?? null,
      is_locked: patch.isLocked ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to update chat settings');
  }
  return res.json();
}

export async function deleteChatForMe(token: string, target: { peerUsername?: string; groupId?: number }): Promise<void> {
  const res = await fetch(`${BASE}/chats/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ peer_username: target.peerUsername ?? null, group_id: target.groupId ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || 'Failed to delete chat');
  }
}
