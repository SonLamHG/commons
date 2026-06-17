import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const keyFrom = (secret: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, 'commons-secretbox-v1', '', 32));

/** Encrypt a short string with AES-256-GCM. Output: `enc:v1:` + base64(iv|tag|ciphertext). */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt a value produced by encryptSecret. Strings without the prefix are returned as-is
 * (legacy plaintext written before encryption existed). Throws on tamper / wrong key. */
export function decryptSecret(blob: string, secret: string): string {
  if (!blob.startsWith(PREFIX)) return blob;
  const raw = Buffer.from(blob.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8');
}
