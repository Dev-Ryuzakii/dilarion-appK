import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { CallType } from '../screens/CallModal';
import { isTauri } from './platform';
import type { GroupCallInfo } from '../callWindow/GroupCallView';

export interface PendingCallPayload {
  token: string;
  my_username: string;
  partner: string;
  call_type: CallType;
  is_incoming: boolean;
  call_id?: number;
  offer_sdp?: string;
  conference_id?: number;
  conference_participants?: string[];
  master_token?: string;
  /** Set for a WhatsApp-style group call — the window renders GroupCallView
   * (LiveKit room for the group) instead of the 1:1 CallModal. */
  group_call?: GroupCallInfo;
}

/**
 * Opens the call as its own OS window (like WhatsApp Desktop) instead of an
 * in-app modal — the main window stays fully usable (chat, other calls'
 * banners, etc.) while a call is up. `onClosed` fires once the window is
 * actually gone, so the caller can clear whatever bookkeeping it used to key
 * off `activeCall` being non-null.
 */
export async function openCallWindow(payload: PendingCallPayload, onClosed: () => void): Promise<void> {
  if (!isTauri()) {
    // Web: no second OS window - the call renders full-screen in this tab
    // (see InPageCallHost).
    showInPageCall(payload, onClosed);
    return;
  }
  await invoke('set_pending_call', { call: payload });

  const existing = await WebviewWindow.getByLabel('call');
  if (existing) {
    // Shouldn't normally happen (can't start a second call mid-call), but
    // don't strand the user on a dead window if it does.
    await existing.setFocus();
    return;
  }

  const win = new WebviewWindow('call', {
    url: 'index.html',
    title: `Dilarion — ${payload.partner}`,
    // WhatsApp Desktop-sized call window — landscape, big enough for video.
    width: 1024,
    height: 700,
    minWidth: 640,
    minHeight: 520,
    resizable: true,
    center: true,
    decorations: true,
  });

  win.once('tauri://destroyed', () => onClosed());
  win.once('tauri://error', () => onClosed());
}

/** Used when the main window itself needs to tear down the call (e.g. the
 * other party upgraded a 1:1 call into a group conference). */
export async function closeCallWindowIfOpen(): Promise<void> {
  if (!isTauri()) {
    closeInPageCall();
    return;
  }
  const existing = await WebviewWindow.getByLabel('call');
  await existing?.close();
}

// ── Web: in-page call ─────────────────────────────────────────────────────────

type InPageCall = { payload: PendingCallPayload; onClosed: () => void } | null;
let inPageCall: InPageCall = null;
const inPageListeners = new Set<(c: InPageCall) => void>();

function publishInPage() {
  inPageListeners.forEach(l => l(inPageCall));
}

export function showInPageCall(payload: PendingCallPayload, onClosed: () => void) {
  if (inPageCall) return; // already on a call
  inPageCall = { payload, onClosed };
  publishInPage();
}

export function closeInPageCall() {
  const current = inPageCall;
  inPageCall = null;
  publishInPage();
  current?.onClosed();
}

/** Replace the call shown in-page (e.g. "call back" after a hang-up). */
export function replaceInPageCall(payload: PendingCallPayload) {
  if (!inPageCall) return;
  inPageCall = { ...inPageCall, payload };
  publishInPage();
}

export function subscribeInPageCall(fn: (c: InPageCall) => void): () => void {
  inPageListeners.add(fn);
  fn(inPageCall);
  return () => { inPageListeners.delete(fn); };
}

/** Window event the in-page call fires when a 1:1 call becomes a group call. */
export const UPGRADE_TO_GALLERY_EVENT = 'dilarion-upgrade-to-gallery';
