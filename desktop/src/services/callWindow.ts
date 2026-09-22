import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { CallType } from '../screens/CallModal';

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
}

/**
 * Opens the call as its own OS window (like WhatsApp Desktop) instead of an
 * in-app modal — the main window stays fully usable (chat, other calls'
 * banners, etc.) while a call is up. `onClosed` fires once the window is
 * actually gone, so the caller can clear whatever bookkeeping it used to key
 * off `activeCall` being non-null.
 */
export async function openCallWindow(payload: PendingCallPayload, onClosed: () => void): Promise<void> {
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
    width: 480,
    height: 760,
    minWidth: 380,
    minHeight: 600,
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
  const existing = await WebviewWindow.getByLabel('call');
  await existing?.close();
}
