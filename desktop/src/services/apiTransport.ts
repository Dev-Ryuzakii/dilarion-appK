import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from './platform';
import { notifySessionInvalid } from './session';
import { sessionRetirementReason } from './sessionAuth';
import { reportFailedRequest } from './watch';

/**
 * Use Tauri's native HTTP client in the desktop shell. Browser fetch is subject
 * to WebView2 CORS checks, and the API intentionally does not trust arbitrary
 * desktop-webview origins. Normal web builds must continue to use browser
 * fetch and the server's web-origin CORS allowlist.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let res: Response;
  if (isTauri()) {
    // Watch only sees window.fetch, so report plugin-http failures ourselves.
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    try {
      res = await tauriFetch(input as Request | URL | string, init);
    } catch (e) {
      reportFailedRequest(url, null, method);
      throw e;
    }
    if (res.status >= 500) reportFailedRequest(url, res.status, method);
  } else {
    res = await globalThis.fetch(input, init);
  }

  const retirementReason = await sessionRetirementReason(res);
  if (retirementReason) {
    // Read from a clone so the caller still gets an untouched body.
    notifySessionInvalid(retirementReason);
  }
  return res;
}
