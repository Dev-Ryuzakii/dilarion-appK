import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from './platform';
import { notifySessionInvalid } from './session';

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

  if (await sessionWasRetired(res)) {
    // Read from a clone so the caller still gets an untouched body.
    notifySessionInvalid('Your session was ended by a newer sign-in, or it expired.');
  }
  return res;
}

/**
 * The auth gates answer a retired token with 403 {"detail":"Not authenticated"}.
 * That string is the marker — not the status, because 403 also covers real
 * permission denials on admin endpoints, and a bad login is a 401 with
 * "Invalid username, token, or password". Both of those must pass through
 * untouched or a wrong password would look like an ended session.
 */
async function sessionWasRetired(res: Response): Promise<boolean> {
  if (res.status !== 401 && res.status !== 403) return false;
  try {
    const body = await res.clone().json();
    const detail = String(body?.detail ?? body?.message ?? '').trim().toLowerCase();
    return detail === 'not authenticated';
  } catch {
    // Unparsable body: a bare 401 is still the token being refused.
    return res.status === 401;
  }
}
