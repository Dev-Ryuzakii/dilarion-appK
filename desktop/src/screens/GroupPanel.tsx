import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChatMessage,
  Group,
  GroupMember,
  getGroupMessages,
  getGroupMembers,
  sendGroupMessage,
  downloadMedia,
  decryptMessage,
  confirmMasterToken,
} from '../services/api';
import { presenceService, WsMessage } from '../services/presence';
import { LockIcon, CameraIcon, MicIcon as MicIconSvg, PaperclipIcon as PaperclipIconSvg, SpinnerIcon } from '../components/Icons';

interface Props {
  token: string;
  myUsername: string;
  group: Group;
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
  decoyContent: string;
  masterToken: string | null;
  onDecrypt: (masterToken: string, messageId: number) => Promise<string>;
  onMasterTokenSaved: (t: string) => void;
}

function EncryptedBubble({ token, messageId, decoyContent, masterToken, onDecrypt, onMasterTokenSaved }: EncryptedBubbleProps) {
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

  async function handleBubbleTap() {
    if (showing || loading) return;
    if (masterToken) {
      await runDecrypt(masterToken);
    } else {
      setInputVisible(v => !v);
    }
  }

  async function runDecrypt(mToken: string) {
    setLoading(true);
    setError(null);
    try {
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
    } catch (err: any) {
      setError(err?.message || 'Invalid master token');
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)' }}>
          {decryptedContent}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Clears in 30s</span>
      </div>
    );
  }

  const displayText = decoyContent || '…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        onClick={handleBubbleTap}
        style={{ cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <span style={{
          fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap',
          wordBreak: 'break-word', color: 'var(--text-secondary)', userSelect: 'none',
        }}>
          {loading ? '…' : displayText}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <LockIcon size={10} color="#6b7280" />
          <span style={{ fontSize: '0.62rem', color: '#6b7280' }}>tap to decrypt</span>
        </div>
      </div>
      {inputVisible && !masterToken && (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <input
            type="password"
            placeholder="Master token"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmitToken(); }}
            style={{ flex: 1, background: 'var(--input-field-bg)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.8rem', padding: '6px 10px' }}
            autoFocus
            onClick={e => e.stopPropagation()}
          />
          <button
            style={{ background: '#c0392b', color: '#fff', fontSize: '0.75rem', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', border: 'none' }}
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

// ── PrivateTagBubble (shown to non-recipients) ────────────────────────────────

function PrivateTagBubble({ recipient }: { recipient: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 12 }}>
      <LockIcon size={13} color="#a78bfa" />
      <span style={{ fontSize: '0.82rem', color: '#a78bfa', fontStyle: 'italic' }}>
        Private message for <strong style={{ color: '#c4b5fd' }}>@{recipient}</strong>
      </span>
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
      const mime = blob.type && !blob.type.startsWith('media/') ? blob.type
        : isVoice(contentType) ? 'audio/webm' : 'application/octet-stream';
      setBlobMime(mime);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setObjectUrl(url);
      setLoaded(true);
    } catch (err: any) {
      const status = err?.status;
      if (status === 410) {
        setLoadError(true);
      } else {
        setLoadError(true);
      }
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 10 }}>
        {isVoice(contentType) ? <MicIconSvg size={22} color="var(--text-muted)" /> : <PaperclipIconSvg size={22} color="var(--text-muted)" />}
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Viewed &amp; deleted</span>
      </div>
    );
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
      <a href={objectUrl} download={mediaId} style={{ color: 'var(--accent)', fontSize: '0.83rem', textDecoration: 'underline' }}>
        Download file
      </a>
    );
  }

  let label = 'File';
  let iconEl: React.ReactNode = <PaperclipIconSvg size={22} color="var(--text-muted)" />;
  if (isImage(contentType)) { iconEl = <CameraIcon size={22} color="var(--text-muted)" />; label = 'Photo'; }
  else if (isVoice(contentType)) { iconEl = <MicIconSvg size={22} color="var(--text-muted)" />; label = 'Voice note'; }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        padding: '12px 16px',
        cursor: loading ? 'wait' : 'pointer',
        color: 'var(--text-muted)',
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

interface GroupMsgBubbleProps {
  msg: ChatMessage;
  isMine: boolean;
  myUsername: string;
  token: string;
  masterToken: string | null;
  onDecrypt: (masterToken: string, messageId: number) => Promise<string>;
  onMasterTokenSaved: (t: string) => void;
}

function GroupMsgBubble({ msg, isMine, myUsername, token, masterToken, onDecrypt, onMasterTokenSaved }: GroupMsgBubbleProps) {
  const ct = msg.content_type;
  const mediaId = msg.content;
  const isPrivateTagged = ct === 'private_tagged';
  const hasRecipient = msg.recipient && msg.recipient !== 'group';
  const isForMe = hasRecipient && msg.recipient === myUsername;

  let body: React.ReactNode;
  if (isPrivateTagged) {
    body = <PrivateTagBubble recipient={msg.recipient || '?'} />;
  } else if (isEncrypted(ct)) {
    body = (
      <EncryptedBubble
        token={token}
        messageId={msg.id}
        decoyContent={msg.decoy_content || ''}
        masterToken={masterToken}
        onDecrypt={onDecrypt}
        onMasterTokenSaved={onMasterTokenSaved}
      />
    );
  } else if (isImage(ct) || isVoice(ct) || isMedia(ct)) {
    body = <MediaBubble token={token} mediaId={mediaId} contentType={ct} />;
  } else {
    body = (
      <span style={{ fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'inherit' }}>
        {msg.content}
      </span>
    );
  }

  const encryptedStyle: React.CSSProperties = isEncrypted(ct)
    ? { background: 'var(--bg-card)', border: '1px solid var(--border-color)' }
    : {};

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isMine ? 'flex-end' : 'flex-start',
      marginBottom: 4,
    }}>
      {!isMine && (
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 2, marginLeft: 4 }}>
          {msg.sender}
          {hasRecipient && !isPrivateTagged && (
            <span style={{ marginLeft: 4, color: '#a78bfa' }}>→ @{msg.recipient}</span>
          )}
        </span>
      )}
      {isMine && hasRecipient && !isPrivateTagged && (
        <span style={{ fontSize: '0.67rem', color: '#a78bfa', marginBottom: 2, marginRight: 4 }}>
          → @{msg.recipient}
        </span>
      )}
      {isForMe && !isMine && (
        <span style={{ fontSize: '0.67rem', color: '#a78bfa', marginBottom: 2, marginLeft: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
          <LockIcon size={9} color="#a78bfa" /> Only you can read this
        </span>
      )}
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

// ── Skeleton ───────────────────────────────────────────────────────────────────

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

// ── GroupPanel ─────────────────────────────────────────────────────────────────

export default function GroupPanel({ token, myUsername, group, masterToken, onMasterTokenSaved }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [taggedUser, setTaggedUser] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await getGroupMessages(token, group.id);
      setMessages(msgs);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [token, group.id]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setTaggedUser(null);
    setText('');
    loadMessages();
    getGroupMembers(token, group.id).then(setMembers).catch(() => {});
  }, [loadMessages, token, group.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handler = (msg: WsMessage) => {
      if (msg.type === 'new_group_message') {
        const gid = msg.data?.group_id as number | undefined;
        if (gid === group.id) {
          loadMessages();
        }
      }
    };
    presenceService.addListener(handler);
    return () => presenceService.removeListener(handler);
  }, [group.id, loadMessages]);

  async function handleDecrypt(mToken: string, messageId: number): Promise<string> {
    const result = await decryptMessage(token, mToken, messageId);
    return result.content;
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const savedTagged = taggedUser;
    setText('');
    setTaggedUser(null);
    setMentionQuery(null);
    try {
      await sendGroupMessage(token, group.id, trimmed, savedTagged ?? undefined);
      await loadMessages();
    } catch {
      setText(trimmed);
      setTaggedUser(savedTagged);
    } finally {
      setSending(false);
    }
  }

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setText(val);
    // detect @mention at end of input
    const match = val.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1].toLowerCase());
    } else {
      setMentionQuery(null);
    }
  }

  function pickMember(username: string) {
    setTaggedUser(username);
    // strip trailing @mention from text
    setText(t => t.replace(/@\w*$/, ''));
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Avatar color by group id (consistent)
  const avatarColors = ['#7c3aed', '#0891b2', '#059669', '#d97706', '#c0392b', '#db2777'];
  const avatarBg = avatarColors[group.id % avatarColors.length];

  return (
    <div style={gs.root}>
      {/* Header */}
      <div style={gs.header}>
        <div style={gs.headerLeft}>
          <div style={{ ...gs.avatar, background: avatarBg }}>{initials(group.name)}</div>
          <div>
            <div style={gs.groupName}>{group.name}</div>
            <div style={gs.groupMeta}>{group.member_count} members</div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={gs.messagesArea}>
        {loading ? (
          <MessageSkeleton />
        ) : messages.length === 0 ? (
          <div style={gs.emptyChat}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>No messages yet.</p>
          </div>
        ) : (
          messages.map(msg => (
            <GroupMsgBubble
              key={msg.id}
              msg={msg}
              isMine={msg.sender === myUsername}
              myUsername={myUsername}
              token={token}
              masterToken={masterToken}
              onDecrypt={handleDecrypt}
              onMasterTokenSaved={onMasterTokenSaved}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* @mention dropdown */}
      {mentionQuery !== null && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            position: 'absolute', bottom: 0, left: 16, right: 16,
            background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 10,
            maxHeight: 180, overflowY: 'auto', zIndex: 10, boxShadow: '0 -4px 16px rgba(0,0,0,0.15)',
          }}>
            {members
              .filter(m => m.username !== myUsername && m.username.toLowerCase().includes(mentionQuery))
              .map(m => (
                <button
                  key={m.username}
                  onMouseDown={e => { e.preventDefault(); pickMember(m.username); }}
                  style={{
                    width: '100%', textAlign: 'left', padding: '10px 14px',
                    background: 'transparent', border: 'none', color: 'var(--text-primary)',
                    fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--item-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: '0.7rem', background: 'var(--bg-card)', color: 'var(--text-muted)', borderRadius: 4, padding: '1px 5px' }}>@</span>
                  {m.username}
                  <span style={{ marginLeft: 'auto', fontSize: '0.67rem', color: 'var(--text-muted)' }}>{m.role}</span>
                </button>
              ))
            }
            {members.filter(m => m.username !== myUsername && m.username.toLowerCase().includes(mentionQuery)).length === 0 && (
              <p style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>No members match</p>
            )}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div style={{ ...gs.inputBar, flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
        {taggedUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', color: '#a78bfa', background: 'var(--bg-card)', border: '1px solid #4c1d95', borderRadius: 8, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <LockIcon size={10} color="#a78bfa" />
              Private → <strong>@{taggedUser}</strong>
            </span>
            <button
              onClick={() => setTaggedUser(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 6px' }}
            >✕</button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <textarea
            ref={inputRef}
            style={gs.textInput}
            placeholder={taggedUser ? `Private message to @${taggedUser}…` : 'Type a message or @ to tag someone'}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          {text.trim() && (
            <button style={gs.sendBtn} onClick={handleSend} disabled={sending} title="Send">
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Icon ───────────────────────────────────────────────────────────────────────

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

const gs: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
    background: 'var(--chat-bg)',
    backgroundImage: 'var(--chat-bg-image)',
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
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.85rem',
    flexShrink: 0,
  },
  groupName: {
    fontSize: '0.92rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  groupMeta: {
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
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
    cursor: 'pointer',
  },
};
