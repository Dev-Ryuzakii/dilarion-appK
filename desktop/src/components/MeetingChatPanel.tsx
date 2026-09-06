import { useEffect, useRef, useState } from 'react';
import { CloseIcon } from './Icons';
import {
  ConferenceChatMessage,
  getConferenceMessages,
  sendConferenceMessage,
  getUserDevices,
  decryptChatMessage,
  confirmMasterToken,
  ChatMessage,
} from '../services/api';
import { encryptMessage } from '../services/crypto';
import { generateDecoy } from '../services/decoy';
import { loadKeypair } from '../services/keys';
import { presenceService, WsMessage } from '../services/presence';

/**
 * In-meeting encrypted chat — sidebar panel scoped to conference_id, reusing
 * the same per-device RSA key-fanout + master-token decoy/unlock model as
 * DM/group chat. Nothing is stored beyond the meeting's own Message rows.
 */
export default function MeetingChatPanel({
  token,
  conferenceId,
  myUsername,
  participantUsernames,
  masterToken,
  onMasterTokenSaved,
  onClose,
}: {
  token: string;
  conferenceId: number;
  myUsername: string;
  participantUsernames: string[];
  masterToken: string | null;
  onMasterTokenSaved: (t: string) => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ConferenceChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadMessages() {
    try {
      const msgs = await getConferenceMessages(token, conferenceId);
      setMessages(msgs);
    } catch {
      // silently fail — chat is best-effort alongside the live call
    }
  }

  useEffect(() => {
    loadMessages();
  }, [conferenceId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handler = (msg: WsMessage) => {
      if (msg.type === 'new_conference_message' && msg.data?.conference_id === conferenceId) {
        loadMessages();
      }
    };
    presenceService.addListener(handler);
    return () => presenceService.removeListener(handler);
  }, [conferenceId]);

  async function handleDecrypt(_mToken: string, messageId: number): Promise<string> {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) throw new Error('Message not found');
    const kp = loadKeypair(myUsername);
    return decryptChatMessage(msg as unknown as ChatMessage, kp?.privateKey ?? null, myUsername, kp?.deviceUuid ?? null);
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setText('');
    try {
      // Wrap the message key once per active device of everyone currently
      // admitted to the meeting (ourselves included), same fanout as group chat.
      const usernames = new Set<string>(participantUsernames);
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

      const { ciphertext, encryptedKeys, iv } = await encryptMessage(trimmed, deviceKeys);
      await sendConferenceMessage(token, conferenceId, ciphertext, {
        encryptedKey: JSON.stringify(encryptedKeys),
        iv,
        decoyContent: generateDecoy(),
      });
      await loadMessages();
    } catch (err: any) {
      setText(trimmed);
      setError(err?.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 340, height: '100%', background: '#16161c', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem' }}>In-meeting chat</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', display: 'flex' }}><CloseIcon size={16} color="#aaa" /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {messages.length === 0 ? (
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem', textAlign: 'center', marginTop: 20 }}>No messages yet.</p>
          ) : (
            messages.map(msg => (
              <MeetingChatBubble
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

        {error && (
          <div style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.12)', color: '#fca5a5', fontSize: '0.75rem' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Message everyone in the meeting…"
            disabled={sending}
            style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#fff', fontSize: '0.82rem', padding: '8px 10px' }}
          />
          <button
            onClick={handleSend}
            disabled={sending || !text.trim()}
            style={{ background: '#25d366', border: 'none', borderRadius: 8, color: '#0b0b10', fontWeight: 700, fontSize: '0.8rem', padding: '0 14px', cursor: sending ? 'wait' : 'pointer', opacity: sending || !text.trim() ? 0.6 : 1 }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function MeetingChatBubble({
  msg,
  isMine,
  token,
  masterToken,
  onDecrypt,
  onMasterTokenSaved,
}: {
  msg: ConferenceChatMessage;
  isMine: boolean;
  token: string;
  masterToken: string | null;
  onDecrypt: (masterToken: string, messageId: number) => Promise<string>;
  onMasterTokenSaved: (t: string) => void;
}) {
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
      const content = await onDecrypt(mToken, msg.id);
      onMasterTokenSaved(mToken);
      setDecryptedContent(content);
      setShowing(true);
      setInputVisible(false);
      setInputValue('');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { setShowing(false); setDecryptedContent(null); }, 30000);
    } catch (err: any) {
      setError(err?.message || 'Invalid master token');
    } finally {
      setLoading(false);
    }
  }

  async function handleBubbleTap() {
    if (showing || loading) return;
    if (masterToken) await runDecrypt(masterToken);
    else setInputVisible(v => !v);
  }

  const bubbleStyle: React.CSSProperties = {
    alignSelf: isMine ? 'flex-end' : 'flex-start',
    maxWidth: '85%',
    background: isMine ? 'rgba(37,211,102,0.15)' : 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: '8px 12px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
      {!isMine && <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', marginBottom: 2, marginLeft: 4 }}>{msg.sender}</span>}
      <div style={bubbleStyle}>
        {showing && decryptedContent !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.82rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#fff' }}>{decryptedContent}</span>
            <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>Clears in 30s</span>
          </div>
        ) : (
          <div onClick={handleBubbleTap} style={{ cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            <span style={{ fontSize: '0.82rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'rgba(255,255,255,0.6)', userSelect: 'none' }}>
              {loading ? '…' : (msg.decoy_content || '…')}
            </span>
          </div>
        )}
        {inputVisible && !masterToken && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              type="password"
              placeholder="Master token"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runDecrypt(inputValue.trim()); }}
              style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#fff', fontSize: '0.75rem', padding: '5px 8px' }}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
            <button
              style={{ background: '#c0392b', color: '#fff', fontSize: '0.7rem', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', border: 'none' }}
              onClick={e => { e.stopPropagation(); runDecrypt(inputValue.trim()); }}
            >
              OK
            </button>
          </div>
        )}
        {error && <span style={{ fontSize: '0.68rem', color: '#ef4444', display: 'block', marginTop: 4 }}>{error}</span>}
      </div>
    </div>
  );
}
