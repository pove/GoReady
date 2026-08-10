/**
 * Encrypts the API key at rest with a user-chosen passphrase, via the
 * browser's Web Crypto API. This protects a stolen device/backup copy of
 * localStorage - it does NOT protect against an active XSS on this page,
 * which could read the decrypted key straight out of memory while the app
 * is using it. PBKDF2 (SHA-256) derives an AES-GCM key per encryption; a
 * fresh salt and IV are generated every time, so encrypting the same key
 * twice never produces the same ciphertext.
 */
const PBKDF2_ITERATIONS = 100_000;

export interface EncryptedApiKey {
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
}

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptApiKey(apiKey: string, passphrase: string): Promise<EncryptedApiKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey));
  return { salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/** Throws (never returns a garbage string) when the passphrase is wrong - AES-GCM's authentication tag fails to verify. */
export async function decryptApiKey(payload: EncryptedApiKey, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromBase64(payload.salt));
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Incorrect passphrase.');
  }
}
