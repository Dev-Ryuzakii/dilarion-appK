import { useEffect, useState } from 'react';
import LivenessCheckModal from './LivenessCheckModal';
import { _subscribeLivenessGate, _resolveLivenessCheck } from '../services/liveness';

// Mount once near the app root. Renders the liveness modal on demand
// whenever requestLivenessCheck()/gateSensitiveAction() is called anywhere
// in the app, and resolves that call's promise once the user passes/cancels.
export default function LivenessGateHost() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    _subscribeLivenessGate(setVisible);
  }, []);

  if (!visible) return null;
  return <LivenessCheckModal onResult={ok => _resolveLivenessCheck(ok)} />;
}
