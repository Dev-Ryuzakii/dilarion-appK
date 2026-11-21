// Camera / mic / speaker picked in the setup room, reused when the meeting
// connects. Stored per device in localStorage; every read tolerates it being
// unavailable or holding a device that has since been unplugged.

export interface MediaPrefs {
  audioInput?: string;
  videoInput?: string;
  audioOutput?: string;
}

const KEY = 'dilarion.mediaPrefs';

export function loadMediaPrefs(): MediaPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MediaPrefs) : {};
  } catch {
    return {};
  }
}

export function saveMediaPrefs(prefs: MediaPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / storage blocked: the default devices are used instead.
  }
}
