import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChatMessage,
  getConversation,
  sendText,
  uploadMedia,
  markRead,
  getUserDevices,
  decryptChatMessage,
  confirmMasterToken,
} from '../services/api';
import { encryptMessage } from '../services/crypto';
import { generateDecoy } from '../services/decoy';
import { loadKeypair } from '../services/keys';
import { presenceService, WsMessage } from '../services/presence';
import { LockIcon, MicIcon as MicIconSvg, PaperclipIcon as PaperclipIconSvg } from '../components/Icons';
import MediaBubble from '../components/MediaBubble';

interface Props {
  token: string;
  myUsername: string;
  partner: string;
  partnerOnline: boolean;
  masterToken: string | null;
  onMasterTokenSaved: (t: string) => void;
  onCall: (partner: string, type: 'audio' | 'video') => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isEncrypted(ct: string | null | undefined): boolean {
  return ct === 'encrypted';
}

// Legacy rows written by the old server fallback. These strings must never reach
// the screen — a decoy that says "encrypted" is not a decoy.
const DECOY_PLACEHOLDERS = [
  '[ENCRYPTED MESSAGE] Tap to decrypt',
  '[ENCRYPTED GROUP MESSAGE] Tap to decrypt',
];
function isPlaceholderDecoy(text: string | null | undefined): boolean {
  return !!text && DECOY_PLACEHOLDERS.includes(text.trim());
}
function isVoice(ct: string | null | undefined): boolean {
  return !!(ct === 'media/voice' || ct?.startsWith('audio/'));
}
function isImage(ct: string | null | undefined): boolean {
  return !!(ct?.startsWith('image/') || ct === 'media/photo');
}
function isMedia(ct: string | null | undefined): boolean {
  return !!(ct?.startsWith('media/') || ct?.startsWith('application/'));
}

function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function dateSepLabel(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

function DateSeparator({ ts }: { ts: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 8px' }}>
      <span style={{
        background: 'var(--bg-card)',
        color: 'var(--text-muted)',
        fontSize: '0.68rem',
        fontWeight: 600,
        padding: '4px 14px',
        borderRadius: 12,
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        userSelect: 'none',
      }}>{dateSepLabel(ts)}</span>
    </div>
  );
}

// ── Shimmer ────────────────────────────────────────────────────────────────────

function Shimmer({ w, h, r = 8 }: { w: string | number; h: number; r?: number }) {
  return (
    <div
      className="shimmer"
      style={{ width: w, height: h, borderRadius: r, flexShrink: 0 }}
    />
  );
}

// ── EncryptedBubble ────────────────────────────────────────────────────────────

interface EncryptedBubbleProps {
  token: string;
  messageId: number;
  decoyContent: string;
  masterToken: string | null;
  isMine: boolean;
  onDecrypt: (masterToken: string, messageId: number) => Promise<string>;
  onMasterTokenSaved: (t: string) => void;
}

function EncryptedBubble({ token, messageId, decoyContent, masterToken, isMine, onDecrypt, onMasterTokenSaved }: EncryptedBubbleProps) {
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [showing, setShowing] = useState(false);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Guard: only decrypt when user explicitly taps — never auto-decrypt on prop/state changes
  const userTappedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  async function handleBubbleTap() {
    if (showing || loading) return;
    userTappedRef.current = true;
    if (masterToken) {
      await runDecrypt(masterToken);
    } else {
      setInputVisible(v => !v);
    }
  }

  async function runDecrypt(mToken: string) {
    if (!userTappedRef.current) return;   // never decrypt without an explicit tap
    setLoading(true);
    setError(null);
    try {
      // If masterToken was already validated this session, skip the server round-trip
      const valid = masterToken === mToken
        ? true
        : await confirmMasterToken(token, mToken);
      if (!valid) {
        setError('Invalid master token');
        setLoading(false);
        userTappedRef.current = false;
        return;
      }
      const content = await onDecrypt(mToken, messageId);
      onMasterTokenSaved(mToken);
      setDecryptedContent(content);
      setShowing(true);
      setInputVisible(false);
      setInputValue('');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setShowing(false);
        setDecryptedContent(null);
        userTappedRef.current = false;
      }, 30000);
    } catch (err: any) {
      setError(err?.message || 'Invalid master token');
    } finally {
      setLoading(false);
      userTappedRef.current = false;
    }
  }

  async function handleSubmitToken() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    userTappedRef.current = true;
    await runDecrypt(trimmed);
  }

  // Showing decrypted content
  if (showing && decryptedContent !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {decryptedContent}
        </span>
        <span style={{ fontSize: '0.65rem', color: '#6b7280', fontStyle: 'italic' }}>
          Clears in 30s
        </span>
      </div>
    );
  }

  // Show decoy text — tapping triggers decrypt. Older rows may still carry the
  // server's old placeholder, which defeats the point of a decoy by advertising
  // that the message is encrypted; never render it.
  const displayText = isPlaceholderDecoy(decoyContent) ? '…' : (decoyContent || '…');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        onClick={handleBubbleTap}
        style={{
          cursor: loading ? 'wait' : 'pointer',
          opacity: loading ? 0.7 : 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <span style={{
          fontSize: '0.88rem',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: isMine ? '#d1b8a8' : '#c9c9c9',
          userSelect: 'none',
        }}>
          {loading ? '…' : displayText}
        </span>
      </div>

      {inputVisible && !masterToken && (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <input
            type="password"
            placeholder="Master token"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmitToken(); }}
            style={{
              flex: 1,
              background: 'var(--input-field-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              padding: '6px 10px',
            }}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
          <button
            style={{
              background: 'var(--accent)',
              color: '#fff',
              fontSize: '0.75rem',
              borderRadius: 8,
              padding: '6px 12px',
              cursor: 'pointer',
              border: 'none',
            }}
            onClick={e => { e.stopPropagation(); handleSubmitToken(); }}
          >
            OK
          </button>
        </div>
      )}
      {error && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</span>}
    </div>
  );
}

// ── LockedContent ──────────────────────────────────────────────────────────────

interface LockedContentProps {
  apiToken: string;
  masterToken: string | null;
  onMasterTokenSaved: (t: string) => void;
  isMine: boolean;
  children: React.ReactNode;
}

function LockedContent({ apiToken, masterToken, onMasterTokenSaved, isMine, children }: LockedContentProps) {
  const [showing, setShowing] = useState(false);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  function startHideTimer() {
    setCountdown(30);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    timerRef.current = setTimeout(() => { setShowing(false); setInputVisible(false); }, 30000);
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { if (countdownRef.current) clearInterval(countdownRef.current); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  function handleTap() {
    if (showing || loading) return;
    if (masterToken) {
      setShowing(true);
      startHideTimer();
    } else {
      setInputVisible(v => !v);
    }
  }

  async function handleSubmit() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const valid = await confirmMasterToken(apiToken, trimmed);
      if (!valid) { setError('Invalid master token'); setLoading(false); return; }
      onMasterTokenSaved(trimmed);
      setInputVisible(false);
      setInputValue('');
      setShowing(true);
      startHideTimer();
    } catch {
      setError('Invalid master token');
    } finally {
      setLoading(false);
    }
  }

  if (showing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children}
        <span style={{ fontSize: '0.62rem', color: isMine ? 'rgba(255,255,255,0.6)' : '#6b7280', fontStyle: 'italic' }}>
          Hides in {countdown}s
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        onClick={handleTap}
        style={{ cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}
      >
        <LockIcon size={12} color={isMine ? 'rgba(255,255,255,0.75)' : '#6b7280'} />
        <span style={{ fontSize: '0.82rem', color: isMine ? 'rgba(255,255,255,0.75)' : '#6b7280', userSelect: 'none' }}>
          {loading ? 'Verifying…' : 'Tap to view'}
        </span>
      </div>
      {inputVisible && (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <input
            type="password"
            placeholder="Master token"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            style={{
              flex: 1,
              background: 'var(--input-field-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              padding: '6px 10px',
            }}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
          <button
            style={{ background: 'var(--accent)', color: '#fff', fontSize: '0.75rem', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', border: 'none' }}
            onClick={e => { e.stopPropagation(); handleSubmit(); }}
          >OK</button>
        </div>
      )}
      {error && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</span>}
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  msg: ChatMessage;
  isMine: boolean;
  token: string;
  masterToken: string | null;
  onDecrypt: (masterToken: string, messageId: number) => Promise<string>;
  onMasterTokenSaved: (t: string) => void;
  onRemoveMessage: (id: number) => void;
}

function MessageBubble({ msg, isMine, token, masterToken, onDecrypt, onMasterTokenSaved, onRemoveMessage }: MessageBubbleProps) {
  const ct = msg.content_type;
  const mediaId = msg.content;

  let body: React.ReactNode;
  if (isEncrypted(ct)) {
    body = (
      <EncryptedBubble
        token={token}
        messageId={msg.id}
        decoyContent={msg.decoy_content || ''}
        masterToken={masterToken}
        isMine={isMine}
        onDecrypt={onDecrypt}
        onMasterTokenSaved={onMasterTokenSaved}
      />
    );
  } else if (isImage(ct) || isVoice(ct) || isMedia(ct)) {
    body = (
      <LockedContent apiToken={token} masterToken={masterToken} onMasterTokenSaved={onMasterTokenSaved} isMine={isMine}>
        <MediaBubble token={token} mediaId={mediaId} contentType={ct} onRemove={() => onRemoveMessage(msg.id)} />
      </LockedContent>
    );
  } else {
    body = (
      <LockedContent apiToken={token} masterToken={masterToken} onMasterTokenSaved={onMasterTokenSaved} isMine={isMine}>
        <span style={{ fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {msg.content}
        </span>
      </LockedContent>
    );
  }

  const encryptedStyle: React.CSSProperties = isEncrypted(ct)
    ? { background: isMine ? '#1a1218' : '#111827', border: '1px solid #374151' }
    : {};

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isMine ? 'flex-end' : 'flex-start',
      marginBottom: 4,
    }}>
      <div style={isMine
        ? { ...ms.bubbleMine, ...encryptedStyle }
        : { ...ms.bubbleTheirs, ...encryptedStyle }
      }>
        {body}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3, justifyContent: isMine ? 'flex-end' : 'flex-start' }}>
        <span style={ms.ts}>{fmtTime(msg.timestamp)}</span>
        {isMine && <MsgStatusIcon delivered={msg.delivered} read={msg.read} />}
      </div>
    </div>
  );
}

// ── Pending bubble (clock icon while sending) ──────────────────────────────────

function PendingBubble({ content, timestamp }: { content: string; timestamp: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: 4 }}>
      <div style={{ ...ms.bubbleMine, opacity: 0.65 }}>
        <span style={{ fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
        <span style={ms.ts}>{fmtTime(timestamp)}</span>
        <ClockSvgIcon />
      </div>
    </div>
  );
}

// ── Skeleton loader ────────────────────────────────────────────────────────────

function MessageSkeleton() {
  const items = [
    { mine: false, w: 180 },
    { mine: true, w: 120 },
    { mine: false, w: 240 },
    { mine: true, w: 160 },
    { mine: false, w: 200 },
  ];
  return (
    <>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: it.mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
          <Shimmer w={it.w} h={40} r={14} />
        </div>
      ))}
    </>
  );
}

// ── Main ChatPanel ─────────────────────────────────────────────────────────────

// Fake pending message while sending
interface PendingMsg {
  localId: string;
  content: string;
  timestamp: string;
}

export default function ChatPanel({ token, myUsername, partner, partnerOnline, masterToken, onMasterTokenSaved, onCall }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [partnerTyping, setPartnerTyping] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingSent = useRef(false);

  // Load conversation
  const loadConversation = useCallback(async () => {
    try {
      const msgs = await getConversation(token, partner);
      setMessages(msgs);
      msgs
        .filter(m => m.sender === partner && !m.read)
        .forEach(m => markRead(token, m.id).catch(() => {}));
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [token, partner]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    loadConversation();
  }, [loadConversation]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handler = (msg: WsMessage) => {
      if (msg.type === 'new_message') {
        const sender = msg.data?.sender_username as string | undefined;
        if (sender === partner) {
          setPartnerTyping(false);
          loadConversation();
        }
      } else if (msg.type === 'typing') {
        const sender = (msg as any).sender as string | undefined;
        const isTyping = (msg as any).is_typing as boolean | undefined;
        if (sender === partner) {
          setPartnerTyping(!!isTyping);
        }
      }
    };
    presenceService.addListener(handler);
    return () => presenceService.removeListener(handler);
  }, [partner, loadConversation]);

  // Decrypt handler (called from EncryptedBubble). The master token only gates the
  // reveal in the UI — the actual decryption uses the device's private key.
  async function handleDecrypt(_mToken: string, messageId: number): Promise<string> {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) throw new Error('Message not found');
    const kp = loadKeypair(myUsername);
    return decryptChatMessage(msg, kp?.privateKey ?? null, myUsername, kp?.deviceUuid ?? null);
  }

  // ── Typing indicators ────────────────────────────────────────────────────────

  function sendTypingStart() {
    if (!isTypingSent.current) {
      isTypingSent.current = true;
      presenceService.send({ type: 'typing', recipient: partner, is_typing: true });
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(sendTypingStop, 2000);
  }

  function sendTypingStop() {
    if (isTypingSent.current) {
      isTypingSent.current = false;
      presenceService.send({ type: 'typing', recipient: partner, is_typing: false });
    }
    if (typingStopTimer.current) { clearTimeout(typingStopTimer.current); typingStopTimer.current = null; }
  }

  // ── Send text ────────────────────────────────────────────────────────────────

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    sendTypingStop();
    setText('');
    setIsSending(true);

    const localId = `pending-${Date.now()}`;
    const pendingMsg: PendingMsg = { localId, content: trimmed, timestamp: new Date().toISOString() };
    setPending(prev => [...prev, pendingMsg]);

    try {
      // Wrap the AES key once per active device of the recipient AND of ourselves,
      // so every one of our devices can also read what we sent. The map is keyed by
      // device_uuid; each device unwraps its own entry.
      const [theirDevices, myDevices] = await Promise.all([
        getUserDevices(token, partner),
        getUserDevices(token, myUsername),
      ]);
      const deviceKeys: Record<string, string> = {};
      for (const d of [...theirDevices, ...myDevices]) {
        if (d.public_key) deviceKeys[d.device_uuid] = d.public_key;
      }
      if (Object.keys(deviceKeys).length === 0) {
        throw new Error(`${partner} has no linked devices with encryption keys yet`);
      }

      const { ciphertext, encryptedKeys, iv } = await encryptMessage(trimmed, deviceKeys);
      await sendText(token, partner, ciphertext, {
        encryptedKey: JSON.stringify(encryptedKeys),
        iv,
        decoyContent: generateDecoy(),
      });
      setPending(prev => prev.filter(p => p.localId !== localId));
      await loadConversation();
    } catch (err: any) {
      setPending(prev => prev.filter(p => p.localId !== localId));
      setText(trimmed);
      setSendError(err?.message || 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── File attach ──────────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const ct = file.type || 'application/octet-stream';
    try {
      await uploadMedia(token, partner, file, ct, file.name);
      await loadConversation();
    } catch {
      // silently fail
    }
  }

  // ── Voice recording ──────────────────────────────────────────────────────────

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = e => { if (e.data.size) recChunksRef.current.push(e.data); };
      rec.start(100);
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch {
      // mic not available
    }
  }

  async function stopRecording() {
    if (!recorderRef.current) return;
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    setRecording(false);
    setRecSeconds(0);

    await new Promise<void>(resolve => {
      recorderRef.current!.onstop = () => resolve();
      recorderRef.current!.stop();
      recorderRef.current!.stream.getTracks().forEach(t => t.stop());
    });

    const blob = new Blob(recChunksRef.current, { type: 'audio/webm' });
    recChunksRef.current = [];
    recorderRef.current = null;

    if (blob.size > 0) {
      try {
        await uploadMedia(token, partner, blob, 'audio/webm', 'voice_note.webm');
        await loadConversation();
      } catch {
        // silently fail
      }
    }
  }

  function toggleRecording() {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  const fmtRec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={cs.root}>

      {/* Header */}
      <div style={cs.header}>
        <div style={cs.headerLeft}>
          <div style={cs.avatar}>{initials(partner)}</div>
          <div>
            <div style={cs.partnerName}>{partner}</div>
            {partnerTyping ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <TypingDots />
                <span style={{ fontSize: '0.72rem', color: '#25d366', fontStyle: 'italic' }}>typing…</span>
              </div>
            ) : (
              <div style={cs.partnerStatus}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: partnerOnline ? '#25d366' : '#6b7280', boxShadow: partnerOnline ? '0 0 5px #25d366' : 'none' }} />
                <span style={{ fontSize: '0.72rem', color: partnerOnline ? '#25d366' : '#6b7280' }}>
                  {partnerOnline ? 'online' : 'offline'}
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Call buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onCall(partner, 'audio')} style={cs.callBtn} title="Voice call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </button>
          <button onClick={() => onCall(partner, 'video')} style={cs.callBtn} title="Video call">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382v7.236a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div style={cs.messagesArea}>
        {loading ? (
          <MessageSkeleton />
        ) : messages.length === 0 && pending.length === 0 ? (
          <div style={cs.emptyChat}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: 8 }}>No messages yet. Say hello!</p>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => {
              const showSep = i === 0 || !isSameDay(msg.timestamp, messages[i - 1].timestamp);
              return (
                <React.Fragment key={msg.id}>
                  {showSep && <DateSeparator ts={msg.timestamp} />}
                  <MessageBubble
                    msg={msg}
                    isMine={msg.sender === myUsername}
                    token={token}
                    masterToken={masterToken}
                    onDecrypt={handleDecrypt}
                    onMasterTokenSaved={onMasterTokenSaved}
                    onRemoveMessage={id => setMessages(prev => prev.filter(m => m.id !== id))}
                  />
                </React.Fragment>
              );
            })}
            {pending.map(p => (
              <PendingBubble key={p.localId} content={p.content} timestamp={p.timestamp} />
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {sendError && (
        <div style={{
          padding: '8px 16px',
          background: 'rgba(239,68,68,0.12)',
          borderTop: '1px solid rgba(239,68,68,0.3)',
          color: '#fca5a5',
          fontSize: '0.78rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}>
          <span>{sendError}</span>
          <button
            onClick={() => setSendError(null)}
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: '0.9rem' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Input bar */}
      <div style={cs.inputBar}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,application/pdf"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <button
          style={cs.iconBtn}
          onClick={() => fileInputRef.current?.click()}
          title="Attach file"
        >
          <PaperclipIconSvg size={18} color="#6b7280" />
        </button>

        {recording ? (
          <div style={cs.recIndicator}>
            <div style={cs.recDot} />
            <span style={{ fontSize: '0.83rem', color: '#ef4444', fontWeight: 600 }}>
              Recording {fmtRec(recSeconds)}
            </span>
          </div>
        ) : (
          <textarea
            style={cs.textInput}
            placeholder="Type a message"
            value={text}
            onChange={e => { setText(e.target.value); sendTypingStart(); }}
            onKeyDown={handleKeyDown}
            rows={1}
          />
        )}

        <button
          style={{ ...cs.iconBtn, color: recording ? '#ef4444' : '#6b7280' }}
          onClick={toggleRecording}
          title={recording ? 'Stop recording' : 'Record voice note'}
        >
          {recording ? <StopIcon /> : <MicIconSvg size={18} color={recording ? '#ef4444' : '#6b7280'} />}
        </button>

        {text.trim() && !recording && (
          <button
            style={cs.sendBtn}
            onClick={handleSend}
            disabled={isSending}
            title="Send"
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function ClockSvgIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );
}

function MsgStatusIcon({ delivered, read }: { delivered: boolean; read: boolean }) {
  if (read) {
    return (
      <svg width="18" height="11" viewBox="0 0 26 14" fill="none">
        <polyline points="1,7 5,11 13,1" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        <polyline points="7,7 11,11 19,1" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  return (
    <svg width="13" height="11" viewBox="0 0 16 14" fill="none">
      <polyline points="1,7 6,12 15,1" stroke={delivered ? '#6b7280' : '#4b5563'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 5, height: 5, borderRadius: '50%', background: '#25d366',
          animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

function StopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const ms: Record<string, React.CSSProperties> = {
  bubbleMine: {
    background: 'var(--bubble-mine-bg)',
    borderRadius: '18px 18px 4px 18px',
    padding: '10px 14px',
    maxWidth: '68%',
    color: 'var(--bubble-mine-text)',
    wordBreak: 'break-word',
  },
  bubbleTheirs: {
    background: 'var(--bubble-theirs-bg)',
    borderRadius: '18px 18px 18px 4px',
    padding: '10px 14px',
    maxWidth: '68%',
    color: 'var(--bubble-theirs-text)',
    wordBreak: 'break-word',
  },
  ts: {
    fontSize: '0.67rem',
    color: 'var(--text-muted)',
    marginTop: 3,
    marginLeft: 4,
    marginRight: 4,
  },
};

const cs: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    background: 'var(--chat-bg)',
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--header-bg)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: '50%',
    background: 'var(--accent)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.85rem',
    flexShrink: 0,
  },
  partnerName: {
    fontSize: '0.92rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  partnerStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },

  messagesArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    background: 'var(--chat-bg)',
    backgroundImage: 'var(--chat-bg-image)',
    backgroundSize: '512px 512px',
    backgroundRepeat: 'repeat',
  },
  emptyChat: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
  },

  inputBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderTop: '1px solid var(--border-color)',
    background: 'var(--input-bar-bg)',
    flexShrink: 0,
    minHeight: 60,
  },
  textInput: {
    flex: 1,
    background: 'var(--input-field-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 24,
    color: 'var(--text-primary)',
    fontSize: '0.88rem',
    padding: '10px 16px',
    resize: 'none',
    lineHeight: 1.4,
    maxHeight: 120,
    overflowY: 'auto',
    fontFamily: 'inherit',
  },
  iconBtn: {
    background: 'transparent',
    color: '#6b7280',
    padding: 8,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'color 0.15s',
    border: 'none',
  },
  sendBtn: {
    background: 'var(--accent)',
    color: '#fff',
    width: 40,
    height: 40,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'background 0.15s',
    border: 'none',
  },
  recIndicator: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 16px',
    background: 'var(--input-field-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 24,
  },
  callBtn: {
    background: 'transparent',
    border: 'none',
    borderRadius: '50%',
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#ef4444',
    animation: 'pulse 1s infinite',
    flexShrink: 0,
  },
};
