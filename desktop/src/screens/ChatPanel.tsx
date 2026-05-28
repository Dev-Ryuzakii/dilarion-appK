import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChatMessage,
  getConversation,
  sendText,
  uploadMedia,
  downloadMedia,
  markRead,
  decryptMessage,
  confirmMasterToken,
} from '../services/api';
import { presenceService, WsMessage } from '../services/presence';
import { LockIcon, CameraIcon, MicIcon as MicIconSvg, PaperclipIcon as PaperclipIconSvg, SpinnerIcon } from '../components/Icons';

interface Props {
  token: string;
  myUsername: string;
  partner: string;
  partnerOnline: boolean;
  masterToken: string | null;
  onMasterTokenSaved: (t: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isEncrypted(ct: string | null | undefined): boolean {
  return ct === 'encrypted';
}
function isVoice(ct: string | null | undefined): boolean {
  return !!(ct === 'media/voice' || ct?.startsWith('audio/'));
}
function isImage(ct: string | null | undefined): boolean {
  return !!ct?.startsWith('image/');
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
  masterToken: string | null;
  onDecrypt: (masterToken: string, messageId: number) => Promise<string>;
  onMasterTokenSaved: (t: string) => void;
}

function EncryptedBubble({ token, messageId, masterToken, onDecrypt, onMasterTokenSaved }: EncryptedBubbleProps) {
  const [decryptedContent, setDecryptedContent] = useState<string | null>(null);
  const [showing, setShowing] = useState(false);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  async function handleDecryptClick() {
    if (masterToken) {
      await runDecrypt(masterToken);
    } else {
      setInputVisible(true);
    }
  }

  async function runDecrypt(mToken: string) {
    setLoading(true);
    setError(null);
    try {
      // First confirm the master token is valid
      const valid = await confirmMasterToken(token, mToken);
      if (!valid) {
        setError('Invalid master token');
        setLoading(false);
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
      }, 30000);
    } catch {
      setError('Invalid master token');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitToken() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    await runDecrypt(trimmed);
  }

  if (showing && decryptedContent !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#f1f5f9' }}>
          {decryptedContent}
        </span>
        <span style={{ fontSize: '0.67rem', color: '#6b7280', fontStyle: 'italic' }}>
          Clears in 30s
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <LockIcon size={16} color="#6b7280" />
        <span style={{ fontSize: '0.82rem', color: '#6b7280', fontStyle: 'italic' }}>Encrypted message</span>
        <button
          style={{
            fontSize: '0.72rem',
            color: '#6b7280',
            background: 'transparent',
            border: '1px solid #374151',
            borderRadius: 6,
            padding: '2px 8px',
            cursor: 'pointer',
            marginLeft: 4,
            opacity: loading ? 0.5 : 1,
          }}
          onClick={handleDecryptClick}
          disabled={loading}
        >
          {loading ? '...' : 'Decrypt'}
        </button>
      </div>
      {inputVisible && (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <input
            type="password"
            placeholder="Master token"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmitToken(); }}
            style={{
              flex: 1,
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              color: '#f1f5f9',
              fontSize: '0.8rem',
              padding: '6px 10px',
            }}
            autoFocus
          />
          <button
            style={{
              background: '#c0392b',
              color: '#fff',
              fontSize: '0.75rem',
              borderRadius: 8,
              padding: '6px 12px',
              cursor: 'pointer',
              border: 'none',
            }}
            onClick={handleSubmitToken}
          >
            OK
          </button>
        </div>
      )}
      {error && (
        <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</span>
      )}
    </div>
  );
}

// ── MediaBubble ────────────────────────────────────────────────────────────────

function MediaBubble({ token, mediaId, contentType }: { token: string; mediaId: string; contentType: string }) {
  const [loaded, setLoaded] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [blobMime, setBlobMime] = useState<string>('');
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const urlRef = useRef<string>('');

  useEffect(() => {
    return () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); };
  }, []);

  async function handleClick() {
    if (loaded || loading) return;
    setLoading(true);
    try {
      const blob = await downloadMedia(token, mediaId);
      const mime = blob.type && !blob.type.startsWith('media/') ? blob.type : 'audio/webm';
      setBlobMime(mime);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setObjectUrl(url);
      setLoaded(true);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return <span style={{ fontSize: '0.78rem', color: '#ef4444', fontStyle: 'italic' }}>Failed to load media</span>;
  }

  if (loaded && objectUrl) {
    if (isImage(contentType)) {
      return <img src={objectUrl} alt="photo" style={{ maxWidth: 260, maxHeight: 260, borderRadius: 10, display: 'block' }} />;
    }
    if (isVoice(contentType)) {
      return (
        <audio controls style={{ maxWidth: 240, display: 'block' }}>
          <source src={objectUrl} type={blobMime || 'audio/webm'} />
          Your browser does not support audio playback.
        </audio>
      );
    }
    return (
      <a href={objectUrl} download={mediaId} style={{ color: '#93c5fd', fontSize: '0.83rem', textDecoration: 'underline' }}>
        Download file
      </a>
    );
  }

  // Icon placeholder
  let label = 'File';
  let iconEl: React.ReactNode = <PaperclipIconSvg size={22} color="#9ca3af" />;
  if (isImage(contentType)) { iconEl = <CameraIcon size={22} color="#9ca3af" />; label = 'Photo'; }
  else if (isVoice(contentType)) { iconEl = <MicIconSvg size={22} color="#9ca3af" />; label = 'Voice note'; }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: '#1e1e1e',
        border: '1px solid #2a2a2a',
        borderRadius: 10,
        padding: '12px 16px',
        cursor: loading ? 'wait' : 'pointer',
        color: '#9ca3af',
        fontSize: '0.85rem',
        opacity: loading ? 0.7 : 1,
      }}
    >
      {loading ? <SpinnerIcon size={22} /> : iconEl}
      <span>{loading ? 'Loading...' : label}</span>
    </button>
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
}

function MessageBubble({ msg, isMine, token, masterToken, onDecrypt, onMasterTokenSaved }: MessageBubbleProps) {
  const ct = msg.content_type;
  const mediaId = msg.content;

  let body: React.ReactNode;
  if (isEncrypted(ct)) {
    body = (
      <EncryptedBubble
        token={token}
        messageId={msg.id}
        masterToken={masterToken}
        onDecrypt={onDecrypt}
        onMasterTokenSaved={onMasterTokenSaved}
      />
    );
  } else if (isImage(ct) || isVoice(ct) || isMedia(ct)) {
    body = <MediaBubble token={token} mediaId={mediaId} contentType={ct} />;
  } else {
    body = (
      <span style={{ fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {msg.content}
      </span>
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
      <span style={ms.ts}>{fmtTime(msg.timestamp)}</span>
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

export default function ChatPanel({ token, myUsername, partner, partnerOnline, masterToken, onMasterTokenSaved }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          loadConversation();
        }
      }
    };
    presenceService.addListener(handler);
    return () => presenceService.removeListener(handler);
  }, [partner, loadConversation]);

  // Decrypt handler (called from EncryptedBubble)
  async function handleDecrypt(mToken: string, messageId: number): Promise<string> {
    const result = await decryptMessage(token, mToken, messageId);
    return result.content;
  }

  // ── Send text ────────────────────────────────────────────────────────────────

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    try {
      await sendText(token, partner, trimmed);
      await loadConversation();
    } catch {
      setText(trimmed);
    } finally {
      setSending(false);
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
            <div style={cs.partnerStatus}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: partnerOnline ? '#25d366' : '#6b7280', boxShadow: partnerOnline ? '0 0 5px #25d366' : 'none' }} />
              <span style={{ fontSize: '0.72rem', color: partnerOnline ? '#25d366' : '#6b7280' }}>
                {partnerOnline ? 'online' : 'offline'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div style={cs.messagesArea}>
        {loading ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div style={cs.emptyChat}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: 8 }}>No messages yet. Say hello!</p>
          </div>
        ) : (
          messages.map(msg => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isMine={msg.sender === myUsername}
              token={token}
              masterToken={masterToken}
              onDecrypt={handleDecrypt}
              onMasterTokenSaved={onMasterTokenSaved}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

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
            onChange={e => setText(e.target.value)}
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
            disabled={sending}
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
    background: '#2a1515',
    borderRadius: '18px 18px 4px 18px',
    padding: '10px 14px',
    maxWidth: '68%',
    color: '#f1f5f9',
    wordBreak: 'break-word',
  },
  bubbleTheirs: {
    background: '#1a1a1a',
    borderRadius: '18px 18px 18px 4px',
    padding: '10px 14px',
    maxWidth: '68%',
    color: '#f1f5f9',
    wordBreak: 'break-word',
  },
  ts: {
    fontSize: '0.67rem',
    color: '#4b5563',
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
    background: '#0e0e0e',
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    borderBottom: '1px solid #1e1e1e',
    background: '#141414',
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
    background: '#c0392b',
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
    color: '#f1f5f9',
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
    borderTop: '1px solid #1e1e1e',
    background: '#141414',
    flexShrink: 0,
    minHeight: 60,
  },
  textInput: {
    flex: 1,
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 24,
    color: '#f1f5f9',
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
    background: '#c0392b',
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
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 24,
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
