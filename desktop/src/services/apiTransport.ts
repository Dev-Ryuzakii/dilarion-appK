import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from './platform';

/**
 * Use Tauri's native HTTP client in the desktop shell. Browser fetch is subject
 * to WebView2 CORS checks, and the API intentionally does not trust arbitrary
 * desktop-webview origins. Normal web builds must continue to use browser
 * fetch and the server's web-origin CORS allowlist.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    return tauriFetch(input as Request | URL | string, init);
  }
  return globalThis.fetch(input, init);
}
