import { randomBytes } from 'node:crypto';
import { sign, verify } from './sign.js';

const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
const dec = (s: string): unknown => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Short-lived signed CSRF state for the OAuth round-trip (default 10 min). */
export function createState(secret: string, ttlMs = 10 * 60_000): string {
  return sign(enc({ nonce: randomBytes(8).toString('base64url'), exp: Date.now() + ttlMs }), secret);
}

/** True if the state is a valid, unexpired token signed by us. */
export function readState(state: string, secret: string, now = Date.now()): boolean {
  const payload = verify(state, secret);
  if (!payload) return false;
  try {
    const o = dec(payload) as { exp?: unknown };
    return typeof o.exp === 'number' && o.exp > now;
  } catch { return false; }
}

/** Session value carrying a userId, valid for ttlMs (default 30 days). */
export function createSession(userId: string, secret: string, ttlMs = 30 * 24 * 3600_000): string {
  return sign(enc({ userId, exp: Date.now() + ttlMs }), secret);
}

/** Return the userId if the session is valid and unexpired, else null. */
export function readSession(value: string, secret: string, now = Date.now()): string | null {
  const payload = verify(value, secret);
  if (!payload) return null;
  try {
    const o = dec(payload) as { userId?: unknown; exp?: unknown };
    return typeof o.userId === 'string' && typeof o.exp === 'number' && o.exp > now ? o.userId : null;
  } catch { return null; }
}
