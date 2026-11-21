import { useState } from 'react';
import { profilePictureUrl } from '../services/api';

const TINTS = ['#e17055', '#00b894', '#0984e3', '#6c5ce7', '#fdcb6e', '#e84393', '#00cec9', '#d63031'];

function tint(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

/** Profile photo when the person has one, otherwise their initial on a tint. */
export default function PersonAvatar({ username, label, hasPicture, size = 32 }: {
  username: string; label?: string; hasPicture?: boolean; size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const letter = (label || username || '?').trim().charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      background: tint(username), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.42,
    }}>
      {hasPicture && !failed
        ? <img src={profilePictureUrl(username)} alt="" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : letter}
    </div>
  );
}
