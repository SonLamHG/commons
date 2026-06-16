import { DatabaseSync } from 'node:sqlite';
import { generateId } from '../util/id.js';
import { SCHEMA_SQL } from './schema.js';
import type { Db } from './types.js';

const TENANT_ID = /^[A-Za-z0-9_-]+$/; // must match EngineRegistry: a tenant id is also a safe dir name
const normEmail = (email: string): string => email.trim().toLowerCase();

/** Open (or create) the SaaS metadata SQLite DB at `location` (':memory:' in tests).
 *  Applies pragmas + schema idempotently. Dependency-free via node:sqlite. */
export function createDb(location: string): Db {
  const db = new DatabaseSync(location);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);

  return {
    createTenant(id) {
      if (!TENANT_ID.test(id)) throw new Error(`invalid tenant id: ${id}`);
      const created_at = new Date().toISOString();
      db.prepare('INSERT INTO tenants (id, created_at) VALUES (?, ?)').run(id, created_at);
      return { id, created_at };
    },
    getTenant(id) {
      return db.prepare('SELECT id, created_at FROM tenants WHERE id = ?').get(id) as
        | { id: string; created_at: string } | undefined;
    },

    createUser(email, tenantId) {
      const id = generateId('usr');
      const e = normEmail(email);
      const created_at = new Date().toISOString();
      db.prepare('INSERT INTO users (id, email, tenant_id, created_at) VALUES (?, ?, ?, ?)')
        .run(id, e, tenantId, created_at);
      return { id, email: e, tenant_id: tenantId, created_at };
    },
    getUserByEmail(email) {
      return db.prepare('SELECT id, email, tenant_id, created_at FROM users WHERE email = ?')
        .get(normEmail(email)) as
        | { id: string; email: string; tenant_id: string; created_at: string } | undefined;
    },
    getUserById(id) {
      return db.prepare('SELECT id, email, tenant_id, created_at FROM users WHERE id = ?').get(id) as
        | { id: string; email: string; tenant_id: string; created_at: string } | undefined;
    },

    close() {
      db.close();
    },
  };
}
