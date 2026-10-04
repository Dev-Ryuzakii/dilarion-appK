// One build, two homes: the Tauri desktop app and the browser (web.dilarion.xyz).
// Everything that needs a desktop-only capability asks here first and falls
// back to a browser equivalent - or does nothing - on the web.

/** True inside the Tauri desktop shell, false in a normal browser tab. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** "desktop" in the app, "web" in a browser - sent to the server on login/linking. */
export function platformName(): 'desktop' | 'web' {
  return isTauri() ? 'desktop' : 'web';
}

/** A readable name for this browser, e.g. "Chrome on macOS". */
export function browserDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Web browser';
  const ua = navigator.userAgent;
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
