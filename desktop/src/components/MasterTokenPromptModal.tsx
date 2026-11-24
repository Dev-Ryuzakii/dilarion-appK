import { useState } from 'react';
import { confirmMasterToken } from '../services/api';
import { CloseIcon, LockIcon } from './Icons';
import { userMessage } from '../services/errors';

/**
 * Shared gate for copilot actions that need plaintext of already-encrypted
 * content (summarize, suggest-reply, translate) when no master token is
 * known yet this session. Decryption itself isn't cryptographically gated
 * by the master token — it's this UI ceremony that is, matching every
 * other reveal in the app. Skipping this for these actions would let
 * someone with the device (but not the token) get a plaintext summary
 * without ever proving they know the secret — a real deniability
 * regression, not just a missing feature.
 */
export default function MasterTokenPromptModal({ token, onConfirmed, onCancel }: {
  token: string;
  onConfirmed: (masterToken: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const valid = await confirmMasterToken(token, trimmed);
      if (!valid) {
        setError('Invalid master token');
        return;
      }
      onConfirmed(trimmed);
    } catch (err) {
      setError(userMessage(err, "Couldn't verify your master token. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-watch-block className="responsive-overlay" onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.40)', backdropFilter: 'blur(3px)', zIndex: 980, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="responsive-dialog" onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 20, width: 360, padding: 24, boxShadow: '0 24px 60px rgba(15,23,42,0.20)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(216,52,40,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <LockIcon size={18} color="var(--accent)" />
          </div>
          <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)', flex: 1 }}>Master token required</span>
          <button onClick={onCancel} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><CloseIcon size={14} color="var(--text-muted)" /></button>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 14px', lineHeight: 1.5 }}>
          This copilot action needs to read the real message content — enter your master token to continue.
        </p>
        <input
          type="password"
          autoFocus
          placeholder="Master token"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border-color)', borderRadius: 12, color: 'var(--text-primary)', fontSize: '0.9rem', padding: '11px 13px', outline: 'none', fontFamily: 'inherit' }}
        />
        {error && <div style={{ color: 'var(--accent)', fontSize: '0.76rem', marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexDirection: 'row-reverse' }}>
          <button
            onClick={submit}
            disabled={!value.trim() || loading}
            style={{ flex: 1, background: !value.trim() ? 'var(--input-field-bg)' : 'var(--accent)', color: !value.trim() ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 999, padding: '10px 0', fontSize: '0.85rem', fontWeight: 700, fontFamily: 'inherit', cursor: !value.trim() || loading ? 'default' : 'pointer' }}
          >{loading ? 'Verifying…' : 'Confirm'}</button>
          <button onClick={onCancel} style={{ background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 999, padding: '10px 18px', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
