import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emitTo, listen } from '@tauri-apps/api/event';
import { browserDeviceName, isTauri } from './platform';
import { notifySessionInvalid } from './session';
import { apiFetch } from './apiTransport';

const WS_BASE = (import.meta.env.VITE_WS_BASE as string | undefined) || 'wss://apidilarion.eibstratoc.com/ws';
const API_BASE = import.meta.env.VITE_API_BASE || 'https://apidilarion.eibstratoc.com';

// The call window never opens its own WebSocket — a second connection under
// the same device_id would fight the main window's for the "current"
// connection on the backend. Instead the main window forwards just the
// message types the call UI needs (see bottom of this file for both halves
// of the bridge) over a Tauri cross-window event.
export const CALL_RELEVANT_WS_TYPES = new Set([
  'call_status_update', 'ice_candidate', 'call_media_state', 'call_end',
  'conference_upgraded',
  'conference_invite', 'conference_peer_connect', 'conference_signal',
  'conference_participant_left', 'conference_ended', 'conference_invite_cancelled', 'conference_force_mute', 'auth_expired',
]);
const WS_FORWARD_EVENT = 'dilarion://ws-forward';
// Emitted by the call window to the main window once its forward bridge is
// listening, so the main window can replay call events (ICE etc.) that arrived
// while the call window was still opening.
const CALL_WINDOW_READY = 'dilarion://call-window-ready';
// Recent call-relevant WS events, kept in the main window to replay to a call
// window that opens mid-call (incoming calls, where the window appears only
// after the user accepts).
let callEventBuffer: WsMessage[] = [];

export type WsMessage = {
  type: string;
  data?: Record<string, any>;
};

type Listener = (msg: WsMessage) => void;

// ── Persistent device identity ─────────────────────────────────────────────────

function getOrCreateDeviceId(): string {
  const KEY = 'dilarion_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

async function getDeviceMetadata(): Promise<{ name: string; platform: string }> {
  if (!isTauri()) return { name: browserDeviceName(), platform: 'web' };
  try {
    const info = await invoke<{ hostname: string; os: string }>('get_device_info');
    const os = info.os.toLowerCase();
    const platform = os.includes('windows') ? 'windows'
      : os.includes('mac') || os.includes('darwin') ? 'macos'
      : os.includes('linux') ? 'linux' : 'desktop';
    return { name: info.hostname || 'Desktop', platform };
  } catch {
    return { name: 'Desktop', platform: 'desktop' };
  }
}

// ── PresenceService ────────────────────────────────────────────────────────────

class PresenceService {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private listeners: Listener[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private deviceId: string = getOrCreateDeviceId();
  private deviceName: string = 'Desktop';
  private platform: string = 'desktop';
  private failures = 0;          // consecutive failed attempts (backoff)
  private stopped = false;       // true once we give up (auth dead)
  private opening = false;

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Reconnect straight away (network back, window focused) instead of waiting out the backoff. */
  private nudge = () => {
    if (!this.token || this.stopped || this.isConnected || this.opening) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    this.failures = 0;
    this._open();
  };
  private nudgeListening = false;

  connect(token: string) {
    if (!this.nudgeListening && typeof window !== 'undefined') {
      this.nudgeListening = true;
      window.addEventListener('online', this.nudge);
      window.addEventListener('focus', this.nudge);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.nudge(); });
    }
    this.token = token;
    this.stopped = false;
    this.failures = 0;
    // Main window only: replay buffered call events to a call window that opens
    // mid-call (answered incoming calls). The call window never calls connect().
    if (isTauri() && !isCallWindow()) startCallEventReplayBridge();
    getDeviceMetadata().then(metadata => {
      this.deviceName = metadata.name;
      this.platform = metadata.platform;
      this._open();
    });
  }

  private async _open() {
    if (!this.token || this.stopped || this.opening) return;
    // One socket at a time. A stale OPEN/CONNECTING socket left behind is what
    // caused the connect/disconnect churn on the server.
    if (this.ws && (this.ws.readyState === WebSocket.OPEN ||
                    this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this._cleanup();

    this.opening = true;
    const sessionToken = this.token;
    let ticket: string;
    try {
      const response = await apiFetch(`${API_BASE}/auth/ws-ticket`, {
        method: 'POST', headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (response.status === 401 || response.status === 403) {
        this.stopped = true;
        this.token = null;
        notifySessionInvalid('Your session expired. Please sign in again.');
        return;
      }
      if (!response.ok) throw new Error(`Ticket request failed: ${response.status}`);
      ticket = (await response.json()).ticket;
      if (!ticket) throw new Error('Missing WebSocket ticket');
    } catch {
      if (!this.stopped && this.token === sessionToken) {
        this.failures += 1;
        const delay = Math.min(30_000, 3_000 * 2 ** Math.min(this.failures, 4));
        this.reconnectTimer = setTimeout(() => this._open(), delay);
      }
      return;
    } finally {
      this.opening = false;
    }
    if (this.stopped || this.token !== sessionToken) return;
    const params = new URLSearchParams({
      ticket,
      device_id: this.deviceId,
      device_type: isTauri() ? 'desktop' : 'web',
      device_name: this.deviceName,
      platform: this.platform,
    });
    this.ws = new WebSocket(`${WS_BASE}?${params.toString()}`);

    this.ws.onopen = () => {
      console.log('[WS] connected');
      this.failures = 0;
      this.pingTimer = setInterval(() => {
        if (this.isConnected) this.ws!.send(JSON.stringify({ type: 'ping' }));
      }, 25_000);
    };

    this.ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        this.listeners.forEach(l => l(msg));
        if (isTauri() && CALL_RELEVANT_WS_TYPES.has(msg.type)) {
          // Buffer call events as well as forwarding them. For an INCOMING call
          // the call window doesn't exist yet while it's still ringing, so the
          // caller's early ICE candidates (sent right after they dialed) would
          // otherwise be emitted to a nonexistent window and lost — leaving the
          // answerer's ICE incomplete and the call stuck "connecting". When the
          // call window opens it asks for a replay (see the ready handler) and
          // we flush this buffer to it. CallModal filters by call_id, so any
          // stale entries from a previous call are harmless.
          callEventBuffer.push(msg);
          if (callEventBuffer.length > 150) callEventBuffer.shift();
          if (msg.type === 'call_end') callEventBuffer = [];
          // Best-effort live forward — if no call window is open this just
          // fails silently (emitTo throws when the target label doesn't exist).
          emitTo('call', WS_FORWARD_EVENT, msg).catch(() => {});
        }
      } catch {}
    };

    this.ws.onclose = (event) => {
      this._cleanup();
      this.ws = null;

      if (event.code === 4001 && (event.reason === 'session_replaced' || event.reason === 'session_expired')) {
        this.stopped = true;
        this.token = null;
        notifySessionInvalid(event.reason === 'session_replaced'
          ? 'This session was replaced by a newer sign-in. Please sign in again.'
          : 'Your session expired. Please sign in again.');
        return;
      }

      // A close before the socket opened is NOT an auth failure: the ticket
      // request just succeeded, so the session is valid. It is a server restart
      // or a network drop. Giving up here after a few tries left desktop with
      // no live messages or typing until the app was reopened. A dead session
      // is caught by the ticket request (401/403) above instead.

      this.failures += 1;
      const delay = Math.min(30_000, 3_000 * 2 ** Math.min(this.failures, 4)); // 3s→30s
      console.log(`[WS] closed — reconnecting in ${delay / 1000}s`);
      this.reconnectTimer = setTimeout(() => this._open(), delay);
    };

    this.ws.onerror = () => {
      try { this.ws?.close(); } catch {}
    };
  }

  private _cleanup() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  addListener(fn: Listener) { this.listeners.push(fn); }
  removeListener(fn: Listener) { this.listeners = this.listeners.filter(l => l !== fn); }

  /** Used only by the call window's forward bridge — see startCallWindowForwardBridge below. */
  injectMessage(msg: WsMessage) { this.listeners.forEach(l => l(msg)); }

  send(payload: object) {
    if (this.isConnected) this.ws!.send(JSON.stringify(payload));
  }

  disconnect() {
    this.stopped = true;
    this._cleanup();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { this.ws?.close(1000, 'logout'); } catch {}
    this.ws = null;
    this.token = null;
  }
}

export const presenceService = new PresenceService();

/**
 * Called once by the call window's bootstrap (never the main window) instead
 * of presenceService.connect() — feeds forwarded messages into the exact
 * same listener list any CallModal instance already reads from, so nothing
 * inside CallModal.tsx has to know it's running in a second window.
 */
export function startCallWindowForwardBridge(): () => void {
  let unlisten: (() => void) | null = null;
  listen<WsMessage>(WS_FORWARD_EVENT, (event) => {
    presenceService.injectMessage(event.payload);
  }).then(fn => {
    unlisten = fn;
    callBridgeListening = true;
    // Replay only once CallModal has subscribed. Asking here used to race
    // the window's first render: the candidates arrived, nobody was listening,
    // and the answerer never learned the caller's ICE.
    flushCallReplayRequest();
  });
  return () => { unlisten?.(); callBridgeListening = false; };
}

/** CallModal calls this after its signaling listener is registered, so the
 *  replayed candidates are filtered against a call id that is already set. */
export function requestCallEventReplay() {
  if (!isCallWindow()) return;
  callReplayRequested = true;
  flushCallReplayRequest();
}

function flushCallReplayRequest() {
  if (!callBridgeListening || !callReplayRequested) return;
  callReplayRequested = false;
  emitTo('main', CALL_WINDOW_READY, {}).catch(() => {});
}

let callBridgeListening = false;
let callReplayRequested = false;

/** Main-window side: when a call window signals it's ready, replay the buffered
 *  call events to it. Registered once from the main window (see connect()). */
let callReadyBridgeStarted = false;
function startCallEventReplayBridge(): void {
  if (callReadyBridgeStarted) return;
  callReadyBridgeStarted = true;
  listen(CALL_WINDOW_READY, () => {
    for (const m of callEventBuffer) emitTo('call', WS_FORWARD_EVENT, m).catch(() => {});
  }).catch(() => {});
}

/** True when running as the standalone call window, not the main app window. */
export function isCallWindow(): boolean {
  if (!isTauri()) return false;
  try {
    return getCurrentWindow().label === 'call';
  } catch {
    return false;
  }
}
