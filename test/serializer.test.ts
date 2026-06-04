import { describe, it, expect } from 'vitest';
import { WorkspaceSerializer } from '../src/mcp/serializer.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('WorkspaceSerializer', () => {
  it('serializes operations on the same key (no interleaving)', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    const op = (label: string, ms: number) => async () => {
      order.push(`start ${label}`);
      await delay(ms);
      order.push(`end ${label}`);
    };
    await Promise.all([s.run('ws', op('A', 30)), s.run('ws', op('B', 1))]);
    expect(order).toEqual(['start A', 'end A', 'start B', 'end B']);
  });

  it('allows operations on different keys to overlap', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    const op = (label: string, ms: number) => async () => {
      order.push(`start ${label}`);
      await delay(ms);
      order.push(`end ${label}`);
    };
    await Promise.all([s.run('ws1', op('A', 30)), s.run('ws2', op('B', 1))]);
    expect(order.indexOf('end B')).toBeLessThan(order.indexOf('end A'));
  });

  it('a rejected op does not break the chain', async () => {
    const s = new WorkspaceSerializer();
    await expect(s.run('ws', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(s.run('ws', async () => 42)).resolves.toBe(42);
  });
});
