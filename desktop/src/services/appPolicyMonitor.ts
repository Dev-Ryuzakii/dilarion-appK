import { invoke } from '@tauri-apps/api/core';
import { getPolicyBlocklist, reportPolicyViolation } from './api';

/**
 * Org device-policy compliance agent. Always on — every desktop device is
 * org-owned, so this runs unconditionally from login, no per-user consent
 * gate (unlike live-listen/recording/location tracking elsewhere, which
 * stay opt-in).
 *
 * Detection is process-name only (via list_running_processes, Rust-side) —
 * it does not read window/tab titles, so browser-based social media use
 * (e.g. a Facebook tab) isn't caught unless it ships as its own app/process.
 */

const POLL_INTERVAL_MS = 30_000;
// Don't re-report the same running app more than once per cooldown window —
// otherwise a blocked app left open all day would screenshot every 30s.
const VIOLATION_COOLDOWN_MS = 10 * 60 * 1000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let currentToken: string | null = null;
const lastReported = new Map<string, number>();

async function checkOnce() {
  const token = currentToken;
  if (!token) return;
  try {
    const blocklist = await getPolicyBlocklist(token);
    if (blocklist.length === 0) return;

    const running = await invoke<string[]>('list_running_processes');
    const runningSet = new Set(running.map(p => p.toLowerCase()));
    const now = Date.now();

    for (const blocked of blocklist) {
      const name = blocked.toLowerCase();
      if (!runningSet.has(name)) continue;
      const last = lastReported.get(name) || 0;
      if (now - last < VIOLATION_COOLDOWN_MS) continue;
      lastReported.set(name, now);

      const screenshot = await invoke<string>('capture_screenshot');
      const deviceInfo = await invoke<{ hostname: string }>('get_device_info');
      await reportPolicyViolation(token, name, deviceInfo.hostname, screenshot);
    }
  } catch {
    // Silent — a transient failure (offline, backend hiccup) just retries
    // on the next tick, nothing to surface to the user for their own device.
  }
}

export function start(token: string) {
  currentToken = token;
  if (pollTimer) return;
  checkOnce();
  pollTimer = setInterval(checkOnce, POLL_INTERVAL_MS);
}

export function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  currentToken = null;
  lastReported.clear();
}
