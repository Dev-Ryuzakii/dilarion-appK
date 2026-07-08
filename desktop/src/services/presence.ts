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

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(token: string) {
    this.token = token;
    getDeviceName().then(name => {
      this.deviceName = name;
      this._open();
    });
  }

  private _open() {
    if (!this.token) return;
    const params = new URLSearchParams({
      token: this.token,
      device_id: this.deviceId,
      device_type: 'desktop',
      device_name: this.deviceName,
    });
    this.ws = new WebSocket(`${WS_BASE}?${params.toString()}`);

    this.ws.onopen = () => {
      console.log('[WS] connected');
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
      console.log('[WS] closed — reconnecting in 5s');
      this._cleanup();
      this.reconnectTimer = setTimeout(() => this._open(), 5_000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
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
    this._cleanup();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close(1000, 'logout');
    this.ws = null;
  }
}

export const presenceService = new PresenceService();
