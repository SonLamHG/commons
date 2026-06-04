import { describe, it, expect } from 'vitest';
import { generateId } from '../src/util/id.js';

describe('generateId', () => {
  it('produces engine-safe ids matching [A-Za-z0-9_-]+', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateId('p')).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
  it('produces unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId('p')));
    expect(ids.size).toBe(1000);
  });
  it('applies the prefix', () => {
    expect(generateId('p').startsWith('p-')).toBe(true);
  });
});
