import { describe, it, expect } from 'vitest';
import { serializeCookie, parseCookies } from '../src/auth/cookie.js';

describe('auth/cookie', () => {
  it('serialises with flags', () => {
    const c = serializeCookie('commons_session', 'abc', {
      httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60,
    });
    expect(c).toContain('commons_session=abc');
    expect(c).toContain('Max-Age=60');
    expect(c).toContain('Path=/');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
  });

  it('url-encodes the value and round-trips via parse', () => {
    const c = serializeCookie('k', 'a b+c');
    expect(parseCookies(c.split(';')[0])).toEqual({ k: 'a b+c' });
  });

  it('parses multiple cookies', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('returns empty for missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});
