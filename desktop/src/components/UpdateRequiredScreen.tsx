import { useEffect, useState } from 'react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

// Covers the whole app until the user taps Update. There is no Later and no
// close. The screen stays through the download; the process then restarts
// into the new version.
export default function UpdateRequiredScreen({ version, onUpdate }: {
  version: string;
  onUpdate: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    WebviewWindow.getByLabel('call').then(win => win?.close()).catch(() => {});
  }, []);

  async function update() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onUpdate();
    } catch {
      setError("Couldn't download the update. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--frame-bg)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 10000,
    }}>
      <div style={{ width: 380, maxWidth: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', background: 'var(--bg-panel)', borderRadius: 18, padding: '32px 28px', boxShadow: '0 24px 60px rgba(0,0,0,0.28)' }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.35rem' }}>There is an update</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Version {version}</div>
        {error && <div style={{ color: '#ef4444', fontSize: '0.85rem', lineHeight: 1.4 }}>{error}</div>}
        <button
          type="button"
          onClick={update}
          disabled={busy}
          style={{
            background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10,
            padding: '12px 28px', fontSize: '0.95rem', fontWeight: 700, minWidth: 180,
            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.8 : 1, fontFamily: 'inherit',
          }}
        >
          {busy ? 'Updating…' : 'Update'}
        </button>
      </div>
    </div>
  );
}
