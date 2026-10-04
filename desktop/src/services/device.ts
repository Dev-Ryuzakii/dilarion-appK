// Stable per-install device id + a readable name, sent on login so the server
// can keep one signed-in desktop per account and name it in security alerts.
// Kept apart from the session so signing out doesn't make this a "new" device.
import { browserDeviceName, isTauri } from './platform';

const DEVICE_ID_KEY = 'dilarion_device_id';

export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    return 'desktop-unknown';
  }
}

export function deviceName(): string {
  if (!isTauri()) return browserDeviceName();
  const p = navigator.platform || 'Desktop';
  if (/mac/i.test(p)) return 'Mac Desktop';
  if (/win/i.test(p)) return 'Windows Desktop';
  if (/linux/i.test(p)) return 'Linux Desktop';
  return 'Desktop';
}
