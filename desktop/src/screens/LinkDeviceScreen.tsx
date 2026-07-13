import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { generateKeyPair } from '../services/crypto';
import { saveKeypair } from '../services/keys';
import { linkStart, linkStatus } from '../services/api';

interface Props {
  onLinked: (token: string, username: string) => void;
  onUsePassword: () => void;
}

type Phase = 'starting' | 'waiting' | 'approved' | 'expired' | 'error';

function deviceName(): string {
  const p = navigator.platform || 'Desktop';
  if (/mac/i.test(p)) return 'Mac Desktop';
  if (/win/i.test(p)) return 'Windows Desktop';
  if (/linux/i.test(p)) return 'Linux Desktop';
  return 'Desktop';
}

export default function LinkDeviceScreen({ onLinked, onUsePassword }: Props) {
  const [phase, setPhase] = useState<Phase>('starting');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [error, setError] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // This device generates its own keypair; only the public key leaves it.
        const kp = await generateKeyPair();
        const { nonce } = await linkStart(kp.publicKey, 'desktop', deviceName());
        if (cancelled) return;

        // The phone scans this nonce to approve the link.
        const url = await QRCode.toDataURL(`dilarion:link:${nonce}`, {
          width: 260,
          margin: 1,
          color: { dark: '#000000', light: '#ffffff' },
        });
        if (cancelled) return;
        setQrDataUrl(url);
        setPhase('waiting');

        pollRef.current = setInterval(async () => {
          try {
            const status = await linkStatus(nonce);
            if (cancelled) return;
            if (status.status === 'approved' && status.session_token && status.username) {
              if (pollRef.current) clearInterval(pollRef.current);
              saveKeypair(status.username, {
                privateKey: kp.privateKey,
                publicKey: kp.publicKey,
                deviceUuid: status.device_uuid,
              });
              setPhase('approved');
              onLinked(status.session_token, status.username);
            } else if (status.status === 'expired') {
              if (pollRef.current) clearInterval(pollRef.current);
              setPhase('expired');
            }
          } catch {
            // transient poll failure — keep trying
          }
        }, 2000);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Could not start linking');
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [onLinked]);

  return (
    <div style={s.root}>
      <div style={s.card}>
        <h1 style={s.title}>Link this device</h1>
        <p style={s.sub}>
          On your phone open <strong>Settings → Linked devices → Link a device</strong> and scan this code.
        </p>

        <div style={s.qrBox}>
          {phase === 'waiting' && qrDataUrl ? (
            <img src={qrDataUrl} alt="Link QR code" style={{ width: 260, height: 260, borderRadius: 8 }} />
          ) : phase === 'starting' ? (
            <span style={s.muted}>Generating code…</span>
          ) : phase === 'approved' ? (
            <span style={{ ...s.muted, color: '#25d366' }}>Linked! Opening…</span>
          ) : phase === 'expired' ? (
            <span style={{ ...s.muted, color: '#f59e0b' }}>Code expired</span>
          ) : (
            <span style={{ ...s.muted, color: '#ef4444' }}>{error}</span>
          )}
        </div>

        {phase === 'waiting' && <p style={s.hint}>Waiting for approval from your phone…</p>}
        {(phase === 'expired' || phase === 'error') && (
          <button style={s.btn} onClick={() => window.location.reload()}>Try again</button>
        )}
        <button style={s.linkBtn} onClick={onUsePassword}>Sign in with username instead</button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#0c0c0c', padding: '1.5rem', height: '100vh',
  },
  card: {
    background: '#141414', border: '1px solid #1e1e1e', borderRadius: 20,
    padding: '2.5rem 2rem', width: '100%', maxWidth: 380,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem',
  },
  title: { fontSize: '1.4rem', fontWeight: 700, color: '#fff', margin: 0 },
  sub: { fontSize: '0.85rem', color: '#9ca3af', textAlign: 'center', lineHeight: 1.5, margin: 0 },
  qrBox: {
    width: 280, height: 280, background: '#fff', borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  muted: { fontSize: '0.9rem', color: '#6b7280' },
  hint: { fontSize: '0.8rem', color: '#9ca3af', margin: 0 },
  btn: {
    background: 'var(--accent, #c0392b)', color: '#fff', border: 'none',
    borderRadius: 10, padding: '10px 20px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
  },
  linkBtn: {
    background: 'transparent', color: '#9ca3af', border: 'none',
    fontSize: '0.82rem', cursor: 'pointer', textDecoration: 'underline',
  },
};
