import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/util/secretbox.js';

describe('secretbox', () => {
  it('round-trips a value', () => {
    const blob = encryptSecret('https://hook.example/abc', 'server-secret');
    expect(blob).not.toContain('hook.example');     // ciphertext, not plaintext
    expect(blob.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(blob, 'server-secret')).toBe('https://hook.example/abc');
  });

  it('produces different ciphertext each call (random IV)', () => {
    expect(encryptSecret('x', 's')).not.toBe(encryptSecret('x', 's'));
  });

  it('throws on wrong key', () => {
    const blob = encryptSecret('secret', 'key-a');
    expect(() => decryptSecret(blob, 'key-b')).toThrow();
  });

  it('passes through legacy plaintext (no prefix) unchanged', () => {
    expect(decryptSecret('https://legacy.example/x', 'any')).toBe('https://legacy.example/x');
  });
});
