import { describe, it, expect } from 'vitest';
import { sign, verify } from '../src/auth/sign.js';

describe('auth/sign', () => {
  it('round-trips a payload with the right secret', () => {
    const s = sign('hello', 'secret');
    expect(s.startsWith('hello.')).toBe(true);
    expect(verify(s, 'secret')).toBe('hello');
  });

  it('rejects a wrong secret', () => {
    expect(verify(sign('hello', 'secret'), 'other')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const sig = sign('hello', 'secret').split('.')[1];
    expect(verify('world.' + sig, 'secret')).toBeNull();
  });

  it('rejects a malformed value', () => {
    expect(verify('nodot', 'secret')).toBeNull();
    expect(verify('', 'secret')).toBeNull();
  });
});
