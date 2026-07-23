import { invoke } from '@tauri-apps/api/core';

const WS_BASE = 'wss://apidilarion.eibstratoc.com/ws';

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

async function getDeviceName(): Promise<string> {
  try {
    const info = await invoke<{ hostname: string }>('get_device_info');
    return info.hostname || 'Desktop';
  } catch {
    return 'Desktop';
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
  private failures = 0;          // consecutive failed attempts (backoff)
  private openedThisAttempt = false;
  private authFailures = 0;      // closes that never opened → likely bad token
  private stopped = false;       // true once we give up (auth dead)

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(token: string) {
    this.token = token;
    this.stopped = false;
    this.failures = 0;
    this.authFailures = 0;
    getDeviceName().then(name => {
      this.deviceName = name;
      this._open();
    });
  }

  private _open() {
    if (!this.token || this.stopped) return;
    // One socket at a time. A stale OPEN/CONNECTING socket left behind is what
    // caused the connect/disconnect churn on the server.
    if (this.ws && (this.ws.readyState === WebSocket.OPEN ||
                    this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this._cleanup();

    this.openedThisAttempt = false;
    const params = new URLSearchParams({
      token: this.token,
      device_id: this.deviceId,
      device_type: 'desktop',
      device_name: this.deviceName,
    });
    this.ws = new WebSocket(`${WS_BASE}?${params.toString()}`);

    this.ws.onopen = () => {
      console.log('[WS] connected');
      this.openedThisAttempt = true;
      this.failures = 0;
      this.authFailures = 0;
      this.pingTimer = setInterval(() => {
        if (this.isConnected) this.ws!.send(JSON.stringify({ type: 'ping' }));
      }, 25_000);
    };

    this.ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        this.listeners.forEach(l => l(msg));
      } catch {}
    };

    this.ws.onclose = () => {
      this._cleanup();
      this.ws = null;

      // A close before the socket ever opened means the handshake was rejected
      // — almost always an expired/invalid token. Retrying it forever is the
      // 403 storm in the logs. Give up after a few and tell the app to re-login.
      if (!this.openedThisAttempt) {
        this.authFailures += 1;
        if (this.authFailures >= 4) {
          this.stopped = true;
          console.warn('[WS] auth rejected repeatedly — stopping, needs re-login');
          this.listeners.forEach(l => l({ type: 'auth_expired' } as WsMessage));
          return;
        }
      }

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
