import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from './platform';
import { notifySessionInvalid } from './session';
import { sessionRetirementReason } from './sessionAuth';

/**
 * Use Tauri's native HTTP client in the desktop shell. Browser fetch is subject
 * to WebView2 CORS checks, and the API intentionally does not trust arbitrary
 * desktop-webview origins. Normal web builds must continue to use browser
 * fetch and the server's web-origin CORS allowlist.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = isTauri()
    ? await tauriFetch(input as Request | URL | string, init)
    : await globalThis.fetch(input, init);

  const retirementReason = await sessionRetirementReason(res);
  if (retirementReason) {
    // Read from a clone so the caller still gets an untouched body.
    notifySessionInvalid(retirementReason);
  }
  return res;
}
