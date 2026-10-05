// The stored session and the one event that can end it early.
//
// The server keeps one signed-in client per platform group and retires the
// older one the moment a new login arrives (see /auth/login), so a client can
// be left holding a token the server has already deactivated. Nothing used to
// notice: the token sat in localStorage for its full seven days and every
// request came back 403 "Not authenticated", which each screen swallowed with
// an empty catch. The app looked signed in and showed nothing.
//
// `apiFetch` now reports that case here instead, and App drops back to the
// sign-in screen with a reason.

export const SESSION_KEY = 'dilarion_session';

/** Fired when the server rejects a token we are still holding. */
export const SESSION_INVALID_EVENT = 'dilarion://session-invalid';

/** Kept outside React state so the login screen can pick it up on mount. */
let invalidReason: string | null = null;

export function clearStoredSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode / storage disabled: nothing to clear.
  }
}

/** The server has retired this token. Drop it and tell whoever is listening. */
export function notifySessionInvalid(reason: string): void {
  invalidReason = reason;
  clearStoredSession();
  try {
    window.dispatchEvent(new CustomEvent(SESSION_INVALID_EVENT, { detail: { reason } }));
  } catch {
    // No window (tests): the reason is still readable via takeInvalidReason.
  }
}

/** Reads and clears the pending reason, if any. */
export function takeInvalidReason(): string | null {
  const reason = invalidReason;
  invalidReason = null;
  return reason;
}
