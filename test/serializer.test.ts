import { describe, it, expect } from 'vitest';
import { WorkspaceSerializer } from '../src/util/serializer.js';

describe('WorkspaceSerializer', () => {
  it('serializes operations for the same key (no overlap)', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    const op = (id: string, ms: number) => async () => {
      order.push(`${id}-start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${id}-end`);
    };
    await Promise.all([s.run('ws', op('a', 30)), s.run('ws', op('b', 1))]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('allows different keys to run concurrently', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    const op = (id: string, ms: number) => async () => {
      order.push(`${id}-start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${id}-end`);
    };
    await Promise.all([s.run('x', op('a', 30)), s.run('y', op('b', 1))]);
    expect(order[0]).toBe('a-start');
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });

  it('keeps the chain alive after a rejected op', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    await expect(
      s.run('ws', async () => { order.push('a'); throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    await s.run('ws', async () => { order.push('b'); });
    expect(order).toEqual(['a', 'b']);
  });
});
