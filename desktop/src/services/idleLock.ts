// Idle auto-logout. After IDLE_TIMEOUT_MINUTES with no keyboard/mouse
// activity the session is dropped and the user has to re-enter their access
// token to get back in. Last-activity time is persisted so closing the app
// and reopening it later still counts as idle time.

const LAST_ACTIVE_KEY = 'dilarion_last_active';
const LOCKED_USER_KEY = 'dilarion_idle_locked_user';

/** System-set idle timeout — not user-configurable. */
export const IDLE_TIMEOUT_MINUTES = 15;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable */ }
}

export function markActive(now = Date.now()): void {
  write(LAST_ACTIVE_KEY, String(now));
}

export function getLastActive(): number | null {
  const n = Number(read(LAST_ACTIVE_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function isIdleExpired(now = Date.now()): boolean {
  const last = getLastActive();
  return last !== null && now - last > IDLE_TIMEOUT_MINUTES * 60_000;
}

/** Username the lock screen should ask a token for, if the app is idle-locked. */
export function getLockedUser(): string | null {
  return read(LOCKED_USER_KEY);
}
export function setLockedUser(username: string | null): void {
  write(LOCKED_USER_KEY, username);
}
