import { createHmac, timingSafeEqual } from 'node:crypto';

const mac = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

/** HMAC-SHA256 sign a payload -> "payload.sig" (base64url sig). */
export function sign(payload: string, secret: string): string {
  return `${payload}.${mac(payload, secret)}`;
}

/** Verify "payload.sig"; return the payload if the signature matches, else null. */
export function verify(signed: string, secret: string): string | null {
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = signed.slice(0, i);
  const a = Buffer.from(signed.slice(i + 1));
  const b = Buffer.from(mac(payload, secret));
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? payload : null;
}
