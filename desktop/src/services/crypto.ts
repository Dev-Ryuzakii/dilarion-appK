// E2EE primitives. Must stay wire-compatible with the Android CryptoManager and
// the iOS equivalent: RSA-2048 OAEP/SHA-256 to wrap a fresh AES-256-GCM key,
// 12-byte IV, 128-bit tag appended to the ciphertext, everything base64 (no wrap).

const RSA_PARAMS = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;
const KEY_BITS = 2048;
const IV_BYTES = 12;
const TAG_BITS = 128;

// ── base64 <-> bytes ──────────────────────────────────────────────────────────

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Key import ────────────────────────────────────────────────────────────────

// Android exports SubjectPublicKeyInfo (X.509) for public keys and PKCS#8 for
// private keys, which is exactly what WebCrypto's spki/pkcs8 formats expect.

function importPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', fromB64(b64).buffer as ArrayBuffer, RSA_PARAMS, false, ['encrypt']);
}

function importPrivateKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', fromB64(b64).buffer as ArrayBuffer, RSA_PARAMS, false, ['decrypt']);
}

/** Throws if the blob isn't a usable RSA private key — used to validate imports. */
export async function validatePrivateKey(b64: string): Promise<void> {
  await importPrivateKey(b64);
}

export async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await crypto.subtle.generateKey(
    { ...RSA_PARAMS, modulusLength: KEY_BITS, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['encrypt', 'decrypt'],
  );
  const [pub, priv] = await Promise.all([
    crypto.subtle.exportKey('spki', kp.publicKey),
    crypto.subtle.exportKey('pkcs8', kp.privateKey),
  ]);
  return { publicKey: toB64(pub), privateKey: toB64(priv) };
}

// ── AES helpers ───────────────────────────────────────────────────────────────

async function aesEncrypt(plaintext: string, rawKey: Uint8Array, iv: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', rawKey.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, tagLength: TAG_BITS },
    key,
    new TextEncoder().encode(plaintext),
  );
  return toB64(ct);
}

async function aesDecrypt(ciphertextB64: string, rawKey: Uint8Array, iv: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', rawKey.buffer as ArrayBuffer, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, tagLength: TAG_BITS },
    key,
    fromB64(ciphertextB64).buffer as ArrayBuffer,
  );
  return new TextDecoder().decode(plain);
}

// ── Message encryption ────────────────────────────────────────────────────────

export interface EncryptedMessage {
  ciphertext: string;
  encryptedKeys: Record<string, string>;
  iv: string;
}

/**
 * One AES key per message, wrapped once per recipient. The wrapped keys travel as
 * a JSON object keyed by username, so every recipient (including the sender, when
 * they wrap for themselves) can unwrap their own entry. Recipients without a
 * published public key are skipped and will not be able to read the message.
 */
export async function encryptMessage(
  plaintext: string,
  recipientPublicKeys: Record<string, string>,
): Promise<EncryptedMessage> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await aesEncrypt(plaintext, rawKey, iv);

  const encryptedKeys: Record<string, string> = {};
  for (const [username, pubB64] of Object.entries(recipientPublicKeys)) {
    if (!pubB64?.trim()) continue;
    try {
      const pub = await importPublicKey(pubB64);
      const wrapped = await crypto.subtle.encrypt(RSA_PARAMS, pub, rawKey.buffer as ArrayBuffer);
      encryptedKeys[username] = toB64(wrapped);
    } catch {
      // One member's malformed key must not block the send.
    }
  }

  if (Object.keys(encryptedKeys).length === 0) {
    throw new Error('No valid recipient keys — message not sent.');
  }

  return { ciphertext, encryptedKeys, iv: toB64(iv) };
}

export async function decryptMessage(
  ciphertextB64: string,
  encryptedKeyB64: string,
  ivB64: string,
  privateKeyB64: string,
): Promise<string> {
  const priv = await importPrivateKey(privateKeyB64);
  const rawKey = await crypto.subtle.decrypt(RSA_PARAMS, priv, fromB64(encryptedKeyB64).buffer as ArrayBuffer);
  return aesDecrypt(ciphertextB64, new Uint8Array(rawKey), fromB64(ivB64));
}

/**
 * Group rows store `encrypted_key` as a JSON map of username -> wrapped key.
 * DMs store the wrapped key directly. Returns null when this user has no entry,
 * which means the message was encrypted before they joined / without their key.
 */
export function resolveEncryptedKey(encryptedKey: string, username: string): string | null {
  const trimmed = encryptedKey?.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const map = JSON.parse(trimmed) as Record<string, string>;
    return map[username] ?? null;
  } catch {
    return trimmed;
  }
}
