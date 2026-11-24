import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Board, BoardElement, BoardList, BoardOp, BoardSummary, ElementType, listBoards, getBoard, createGroupBoard,
  updateBoard, deleteBoard, sendBoardOps, favoriteBoard, sendBoardCursor, startAgent, errText,
} from '../services/workspace';
import { Group } from '../services/api';
import { presenceService, WsMessage } from '../services/presence';
import { CheckIcon, ExpandIcon, FitIcon, GlobeIcon, LockIcon, MenuIcon, MoreIcon, RedoIcon, ShrinkIcon, SparkleIcon, StarIcon, TaskIcon, TrashIcon, UndoIcon, UsersIcon, WhiteboardIcon } from './Icons';

/**
 * Whiteboard page: the organization board everyone sees, plus group boards.
 * Infinite dot-grid canvas (SVG), bottom toolbar, live sync over the websocket.
 */

type Tool = 'select' | 'hand' | 'task' | 'pen' | 'rect' | 'arrow' | 'sticky' | 'text' | 'frame' | 'image';
interface View { x: number; y: number; zoom: number }
interface Change { id: string; before: BoardElement | null; after: BoardElement | null }

const STICKY_COLORS = ['#FDE68A', '#FBCFE8', '#BFDBFE', '#BBF7D0', '#DDD6FE', '#FED7AA'];
const INK_COLORS = ['#f1f5f9', '#e5484d', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7'];
const SHORTCUTS: Record<string, Tool> = { v: 'select', h: 'hand', t: 'task', d: 'pen', r: 'rect', a: 'arrow', n: 'sticky', x: 'text', f: 'frame' };

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export default function WhiteboardPage({ token, groups }: { token: string; groups: Group[] }) {
  const [boards, setBoards] = useState<BoardList>({ org: null, groups: [], organization_id: 0, organizations: null });
  const [orgId, setOrgId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const reload = useCallback(() => {
    listBoards(token, orgId).then(b => {
      setBoards(b);
      const ids = [b.org?.id, ...b.groups.map(g => g.id)];
      setActiveId(prev => (prev && ids.includes(prev) ? prev : b.org?.id ?? b.groups[0]?.id ?? null));
    }).catch(e => setError(errText(e)));
  }, [token, orgId]);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const onMsg = (m: WsMessage) => {
      if (m.type === 'whiteboard_created' || m.type === 'whiteboard_deleted' || m.type === 'whiteboard_updated') reload();
    };
    presenceService.addListener(onMsg);
    return () => presenceService.removeListener(onMsg);
  }, [reload]);

  const byGroup = useMemo(() => {
    const m = new Map<string, BoardSummary[]>();
    for (const b of boards.groups) m.set(b.group_name || 'Group', [...(m.get(b.group_name || 'Group') || []), b]);
    return [...m.entries()];
  }, [boards.groups]);

  const row = (b: BoardSummary, label: string, sub?: string) => (
    <button key={b.id} onClick={() => setActiveId(b.id)} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
      padding: '9px 10px', borderRadius: 10, fontFamily: 'inherit',
      background: activeId === b.id ? 'var(--item-active-bg)' : 'transparent', color: 'var(--text-primary)',
    }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0,
        background: b.scope === 'org' ? 'var(--accent)' : '#f59e0b', color: '#fff' }}>{b.scope === 'org' ? <GlobeIcon size={14} /> : <WhiteboardIcon size={14} />}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: '0.84rem', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{sub}</span>}
      </span>
      {b.favorite && <StarIcon size={13} color="#f59e0b" filled />}
    </button>
  );

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-base)' }}>
      {!collapsed && (
        <div style={{ width: 250, flexShrink: 0, borderRight: '1px solid var(--border-color)', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '22px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>Whiteboards</h2>
            <button title="New group whiteboard" onClick={() => setShowNew(true)} style={{ border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 999, width: 28, height: 28, cursor: 'pointer', fontSize: 16 }}>+</button>
          </div>
          {boards.organizations && boards.organizations.length > 0 && (
            <div style={{ padding: '0 16px 8px' }}>
              <select aria-label="Organization" value={boards.organization_id} onChange={e => { setActiveId(null); setOrgId(Number(e.target.value)); }}
                style={{ width: '100%', border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-primary)', borderRadius: 10, padding: '8px 10px', fontSize: '0.8rem', fontFamily: 'inherit' }}>
                {boards.organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 16px' }}>
            {boards.org && (<>
              <div style={secLabel}>Organization</div>
              {row(boards.org, boards.org.title, 'Everyone in your organization')}
            </>)}
            {byGroup.map(([name, list]) => (
              <div key={name}>
                <div style={secLabel}>{name}</div>
                {list.map(b => row(b, b.title))}
              </div>
            ))}
            {boards.groups.length === 0 && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '10px 10px' }}>No group boards yet. Press + to make one for a group.</div>
            )}
          </div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {error && <div style={{ position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 5, background: '#ef4444', color: '#fff', padding: '8px 14px', borderRadius: 10, fontSize: '0.8rem' }} onClick={() => setError('')}>{error}</div>}
        {activeId ? (
          <BoardCanvas key={activeId} token={token} boardId={activeId} onError={setError}
            sidebarCollapsed={collapsed} onToggleSidebar={() => setCollapsed(c => !c)}
            onChanged={reload} onDeleted={() => { setActiveId(boards.org?.id ?? null); reload(); }} />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-muted)' }}>Loading whiteboards…</div>
        )}
      </div>
      {showNew && (
        <NewBoardDialog groups={groups} onClose={() => setShowNew(false)} onCreate={async (gid, title) => {
          try {
            const b = await createGroupBoard(token, gid, title);
            setShowNew(false); setActiveId(b.id); reload();
          } catch (e) { setError(errText(e)); }
        }} />
      )}
    </div>
  );
}

const secLabel: React.CSSProperties = { fontSize: '0.68rem', fontWeight: 750, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', padding: '14px 10px 6px' };

function NewBoardDialog({ groups, onClose, onCreate }: { groups: Group[]; onClose: () => void; onCreate: (gid: number, title: string) => void }) {
  const usable = groups.filter(g => (g.kind ?? 'group') !== 'channel' || true);
  const [gid, setGid] = useState<number | ''>(usable[0]?.id ?? '');
  const [title, setTitle] = useState('Whiteboard');
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border-color)', background: 'var(--bg-base)', color: 'var(--text-primary)', borderRadius: 10, padding: '10px 12px', fontSize: '0.86rem', fontFamily: 'inherit' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'grid', placeItems: 'center', zIndex: 900 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 380, background: 'var(--bg-panel)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--border-color)' }}>
        <div style={{ fontWeight: 750, fontSize: '1.05rem', color: 'var(--text-primary)' }}>New group whiteboard</div>
        {usable.length === 0 ? <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Join a group first.</div> : (<>
          <select value={gid} onChange={e => setGid(Number(e.target.value))} style={field}>
            {usable.map(g => <option key={g.id} value={g.id}>{g.kind === 'channel' ? '# ' : ''}{g.name}</option>)}
          </select>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Board name" style={field} />
        </>)}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={ghostBtn}>Cancel</button>
          <button disabled={!gid || !title.trim()} onClick={() => gid && onCreate(gid, title.trim())} style={{ ...ghostBtn, background: 'var(--accent)', color: '#fff', border: 'none' }}>Create</button>
        </div>
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = { border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', borderRadius: 9, padding: '8px 14px', fontSize: '0.82rem', fontWeight: 650, cursor: 'pointer', fontFamily: 'inherit' };

// ── Canvas ───────────────────────────────────────────────────────────────────

function BoardCanvas({ token, boardId, onError, onChanged, onDeleted, sidebarCollapsed, onToggleSidebar }: {
  token: string; boardId: number; onError: (s: string) => void; onChanged: () => void; onDeleted: () => void;
  sidebarCollapsed: boolean; onToggleSidebar: () => void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [els, setEls] = useState<Record<string, BoardElement>>({});
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ink, setInk] = useState(INK_COLORS[0]);
  const [stickyColor, setStickyColor] = useState(STICKY_COLORS[0]);
  const [draft, setDraft] = useState<BoardElement | null>(null);
  const [cursors, setCursors] = useState<Record<number, { name: string; x: number; y: number; at: number }>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const elsRef = useRef(els); elsRef.current = els;
  const versionRef = useRef(0);
  const drag = useRef<{ kind: 'pan' | 'move' | 'draw' | 'resize'; sx: number; sy: number; vx: number; vy: number; id?: string; orig?: BoardElement } | null>(null);
  const undoStack = useRef<Change[][]>([]);
  const redoStack = useRef<Change[][]>([]);
  const lastCursor = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const editText = useRef<{ id: string; text: string } | null>(null);

  const canEdit = !!board?.can_edit;

  useEffect(() => {
    getBoard(token, boardId).then(b => {
      setBoard(b);
      versionRef.current = b.version;
      setEls(Object.fromEntries(b.elements.map(e => [e.id, e])));
      if (b.viewport) setView(b.viewport);
    }).catch(e => onError(errText(e)));
  }, [token, boardId]);

  // Live updates from other people.
  useEffect(() => {
    const onMsg = (m: WsMessage) => {
      const d = (m.data ?? {}) as Record<string, unknown>;
      if (d.board_id !== boardId) return;
      if (m.type === 'whiteboard_ops') {
        versionRef.current = Number(d.version) || versionRef.current;
        const ops = (d.ops as BoardOp[]) || [];
        setEls(prev => {
          const next = { ...prev };
          for (const op of ops) {
            if (drag.current?.id === op.id) continue; // don't yank what I'm dragging
            if (op.op === 'delete') delete next[op.id];
            else next[op.id] = op.element as BoardElement;
          }
          return next;
        });
      } else if (m.type === 'whiteboard_cursor') {
        const id = Number(d.user_id);
        setCursors(prev => ({ ...prev, [id]: { name: String(d.name ?? ''), x: Number(d.x), y: Number(d.y), at: Date.now() } }));
      }
    };
    presenceService.addListener(onMsg);
    const sweep = setInterval(() => setCursors(prev => {
      const now = Date.now();
      const next = Object.fromEntries(Object.entries(prev).filter(([, c]) => now - c.at < 5000));
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    }), 2000);
    return () => { presenceService.removeListener(onMsg); clearInterval(sweep); };
  }, [boardId]);

  // Persist + broadcast a batch of changes; record for undo.
  const commit = useCallback((changes: Change[], record = true) => {
    if (!changes.length) return;
    setEls(prev => {
      const next = { ...prev };
      for (const c of changes) { if (c.after) next[c.id] = c.after; else delete next[c.id]; }
      return next;
    });
    if (record) { undoStack.current.push(changes); redoStack.current = []; }
    const ops: BoardOp[] = changes.map(c => c.after ? { op: 'upsert', id: c.id, element: c.after } : { op: 'delete', id: c.id });
    sendBoardOps(token, boardId, ops, versionRef.current)
      .then(r => { versionRef.current = r.version; })
      .catch(e => onError(errText(e)));
  }, [token, boardId, onError]);

  const upsert = (el: BoardElement) => commit([{ id: el.id, before: elsRef.current[el.id] ?? null, after: el }]);
  const remove = (id: string) => { const before = elsRef.current[id]; if (before) commit([{ id, before, after: null }]); };

  function undo() {
    const batch = undoStack.current.pop(); if (!batch) return;
    redoStack.current.push(batch);
    commit(batch.map(c => ({ id: c.id, before: c.after, after: c.before })), false);
  }
  function redo() {
    const batch = redoStack.current.pop(); if (!batch) return;
    undoStack.current.push(batch);
    commit(batch, false);
  }

  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom };
  };

  function zoomAt(factor: number, cx?: number, cy?: number) {
    const r = svgRef.current?.getBoundingClientRect();
    const px = cx ?? (r ? r.width / 2 : 0), py = cy ?? (r ? r.height / 2 : 0);
    setView(v => {
      const zoom = Math.min(4, Math.max(0.1, v.zoom * factor));
      return { zoom, x: px - (px - v.x) * (zoom / v.zoom), y: py - (py - v.y) * (zoom / v.zoom) };
    });
  }

  function fitAll() {
    const list = Object.values(elsRef.current);
    const r = svgRef.current?.getBoundingClientRect();
    if (!list.length || !r) { setView({ x: 0, y: 0, zoom: 1 }); return; }
    const b = list.map(bounds);
    const minX = Math.min(...b.map(q => q.x)), minY = Math.min(...b.map(q => q.y));
    const maxX = Math.max(...b.map(q => q.x + q.w)), maxY = Math.max(...b.map(q => q.y + q.h));
    const zoom = Math.min(2, Math.max(0.1, Math.min((r.width - 120) / (maxX - minX || 1), (r.height - 200) / (maxY - minY || 1))));
    setView({ zoom, x: r.width / 2 - ((minX + maxX) / 2) * zoom, y: r.height / 2 - ((minY + maxY) / 2) * zoom });
  }

  // Keyboard: tool shortcuts, delete, undo/redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (!canEdit) return; e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); if (canEdit) redo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && canEdit) { remove(selected); setSelected(null); return; }
      if (e.key === 'Escape') { setSelected(null); setTool('select'); finishEdit(); return; }
      if (!mod && SHORTCUTS[e.key.toLowerCase()]) setTool(SHORTCUTS[e.key.toLowerCase()]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, canEdit]);

  // Save the viewport a moment after the user stops moving.
  useEffect(() => {
    if (!canEdit) return;
    const t = setTimeout(() => updateBoard(token, boardId, { viewport: { ...view } }).catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, [view, canEdit]);

  function onWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      const r = svgRef.current!.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    } else {
      setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  }

  /** Save whatever is typed in the open text box, then close it. */
  function finishEdit() {
    const d = editText.current;
    editText.current = null;
    if (d) {
      const el = elsRef.current[d.id];
      if (el && (el.text ?? '') !== d.text) upsert({ ...el, text: d.text });
    }
    setEditingId(null);
  }
  function beginEdit(id: string) {
    finishEdit();
    editText.current = { id, text: elsRef.current[id]?.text ?? '' };
    setEditingId(id);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (editingId) finishEdit();
    const p = toWorld(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === 'hand' || e.button === 1 || !canEdit || tool === 'select') {
      setSelected(null);
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    // Stop the browser's mousedown focus change, or it steals focus from the
    // text box this click is about to open.
    e.preventDefault();
    const base = { id: uid(), x: p.x, y: p.y } as const;
    if (tool === 'sticky') { const el = { ...base, type: 'sticky' as ElementType, w: 200, h: 180, text: '', color: stickyColor }; upsert(el); setSelected(el.id); editText.current = { id: el.id, text: '' }; setEditingId(el.id); setTool('select'); return; }
    if (tool === 'text') { const el = { ...base, type: 'text' as ElementType, w: 240, h: 40, text: '', color: ink }; upsert(el); setSelected(el.id); editText.current = { id: el.id, text: '' }; setEditingId(el.id); setTool('select'); return; }
    if (tool === 'task') { const el = { ...base, type: 'task' as ElementType, w: 260, h: 72, text: '', done: false }; upsert(el); setSelected(el.id); editText.current = { id: el.id, text: '' }; setEditingId(el.id); setTool('select'); return; }
    if (tool === 'image') { fileRef.current?.setAttribute('data-x', String(p.x)); fileRef.current?.setAttribute('data-y', String(p.y)); fileRef.current?.click(); setTool('select'); return; }
    let d: BoardElement;
    if (tool === 'pen') d = { ...base, type: 'pen', points: [0, 0], stroke: ink };
    else if (tool === 'arrow') d = { ...base, type: 'arrow', x2: p.x, y2: p.y, stroke: ink };
    else if (tool === 'frame') d = { ...base, type: 'frame', w: 1, h: 1, text: 'Frame' };
    else d = { ...base, type: 'rect', w: 1, h: 1, stroke: ink, text: '' };
    setDraft(d);
    drag.current = { kind: 'draw', sx: p.x, sy: p.y, vx: 0, vy: 0 };
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = toWorld(e.clientX, e.clientY);
    const now = Date.now();
    if (now - lastCursor.current > 120) { lastCursor.current = now; sendBoardCursor(token, boardId, p.x, p.y).catch(() => {}); }
    const g = drag.current; if (!g) return;
    if (g.kind === 'pan') { setView(v => ({ ...v, x: g.vx + (e.clientX - g.sx), y: g.vy + (e.clientY - g.sy) })); return; }
    if (g.kind === 'move' && g.id && g.orig) {
      const dx = p.x - g.sx, dy = p.y - g.sy;
      const o = g.orig;
      const moved: BoardElement = { ...o, x: o.x + dx, y: o.y + dy, ...(o.type === 'arrow' ? { x2: (o.x2 ?? 0) + dx, y2: (o.y2 ?? 0) + dy } : {}) };
      setEls(prev => ({ ...prev, [g.id!]: moved }));
      return;
    }
    if (g.kind === 'resize' && g.id && g.orig) {
      const o = g.orig;
      setEls(prev => ({ ...prev, [g.id!]: { ...o, w: Math.max(40, (o.w ?? 0) + p.x - g.sx), h: Math.max(30, (o.h ?? 0) + p.y - g.sy) } }));
      return;
    }
    if (g.kind === 'draw' && draft) {
      if (draft.type === 'pen') setDraft({ ...draft, points: [...(draft.points ?? []), p.x - draft.x, p.y - draft.y] });
      else if (draft.type === 'arrow') setDraft({ ...draft, x2: p.x, y2: p.y });
      else setDraft({ ...draft, x: Math.min(g.sx, p.x), y: Math.min(g.sy, p.y), w: Math.abs(p.x - g.sx), h: Math.abs(p.y - g.sy) });
    }
  }

  function onPointerUp() {
    const g = drag.current; drag.current = null;
    if (!g) return;
    if ((g.kind === 'move' || g.kind === 'resize') && g.id && g.orig) {
      const after = elsRef.current[g.id];
      if (after && JSON.stringify(after) !== JSON.stringify(g.orig)) commit([{ id: g.id, before: g.orig, after }]);
      return;
    }
    if (g.kind === 'draw' && draft) {
      let el = draft;
      if ((el.type === 'rect' || el.type === 'frame') && (el.w ?? 0) < 8) el = { ...el, w: el.type === 'frame' ? 480 : 160, h: el.type === 'frame' ? 320 : 100 };
      if (el.type === 'pen' && (el.points?.length ?? 0) < 6) { setDraft(null); return; }
      upsert(el);
      setDraft(null);
      if (el.type !== 'pen') { setSelected(el.id); setTool('select'); }
    }
  }

  function startMove(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    if (tool !== 'select' && tool !== 'hand') return onPointerDown(e);
    setSelected(id);
    if (!canEdit || tool === 'hand') { drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; return; }
    const p = toWorld(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'move', sx: p.x, sy: p.y, vx: 0, vy: 0, id, orig: elsRef.current[id] };
  }
  function startResize(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    const p = toWorld(e.clientX, e.clientY);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'resize', sx: p.x, sy: p.y, vx: 0, vy: 0, id, orig: elsRef.current[id] };
  }

  async function onImagePicked(file: File) {
    const x = Number(fileRef.current?.getAttribute('data-x') || 0), y = Number(fileRef.current?.getAttribute('data-y') || 0);
    const url = await shrinkImage(file, 640);
    const img = await new Promise<HTMLImageElement>(res => { const i = new Image(); i.onload = () => res(i); i.src = url; });
    upsert({ id: uid(), type: 'image', x, y, w: img.width, h: img.height, src: url });
  }

  const list = Object.values(els).sort((a, b) => (a.type === 'frame' ? -1 : 0) - (b.type === 'frame' ? -1 : 0));
  const grid = 24 * view.zoom;
  const sel = selected ? els[selected] : null;
  const cursorStyle = tool === 'hand' ? (drag.current?.kind === 'pan' ? 'grabbing' : 'grab') : tool === 'select' ? 'default' : 'crosshair';

  return (
    <div ref={wrapRef} style={{
      position: fullscreen ? 'fixed' : 'relative', inset: fullscreen ? 0 : undefined, zIndex: fullscreen ? 800 : undefined,
      height: '100%', width: '100%', overflow: 'hidden', background: 'var(--wb-bg, #111214)',
    }}>
      <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block', cursor: cursorStyle, touchAction: 'none' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel}>
        <defs>
          <pattern id={`dots-${boardId}`} width={grid} height={grid} patternUnits="userSpaceOnUse" x={view.x % grid} y={view.y % grid}>
            <circle cx={1} cy={1} r={Math.max(0.6, view.zoom)} fill="rgba(255,255,255,0.13)" />
          </pattern>
          <marker id={`arrow-${boardId}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill={`url(#dots-${boardId})`} />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {list.map(el => (
            <ElementView key={el.id} el={el} boardId={boardId} selected={selected === el.id} editing={editingId === el.id}
              canEdit={canEdit}
              onPointerDown={e => startMove(e, el.id)}
              onDoubleClick={() => canEdit && ['sticky', 'text', 'task', 'rect', 'frame'].includes(el.type) && beginEdit(el.id)}
              onText={text => { editText.current = { id: el.id, text }; }}
              onDone={finishEdit}
              onToggle={() => canEdit && upsert({ ...el, done: !el.done })}
              onResize={e => startResize(e, el.id)} />
          ))}
          {draft && <ElementView el={draft} boardId={boardId} selected={false} editing={false} canEdit={false}
            onPointerDown={() => {}} onDoubleClick={() => {}} onText={() => {}} onDone={() => {}} onToggle={() => {}} onResize={() => {}} />}
          {Object.entries(cursors).map(([id, c]) => (
            <g key={id} transform={`translate(${c.x} ${c.y}) scale(${1 / view.zoom})`} pointerEvents="none">
              <path d="M0 0 L0 16 L4.5 12 L8 19 L10.5 18 L7 11 L13 11 Z" fill="#3b82f6" stroke="#fff" strokeWidth={1} />
              <text x={14} y={24} fontSize={11} fill="#fff" style={{ paintOrder: 'stroke', stroke: '#3b82f6', strokeWidth: 4 }}>{c.name}</text>
            </g>
          ))}
        </g>
      </svg>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onImagePicked(f); e.target.value = ''; }} />

      {/* Header: title chip (left), share/actions (right) */}
      <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', gap: 8 }}>
        <button title={sidebarCollapsed ? 'Show boards' : 'Hide boards'} onClick={onToggleSidebar} style={chip}><MenuIcon /></button>
        <div style={{ ...chip, gap: 10, padding: '0 12px' }}>
          <span style={{ width: 20, height: 20, borderRadius: 6, background: '#f59e0b', display: 'grid', placeItems: 'center', color: '#111' }}><WhiteboardIcon size={12} /></span>
          <span style={{ fontWeight: 650 }}>{board?.title ?? 'Whiteboard'}</span>
          {board && (
            <button title={board.favorite ? 'Unfavourite' : 'Favourite'} onClick={() => {
              const fav = !board.favorite; setBoard({ ...board, favorite: fav }); favoriteBoard(token, board.id, fav).then(onChanged).catch(() => {});
            }} style={{ border: 'none', background: 'transparent', color: board.favorite ? '#f59e0b' : '#a1a1aa', cursor: 'pointer', padding: 0, display: 'grid' }}><StarIcon filled={board.favorite} /></button>
          )}
          {board?.locked && <span title="Locked: only admins can edit" style={{ display: 'grid' }}><LockIcon size={13} color="#a1a1aa" /></span>}
          {!canEdit && board && <span style={{ fontSize: '0.7rem', color: '#a1a1aa' }}>View only</span>}
        </div>
      </div>
      <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ ...chip, padding: '0 12px', gap: 6 }}>
          {board?.scope === 'org' ? <GlobeIcon size={14} /> : <UsersIcon size={14} />}
          <span style={{ fontSize: '0.78rem' }}>{board?.scope === 'org' ? 'Organization' : 'Group'} · {Object.keys(cursors).length + 1} here</span>
        </div>
        <div style={{ position: 'relative' }}>
          <button style={chip} onClick={() => setMenuOpen(o => !o)} title="More"><MoreIcon /></button>
          {menuOpen && board && (
            <div style={{ position: 'absolute', right: 0, top: 40, background: '#1c1d21', border: '1px solid #2a2b30', borderRadius: 12, padding: 6, width: 200, zIndex: 10 }}>
              <MenuItem label="Rename" onClick={() => { const t = window.prompt('Board name', board.title); setMenuOpen(false); if (t?.trim()) updateBoard(token, board.id, { title: t.trim() }).then(s => { setBoard({ ...board, title: s.title }); onChanged(); }).catch(e => onError(errText(e))); }} />
              <MenuItem label={board.locked ? 'Unlock editing' : 'Lock editing'} onClick={() => { setMenuOpen(false); updateBoard(token, board.id, { locked: !board.locked }).then(s => setBoard({ ...board, locked: s.locked })).catch(e => onError(errText(e))); }} />
              <MenuItem label="Zoom to fit" onClick={() => { setMenuOpen(false); fitAll(); }} />
              {board.scope === 'group' && <MenuItem danger label="Delete board" onClick={() => { setMenuOpen(false); if (window.confirm(`Delete "${board.title}" for everyone? This cannot be undone.`)) deleteBoard(token, board.id).then(onDeleted).catch(e => onError(errText(e))); }} />}
            </div>
          )}
        </div>
        <button style={chip} title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => setFullscreen(f => !f)}>{fullscreen ? <ShrinkIcon /> : <ExpandIcon />}</button>
      </div>

      {/* Zoom (bottom-left) */}
      <div style={{ position: 'absolute', left: 14, bottom: 14, ...chip, padding: 0, gap: 0 }}>
        <button style={zoomBtn} title="Zoom to fit" onClick={fitAll}><FitIcon /></button>
        <button style={zoomBtn} title="Zoom out" onClick={() => zoomAt(1 / 1.2)}>−</button>
        <button style={{ ...zoomBtn, width: 56, fontSize: '0.8rem' }} title="Reset to 100%" onClick={() => zoomAt(1 / view.zoom)}>{Math.round(view.zoom * 100)}%</button>
        <button style={zoomBtn} title="Zoom in" onClick={() => zoomAt(1.2)}>+</button>
      </div>

      {/* Selection quick bar */}
      {sel && canEdit && !editingId && (
        <div style={{ position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)', ...chip, gap: 6, padding: '0 8px' }}>
          {sel.type === 'sticky' && STICKY_COLORS.map(c => <Swatch key={c} c={c} active={sel.color === c} onClick={() => upsert({ ...sel, color: c })} />)}
          {['pen', 'arrow', 'rect', 'text'].includes(sel.type) && INK_COLORS.map(c => <Swatch key={c} c={c} active={(sel.stroke ?? sel.color) === c} onClick={() => upsert({ ...sel, ...(sel.type === 'text' ? { color: c } : { stroke: c }) })} />)}
          <button style={{ ...zoomBtn, color: '#f87171' }} title="Delete (⌫)" onClick={() => { remove(sel.id); setSelected(null); }}><TrashIcon /></button>
        </div>
      )}

      {/* Bottom toolbar */}
      {canEdit && (
        <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'flex-end', gap: 2,
          background: '#1c1d21', border: '1px solid #2a2b30', borderRadius: 16, padding: '6px 8px', boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}>
          <ToolBtn k="V" label="Select" active={tool === 'select'} onClick={() => setTool('select')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M5 3l14 8-6 2-2 6z" /></svg>
          </ToolBtn>
          <ToolBtn k="H" label="Hand" active={tool === 'hand'} onClick={() => setTool('hand')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0" /></svg>
          </ToolBtn>
          <Sep />
          <ToolBtn k="T" label="Task" active={tool === 'task'} onClick={() => setTool('task')} wide>
            <div style={{ width: 70, height: 34, borderRadius: 7, background: '#2a2b30', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 6px', gap: 4 }}>
              <span style={{ fontSize: 10, color: '#d4d4d8', display: 'flex', alignItems: 'center', gap: 4 }}><TaskIcon size={10} /> Task</span>
              <span style={{ display: 'flex', gap: 3 }}><i style={{ flex: 1, height: 3, background: '#71717a', borderRadius: 2 }} /><i style={{ flex: 1, height: 3, background: '#3b82f6', borderRadius: 2 }} /></span>
            </div>
          </ToolBtn>
          <ToolBtn k="D" label="Draw" active={tool === 'pen'} onClick={() => setTool('pen')}>
            <svg width="22" height="26" viewBox="0 0 24 28"><path d="M8 26 L12 4 L16 26 Z" fill="#e4e4e7" /><path d="M10.6 11 L12 4 L13.4 11 Z" fill={ink} /></svg>
          </ToolBtn>
          <ToolBtn k="R" label="Shape" active={tool === 'rect'} onClick={() => setTool('rect')}>
            <div style={{ width: 34, height: 26, borderRadius: 4, background: '#f4f4f5' }} />
          </ToolBtn>
          <ToolBtn k="A" label="Arrow" active={tool === 'arrow'} onClick={() => setTool('arrow')}>
            <svg width="22" height="26" viewBox="0 0 24 28" fill="none" stroke="#e4e4e7" strokeWidth="2" strokeLinecap="round"><path d="M12 26V3M5 10l7-7 7 7" /></svg>
          </ToolBtn>
          <ToolBtn k="N" label="Sticky note" active={tool === 'sticky'} onClick={() => setTool('sticky')}>
            <div style={{ width: 32, height: 28, background: stickyColor, borderRadius: '2px 2px 10px 2px' }} />
          </ToolBtn>
          <ToolBtn k="X" label="Text" active={tool === 'text'} onClick={() => setTool('text')}>
            <div style={{ width: 30, height: 28, borderRadius: 5, background: '#f4f4f5', color: '#111', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 18 }}>T</div>
          </ToolBtn>
          <ToolBtn k="F" label="Frame" active={tool === 'frame'} onClick={() => setTool('frame')}>
            <div style={{ width: 34, height: 26, borderRadius: 4, border: '2px solid #52525b', position: 'relative' }}><i style={{ position: 'absolute', top: -7, left: 2, width: 12, height: 4, background: '#71717a', borderRadius: 2 }} /></div>
          </ToolBtn>
          <ToolBtn k="" label="Image" active={tool === 'image'} onClick={() => setTool('image')}>
            <div style={{ width: 34, height: 26, borderRadius: 4, background: 'linear-gradient(160deg,#fcd34d 0%,#fb923c 45%,#60a5fa 46%,#93c5fd 100%)' }} />
          </ToolBtn>
          <ToolBtn k="" label="Ask Dilarion AI" active={aiOpen} onClick={() => setAiOpen(o => !o)}>
            <div style={{ width: 32, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'grid', placeItems: 'center', color: '#fff' }}><SparkleIcon size={15} /></div>
          </ToolBtn>
          <Sep />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 2 }}>
            <button title="Undo (⌘Z)" onClick={undo} style={undoBtn}><UndoIcon /></button>
            <button title="Redo (⇧⌘Z)" onClick={redo} style={undoBtn}><RedoIcon /></button>
          </div>
        </div>
      )}

      {/* Ink colour for pen/arrow/shape */}
      {canEdit && ['pen', 'arrow', 'rect', 'text'].includes(tool) && (
        <div style={{ position: 'absolute', bottom: 92, left: '50%', transform: 'translateX(-50%)', ...chip, gap: 6, padding: '0 8px' }}>
          {INK_COLORS.map(c => <Swatch key={c} c={c} active={ink === c} onClick={() => setInk(c)} />)}
        </div>
      )}
      {canEdit && tool === 'sticky' && (
        <div style={{ position: 'absolute', bottom: 92, left: '50%', transform: 'translateX(-50%)', ...chip, gap: 6, padding: '0 8px' }}>
          {STICKY_COLORS.map(c => <Swatch key={c} c={c} active={stickyColor === c} onClick={() => setStickyColor(c)} />)}
        </div>
      )}

      {aiOpen && board && <BoardAiPrompt token={token} board={board} onClose={() => setAiOpen(false)} onError={onError} />}
    </div>
  );
}

function BoardAiPrompt({ token, board, onClose, onError }: { token: string; board: Board; onClose: () => void; onError: (s: string) => void }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const target = board.scope === 'org' ? 'the org whiteboard' : `the "${board.group_name ?? board.title}" group whiteboard`;
  return (
    <div style={{ position: 'absolute', bottom: 96, left: '50%', transform: 'translateX(-50%)', width: 420, background: '#1c1d21', border: '1px solid #2a2b30', borderRadius: 14, padding: 14, color: '#e4e4e7', zIndex: 6 }}>
      <div style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><SparkleIcon size={14} color="var(--accent)" /> Ask Dilarion AI</div>
      {sent ? (
        <div style={{ fontSize: '0.84rem', color: '#a1a1aa' }}>Agent sent. Review and approve its plan on the AI page; the notes land here once it runs.
          <div style={{ marginTop: 10 }}><button style={{ ...ghostBtn, color: '#e4e4e7' }} onClick={onClose}>Close</button></div></div>
      ) : (<>
        <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="e.g. Add sticky notes for each step of our Q1 launch plan"
          style={{ width: '100%', boxSizing: 'border-box', background: '#111214', color: '#e4e4e7', border: '1px solid #2a2b30', borderRadius: 10, padding: 10, fontFamily: 'inherit', fontSize: '0.85rem', resize: 'none' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button style={{ ...ghostBtn, color: '#a1a1aa' }} onClick={onClose}>Cancel</button>
          <button disabled={!text.trim()} style={{ ...ghostBtn, background: 'var(--accent)', color: '#fff', border: 'none' }} onClick={() => {
            startAgent(token, `${text.trim()}. Put the results as notes on ${target}.`, true).then(() => setSent(true)).catch(e => onError(errText(e)));
          }}>Send agent</button>
        </div>
      </>)}
    </div>
  );
}

// ── Element rendering ────────────────────────────────────────────────────────

function ElementView({ el, boardId, selected, editing, canEdit, onPointerDown, onDoubleClick, onText, onDone, onToggle, onResize }: {
  el: BoardElement; boardId: number; selected: boolean; editing: boolean; canEdit: boolean;
  onPointerDown: (e: React.PointerEvent) => void; onDoubleClick: () => void; onText: (t: string) => void; onDone: () => void;
  onToggle: () => void; onResize: (e: React.PointerEvent) => void;
}) {
  const w = el.w ?? 0, h = el.h ?? 0;
  const ring = selected ? <rect x={el.x - 4} y={el.y - 4} width={w + 8} height={h + 8} rx={8} fill="none" stroke="#3b82f6" strokeWidth={2} pointerEvents="none" /> : null;
  const handle = selected && canEdit && w > 0 ? (
    <rect x={el.x + w - 5} y={el.y + h - 5} width={10} height={10} rx={2} fill="#fff" stroke="#3b82f6" strokeWidth={1.5}
      style={{ cursor: 'nwse-resize' }} onPointerDown={onResize} />
  ) : null;
  const common = { onPointerDown, onDoubleClick, style: { cursor: canEdit ? 'move' : 'default' } as React.CSSProperties };

  const textBox = (color: string, size: number, align: 'left' | 'center' = 'left', weight = 500, placeholder = 'Type something') => (
    <foreignObject x={el.x} y={el.y} width={w} height={h} {...common}>
      {editing ? (
        <textarea autoFocus defaultValue={el.text ?? ''} onChange={e => onText(e.target.value)} onBlur={onDone} onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }}
          style={{ width: '100%', height: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', outline: 'none', resize: 'none',
            color, fontSize: size, fontWeight: weight, fontFamily: 'inherit', padding: 12, textAlign: align }} />
      ) : (
        <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', padding: 12, color, fontSize: size, fontWeight: weight, whiteSpace: 'pre-wrap',
          overflow: 'hidden', textAlign: align, display: 'flex', alignItems: align === 'center' ? 'center' : 'flex-start', justifyContent: align === 'center' ? 'center' : 'flex-start', userSelect: 'none' }}>
          {el.text || <span style={{ opacity: 0.45 }}>{placeholder}</span>}
        </div>
      )}
    </foreignObject>
  );

  switch (el.type) {
    case 'sticky':
      return <g>
        <rect x={el.x} y={el.y} width={w} height={h} rx={4} fill={el.color || STICKY_COLORS[0]} style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.35))' }} />
        {textBox('#1f2937', 16)}{ring}{handle}
      </g>;
    case 'text':
      return <g>{textBox(el.color || '#f1f5f9', 20, 'left', 600, 'Text')}{ring}{handle}</g>;
    case 'rect':
    case 'ellipse':
    case 'diamond':
      return <g>
        <rect x={el.x} y={el.y} width={w} height={h} rx={el.type === 'ellipse' ? Math.min(w, h) / 2 : 10} fill="rgba(255,255,255,0.04)" stroke={el.stroke || '#f1f5f9'} strokeWidth={2} {...common} />
        {(el.text || editing) ? textBox(el.stroke || '#f1f5f9', 15, 'center', 600, '') : null}{ring}{handle}
      </g>;
    case 'frame':
      return <g>
        <text x={el.x} y={el.y - 8} fontSize={13} fill="#a1a1aa" {...common} style={{ ...common.style, userSelect: 'none' }}>{el.text || 'Frame'}</text>
        <rect x={el.x} y={el.y} width={w} height={h} rx={10} fill="rgba(255,255,255,0.025)" stroke="#3f3f46" strokeWidth={1.5} {...common} />
        {editing && <foreignObject x={el.x} y={el.y - 30} width={Math.max(160, w)} height={26}>
          <input autoFocus defaultValue={el.text ?? ''} onChange={e => onText(e.target.value)} onBlur={onDone} onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
            style={{ width: '100%', background: '#1c1d21', color: '#e4e4e7', border: '1px solid #3b82f6', borderRadius: 6, fontSize: 13, padding: '2px 6px' }} />
        </foreignObject>}
        {ring}{handle}
      </g>;
    case 'task':
      return <g>
        <rect x={el.x} y={el.y} width={w} height={h} rx={10} fill="#1f2025" stroke="#33343a" {...common} />
        <foreignObject x={el.x} y={el.y} width={w} height={h} {...common}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, height: '100%', boxSizing: 'border-box' }}>
            <button onPointerDown={e => e.stopPropagation()} onClick={onToggle} style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 2, cursor: 'pointer',
              border: `2px solid ${el.done ? '#22c55e' : '#71717a'}`, background: el.done ? '#22c55e' : 'transparent', color: '#fff', padding: 0, display: 'grid', placeItems: 'center' }}>{el.done && <CheckIcon size={10} />}</button>
            {editing ? (
              <textarea autoFocus defaultValue={el.text ?? ''} onChange={e => onText(e.target.value)} onBlur={onDone} onPointerDown={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }}
                style={{ flex: 1, height: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none', color: '#e4e4e7', fontSize: 14, fontFamily: 'inherit' }} />
            ) : (
              <div style={{ flex: 1, color: el.done ? '#71717a' : '#e4e4e7', fontSize: 14, textDecoration: el.done ? 'line-through' : 'none', userSelect: 'none', whiteSpace: 'pre-wrap', overflow: 'hidden' }}>
                {el.text || <span style={{ opacity: 0.45 }}>Task name</span>}
              </div>
            )}
          </div>
        </foreignObject>
        {ring}{handle}
      </g>;
    case 'pen': {
      const pts = el.points ?? [];
      let d = '';
      for (let i = 0; i < pts.length; i += 2) d += `${i ? 'L' : 'M'}${el.x + pts[i]} ${el.y + pts[i + 1]} `;
      return <g>
        <path d={d} fill="none" stroke="transparent" strokeWidth={14} {...common} />
        <path d={d} fill="none" stroke={el.stroke || '#f1f5f9'} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
        {selected && <path d={d} fill="none" stroke="#3b82f6" strokeWidth={1} strokeDasharray="4 4" pointerEvents="none" />}
      </g>;
    }
    case 'arrow':
    case 'line':
    case 'connector':
      return <g>
        <line x1={el.x} y1={el.y} x2={el.x2 ?? el.x} y2={el.y2 ?? el.y} stroke="transparent" strokeWidth={14} {...common} />
        <line x1={el.x} y1={el.y} x2={el.x2 ?? el.x} y2={el.y2 ?? el.y} stroke={selected ? '#3b82f6' : el.stroke || '#f1f5f9'} strokeWidth={2.5}
          markerEnd={el.type === 'line' ? undefined : `url(#arrow-${boardId})`} pointerEvents="none" />
      </g>;
    case 'image':
      return <g>
        <image href={String(el.src ?? '')} x={el.x} y={el.y} width={w} height={h} preserveAspectRatio="xMidYMid meet" {...common} />
        {ring}{handle}
      </g>;
    default:
      return null;
  }
}

function bounds(el: BoardElement) {
  if (el.type === 'arrow' || el.type === 'line' || el.type === 'connector') {
    const x = Math.min(el.x, el.x2 ?? el.x), y = Math.min(el.y, el.y2 ?? el.y);
    return { x, y, w: Math.abs((el.x2 ?? el.x) - el.x), h: Math.abs((el.y2 ?? el.y) - el.y) };
  }
  if (el.type === 'pen') {
    const p = el.points ?? [0, 0];
    const xs = p.filter((_, i) => i % 2 === 0), ys = p.filter((_, i) => i % 2 === 1);
    return { x: el.x + Math.min(...xs), y: el.y + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: el.x, y: el.y, w: el.w ?? 0, h: el.h ?? 0 };
}

async function shrinkImage(file: File, max: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } finally { URL.revokeObjectURL(url); }
}

// ── Small chrome pieces ──────────────────────────────────────────────────────

const chip: React.CSSProperties = {
  height: 36, minWidth: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
  background: '#1c1d21', border: '1px solid #2a2b30', borderRadius: 10, color: '#e4e4e7', fontSize: '0.86rem', cursor: 'pointer', fontFamily: 'inherit',
};
const zoomBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: '#d4d4d8', width: 36, height: 34, cursor: 'pointer', fontSize: 16, fontFamily: 'inherit' };
const undoBtn: React.CSSProperties = { border: 'none', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 15, padding: '2px 6px', lineHeight: 1 };

function ToolBtn({ k, label, active, onClick, children, wide }: { k: string; label: string; active: boolean; onClick: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <button title={k ? `${label} (${k})` : label} onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
      background: active ? '#2f3036' : 'transparent', borderRadius: 10, padding: '4px 7px 6px', minWidth: wide ? 84 : 46, color: '#e4e4e7',
    }}>
      <span style={{ fontSize: 10, color: '#71717a', height: 12 }}>{k}</span>
      <span style={{ height: 34, display: 'grid', placeItems: 'center' }}>{children}</span>
    </button>
  );
}
function Sep() { return <span style={{ width: 1, alignSelf: 'stretch', background: '#2a2b30', margin: '6px 4px' }} />; }
function Swatch({ c, active, onClick }: { c: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} title={c} style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: active ? '2px solid #3b82f6' : '2px solid #3f3f46', padding: 0 }} />;
}
function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: danger ? '#f87171' : '#e4e4e7', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'inherit' }}>{label}</button>;
}
