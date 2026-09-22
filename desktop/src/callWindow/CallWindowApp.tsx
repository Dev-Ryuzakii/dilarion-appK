import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emitTo } from '@tauri-apps/api/event';
import CallModal, { CallType } from '../screens/CallModal';
import { startCallWindowForwardBridge } from '../services/presence';
import type { PendingCallPayload } from '../services/callWindow';

/**
 * The standalone call window's entire app — mounted instead of <App/> when
 * this Tauri window's label is "call" (see main.tsx). Owns its own small
 * bit of call state so "call back" after hangup, or answering while already
 * on this window, doesn't need to round-trip the main window at all.
 */
export default function CallWindowApp() {
  const [call, setCall] = useState<PendingCallPayload | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unbridge = startCallWindowForwardBridge();
    invoke<PendingCallPayload | null>('take_pending_call').then(p => {
      setCall(p);
      setReady(true);
      if (!p) {
        // Opened with nothing to show (e.g. a stray relaunch) — nothing to do here.
        getCurrentWindow().close().catch(() => {});
      }
    });
    return unbridge;
  }, []);

  if (!ready || !call) {
    return <div style={{ width: '100%', height: '100vh', background: '#0b0b0b' }} />;
  }

  return (
    <CallModal
      token={call.token}
      myUsername={call.my_username}
      partner={call.partner}
      callType={call.call_type}
      isIncoming={call.is_incoming}
      callId={call.call_id}
      offerSdp={call.offer_sdp}
      conferenceIdProp={call.conference_id}
      conferenceParticipants={call.conference_participants}
      masterToken={call.master_token}
      onEnd={() => { getCurrentWindow().close().catch(() => {}); }}
      onCallBack={(type: CallType) => {
        // Fresh call to the same partner, same window — mirrors how the
        // main window used to fully remount CallModal for a callback.
        setCall(null);
        setTimeout(() => {
          setCall({
            token: call.token, my_username: call.my_username, partner: call.partner,
            call_type: type, is_incoming: false,
          });
        }, 250);
      }}
      onUpgradeToGallery={(confId: number) => {
        // Group video runs in the main window (GalleryView/LiveKit) — hand
        // off and close this window rather than duplicating that UI here.
        emitTo('main', 'dilarion://upgrade-to-gallery', { conferenceId: confId }).catch(() => {});
        getCurrentWindow().close().catch(() => {});
      }}
    />
  );
}
