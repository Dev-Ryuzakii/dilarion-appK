// Browser identity keys live in IndexedDB as non-extractable CryptoKey objects.
// localStorage holds only an opaque handle so existing synchronous UI reads can
// continue to find the device key without exposing its PKCS#8 bytes.
const DB_NAME = 'dilarion-private-keys';
const STORE_NAME = 'keys';
const HANDLE_PREFIX = 'idb:';

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openKeyDb().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  }));
}

export function isStoredKey(handle: string): boolean {
  return handle.startsWith(HANDLE_PREFIX);
}

export async function storePrivateKey(key: CryptoKey): Promise<string> {
  if (key.extractable) throw new Error('Private key must be non-extractable');
  const id = crypto.randomUUID();
  await withStore('readwrite', store => store.put(key, id));
  return HANDLE_PREFIX + id;
}

export async function loadStoredPrivateKey(handle: string): Promise<CryptoKey> {
  if (!isStoredKey(handle)) throw new Error('Invalid private key handle');
  const key = await withStore<CryptoKey | undefined>('readonly', store => store.get(handle.slice(HANDLE_PREFIX.length)));
  if (!key || key.extractable) throw new Error('Private key is missing or invalid');
  return key;
}

export async function removeStoredPrivateKey(handle: string): Promise<void> {
  if (!isStoredKey(handle)) return;
  await withStore('readwrite', store => store.delete(handle.slice(HANDLE_PREFIX.length)));
}

export async function importPrivateKeyToStore(b64: string): Promise<string> {
  const binary = atob(b64.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', bytes.buffer as ArrayBuffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  return storePrivateKey(key);
}
