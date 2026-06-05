import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublishStore } from '../src/publish/store.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'commons-pub-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('PublishStore', () => {
  it('round-trips webhook config', () => {
    const s = createPublishStore(root);
    expect(s.getConfig('ws1')).toEqual({ webhookUrl: undefined });
    s.setConfig('ws1', { webhookUrl: 'https://hook.example/abc' });
    expect(s.getConfig('ws1').webhookUrl).toBe('https://hook.example/abc');
  });

  it('marks and lists published items', () => {
    const s = createPublishStore(root);
    expect(s.listPublished('ws1')).toEqual({});
    const rec = s.markPublished('ws1', 'items/post-1/post.md');
    expect(rec.publishedAt).toMatch(/^\d{4}-/);
    expect(s.listPublished('ws1')['items/post-1/post.md']).toBeDefined();
  });

  it('persists across store instances (re-read from disk)', () => {
    createPublishStore(root).setConfig('ws1', { webhookUrl: 'https://h/x' });
    createPublishStore(root).markPublished('ws1', 'a.md');
    const s2 = createPublishStore(root);
    expect(s2.getConfig('ws1').webhookUrl).toBe('https://h/x');
    expect(s2.listPublished('ws1')['a.md']).toBeDefined();
  });

  it('keeps config and published independent (setConfig does not wipe published)', () => {
    const s = createPublishStore(root);
    s.markPublished('ws1', 'a.md');
    s.setConfig('ws1', { webhookUrl: 'https://h/y' });
    expect(s.listPublished('ws1')['a.md']).toBeDefined();
    expect(s.getConfig('ws1').webhookUrl).toBe('https://h/y');
  });
});
