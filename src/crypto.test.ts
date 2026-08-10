import { describe, expect, it } from 'vitest';
import { decryptApiKey, encryptApiKey } from './crypto';

describe('encryptApiKey / decryptApiKey', () => {
  it('round-trips the original value', async () => {
    const encrypted = await encryptApiKey('super-secret-key', 'correct horse battery staple');
    expect(await decryptApiKey(encrypted, 'correct horse battery staple')).toBe('super-secret-key');
  });

  it('throws on an incorrect passphrase rather than returning garbage', async () => {
    const encrypted = await encryptApiKey('super-secret-key', 'right-passphrase');
    await expect(decryptApiKey(encrypted, 'wrong-passphrase')).rejects.toThrow('Incorrect passphrase.');
  });

  it('generates a fresh salt and IV every time, so the same input never produces the same ciphertext twice', async () => {
    const a = await encryptApiKey('same-key', 'same-passphrase');
    const b = await encryptApiKey('same-key', 'same-passphrase');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('round-trips an empty string', async () => {
    const encrypted = await encryptApiKey('', 'a passphrase');
    expect(await decryptApiKey(encrypted, 'a passphrase')).toBe('');
  });
});
