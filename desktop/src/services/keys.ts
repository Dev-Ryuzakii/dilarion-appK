import { validatePrivateKey } from './crypto';

// The identity keypair is stored per-username and deliberately survives logout —
// same as Android, where regenerating on each login would rotate the identity and
// make every previously received message permanently undecryptable.

const KEY_PREFIX = 'dilarion_keys_';

export interface Keypair {
  privateKey: string;
  publicKey: string;
}

function storageKey(username: string): string {
  return `${KEY_PREFIX}${username.toLowerCase()}`;
}

export function loadKeypair(username: string): Keypair | null {
  try {
    const raw = localStorage.getItem(storageKey(username));
    if (!raw) return null;
    const kp = JSON.parse(raw) as Keypair;
    if (!kp.privateKey) return null;
    return kp;
  } catch {
    return null;
  }
}

export function saveKeypair(username: string, kp: Keypair): void {
  localStorage.setItem(storageKey(username), JSON.stringify(kp));
}

export function clearKeypair(username: string): void {
  localStorage.removeItem(storageKey(username));
}

export function hasKeypair(username: string): boolean {
  return loadKeypair(username) !== null;
}

/**
 * Accepts what the phone's "Export key" screen produces: either the JSON blob
 * {"private_key":"…","public_key":"…"} or a bare base64 PKCS#8 private key.
 * Rejects anything WebCrypto can't load as an RSA private key.
 */
export async function parseExportedKey(blob: string): Promise<Keypair> {
  const trimmed = blob.trim();
  if (!trimmed) throw new Error('Paste the key exported from your phone.');

  let privateKey = '';
  let publicKey = '';

  if (trimmed.startsWith('{')) {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('That does not look like a valid exported key.');
    }
    privateKey = (parsed.private_key ?? parsed.privateKey ?? '').trim();
    publicKey = (parsed.public_key ?? parsed.publicKey ?? '').trim();
  } else {
    privateKey = trimmed.replace(/\s+/g, '');
  }

  if (!privateKey) throw new Error('No private key found in that blob.');

  try {
    await validatePrivateKey(privateKey);
  } catch {
    throw new Error('That key is not a valid RSA private key.');
  }

  return { privateKey, publicKey };
}
