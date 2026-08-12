import { useEffect } from 'react';
import { presenceService, WsMessage } from '../services/presence';

// Shown after join_by_code comes back status:"waiting" — the host has a
// waiting room on and hasn't let this guest in yet. Just listens for the
// admit/deny WS events the backend sends once the host acts.
export default function WaitingForHostScreen({
  conferenceId,
  onAdmitted,
  onDenied,
  onCancel,
}: {
  conferenceId: number;
  onAdmitted: () => void;
  onDenied: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onMsg = (msg: WsMessage) => {
      const data = msg.data || {};
      if (data.conference_id !== conferenceId) return;
      if (msg.type === 'conference_admitted') onAdmitted();
      else if (msg.type === 'conference_denied') onDenied();
    };
    presenceService.addListener(onMsg);
    return () => presenceService.removeListener(onMsg);
  }, [conferenceId, onAdmitted, onDenied]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        background: '#0b0b10',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 18, color: '#fff',
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        border: '3px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--accent, #6d5efc)',
        animation: 'spin 1s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontSize: '1rem', fontWeight: 700 }}>Waiting for the host to let you in…</div>
      <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.6)' }}>You'll join automatically once admitted.</div>
      <button
        onClick={onCancel}
        style={{
          marginTop: 12, background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8,
          padding: '8px 18px', color: '#fff', fontSize: '0.82rem', cursor: 'pointer',
        }}
      >
        Cancel
      </button>
    </div>
  );
}
