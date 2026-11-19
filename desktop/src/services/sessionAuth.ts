/** Identify a retired app session without confusing it with other 401/403s. */
export async function sessionRetirementReason(res: Response): Promise<string | null> {
  if (res.status !== 401 && res.status !== 403) return null;
  try {
    const body = await res.clone().json();
    const detail = String(body?.detail ?? body?.message ?? '').trim().toLowerCase();
    if (detail === 'session replaced by another login') {
      return 'This session was replaced by a newer sign-in. Please sign in again.';
    }
    if (detail === 'invalid or expired session' || detail === 'not authenticated') {
      return 'Your session expired. Please sign in again.';
    }
    return null;
  } catch {
    return null;
  }
}
