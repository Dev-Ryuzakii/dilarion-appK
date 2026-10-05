// WhatsApp-style delete: "Delete for me" is always available; "Delete for
// everyone" only when the viewer sent the message (or, in a group, is a
// group admin).
export type DeleteScope = 'me' | 'everyone';

export default function DeleteMessageDialog({ canDeleteForEveryone, isMine, onPick, onCancel }: {
  canDeleteForEveryone: boolean;
  isMine: boolean;
  onPick: (scope: DeleteScope) => void;
  onCancel: () => void;
}) {
  const btn: React.CSSProperties = {
    width: '100%', textAlign: 'right', background: 'transparent', border: '1px solid var(--border-color)',
    borderRadius: 999, padding: '9px 18px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    color: 'var(--accent)',
  };
  return (
    <div
      className="responsive-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 980, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="responsive-dialog" style={{
        width: 340, maxWidth: '100%', background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 14,
        padding: '20px 20px 16px', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
      }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.95rem' }}>Delete message?</div>
        {!isMine && canDeleteForEveryone && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem', lineHeight: 1.5 }}>
            As a group admin you can remove this message for everyone.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          {canDeleteForEveryone && (
            <button style={btn} onClick={() => onPick('everyone')}>Delete for everyone</button>
          )}
          <button style={btn} onClick={() => onPick('me')}>Delete for me</button>
          <button style={{ ...btn, color: 'var(--text-muted)' }} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
