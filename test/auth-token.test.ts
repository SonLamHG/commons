import { describe, it, expect } from 'vitest';
import { createState, readState, createSession, readSession } from '../src/auth/token.js';

const SECRET = 'test-secret';

describe('state token', () => {
  it('round-trips a fresh state', () => {
    const s = createState(SECRET);
    expect(readState(s, SECRET)).toBe(true);
  });

  it('rejects a tampered state', () => {
    expect(readState('garbage', SECRET)).toBe(false);
  });

  it('rejects a state signed with another secret', () => {
    expect(readState(createState(SECRET), 'other')).toBe(false);
  });

  it('rejects an expired state', () => {
    const s = createState(SECRET, 1000);
    expect(readState(s, SECRET, Date.now() + 2000)).toBe(false);
  });
});

describe('session token', () => {
  it('reads back the userId from a fresh session', () => {
    const s = createSession('usr-1', SECRET);
    expect(readSession(s, SECRET)).toBe('usr-1');
  });

  it('rejects an expired session', () => {
    const s = createSession('usr-1', SECRET, 1000);
    expect(readSession(s, SECRET, Date.now() + 2000)).toBeNull();
  });
});
