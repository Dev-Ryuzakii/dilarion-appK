// Desktop's stand-in for the mobile Biometric Lock — there's no Windows
// Hello/Touch ID plumbing in the Tauri/Rust layer, so instead of faking real
// biometrics this confirms a live human is in front of the camera (motion
// over a short window) before unlocking the app or a sensitive setting.
// It does NOT verify identity — it only rules out a static photo or an
// already-unlocked machine being walked up to. Off by default.

export const LIVENESS_LOCK_KEY = 'dilarion_liveness_lock_enabled';

export function isLivenessLockEnabled(): boolean {
  return localStorage.getItem(LIVENESS_LOCK_KEY) === 'true';
}

export function setLivenessLockEnabled(enabled: boolean): void {
  localStorage.setItem(LIVENESS_LOCK_KEY, enabled ? 'true' : 'false');
}

type VisibilityListener = (visible: boolean) => void;

let resolver: ((ok: boolean) => void) | null = null;
let listener: VisibilityListener | null = null;

/** Mount exactly one <LivenessGateHost /> near the app root — it renders the
 * modal whenever this is called and resolves once the user passes/cancels. */
export function requestLivenessCheck(): Promise<boolean> {
  return new Promise(resolve => {
    resolver = resolve;
    listener?.(true);
  });
}

export function _subscribeLivenessGate(l: VisibilityListener): void {
  listener = l;
}

export function _resolveLivenessCheck(ok: boolean): void {
  listener?.(false);
  const r = resolver;
  resolver = null;
  r?.(ok);
}

/** Off (or the check passes/is cancelled) — callers just await this before
 * proceeding; off passes straight through so nobody who didn't opt in sees
 * a camera prompt. */
export async function gateSensitiveAction(): Promise<boolean> {
  if (!isLivenessLockEnabled()) return true;
  return requestLivenessCheck();
}
