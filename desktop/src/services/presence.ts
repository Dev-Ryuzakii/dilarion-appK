const WS_BASE = 'ws://187.124.208.16:8010/ws';

export type WsMessage = {
  type: string;
  data?: Record<string, any>;
};

type Listener = (msg: WsMessage) => void;

class PresenceService {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private listeners: Listener[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  get isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(token: string) {
    this.token = token;
    this._open();
  }

  private _open() {
    if (!this.token) return;
    this.ws = new WebSocket(`${WS_BASE}?token=${this.token}`);

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
