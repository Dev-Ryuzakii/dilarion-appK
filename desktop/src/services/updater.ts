import { isTauri } from './platform';

// OTA auto-update for the production desktop build. On launch it asks the
// update endpoint (GitHub Releases latest.json) whether a newer, signed version
// exists; if so it downloads, installs and relaunches. The test build ships an
// empty endpoints list, so check() finds nothing and this is a no-op there, and
// on the web build isTauri() is false so it never runs.
let ranOnce = false;

export async function runUpdateCheck(): Promise<void> {
  if (ranOnce || !isTauri()) return;
  ranOnce = true;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return;
    // Download + install the signed package, then relaunch into the new version.
    await update.downloadAndInstall();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch {
    // No endpoints (test build), offline, or no update available — ignore and
    // let the app keep running on the current version.
  }
}
