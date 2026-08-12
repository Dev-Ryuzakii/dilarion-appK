import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadMedia, downloadDecoyFile, confirmMasterToken } from '../services/api';
import { CameraIcon, MicIcon as MicIconSvg, PaperclipIcon as PaperclipIconSvg, SpinnerIcon } from './Icons';

// Best-effort classification from the server's content_type, used only for the
// pre-download placeholder icon. The real decision is made by sniffing bytes.
function isVoice(ct: string | null | undefined): boolean {
  return !!(ct === 'media/voice' || ct?.startsWith('audio/'));
}
function isImageCt(ct: string | null | undefined): boolean {
  return !!(ct?.startsWith('image/') || ct === 'media/photo');
}
function isVideoCt(ct: string | null | undefined): boolean {
  return !!(ct?.startsWith('video/') || ct === 'media/video');
}

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

// The stored content_type is unreliable — depending on the upload path it can be
// "media/photo", "media/raw", or "application/octet-stream" for the same image.
// Classify by the file's own magic bytes so rendering is correct regardless.
export function sniffMedia(bytes: Uint8Array): { kind: MediaKind; mime: string } {
  const b = bytes;
  const ascii = (o: number, s: string) => s.split('').every((c, i) => b[o + i] === c.charCodeAt(0));

  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (b[0] === 0x89 && ascii(1, 'PNG')) return { kind: 'image', mime: 'image/png' };
  if (ascii(0, 'GIF8')) return { kind: 'image', mime: 'image/gif' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', mime: 'image/webp' };
  if (ascii(0, 'BM')) return { kind: 'image', mime: 'image/bmp' };
  // HEIC/HEIF and MP4 both use the ISO-BMFF "ftyp" box at offset 4
  if (ascii(4, 'ftyp')) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand.startsWith('hei') || brand.startsWith('mif')) return { kind: 'image', mime: 'image/heic' };
    if (brand.startsWith('M4A')) return { kind: 'audio', mime: 'audio/mp4' };
    return { kind: 'video', mime: 'video/mp4' };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mime: 'video/webm' };
  if (ascii(0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (ascii(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg' };
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav' };
  if (ascii(0, '%PDF')) return { kind: 'file', mime: 'application/pdf' };
  return { kind: 'file', mime: 'application/octet-stream' };
}

// ── MediaLightbox ──────────────────────────────────────────────────────────────

/** Full-screen viewer for photos and videos. Escape or a backdrop click closes it. */
function MediaLightbox({ src, kind, onClose }: { src: string; kind: MediaKind; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <button
        onClick={onClose}
        title="Close (Esc)"
        style={{
          position: 'absolute',
          top: 16,
          right: 20,
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255,255,255,0.12)',
          color: '#fff',
          fontSize: '1.1rem',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        ✕
      </button>

      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {kind === 'video' ? (
          <video
            src={src}
            controls
            autoPlay
            style={{ maxWidth: '90vw', maxHeight: '82vh', borderRadius: 8, background: '#000' }}
          />
        ) : kind === 'file' ? (
          <iframe
            src={src}
            title="document"
            style={{ width: '80vw', height: '82vh', border: 'none', borderRadius: 8, background: '#fff' }}
          />
        ) : (
          <img
            src={src}
            alt="media"
            style={{ maxWidth: '90vw', maxHeight: '82vh', objectFit: 'contain', borderRadius: 8, display: 'block' }}
          />
        )}
        <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)' }}>
          View once — this closes and clears when you dismiss it
        </span>
      </div>
    </div>,
    document.body,
  );
}

// ── MediaBubble ────────────────────────────────────────────────────────────────

/**
 * View-once media bubble. Downloads on tap, classifies by magic bytes, and shows
 * photos/videos in a full-screen lightbox. `onRemove` (when provided) fires 10s
 * after the media is dismissed, matching the server's one-time-view deletion.
 */
export default function MediaBubble({ token, mediaId, contentType, onRemove }: { token: string; mediaId: string; contentType: string; onRemove?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<MediaKind>('file');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerMime, setViewerMime] = useState('application/octet-stream');
  const removeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const viewable = kind === 'image' || kind === 'video';

  useEffect(() => {
    return () => { if (removeTimerRef.current) clearTimeout(removeTimerRef.current); };
  }, []);

  function scheduleRemoval() {
    if (!onRemove) return;
    if (removeTimerRef.current) clearTimeout(removeTimerRef.current);
    removeTimerRef.current = setTimeout(() => onRemove(), 10_000);
  }

  function closeViewer() {
    setViewerOpen(false);
    scheduleRemoval();
  }

  async function handleClick() {
    if (loading) return;
    if (loaded) {
      if (viewable && objectUrl) setViewerOpen(true);
      return;
    }
    setLoading(true);
    try {
      const blob = await downloadMedia(token, mediaId);
      const buf = new Uint8Array(await blob.arrayBuffer());
      const { kind: k, mime } = sniffMedia(buf);
      setKind(k);
      setViewerMime(mime);

      // Data URL with the sniffed MIME — avoids both blob: protocol issues in the
      // Tauri WebView and the server's unreliable content_type.
      let b64 = '';
      for (let i = 0; i < buf.length; i++) b64 += String.fromCharCode(buf[i]);
      setObjectUrl(`data:${mime};base64,${btoa(b64)}`);
      setLoaded(true);

      if (k === 'image' || k === 'video') {
        setViewerOpen(true);   // removal scheduled on close
      } else {
        scheduleRemoval();
      }
    } catch (err: any) {
      const status = err?.status;
      if (status === 410 || status === 404) {
        onRemove?.();
      } else {
        setLoadError('Failed to load');
      }
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--input-field-bg)', border: '1px solid var(--border-color)', borderRadius: 10 }}>
        {isVoice(contentType) ? <MicIconSvg size={18} color="#6b7280" /> : (isImageCt(contentType) || isVideoCt(contentType)) ? <CameraIcon size={18} color="#6b7280" /> : <PaperclipIconSvg size={18} color="#6b7280" />}
        <span style={{ fontSize: '0.78rem', color: '#6b7280', fontStyle: 'italic' }}>{loadError}</span>
      </div>
    );
  }

  if (loaded && objectUrl) {
    if (viewable) {
      return (
        <>
          <div
            onClick={() => setViewerOpen(true)}
            title="Tap to view"
            style={{ position: 'relative', cursor: 'pointer', lineHeight: 0 }}
          >
            {kind === 'image' ? (
              <img
                src={objectUrl}
                alt="photo"
                style={{ maxWidth: 260, maxHeight: 260, borderRadius: 10, display: 'block' }}
              />
            ) : (
              <video
                src={objectUrl}
                preload="metadata"
                style={{ maxWidth: 260, maxHeight: 260, borderRadius: 10, display: 'block', background: '#000' }}
              />
            )}
            {kind === 'video' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                  width: 46, height: 46, borderRadius: '50%', background: 'rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '1rem', paddingLeft: 3,
                }}>
                  ▶
                </div>
              </div>
            )}
          </div>
          {viewerOpen && <MediaLightbox src={objectUrl} kind={kind} onClose={closeViewer} />}
        </>
      );
    }
    if (kind === 'audio') {
      return <audio controls src={objectUrl} preload="auto" style={{ maxWidth: 240, display: 'block' }} />;
    }
    return (
      <a href={objectUrl} download={mediaId} style={{ color: '#93c5fd', fontSize: '0.83rem', textDecoration: 'underline' }}>
        Download {viewerMime === 'application/pdf' ? 'PDF' : 'file'}
      </a>
    );
  }

  // Icon placeholder (best-effort from content_type until we download and sniff).
  let label = 'Tap to open';
  let iconEl: React.ReactNode = <PaperclipIconSvg size={22} color="#9ca3af" />;
  if (isImageCt(contentType)) { iconEl = <CameraIcon size={22} color="#9ca3af" />; label = 'Photo'; }
  else if (isVideoCt(contentType)) { iconEl = <CameraIcon size={22} color="#9ca3af" />; label = 'Video'; }
  else if (isVoice(contentType)) { iconEl = <MicIconSvg size={22} color="#9ca3af" />; label = 'Voice note'; }

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

// ── DocumentBubble ─────────────────────────────────────────────────────────────

// data: URL, kept only in memory for as long as the viewer is open — nothing
// here ever touches disk, matching how images/video are already handled above.
function toDataUrl(bytes: Uint8Array, mime: string): string {
  let b64 = '';
  for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(b64)}`;
}

type DocStage = 'idle' | 'loading' | 'decoy' | 'revealing' | 'revealed';

/**
 * A document attachment that opens the decoy on the first tap — no gate, same
 * as anyone else opening it would see — and only offers the real file behind a
 * double-tap + master token, mirroring EncryptedBubble's reveal for text. The
 * pre-tap and decoy states must look identical to a plain attachment; nothing
 * in the UI may hint that a decoy exists until the real content is unlocked.
 */
export function DocumentBubble({
  token,
  mediaId,
  masterToken,
  onMasterTokenSaved,
  onRemove,
}: {
  token: string;
  mediaId: string;
  masterToken: string | null;
  onMasterTokenSaved: (t: string) => void;
  onRemove?: () => void;
}) {
  const [stage, setStage] = useState<DocStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tokenInputVisible, setTokenInputVisible] = useState(false);
  const [tokenValue, setTokenValue] = useState('');
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); };
  }, []);

  function closeViewer() {
    // Drop it from memory on close — reopening re-fetches rather than keeping
    // decoded bytes sitting around. For the real file this also means it can't
    // be viewed again without the server round-trip, which will 410 anyway
    // since the server already deleted it after this one read.
    const wasRevealed = stage === 'revealed';
    setViewerUrl(null);
    // Only remove the message once the user has actually seen the real file and
    // dismissed it — calling this from reveal() itself would unmount the bubble
    // (and its just-opened viewer) before anything ever painted.
    if (wasRevealed) onRemove?.();
  }

  // Also used to reopen the decoy after the viewer's been closed once — nothing
  // stays cached client-side, so that's a plain re-fetch, not a special case.
  async function loadDecoy() {
    setError(null);
    try {
      const blob = await downloadDecoyFile(token, mediaId);
      const buf = new Uint8Array(await blob.arrayBuffer());
      setViewerUrl(toDataUrl(buf, 'application/pdf'));
      setStage('decoy');
    } catch {
      setError('Failed to load');
      setStage('idle');
    }
  }

  async function reveal(mToken: string) {
    setStage('revealing');
    setError(null);
    try {
      const valid = masterToken === mToken ? true : await confirmMasterToken(token, mToken);
      if (!valid) {
        setError('Invalid master token');
        setStage('decoy');
        return;
      }
      onMasterTokenSaved(mToken);
      const blob = await downloadMedia(token, mediaId);
      const buf = new Uint8Array(await blob.arrayBuffer());
      const { mime } = sniffMedia(buf);
      setViewerUrl(toDataUrl(buf, mime));
      setStage('revealed');
      setTokenInputVisible(false);
      setTokenValue('');
      // Message removal happens on viewer close (closeViewer), not here — see
      // its comment for why.
    } catch (err: any) {
      // 410/404: the real file is already gone server-side (viewed elsewhere,
      // or expired). The decoy is unaffected — fall back to it, not an error.
      if (err?.status === 410 || err?.status === 404) {
        setStage('decoy');
      } else {
        setError('Failed to reveal');
        setStage('decoy');
      }
    }
  }

  function handleClick() {
    // Delayed so a double-click's leading click doesn't race loadDecoy() against
    // the reveal that the trailing dblclick is about to trigger. If a second
    // click arrives in time, handleDoubleClick cancels this before it runs.
    if (clickTimerRef.current) return;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      if (stage === 'idle') loadDecoy();
      else if (stage === 'decoy' && !viewerUrl) loadDecoy();
    }, 280);
  }

  function handleDoubleClick() {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    if (stage !== 'decoy') return;
    if (masterToken) {
      reveal(masterToken);
    } else {
      setTokenInputVisible(v => !v);
    }
  }

  async function handleSubmitToken() {
    const trimmed = tokenValue.trim();
    if (!trimmed) return;
    await reveal(trimmed);
  }

  const loading = stage === 'loading' || stage === 'revealing';
  // A generic-looking filename, not an action hint — reads like any other
  // attachment bubble instead of announcing that tapping does something special.
  const label = stage === 'loading' ? 'Loading...' : stage === 'revealing' ? 'Verifying...' : 'Document.pdf';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
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
        {loading ? <SpinnerIcon size={22} /> : <PaperclipIconSvg size={22} color="#9ca3af" />}
        <span>{label}</span>
      </button>

      {tokenInputVisible && !masterToken && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="password"
            placeholder="Master token"
            value={tokenValue}
            onChange={e => setTokenValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmitToken(); }}
            style={{
              flex: 1,
              background: 'var(--input-field-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              padding: '6px 10px',
            }}
            autoFocus
          />
          <button
            style={{
              background: 'var(--accent)',
              color: '#fff',
              fontSize: '0.75rem',
              borderRadius: 8,
              padding: '6px 12px',
              cursor: 'pointer',
              border: 'none',
            }}
            onClick={handleSubmitToken}
          >
            OK
          </button>
        </div>
      )}
      {error && <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</span>}
      {viewerUrl && <MediaLightbox src={viewerUrl} kind="file" onClose={closeViewer} />}
    </div>
  );
}
