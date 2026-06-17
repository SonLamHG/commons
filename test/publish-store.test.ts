import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublishStore } from '../src/publish/store.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pub-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('publish store at-rest encryption', () => {
  it('round-trips webhookUrl but does not store it in plaintext', () => {
    const store = createPublishStore(root, 'srv-secret');
    store.setConfig('ws1', { webhookUrl: 'https://hook.example/secret-path' });
    expect(store.getConfig('ws1').webhookUrl).toBe('https://hook.example/secret-path');

    const onDisk = readFileSync(join(root, 'meta', 'ws1', 'publish.json'), 'utf8');
    expect(onDisk).not.toContain('hook.example');   // encrypted at rest
    expect(onDisk).toContain('enc:v1:');
  });

  it('clearing the webhook (undefined) yields no webhookUrl', () => {
    const store = createPublishStore(root, 'srv-secret');
    store.setConfig('ws1', { webhookUrl: 'https://hook.example/x' });
    store.setConfig('ws1', { webhookUrl: undefined });
    expect(store.getConfig('ws1').webhookUrl).toBeUndefined();
  });

  it('reads back a value written with the same store', () => {
    createPublishStore(root, 's').setConfig('ws2', { webhookUrl: 'https://plain.example/y' });
    expect(createPublishStore(root, 's').getConfig('ws2').webhookUrl).toBe('https://plain.example/y');
  });
});
