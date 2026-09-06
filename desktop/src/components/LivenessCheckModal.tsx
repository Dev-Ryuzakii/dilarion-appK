import { useEffect, useRef, useState } from 'react';

// Simple motion-based liveness check: samples the webcam a few times a
// second and looks for natural micro-motion (the kind a live person can't
// avoid producing — blinking, breathing, tiny head movement) over a short
// window. A static photo held up to the camera stays essentially motionless
// and fails; a live face passes within a couple of seconds. This is a
// presence check, not identity verification — it doesn't confirm WHO is
// there, only that it's a live person and not a photo.

const SAMPLE_INTERVAL_MS = 150;
const WINDOW_SAMPLES = 16; // ~2.4s rolling window
const MOTION_THRESHOLD = 6; // mean abs luminance delta (0-255 scale) to count as "moved"
const TIMEOUT_MS = 8000;
const SAMPLE_W = 96;
const SAMPLE_H = 72;

type Status = 'requesting-camera' | 'checking' | 'passed' | 'failed' | 'camera-error';

export default function LivenessCheckModal({ onResult }: { onResult: (ok: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const motionHistoryRef = useRef<number[]>([]);
  const [status, setStatus] = useState<Status>('requesting-camera');
  const [attempt, setAttempt] = useState(0);

  function cleanup() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function start() {
      setStatus('requesting-camera');
      prevFrameRef.current = null;
      motionHistoryRef.current = [];
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus('checking');

        timeoutId = setTimeout(() => {
          if (cancelled) return;
          setStatus('failed');
        }, TIMEOUT_MS);

        intervalId = setInterval(() => {
          if (cancelled) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < 2) return;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
          const frame = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

          const prev = prevFrameRef.current;
          if (prev) {
            let diffSum = 0;
            const pixelCount = SAMPLE_W * SAMPLE_H;
            for (let i = 0; i < frame.length; i += 4) {
              // Cheap luminance approximation, no need for exact weights here.
              const lum = (frame[i] + frame[i + 1] + frame[i + 2]) / 3;
              const prevLum = (prev[i] + prev[i + 1] + prev[i + 2]) / 3;
              diffSum += Math.abs(lum - prevLum);
            }
            const meanDiff = diffSum / pixelCount;
            const history = motionHistoryRef.current;
            history.push(meanDiff);
            if (history.length > WINDOW_SAMPLES) history.shift();

            const movedSamples = history.filter(d => d > MOTION_THRESHOLD).length;
            if (history.length >= 6 && movedSamples >= 2) {
              if (timeoutId) clearTimeout(timeoutId);
              if (intervalId) clearInterval(intervalId);
              setStatus('passed');
              cleanup();
              setTimeout(() => { if (!cancelled) onResult(true); }, 500);
            }
          }
          prevFrameRef.current = new Uint8ClampedArray(frame);
        }, SAMPLE_INTERVAL_MS);
      } catch {
        if (!cancelled) setStatus('camera-error');
      }
    }

    start();
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      if (timeoutId) clearTimeout(timeoutId);
      cleanup();
    };
  }, [attempt]);

  function retry() {
    setAttempt(a => a + 1);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-panel, #1a1a1a)', border: '1px solid var(--border-color, #333)',
        borderRadius: 16, padding: 28, width: 340, display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 14,
      }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary, #fff)' }}>Liveness Check</div>

        <div style={{
          width: 240, height: 180, borderRadius: 12, overflow: 'hidden', background: '#000',
          border: status === 'passed' ? '2px solid #25d366' : status === 'failed' ? '2px solid #ef4444' : '1px solid var(--border-color, #333)',
        }}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        </div>
        <canvas ref={canvasRef} width={SAMPLE_W} height={SAMPLE_H} style={{ display: 'none' }} />

        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #9ca3af)', textAlign: 'center', minHeight: 32 }}>
          {status === 'requesting-camera' && 'Requesting camera…'}
          {status === 'checking' && 'Look at the camera and move a little — a small nod or blink is enough.'}
          {status === 'passed' && 'Verified — a live person was detected.'}
          {status === 'failed' && "Couldn't confirm — try again, or check your camera isn't blocked."}
          {status === 'camera-error' && 'Camera unavailable — check permissions and try again.'}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          {(status === 'failed' || status === 'camera-error') && (
            <button
              onClick={retry}
              style={{ background: 'var(--accent, #ef4444)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              Retry
            </button>
          )}
          <button
            onClick={() => { cleanup(); onResult(false); }}
            style={{ background: 'transparent', color: 'var(--text-muted, #9ca3af)', border: '1px solid var(--border-color, #333)', borderRadius: 8, padding: '8px 18px', fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
