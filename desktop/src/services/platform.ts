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

/**
 * Saves a downloaded file for the user. In the desktop app it's written to
 * Downloads (the webview can't save a Blob itself) and revealed in Finder /
 * Explorer; in a browser it's a normal download. Resolves to the saved path
 * on desktop, null on the web.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<string | null> {
  if (isTauri()) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string>('save_download', { filename, dataB64: btoa(binary) });
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    revealItemInDir(path).catch(() => {});
    return path;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}
