// Base1 Watch: error/UX monitoring and session replay.
// The abw_ ingest key is write-only and meant to ship in client code.
import { initWatch, type WatchClient } from '@afribase/afribase-js';
import { SESSION_KEY } from './session';

declare const __APP_VERSION__: string;

/** Logged-in username from the session, or undefined when logged out. Hashed server-side. */
function currentUser(): string | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const s = JSON.parse(raw) as { username?: string };
    return s.username || undefined;
  } catch {
    return undefined;
  }
}

export const watch: WatchClient = initWatch({
  key: 'abw_Sk8xQS84EIBreWKAvDsYFIkxTkJ-Kn7dJ6MwIfIspXQ',
  endpoint: 'https://api.useafribase.app/watch/ingest',
  release: __APP_VERSION__,
  environment: import.meta.env.MODE === 'production' ? 'production' : import.meta.env.MODE,
  user: currentUser,
  // Replay masks every text node, so messages, names and contacts are never
  // recorded; inputs are always masked. [data-watch-block] areas are skipped.
  replay: true,
  maskAllText: true,
});

/**
 * Report a failed API call. In the Tauri shell requests go through
 * @tauri-apps/plugin-http, which Watch cannot see on its own.
 */
export function reportFailedRequest(url: string, status: number | null, method = 'GET'): void {
  let path = url;
  try { path = new URL(url).pathname; } catch { /* relative */ }
  watch.captureError(new Error(status ? `HTTP ${status} ${method} ${path}` : `Network error ${method} ${path}`), {
    kind: 'request', path, status, method,
  });
}
