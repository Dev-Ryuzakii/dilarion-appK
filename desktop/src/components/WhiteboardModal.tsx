import { useEffect, useRef, useState } from 'react';
import { sendWhiteboardStroke, sendWhiteboardClear, WhiteboardTarget, WhiteboardStroke } from '../services/api';
import { presenceService, WsMessage } from '../services/presence';

/**
 * Ephemeral shared canvas. Strokes are relayed live via WS (POST /whiteboard/
 * stroke -> ws_manager push) — nothing is persisted, so this always opens
 * blank. Coordinates are normalized to 0..1 before sending so two clients
 * with different window sizes still draw in the same relative place.
 */
export default function WhiteboardModal({
  token,
  target,
  onClose,
}: {
  token: string;
  target: WhiteboardTarget;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState('#e5484d');

  function drawSegment(x0: number, y0: number, x1: number, y1: number, strokeColor: string, width: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0 * canvas.width, y0 * canvas.height);
    ctx.lineTo(x1 * canvas.width, y1 * canvas.height);
    ctx.stroke();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const matchesTarget = (data: any) => {
      if (target.conferenceId) return data?.conference_id === target.conferenceId;
      if (target.groupId) return data?.group_id === target.groupId;
      return !data?.group_id && !data?.conference_id; // 1:1: any non-group/non-meeting stroke scoped to this conversation
    };
    const handler = (msg: WsMessage) => {
      if (msg.type === 'whiteboard_stroke') {
        const data = msg.data;
        if (!matchesTarget(data)) return;
        const s = data?.stroke as WhiteboardStroke | undefined;
        if (s) drawSegment(s.x0, s.y0, s.x1, s.y1, s.color, s.width);
      } else if (msg.type === 'whiteboard_clear') {
        const data = msg.data;
        if (!matchesTarget(data)) return;
        const canvas = canvasRef.current;
        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    presenceService.addListener(handler);
    return () => presenceService.removeListener(handler);
  }, [target.groupId, target.conferenceId]);

  function toNormalized(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = true;
    lastPointRef.current = toNormalized(e);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !lastPointRef.current) return;
    const p = toNormalized(e);
    const prev = lastPointRef.current;
    drawSegment(prev.x, prev.y, p.x, p.y, color, 3);
    const stroke: WhiteboardStroke = { x0: prev.x, y0: prev.y, x1: p.x, y1: p.y, color, width: 3 };
    sendWhiteboardStroke(token, target, stroke);
    lastPointRef.current = p;
  }

  function handlePointerUp() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function handleClear() {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    sendWhiteboardClear(token, target);
  }

  const colors = ['#e5484d', '#0ea5e9', '#22c55e', '#f59e0b', '#111827'];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-color)',
        borderRadius: 16,
        width: '86vw',
        height: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {colors.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                  border: color === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                }}
              />
            ))}
            <button
              onClick={handleClear}
              style={{
                marginLeft: 10, background: 'var(--input-field-bg)', border: '1px solid var(--border-color)',
                borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.78rem', padding: '5px 10px', cursor: 'pointer',
              }}
            >Clear</button>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1 }}
          >✕</button>
        </div>
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          style={{ flex: 1, background: '#fff', touchAction: 'none', cursor: 'crosshair' }}
        />
      </div>
    </div>
  );
}
