import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Load environment variables from a `.env` file at the project root, if present.
 * Dependency-free (Node's built-in `process.loadEnvFile`). Call this FIRST in
 * every entry point so secrets like GEMINI_API_KEY are available regardless of
 * how the process was launched. No-op when the file is absent.
 */
export function loadEnv(path = resolve(process.cwd(), '.env')): void {
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch (e) {
    process.stderr.write(`could not load ${path}: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
