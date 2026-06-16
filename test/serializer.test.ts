import { describe, it, expect } from 'vitest';
import { WorkspaceSerializer, scopeKey } from '../src/util/serializer.js';

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

describe('scopeKey', () => {
  const op = (order: string[], id: string, ms: number) => async () => {
    order.push(`${id}-start`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${id}-end`);
  };

  it('namespaces a workspace under a tenant', () => {
    expect(scopeKey('acme', 'ws1')).toBe('acme:ws1');
  });

  it('lets the same workspace id in different tenants run concurrently', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    await Promise.all([
      s.run(scopeKey('acme', 'ws1'), op(order, 'a', 30)),
      s.run(scopeKey('globex', 'ws1'), op(order, 'b', 1)),
    ]);
    // b (tenant globex) finishes before a (tenant acme) despite the same ws id
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });

  it('serializes the same workspace within one tenant', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    await Promise.all([
      s.run(scopeKey('acme', 'ws1'), op(order, 'a', 30)),
      s.run(scopeKey('acme', 'ws1'), op(order, 'b', 1)),
    ]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});
