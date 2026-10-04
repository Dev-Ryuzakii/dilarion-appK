import { useEffect, useState } from 'react';
import CallModal, { CallType } from '../screens/CallModal';
import GroupCallView from '../callWindow/GroupCallView';
import {
  PendingCallPayload, UPGRADE_TO_GALLERY_EVENT,
  closeInPageCall, replaceInPageCall, subscribeInPageCall,
} from '../services/callWindow';

/**
 * Web version only: the desktop app opens each call in its own OS window
 * (CallWindowApp). A browser tab can't, so the same call UI renders here,
 * full-screen over the app, fed by the main presence connection directly.
 */
export default function InPageCallHost() {
  const [call, setCall] = useState<PendingCallPayload | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => subscribeInPageCall(c => {
    setCall(c?.payload ?? null);
    setKey(k => k + 1);
  }), []);

  if (!call) return null;

  const end = () => closeInPageCall();

  return (
    <div data-in-page-call style={{ position: 'fixed', inset: 0, zIndex: 3500, background: '#0b0b0b' }}>
      {call.group_call ? (
        <GroupCallView key={key} token={call.token} myUsername={call.my_username} info={call.group_call} onEnd={end} />
      ) : (
        <CallModal
          key={key}
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
          onEnd={end}
          onCallBack={(type: CallType) => {
            replaceInPageCall({
              token: call.token, my_username: call.my_username, partner: call.partner,
              call_type: type, is_incoming: false,
            });
          }}
          onUpgradeToGallery={(confId: number) => {
            window.dispatchEvent(new CustomEvent(UPGRADE_TO_GALLERY_EVENT, { detail: { conferenceId: confId } }));
            end();
          }}
        />
      )}
    </div>
  );
}
