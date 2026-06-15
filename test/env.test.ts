import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../src/util/env.js';

describe('loadEnv', () => {
  const key = 'COMMONS_TEST_ENV_VAR';
  afterEach(() => { delete process.env[key]; });

  it('loads variables from a .env file into process.env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'commons-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, `${key}=hello-from-env\n`);
    try {
      loadEnv(file);
      expect(process.env[key]).toBe('hello-from-env');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when the file does not exist', () => {
    expect(() => loadEnv(join(tmpdir(), 'definitely-missing-commons.env'))).not.toThrow();
  });
});
