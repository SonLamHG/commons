import { describe, it, expect } from 'vitest';
import { createMagicToken, readMagicToken, createSession, readSession } from '../src/auth/token.js';

const SECRET = 'test-secret';

describe('auth/token', () => {
  it('reads back the email from a fresh magic token (normalised)', () => {
    const t = createMagicToken('Alice@Example.com', SECRET);
    expect(readMagicToken(t, SECRET)).toBe('alice@example.com');
  });

  it('rejects an expired magic token', () => {
    const t = createMagicToken('a@x.com', SECRET, 1000);
    expect(readMagicToken(t, SECRET, Date.now() + 2000)).toBeNull();
  });

  it('rejects a magic token signed with another secret', () => {
    expect(readMagicToken(createMagicToken('a@x.com', SECRET), 'other')).toBeNull();
  });

  it('reads back the userId from a fresh session', () => {
    const s = createSession('usr-1', SECRET);
    expect(readSession(s, SECRET)).toBe('usr-1');
  });

  it('rejects an expired session', () => {
    const s = createSession('usr-1', SECRET, 1000);
    expect(readSession(s, SECRET, Date.now() + 2000)).toBeNull();
  });
});
