import { useState } from 'react';
import { confirmMasterToken } from '../services/api';
import { CloseIcon, LockIcon } from './Icons';

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
    } catch {
      setError('Failed to verify master token');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 980, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 16, width: 340, padding: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <LockIcon size={16} color="var(--text-muted)" />
          <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1 }}>Master token required</span>
          <button onClick={onCancel} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><CloseIcon size={14} color="var(--text-muted)" /></button>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          This copilot action needs to read the real message content — enter your master token to continue.
        </p>
        <input
          type="password"
          autoFocus
          placeholder="Master token"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--input-field-bg)', border: '1px solid var(--border-color)', borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.85rem', padding: '8px 10px' }}
        />
        {error && <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 6 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            onClick={submit}
            disabled={!value.trim() || loading}
            style={{ flex: 1, background: !value.trim() ? 'var(--input-field-bg)' : 'var(--accent)', color: !value.trim() ? 'var(--text-muted)' : '#fff', border: 'none', borderRadius: 8, padding: '9px 0', fontSize: '0.82rem', fontWeight: 700, cursor: !value.trim() || loading ? 'default' : 'pointer' }}
          >{loading ? 'Verifying…' : 'Confirm'}</button>
          <button onClick={onCancel} style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '9px 16px', fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
