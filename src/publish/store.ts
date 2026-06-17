import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { encryptSecret, decryptSecret } from '../util/secretbox.js';

export interface PublishConfig { webhookUrl?: string; }
export interface PublishRecord { publishedAt: string; }
interface PublishData { webhookUrl?: string; published: Record<string, PublishRecord>; }

export interface PublishStore {
  getConfig(ws: string): PublishConfig;
  setConfig(ws: string, config: PublishConfig): void;
  listPublished(ws: string): Record<string, PublishRecord>;
  markPublished(ws: string, path: string): PublishRecord;
}

/** Per-tenant publish metadata. `secret` keys the at-rest encryption of webhookUrl. */
export function createPublishStore(rootDir: string, secret: string): PublishStore {
  rootDir = resolve(rootDir);
  const file = (ws: string) => join(rootDir, 'meta', ws, 'publish.json');
  const read = (ws: string): PublishData => {
    const f = file(ws);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { published: {} };
  };
  const write = (ws: string, data: PublishData) => {
    const f = file(ws);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(data, null, 2));
  };
  return {
    getConfig(ws) {
      const stored = read(ws).webhookUrl;
      return { webhookUrl: stored ? decryptSecret(stored, secret) : undefined };
    },
    setConfig(ws, config) {
      const d = read(ws);
      d.webhookUrl = config.webhookUrl ? encryptSecret(config.webhookUrl, secret) : undefined;
      write(ws, d);
    },
    listPublished(ws) { return read(ws).published; },
    markPublished(ws, path) {
      const d = read(ws);
      const rec: PublishRecord = { publishedAt: new Date().toISOString() };
      d.published[path] = rec;
      write(ws, d);
      return rec;
    },
  };
}
