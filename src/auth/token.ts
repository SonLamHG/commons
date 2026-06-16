import { sign, verify } from './sign.js';

const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
const dec = (s: string): unknown => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Magic-link token carrying a normalised email, valid for ttlMs (default 15 min). */
export function createMagicToken(email: string, secret: string, ttlMs = 15 * 60_000): string {
  return sign(enc({ email: email.trim().toLowerCase(), exp: Date.now() + ttlMs }), secret);
}

/** Return the email if the token is valid and unexpired, else null. */
export function readMagicToken(token: string, secret: string, now = Date.now()): string | null {
  const payload = verify(token, secret);
  if (!payload) return null;
  try {
    const o = dec(payload) as { email?: unknown; exp?: unknown };
    return typeof o.email === 'string' && typeof o.exp === 'number' && o.exp > now ? o.email : null;
  } catch { return null; }
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
