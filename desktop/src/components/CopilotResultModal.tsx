import { SparkleIcon, CloseIcon } from './Icons';

/** Shared result popup for one-shot copilot actions (summarize, translate,
 * document Q&A) — a single "thinking… / error / result" pattern reused
 * instead of three near-identical modals. */
export default function CopilotResultModal({ title, loading, error, content, onClose }: {
  title: string;
  loading: boolean;
  error: string | null;
  content: string | null;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 970, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 16,
          width: 420, maxWidth: '90vw', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <SparkleIcon size={16} color="var(--accent)" />
          <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)', flex: 1 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
            <CloseIcon size={16} color="var(--text-muted)" />
          </button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {loading && <span style={{ color: 'var(--text-muted)' }}>Thinking…</span>}
          {!loading && error && <span style={{ color: '#ef4444' }}>{error}</span>}
          {!loading && !error && content}
        </div>
      </div>
    </div>
  );
}
