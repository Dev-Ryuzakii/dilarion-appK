import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChatMessage,
  DecoyKind,
  Group,
  GroupMember,
  getGroupMessages,
  getGroupMembers,
  sendGroupMessage,
  sendText,
  getUserDevices,
  getAdminPublicKey,
  decryptChatMessage,
  confirmMasterToken,
  uploadGroupMedia,
  downloadMedia,
  uploadMedia,
  toggleReaction,
  editMessage,
  deleteMessage,
  pinMessage,
  unpinMessage,
  starMessage,
  unstarMessage,
  getStarredMessages,
  GifResult,
  formatDisappear,
  getThread,
  setThreadFollow,
  patchChannel,
  archiveChannel,
  transferChannel,
} from '../services/api';
import { encryptMessage } from '../services/crypto';
import { generateDecoy } from '../services/decoy';
import { loadKeypair } from '../services/keys';
import { presenceService, WsMessage } from '../services/presence';
import { PaperclipIcon as PaperclipIconSvg, CloseIcon, PinIcon, SparkleIcon, UsersIcon } from '../components/Icons';
import MediaBubble, { DocumentBubble } from '../components/MediaBubble';
import { PendingBubble, PendingMsg, buildRecipientKeys, avatarTint, ms as flatBase } from './ChatPanel';
import MeetingCard, { JoinMeetingHandler } from '../components/MeetingCard';
import { MessageMenuTrigger, MessageReactionPills, SmileyIcon } from '../components/MessageMenu';
import MediaPicker from '../components/MediaPicker';
import { getSticker } from '../components/stickers';
import CopilotResultModal from '../components/CopilotResultModal';
import MasterTokenPromptModal from '../components/MasterTokenPromptModal';
import { GroupInfoDrawer } from '../components/GroupDialogs';
import ForwardRecipientPicker from '../components/ForwardRecipientPicker';
import DeleteMessageDialog, { DeleteScope } from '../components/DeleteMessageDialog';
import { summarizeThreadCopilot, composeReplyCopilot, translateCopilot } from '../services/api';
import { userMessage } from '../services/errors';

interface Props {
  token: string;
  myUsername: string;
  group: Group;
  masterToken: string | null;
  onMasterTokenSaved: (t: string) => void;
  onJoinMeeting: JoinMeetingHandler;
  /** Leave the group thread and go back to the list. */
  onBack?: () => void;
  /** Group name/description/timer changed from the info drawer. */
  onGroupChanged?: (g: Group) => void;
  /** The viewer left, was removed from, or deleted this group. */
  onGroupGone?: () => void;
  /** Start a WhatsApp-style call that rings the whole group. */
  onStartGroupCall?: (group: Group, callType: 'voice' | 'video') => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isEncrypted(ct: string | null | undefined): boolean {
  return ct === 'encrypted';
}
function isMeeting(ct: string | null | undefined): boolean {
  return ct === 'meeting';
}
function isGifOrSticker(ct: string | null | undefined): boolean {
  return ct === 'gif' || ct === 'sticker';
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
  return !!ct?.startsWith('image/');
}
function isMedia(ct: string | null | undefined): boolean {
  return !!(ct?.startsWith('media/') || ct?.startsWith('application/'));
}
function isDocument(ct: string | null | undefined): boolean {
  return isMedia(ct) && !isImage(ct) && !isVoice(ct);
}
// A reasonable filename for a forwarded media blob re-uploaded under a new
// message — the server only needs a plausible extension, not the original name.
function extensionForContentType(ct: string | null | undefined): string {
  if (!ct) return '.bin';
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
    'audio/mp4': '.m4a', 'audio/mpeg': '.mp3', 'audio/webm': '.webm', 'media/voice': '.m4a',
    'application/pdf': '.pdf',
  };
  if (map[ct]) return map[ct];
  const slash = ct.split('/')[1];
  return slash ? `.${slash.split(';')[0]}` : '.bin';
}

const DECOY_KIND_LABELS: [DecoyKind, string][] = [
  ['invoice', 'Invoice'],
  ['delivery', 'Delivery note'],
  ['minutes', 'Meeting minutes'],
  ['memo', 'Memo'],
];

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

function fmtDateLabel(ts: string): string {
  try {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay(d, today)) return 'Today';
    if (sameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  } catch {
    return '';
  }
}

function msgDateKey(ts: string): string {
  try {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  } catch {
    return ts;
  }
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
      <span style={{
        fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600,
        background: 'var(--chat-bg)', padding: '2px 10px', borderRadius: 10,
        border: '1px solid var(--border-color)', whiteSpace: 'nowrap',
      }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-color)' }} />
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
  onDecrypt: (masterToken: string, messageId: number) => Promise<string>;
  onMasterTokenSaved: (t: string) => void;
  onRevealed?: (text: string) => void;
  contentType?: string | null;
}

function EncryptedBubble({ token, messageId, decoyContent, masterToken, onDecrypt, onMasterTokenSaved, onRevealed, contentType }: EncryptedBubbleProps) {
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
      onRevealed?.(content);
      setShowing(true);
      setInputVisible(false);
      setInputValue('');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setShowing(false);
        setDecryptedContent(null);
      }, 30000);
    } catch (err: any) {
      setError(userMessage(err, "Couldn't unlock this message. Check your master token and try again."));
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
    if (contentType === 'gif') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <img src={decryptedContent} alt="GIF" style={{ maxWidth: 220, maxHeight: 220, borderRadius: 10, display: 'block' }} />
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Clears in 30s</span>
        </div>
      );
    }
    if (contentType === 'sticker') {
      const sticker = getSticker(decryptedContent.replace(/^sticker:/, ''));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sticker ? sticker.render() : <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>[sticker]</span>}
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Clears in 30s</span>
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: '0.88rem', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)' }}>
          {decryptedContent}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Clears in 30s</span>
      </div>
    );
  }

  // Older rows may still carry the server's old placeholder, which defeats the
  // point of a decoy by advertising that the message is encrypted; never render it.
  const displayText = isPlaceholderDecoy(decoyContent) ? '…' : (decoyContent || '…');

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
      <span style={{ fontSize: '0.82rem', color: '#a78bfa', fontStyle: 'italic' }}>
        Private message for <strong style={{ color: '#c4b5fd' }}>@{recipient}</strong>
      </span>
    </div>
  );
}


// ── Message bubble ─────────────────────────────────────────────────────────────


interface GroupMsgBubbleProps {
  msg: ChatMessage;
  isMine: boolean;
  /** First message in a run from one sender: show avatar, name and time. */
  showHeader?: boolean;
  myUsername: string;
  token: string;
  masterToken: string | null;
  onDecrypt: (masterToken: string, messageId: number) => Promise<string>;
  onMasterTokenSaved: (t: string) => void;
  onJoinMeeting: JoinMeetingHandler;
  replyToMsg?: ChatMessage | null;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onForward: () => void;
  onPinToggle: () => void;
  onStarToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTranslate: (text: string) => void;
  isStarred: boolean;
}

function GroupMsgBubble({
  msg, isMine: isMineReal, showHeader = true, myUsername, token, masterToken, onDecrypt, onMasterTokenSaved, onJoinMeeting,
  replyToMsg, onReact, onReply, onForward, onPinToggle, onStarToggle, onEdit, onDelete, onTranslate,
  isStarred,
}: GroupMsgBubbleProps) {
  // Flat layout: neutral cards on the left for everyone. Ownership still
  // drives the edit/delete menu through isMineReal.
  const isMine = false;
  const ct = msg.content_type;
  const mediaId = msg.content;
  const isPrivateTagged = ct === 'private_tagged';
  const hasRecipient = msg.recipient && msg.recipient !== 'group';
  const isForMe = hasRecipient && msg.recipient === myUsername;
  const [hovered, setHovered] = useState(false);
  const [revealedText, setRevealedText] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  function handleCopy() {
    const text = revealedText ?? (isEncrypted(ct) ? null : msg.content);
    if (!text) {
      setCopyHint('Unlock the message first');
    } else {
      navigator.clipboard.writeText(text).catch(() => {});
      setCopyHint('Copied');
    }
    setTimeout(() => setCopyHint(null), 1500);
  }

  const isTextish = !isMeeting(ct) && !isPrivateTagged && !isDocument(ct) && !isVoice(ct) && !isImage(ct) && !isMedia(ct);

  function handleTranslateClick() {
    const text = revealedText ?? (isEncrypted(ct) ? null : msg.content);
    if (!text) {
      setCopyHint('Unlock the message first');
      setTimeout(() => setCopyHint(null), 1500);
      return;
    }
    onTranslate(text);
  }

  if (msg.is_deleted) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start', marginBottom: 4 }}>
        <div style={{ ...(isMine ? ms.bubbleMine : ms.bubbleTheirs), background: 'transparent', border: '1px dashed var(--border-color)' }}>
          <span style={{ fontSize: '0.82rem', fontStyle: 'italic', color: 'var(--text-muted)' }}>This message was deleted</span>
        </div>
      </div>
    );
  }

  let body: React.ReactNode;
  if (isMeeting(ct)) {
    body = <MeetingCard content={msg.content} senderUsername={msg.sender} onJoin={onJoinMeeting} />;
  } else if (isPrivateTagged) {
    body = <PrivateTagBubble recipient={msg.recipient || '?'} />;
  } else if (isEncrypted(ct) || isGifOrSticker(ct)) {
    body = (
      <EncryptedBubble
        token={token}
        messageId={msg.id}
        decoyContent={msg.decoy_content || ''}
        masterToken={masterToken}
        onDecrypt={onDecrypt}
        onMasterTokenSaved={onMasterTokenSaved}
        onRevealed={setRevealedText}
        contentType={ct}
      />
    );
  } else if (isDocument(ct)) {
    body = (
      <DocumentBubble
        token={token}
        mediaId={mediaId}
        masterToken={masterToken}
        onMasterTokenSaved={onMasterTokenSaved}
      />
    );
  } else if (isVoice(ct)) {
    // Self-gates (decoy-first) — see VoiceBubble inside MediaBubble.tsx. Group
    // chat had no lock at all here before; this closes that gap too.
    body = (
      <MediaBubble
        token={token}
        mediaId={mediaId}
        contentType={ct}
        masterToken={masterToken}
        onMasterTokenSaved={onMasterTokenSaved}
        isMine={isMine}
        sender={msg.sender || '?'}
      />
    );
  } else if (isImage(ct) || isMedia(ct)) {
    // Self-gates (decoy-first) — see VisualMediaBubble inside MediaBubble.tsx,
    // same model as voice notes above.
    body = (
      <MediaBubble
        token={token}
        mediaId={mediaId}
        contentType={ct}
        masterToken={masterToken}
        onMasterTokenSaved={onMasterTokenSaved}
      />
    );
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

  const sender = msg.sender || '?';
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ ...flat.row, marginTop: showHeader ? 14 : 2, background: hovered ? 'var(--item-hover)' : 'transparent' }}
    >
      <div style={flat.avatarCol}>
        {showHeader && <div style={{ ...flat.avatar, background: avatarTint(sender) }}>{initials(sender)}</div>}
      </div>
      <div style={flat.content}>
      {showHeader && (
        <div style={flat.header}>
          <span style={flat.senderName}>{sender}</span>
          <span style={flat.headerTime}>{fmtTime(msg.timestamp)}</span>
          {hasRecipient && !isPrivateTagged && (
            <span style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>→ @{msg.recipient}</span>
          )}
        </div>
      )}
      {hovered && (
        <div style={{ position: 'absolute', top: -14, right: 12, zIndex: 15 }}>
          <MessageMenuTrigger
            isMine={isMineReal}
            onReact={onReact}
            onReply={onReply}
            onForward={onForward}
            onCopy={handleCopy}
            onInfo={() => setShowInfo(v => !v)}
            onPinToggle={onPinToggle}
            onStarToggle={onStarToggle}
            onEdit={isMineReal ? onEdit : undefined}
            onDelete={onDelete}
            onTranslate={isTextish ? handleTranslateClick : undefined}
            isPinned={!!msg.is_pinned}
            isStarred={isStarred}
          />
        </div>
      )}

      {copyHint && (
        <div style={{ position: 'absolute', top: -30, [isMine ? 'right' : 'left']: 0, zIndex: 16, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 6, padding: '2px 8px', fontSize: '0.7rem', color: 'var(--text-secondary)' } as React.CSSProperties}>
          {copyHint}
        </div>
      )}

      {showInfo && (
        <div style={{
          position: 'absolute', top: '100%', marginTop: 4, [isMine ? 'right' : 'left']: 0, zIndex: 20,
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 8,
          padding: 10, fontSize: '0.72rem', color: 'var(--text-secondary)', minWidth: 160, boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        } as React.CSSProperties}>
          <div>Sent: {new Date(msg.timestamp).toLocaleString()}</div>
          {msg.is_edited && <div>Edited</div>}
          <button onClick={() => setShowInfo(false)} style={{ marginTop: 6, background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.7rem', padding: 0 }}>Close</button>
        </div>
      )}

      {isForMe && !isMineReal && (
        <span style={{ fontSize: '0.67rem', color: '#a78bfa', marginBottom: 2, marginLeft: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
          Only you can read this
        </span>
      )}

      {msg.forwarded_from_message_id && (
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 2 }}>Forwarded</span>
      )}

      {replyToMsg && (
        <div style={{
          fontSize: '0.72rem', color: 'var(--text-muted)', borderLeft: '2px solid var(--accent)',
          paddingLeft: 6, marginBottom: 3, maxWidth: '68%', opacity: 0.85,
        }}>
          <div style={{ fontWeight: 600 }}>{replyToMsg.sender}</div>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {replyToMsg.is_deleted ? 'Message deleted' : (replyToMsg.decoy_content || '…')}
          </div>
        </div>
      )}

      <div style={isMine
        ? { ...ms.bubbleMine, ...encryptedStyle }
        : { ...ms.bubbleTheirs, ...encryptedStyle }
      }>
        {body}
      </div>

      <MessageReactionPills reactions={msg.reactions} onToggle={onReact} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
        {msg.is_pinned && <span title="Pinned" style={{ display: 'inline-flex' }}><PinIcon size={11} color={isMine ? 'rgba(255,255,255,0.75)' : '#6b7280'} /></span>}
        {msg.is_edited && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>edited</span>}
        {!showHeader && <span style={ms.ts}>{fmtTime(msg.timestamp)}</span>}
      </div>
      </div>
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

export default function GroupPanel({ token, myUsername, group, masterToken, onMasterTokenSaved, onJoinMeeting, onBack, onGroupChanged, onGroupGone, onStartGroupCall }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingDocFile, setPendingDocFile] = useState<File | null>(null);
  const [pending, setPending] = useState<PendingMsg[]>([]);
  const [taggedUser, setTaggedUser] = useState<string | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [showMembers, setShowMembers] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [threadRoot, setThreadRoot] = useState<number | null>(null);
  const [threadReplies, setThreadReplies] = useState<ChatMessage[]>([]);
  const [threadFollowing, setThreadFollowing] = useState(false);
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [channelTopic, setChannelTopic] = useState(group.topic || '');
  const [channelError, setChannelError] = useState<string | null>(null);
  const [starredIds, setStarredIds] = useState<Set<number>>(new Set());
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
  const [forwardBusy, setForwardBusy] = useState(false);
  const [forwardError, setForwardError] = useState<string | null>(null);
  const [copilotResult, setCopilotResult] = useState<{ title: string; loading: boolean; error: string | null; content: string | null } | null>(null);
  const [tokenGateOpen, setTokenGateOpen] = useState(false);
  const tokenGateResolveRef = useRef<((t: string | null) => void) | null>(null);
  const [replySuggestions, setReplySuggestions] = useState<string[] | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await getGroupMessages(token, group.id);
      setMessages([...msgs].reverse());
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
    getStarredMessages(token).then(list => setStarredIds(new Set(list.map(m => m.id)))).catch(() => {});
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
      } else if (msg.type === 'message_deleted') {
        const mid = msg.data?.message_id as number | undefined;
        if (mid && msg.data?.group_id === group.id) {
          setMessages(prev => prev.map(m => (m.id === mid ? { ...m, is_deleted: true } : m)));
        }
      } else if (msg.type === 'group_updated') {
        const gid = msg.data?.group_id as number | undefined;
        if (gid === group.id) {
          getGroupMembers(token, group.id).then(setMembers).catch(() => {});
        }
      }
    };
    presenceService.addListener(handler);
    return () => presenceService.removeListener(handler);
  }, [group.id, loadMessages, token]);

  // The master token gates the reveal in the UI; the decryption itself uses the
  // device's private key against this user's entry in the message's key map.
  async function handleDecrypt(_mToken: string, messageId: number): Promise<string> {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) throw new Error('Message not found');
    const kp = loadKeypair(myUsername);
    return decryptChatMessage(msg, kp?.privateKey ?? null, myUsername, kp?.deviceUuid ?? null);
  }

  // ── Copilot actions ──────────────────────────────────────────────────────────
  // Same master-token re-gate as ChatPanel: decryptChatMessage only needs the
  // device key, so bulk-decrypting for summarize/suggest-reply without this
  // gate would let a device without the token get plaintext, bypassing the
  // deniability ceremony.

  function ensureMasterToken(): Promise<string | null> {
    if (masterToken) return Promise.resolve(masterToken);
    return new Promise(resolve => {
      tokenGateResolveRef.current = resolve;
      setTokenGateOpen(true);
    });
  }

  async function getRecentPlaintext(limit = 40): Promise<string[]> {
    const kp = loadKeypair(myUsername);
    const recent = messages.filter(m => !m.is_deleted && !isMeeting(m.content_type) && m.content_type !== 'private_tagged').slice(-limit);
    const lines: string[] = [];
    for (const m of recent) {
      const who = m.sender === myUsername ? 'You' : m.sender;
      if (isEncrypted(m.content_type)) {
        try {
          const text = await decryptChatMessage(m, kp?.privateKey ?? null, myUsername, kp?.deviceUuid ?? null);
          lines.push(`${who}: ${text}`);
        } catch {
          // skip messages this device can't decrypt
        }
      } else if (m.content && !isDocument(m.content_type) && !isVoice(m.content_type) && !isImage(m.content_type) && !isMedia(m.content_type)) {
        lines.push(`${who}: ${m.content}`);
      }
    }
    return lines;
  }

  async function handleSummarize() {
    const mt = await ensureMasterToken();
    if (!mt) return;
    setCopilotResult({ title: 'Thread summary', loading: true, error: null, content: null });
    try {
      const lines = await getRecentPlaintext();
      if (lines.length === 0) {
        setCopilotResult({ title: 'Thread summary', loading: false, error: 'Nothing to summarize yet.', content: null });
        return;
      }
      const summary = await summarizeThreadCopilot(token, lines.join('\n'));
      setCopilotResult({ title: 'Thread summary', loading: false, error: null, content: summary });
    } catch (err: any) {
      setCopilotResult({ title: 'Thread summary', loading: false, error: userMessage(err, "Couldn't summarize this thread. Please try again."), content: null });
    }
  }

  async function handleSuggestReply() {
    const lastFromOthers = [...messages].reverse().find(m => m.sender !== myUsername && !m.is_deleted && m.content_type !== 'private_tagged');
    if (!lastFromOthers) return;
    const mt = await ensureMasterToken();
    if (!mt) return;

    let contextText = lastFromOthers.content || '';
    if (isEncrypted(lastFromOthers.content_type)) {
      try {
        const kp = loadKeypair(myUsername);
        contextText = await decryptChatMessage(lastFromOthers, kp?.privateKey ?? null, myUsername, kp?.deviceUuid ?? null);
      } catch {
        setSendError('Could not decrypt that message to suggest a reply');
        return;
      }
    }
    setSuggestLoading(true);
    setReplySuggestions(null);
    try {
      const suggestions = await composeReplyCopilot(token, contextText);
      setReplySuggestions(suggestions);
    } catch (err: any) {
      setSendError(userMessage(err, "Copilot couldn't draft a reply. Please try again."));
    } finally {
      setSuggestLoading(false);
    }
  }

  async function handleTranslateMessage(text: string) {
    const target = window.prompt('Translate to which language?', 'English');
    if (!target || !target.trim()) return;
    setCopilotResult({ title: `Translation (${target.trim()})`, loading: true, error: null, content: null });
    try {
      const translated = await translateCopilot(token, text, target.trim());
      setCopilotResult({ title: `Translation (${target.trim()})`, loading: false, error: null, content: translated });
    } catch (err: any) {
      setCopilotResult({ title: `Translation (${target.trim()})`, loading: false, error: userMessage(err, "Couldn't translate this message. Please try again."), content: null });
    }
  }

  // ── Collaboration actions ────────────────────────────────────────────────────

  async function handleReact(messageId: number, emoji: string) {
    try {
      await toggleReaction(token, messageId, emoji);
      await loadMessages();
    } catch {}
  }

  async function handlePinToggle(msg: ChatMessage) {
    try {
      if (msg.is_pinned) await unpinMessage(token, msg.id);
      else await pinMessage(token, msg.id);
      await loadMessages();
    } catch {}
  }

  async function handleStarToggle(msg: ChatMessage) {
    const isStarred = starredIds.has(msg.id);
    try {
      if (isStarred) {
        await unstarMessage(token, msg.id);
        setStarredIds(prev => { const next = new Set(prev); next.delete(msg.id); return next; });
      } else {
        await starMessage(token, msg.id);
        setStarredIds(prev => new Set(prev).add(msg.id));
      }
    } catch {}
  }

  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const iAmGroupAdmin = members.find(m => m.username === myUsername)?.role === 'admin' || group.my_role === 'admin';

  function handleDeleteMessage(msg: ChatMessage) {
    setDeleteTarget(msg);
  }

  async function confirmDelete(scope: DeleteScope) {
    const msg = deleteTarget;
    setDeleteTarget(null);
    if (!msg) return;
    try {
      await deleteMessage(token, msg.id, scope);
      if (scope === 'me') setMessages(prev => prev.filter(m => m.id !== msg.id));
      else setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, is_deleted: true } : m)));
      loadMessages();
    } catch (err: any) {
      setSendError(userMessage(err, "Couldn't delete that message. Please try again."));
    }
  }


  async function handleEditStart(msg: ChatMessage) {
    if (!masterToken) {
      setSendError('Unlock a message with your master token first, then edit it');
      return;
    }
    try {
      const plaintext = await handleDecrypt(masterToken, msg.id);
      setEditingMessage(msg);
      setReplyTarget(null);
      setText(plaintext);
    } catch (err: any) {
      setSendError(userMessage(err, "Couldn't open this message to edit it. Please try again."));
    }
  }

  async function handleForwardConfirm(targetUsername: string) {
    const target = forwardTarget;
    if (!target || !targetUsername) return;
    setForwardError(null);
    setForwardBusy(true);
    const ct = target.content_type;
    try {
      if (isImage(ct) || isMedia(ct) || isVoice(ct) || isDocument(ct)) {
        // Media isn't end-to-end encrypted client-side the way text is — it's
        // master-token-gated storage (see MediaBubble's reveal()). Forwarding
        // it is just moving the bytes to a new recipient, not a decrypt step,
        // so this never needed the master token at all.
        const blob = await downloadMedia(token, target.content);
        const filename = `forwarded${extensionForContentType(ct)}`;
        await uploadMedia(token, targetUsername, blob, ct, filename, undefined, target.id);
      } else {
        if (!masterToken) {
          setForwardError('Unlock this message with your master token first');
          return;
        }
        const plaintext = await handleDecrypt(masterToken, target.id);
        const deviceKeys = await buildRecipientKeys(
          token, [targetUsername, myUsername],
          `${targetUsername} has no linked devices with encryption keys yet`,
        );
        const { ciphertext, encryptedKeys, iv } = await encryptMessage(plaintext, deviceKeys);
        await sendText(token, targetUsername, ciphertext, {
          encryptedKey: JSON.stringify(encryptedKeys), iv, decoyContent: generateDecoy(),
          forwardedFromMessageId: target.id,
        });
      }
      setForwardTarget(null);
    } catch (err: any) {
      setForwardError(userMessage(err, "Couldn't forward that message. Please try again."));
    } finally {
      setForwardBusy(false);
    }
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const savedTagged = taggedUser;
    const editTarget = editingMessage;
    const replyId = replyTarget?.id;
    setText('');
    setTaggedUser(null);
    setMentionQuery(null);
    setEditingMessage(null);
    setReplyTarget(null);
    try {
      // Wrap the message key once per active device of every member (ourselves
      // included), keyed by device_uuid, so each member's every device can read it.
      const groupMembers = await getGroupMembers(token, group.id);
      const usernames = new Set<string>(groupMembers.map(m => m.username));
      usernames.add(myUsername);
      const deviceKeys: Record<string, string> = {};
      await Promise.all(
        [...usernames].map(async u => {
          const devices = await getUserDevices(token, u);
          for (const d of devices) {
            if (d.public_key) deviceKeys[d.device_uuid] = d.public_key;
          }
        }),
      );
      const adminKey = await getAdminPublicKey(token).catch(() => null);
      if (adminKey) deviceKeys['__admin__'] = adminKey;

      const { ciphertext, encryptedKeys, iv } = await encryptMessage(trimmed, deviceKeys);
      if (editTarget) {
        await editMessage(token, editTarget.id, ciphertext, {
          encryptedKey: JSON.stringify(encryptedKeys), iv, decoyContent: generateDecoy(),
        });
      } else {
        // @mentions are detected from the typed text against known member
        // usernames — separate from the existing "tag one member privately"
        // feature above (taggedUser/addressed_to_username), which stays as-is.
        const mentioned = groupMembers
          .map(m => m.username)
          .filter(u => new RegExp(`(^|\\s)@${u}\\b`).test(trimmed));
        await sendGroupMessage(
          token,
          group.id,
          ciphertext,
          { encryptedKey: JSON.stringify(encryptedKeys), iv, decoyContent: generateDecoy(), replyToMessageId: replyId, threadRootId: threadRoot ?? undefined, mentions: mentioned.length ? mentioned : undefined },
          savedTagged ?? undefined,
        );
      }
      await loadMessages();
    } catch (err: any) {
      setText(trimmed);
      setTaggedUser(savedTagged);
      if (editTarget) setEditingMessage(editTarget);
      setSendError(userMessage(err, "Couldn't send your message. Check your connection and try again."));
    } finally {
      setSending(false);
    }
  }

  /** GIF/sticker share the exact same E2EE + decoy pipeline as text — only
   * the carried string (a GIF URL, or "sticker:<id>") and content_type differ. */
  async function handleSendSpecial(content: string, contentType: 'gif' | 'sticker') {
    if (sending) return;
    setSending(true);
    try {
      const groupMembers = await getGroupMembers(token, group.id);
      const usernames = new Set<string>(groupMembers.map(m => m.username));
      usernames.add(myUsername);
      const deviceKeys: Record<string, string> = {};
      await Promise.all(
        [...usernames].map(async u => {
          const devices = await getUserDevices(token, u);
          for (const d of devices) {
            if (d.public_key) deviceKeys[d.device_uuid] = d.public_key;
          }
        }),
      );
      const adminKey = await getAdminPublicKey(token).catch(() => null);
      if (adminKey) deviceKeys['__admin__'] = adminKey;
      const { ciphertext, encryptedKeys, iv } = await encryptMessage(content, deviceKeys);
      await sendGroupMessage(
        token, group.id, ciphertext,
        { encryptedKey: JSON.stringify(encryptedKeys), iv, decoyContent: generateDecoy(), contentType },
      );
      await loadMessages();
    } catch (err: any) {
      setSendError(userMessage(err, `Couldn't send that ${contentType}. Check your connection and try again.`));
    } finally {
      setSending(false);
    }
  }

  // ── File attach ──────────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const ct = file.type || 'application/octet-stream';
    if (isDocument(ct)) {
      setPendingDocFile(file);
      return;
    }
    const localId = `pending-${Date.now()}`;
    setPending(prev => [...prev, { localId, content: '', timestamp: new Date().toISOString(), kind: 'image', filename: file.name }]);
    try {
      await uploadGroupMedia(token, group.id, file, ct, file.name);
      await loadMessages();
    } catch (err: any) {
      setSendError(userMessage(err, "Couldn't send that file. Check your connection and try again."));
    } finally {
      setPending(prev => prev.filter(p => p.localId !== localId));
    }
  }

  async function sendPendingDoc(kind?: DecoyKind) {
    const file = pendingDocFile;
    if (!file) return;
    setPendingDocFile(null);
    const ct = file.type || 'application/octet-stream';
    const localId = `pending-${Date.now()}`;
    setPending(prev => [...prev, { localId, content: '', timestamp: new Date().toISOString(), kind: 'document', filename: file.name }]);
    try {
      await uploadGroupMedia(token, group.id, file, ct, file.name, kind);
      await loadMessages();
    } catch (err: any) {
      setSendError(userMessage(err, "Couldn't send that file. Check your connection and try again."));
    } finally {
      setPending(prev => prev.filter(p => p.localId !== localId));
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
  const isChannel = group.kind === 'channel';
  const canManageChannel = isChannel && (group.my_role === 'owner' || group.my_role === 'admin');
  const channelLocked = isChannel && (
    !!group.is_archived || (group.posting_policy === 'admins' && group.my_role !== 'owner' && group.my_role !== 'admin')
  );
  const lockHint = group.is_archived ? 'This channel is archived' : 'Only channel admins can post';
  const timeline = isChannel ? messages.filter(m => !m.thread_root_id) : messages;

  useEffect(() => {
    if (!isChannel || threadRoot == null) return;
    getThread(token, group.id, threadRoot).then(page => {
      setThreadReplies(page.replies);
      setThreadFollowing(page.following);
    }).catch(() => setThreadReplies([]));
  }, [isChannel, threadRoot, token, group.id, messages.length]);

  return (
      <div className="chat-panel" style={{ ...gs.root, display: 'flex', flexDirection: 'row' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Header */}
      <div className="chat-header" style={{ ...gs.header, justifyContent: 'space-between' }}>
        <div className="chat-header-identity" style={gs.headerLeft}>
          {onBack && (
            <button onClick={onBack} style={gs.backBtn} title="Back to groups" aria-label="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <button style={gs.titlePill} onClick={() => setShowMembers(true)} title={isChannel ? 'Channel details' : 'Group details'}>
            {isChannel
              ? <span style={{ color: 'var(--text-muted)', fontSize: '1.05rem', fontWeight: 500 }}>{group.visibility === 'private'
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                : '#'}</span>
              : <span style={{ ...gs.avatar, background: avatarBg }}>{initials(group.name)}</span>}
            <span style={gs.groupName}>{group.name}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}><polyline points="6 9 12 15 18 9" /></svg>
          </button>
          {(group.topic || group.disappear_after_hours) && (
            <span style={gs.groupMeta}>
              {group.topic || ''}
              {group.topic && group.disappear_after_hours ? ' · ' : ''}
              {group.disappear_after_hours ? `Disappearing: ${formatDisappear(group.disappear_after_hours)}` : ''}
            </span>
          )}
        </div>
        <div className="chat-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {onStartGroupCall && (
          <>
            <button onClick={() => onStartGroupCall(group, 'voice')} style={gs.iconBtn} title="Group voice call">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.64a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </button>
            <button onClick={() => onStartGroupCall(group, 'video')} style={gs.iconBtn} title="Group video call">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 10l4.553-2.553A1 1 0 0 1 21 8.382v7.236a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              </svg>
            </button>
          </>
        )}
        {canManageChannel && (
          <button onClick={() => { setChannelTopic(group.topic || ''); setShowChannelSettings(true); }} style={gs.iconBtn} title="Channel settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        )}
        <button onClick={() => setShowMembers(true)} style={gs.memberStack} title={`${members.length || group.member_count || 0} members`}>
          {members.slice(0, 3).map((m, i) => (
            <span key={m.user_id} style={{ ...gs.stackAvatar, background: avatarTint(m.username), marginLeft: i ? -8 : 0, zIndex: 3 - i }}>{initials(m.username)}</span>
          ))}
          {members.length === 0 && <UsersIcon size={18} color="var(--text-secondary)" />}
          <span style={gs.stackCount}>{members.length || group.member_count || 0}</span>
        </button>
        <button onClick={handleSummarize} style={gs.iconBtn} title="Summarize thread">
          <SparkleIcon size={17} color="#9ca3af" />
        </button>
        </div>
      </div>

      {deleteTarget && (
        <DeleteMessageDialog
          isMine={deleteTarget.sender === myUsername}
          canDeleteForEveryone={!deleteTarget.is_deleted && (deleteTarget.sender === myUsername || iAmGroupAdmin)}
          onPick={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showMembers && (
        <GroupInfoDrawer
          token={token}
          myUsername={myUsername}
          group={group}
          members={members}
          onClose={() => setShowMembers(false)}
          onGroupChanged={g => onGroupChanged?.(g)}
          onMembersChanged={() => { getGroupMembers(token, group.id).then(setMembers).catch(() => {}); }}
          onGroupGone={() => { setShowMembers(false); onGroupGone?.(); }}
        />
      )}

      {/* Messages */}
      <div className="chat-messages" style={gs.messagesArea}>
        {loading ? (
          <MessageSkeleton />
        ) : timeline.length === 0 ? (
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
          timeline.reduce<React.ReactNode[]>((acc, msg, i) => {
            const dateKey = msgDateKey(msg.timestamp);
            const prevKey = i > 0 ? msgDateKey(timeline[i - 1].timestamp) : null;
            if (dateKey !== prevKey) {
              acc.push(<DateSeparator key={`sep-${dateKey}`} label={fmtDateLabel(msg.timestamp)} />);
            }
            const prevMsg = i > 0 ? timeline[i - 1] : null;
            const showHeader = dateKey !== prevKey || !prevMsg || prevMsg.sender !== msg.sender
              || (prevMsg.thread_reply_count || 0) > 0
              || new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime() > 5 * 60_000;
            acc.push(
              <GroupMsgBubble
                key={msg.id}
                msg={msg}
                showHeader={showHeader}
                isMine={msg.sender === myUsername}
                myUsername={myUsername}
                token={token}
                masterToken={masterToken}
                onDecrypt={handleDecrypt}
                onMasterTokenSaved={onMasterTokenSaved}
                onJoinMeeting={onJoinMeeting}
                replyToMsg={msg.reply_to_message_id ? messages.find(m => m.id === msg.reply_to_message_id) ?? null : null}
                onReact={emoji => handleReact(msg.id, emoji)}
                onReply={() => { setReplyTarget(msg); setEditingMessage(null); }}
                onForward={() => { setForwardTarget(msg); setForwardError(null); }}
                onPinToggle={() => handlePinToggle(msg)}
                onStarToggle={() => handleStarToggle(msg)}
                onEdit={() => handleEditStart(msg)}
                onDelete={() => handleDeleteMessage(msg)}
                onTranslate={t => handleTranslateMessage(t)}
                isStarred={starredIds.has(msg.id)}
              />
            );
            if (isChannel && (msg.thread_reply_count || 0) > 0) {
              acc.push(
                <button key={`thread-${msg.id}`} onClick={() => setThreadRoot(msg.id)} style={flat.threadChip}>
                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{msg.thread_reply_count} {msg.thread_reply_count === 1 ? 'reply' : 'replies'}</span>
                  {msg.thread_last_reply_at && <span style={{ color: 'var(--text-muted)' }}>Last reply {fmtTime(msg.thread_last_reply_at)}</span>}
                </button>
              );
            }
            return acc;
          }, [])
        )}
        {pending.map(p => (
          <PendingBubble key={p.localId} content={p.content} timestamp={p.timestamp} kind={p.kind} filename={p.filename} />
        ))}
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

      {(suggestLoading || replySuggestions) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '8px 16px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)',
        }}>
          {suggestLoading ? (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Copilot is drafting replies…</span>
          ) : (
            <>
              {replySuggestions!.map((s, i) => (
                <button
                  key={i}
                  onClick={() => { setText(s); setReplySuggestions(null); }}
                  style={{ background: 'var(--input-field-bg)', border: '1px solid var(--border-color)', borderRadius: 14, color: 'var(--text-primary)', padding: '6px 12px', fontSize: '0.78rem', cursor: 'pointer', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {s}
                </button>
              ))}
              <button
                onClick={() => setReplySuggestions(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
              ><CloseIcon size={14} color="var(--text-muted)" /></button>
            </>
          )}
        </div>
      )}

      {(replyTarget || editingMessage) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px', background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)',
        }}>
          <div style={{ borderLeft: '2px solid var(--accent)', paddingLeft: 8, minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent)' }}>
              {editingMessage ? 'Editing message' : `Replying to ${replyTarget?.sender}`}
            </div>
            {replyTarget && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {replyTarget.decoy_content || '…'}
              </div>
            )}
          </div>
          <button
            onClick={() => { setReplyTarget(null); setEditingMessage(null); setText(''); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
          ><CloseIcon size={14} color="var(--text-muted)" /></button>
        </div>
      )}

      {forwardTarget && (
        <ForwardRecipientPicker
          token={token}
          onCancel={() => setForwardTarget(null)}
          onConfirm={handleForwardConfirm}
          busy={forwardBusy}
          error={forwardError}
        />
      )}

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
            style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', display: 'flex' }}
          >
            <CloseIcon size={14} color="#fca5a5" />
          </button>
        </div>
      )}

      {pendingDocFile && (
        <div style={{
          padding: '10px 16px',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Decoy for "{pendingDocFile.name}":
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {DECOY_KIND_LABELS.map(([kind, label]) => (
              <button
                key={kind}
                onClick={() => sendPendingDoc(kind)}
                style={gs.decoyKindBtn}
              >
                {label}
              </button>
            ))}
            <button onClick={() => sendPendingDoc()} style={gs.decoyKindBtn}>
              Random
            </button>
            <button
              onClick={() => setPendingDocFile(null)}
              style={{ ...gs.decoyKindBtn, color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="chat-input-bar" style={{ ...gs.inputBar, flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
        {taggedUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.75rem', color: '#a78bfa', background: 'var(--bg-card)', border: '1px solid #4c1d95', borderRadius: 8, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              Private → <strong>@{taggedUser}</strong>
            </span>
            <button
              onClick={() => setTaggedUser(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px', display: 'flex' }}
            ><CloseIcon size={12} color="var(--text-muted)" /></button>
          </div>
        )}
        <div style={{ ...flatBase.composer, position: 'relative', opacity: channelLocked ? 0.6 : 1 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,application/pdf"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <div style={flatBase.toolbar}>
          <button
            style={gs.iconBtn}
            onClick={() => setShowMediaPicker(v => !v)}
            title="Emoji, GIFs & stickers"
            disabled={channelLocked}
          >
            <SmileyIcon />
          </button>
          {showMediaPicker && (
            <MediaPicker
              token={token}
              anchorStyle={{ bottom: 52, left: 0 }}
              onClose={() => setShowMediaPicker(false)}
              onPickEmoji={emoji => setText(t => t + emoji)}
              onPickGif={(gif: GifResult) => { setShowMediaPicker(false); handleSendSpecial(gif.url, 'gif'); }}
              onPickSticker={stickerId => { setShowMediaPicker(false); handleSendSpecial(`sticker:${stickerId}`, 'sticker'); }}
            />
          )}
          <button
            style={gs.iconBtn}
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            disabled={channelLocked}
          >
            <PaperclipIconSvg size={18} color="var(--text-secondary)" />
          </button>
          <button
            style={gs.iconBtn}
            onClick={() => { setText(t => (t.endsWith(' ') || !t ? t : t + ' ') + '@'); inputRef.current?.focus(); }}
            title="Mention someone"
            disabled={channelLocked}
          >
            <span style={{ fontSize: '1.02rem', fontWeight: 600, lineHeight: 1, color: 'var(--text-secondary)' }}>@</span>
          </button>
          <span style={flatBase.toolbarDivider} />
          <button
            style={gs.iconBtn}
            onClick={handleSuggestReply}
            disabled={suggestLoading || channelLocked}
            title="Suggest a reply"
          >
            <SparkleIcon size={17} color="var(--text-secondary)" />
          </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <textarea
            ref={inputRef}
            style={gs.textInput}
            placeholder={channelLocked ? lockHint : threadRoot ? 'Reply in thread' : taggedUser ? `Private message to @${taggedUser}…` : isChannel ? `Message #${group.name}` : `Message ${group.name}`}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={channelLocked}
          />
          <button
            style={{ ...gs.sendBtn, opacity: text.trim() ? 1 : 0.35, cursor: text.trim() ? 'pointer' : 'default' }}
            onClick={handleSend}
            disabled={sending || !text.trim() || channelLocked}
            title="Send"
          >
            <SendIcon />
          </button>
          </div>
        </div>
      </div>

      {isChannel && group.is_archived && (
        <div style={{ margin: '8px 16px 0', padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', color: '#fbbf24', fontSize: '0.78rem' }}>
          This channel is archived. It is read-only.
        </div>
      )}
      </div>
      {isChannel && threadRoot != null && (
        <aside style={{ width: 320, borderLeft: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
            <strong style={{ fontSize: '0.85rem' }}>Thread</strong>
            <button onClick={() => setThreadRoot(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Close</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
            {threadReplies.map(reply => (
              <div key={reply.id} style={{ marginBottom: 10, fontSize: '0.8rem' }}>
                <div style={{ color: 'var(--text-muted)' }}>{reply.sender}</div>
                <div>{reply.decoy_content || 'Encrypted reply'}</div>
              </div>
            ))}
            {threadReplies.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>No replies yet.</div>}
          </div>
          <button
            onClick={() => setThreadFollow(token, group.id, threadRoot, !threadFollowing).then(() => setThreadFollowing(v => !v)).catch(() => {})}
            style={{ margin: 12, background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 8, padding: 8, color: 'var(--text-primary)', cursor: 'pointer' }}
          >{threadFollowing ? 'Unfollow thread' : 'Follow thread'}</button>
        </aside>
      )}
      {showChannelSettings && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40 }}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setChannelError(null);
              try {
                const updated = await patchChannel(token, group.id, { topic: channelTopic });
                onGroupChanged?.({ ...group, ...updated });
                setShowChannelSettings(false);
              } catch (err: any) {
                setChannelError(err?.message || 'Could not save');
              }
            }}
            style={{ width: 360, background: 'var(--bg-panel)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <strong>Channel settings</strong>
            <input value={channelTopic} onChange={e => setChannelTopic(e.target.value)} placeholder="Topic" style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            {channelError && <div style={{ color: '#fca5a5', fontSize: '0.75rem' }}>{channelError}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>Save topic</button>
              <button type="button" onClick={async () => { const updated = await archiveChannel(token, group.id, !group.is_archived); onGroupChanged?.({ ...group, ...updated }); setShowChannelSettings(false); }} style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)', cursor: 'pointer' }}>{group.is_archived ? 'Unarchive' : 'Archive'}</button>
              <button type="button" onClick={() => setShowChannelSettings(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>Close</button>
            </div>
            {group.my_role === 'owner' && (
              <input placeholder="Transfer to username" onKeyDown={async (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const username = (e.target as HTMLInputElement).value.trim();
                if (!username) return;
                const updated = await transferChannel(token, group.id, username);
                onGroupChanged?.({ ...group, ...updated });
              }} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            )}
          </form>
        </div>
      )}

      {tokenGateOpen && (
        <MasterTokenPromptModal
          token={token}
          onConfirmed={mt => {
            onMasterTokenSaved(mt);
            setTokenGateOpen(false);
            tokenGateResolveRef.current?.(mt);
            tokenGateResolveRef.current = null;
          }}
          onCancel={() => {
            setTokenGateOpen(false);
            tokenGateResolveRef.current?.(null);
            tokenGateResolveRef.current = null;
          }}
        />
      )}

      {copilotResult && (
        <CopilotResultModal
          title={copilotResult.title}
          loading={copilotResult.loading}
          error={copilotResult.error}
          content={copilotResult.content}
          onClose={() => setCopilotResult(null)}
        />
      )}
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

const flat: Record<string, React.CSSProperties> = {
  ...flatBase,
  threadChip: {
    display: 'flex', alignItems: 'center', gap: 10, margin: '2px 12px 6px 60px', padding: '4px 8px',
    background: 'transparent', border: '1px solid var(--border-color)', borderRadius: 8,
    fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start',
  },
};

const ms: Record<string, React.CSSProperties> = {
  bubbleMine: {
    background: 'var(--bubble-theirs-bg)',
    borderRadius: 10,
    padding: '8px 12px',
    maxWidth: '85%',
    color: 'var(--bubble-theirs-text)',
    wordBreak: 'break-word',
  },
  bubbleTheirs: {
    background: 'var(--bubble-theirs-bg)',
    borderRadius: 10,
    padding: '8px 12px',
    maxWidth: '85%',
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
    padding: '12px 24px',
    minHeight: 64,
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--header-bg)',
    flexShrink: 0,
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 7,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '0.6rem',
    flexShrink: 0,
  },
  titlePill: {
    display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-card)', border: 'none', borderRadius: 10,
    padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit',
  },
  groupName: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  groupMeta: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    maxWidth: 360,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  memberStack: {
    display: 'flex', alignItems: 'center', background: 'transparent', border: 'none', cursor: 'pointer',
    padding: '2px 4px', marginLeft: 6, fontFamily: 'inherit',
  },
  stackAvatar: {
    width: 30, height: 30, borderRadius: '50%', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '0.62rem', fontWeight: 700, border: '2px solid var(--bg-panel)', position: 'relative',
  },
  stackCount: {
    marginLeft: 4, minWidth: 30, height: 30, borderRadius: 15, background: 'var(--bg-card)', color: 'var(--text-secondary)',
    fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px',
  },
  messagesArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 12px 16px',
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
    padding: '8px 24px 20px',
    background: 'var(--input-bar-bg)',
    flexShrink: 0,
  },
  textInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    fontSize: '0.92rem',
    padding: '8px 6px',
    resize: 'none',
    lineHeight: 1.45,
    maxHeight: 160,
    overflowY: 'auto',
    fontFamily: 'inherit',
  },
  sendBtn: {
    background: 'var(--accent)',
    color: '#fff',
    width: 36,
    height: 36,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'background 0.15s',
    border: 'none',
    cursor: 'pointer',
  },
  iconBtn: {
    background: 'transparent',
    color: 'var(--text-secondary)',
    padding: 7,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'color 0.15s',
    border: 'none',
    cursor: 'pointer',
  },
  decoyKindBtn: {
    background: 'var(--input-field-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: '0.78rem',
    padding: '6px 12px',
    cursor: 'pointer',
  },
};
