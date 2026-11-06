/**
 * Turn an arbitrary thrown value into a clear, friendly, actionable message for
 * the user, while preserving the raw technical detail in the console for
 * debugging. This does NOT change control flow — callers still decide where and
 * when to surface the returned string; it only standardizes the wording so the
 * same failure reads the same way everywhere (and so raw exception text like
 * "Failed to fetch", "Load failed" or a bare HTTP status never reaches a user).
 *
 * Pass a `fallback` that describes the specific thing that failed in friendly,
 * actionable terms (e.g. "Couldn't send your message. Please try again."). It
 * is used whenever the failure isn't a recognized network/auth/size/server case.
 */
export function userMessage(err: unknown, fallback: string): string {
  // Always keep the real detail in the logs — never surfaced to the user.
  console.error('[dilarion]', fallback, err);

  const status: unknown = (err as any)?.status ?? (err as any)?.response?.status;
  const raw = String((err as any)?.message ?? err ?? '');

  // Network / connectivity failures (browser fetch throws TypeError "Failed to
  // fetch"; Tauri's HTTP client throws "error sending request" / timeouts).
  if (
    err instanceof TypeError ||
    /failed to fetch|load failed|networkerror|network error|error sending request|timed? ?out|timeout|connection|econn|refused|unreachable|dns|offline/i.test(raw)
  ) {
    return "Can't reach the server. Check your connection and try again.";
  }

  if (status === 401 || status === 403) {
    return 'Your session expired. Please sign in again.';
  }
  if (status === 413) {
    return 'That file is too large to send.';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'Something went wrong on our end. Please try again in a moment.';
  }

  return fallback;
}
