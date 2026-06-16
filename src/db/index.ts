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

    addInvite(email) {
      const e = normEmail(email);
      db.prepare('INSERT OR IGNORE INTO invites (email, invited_at) VALUES (?, ?)')
        .run(e, new Date().toISOString());
      return db.prepare('SELECT email, invited_at, accepted_at FROM invites WHERE email = ?')
        .get(e) as { email: string; invited_at: string; accepted_at: string | null };
    },
    isInvited(email) {
      return db.prepare('SELECT 1 FROM invites WHERE email = ?').get(normEmail(email)) !== undefined;
    },
    markInviteAccepted(email) {
      db.prepare('UPDATE invites SET accepted_at = ? WHERE email = ?')
        .run(new Date().toISOString(), normEmail(email));
    },

    createRun({ userId, tenantId, workspace, model }) {
      const id = generateId('run');
      const created_at = new Date().toISOString();
      db.prepare(
        'INSERT INTO runs (id, user_id, tenant_id, workspace, status, cost_usd, num_turns, model, created_at) ' +
        "VALUES (?, ?, ?, ?, 'running', 0, 0, ?, ?)",
      ).run(id, userId, tenantId, workspace, model ?? null, created_at);
      return {
        id, user_id: userId, tenant_id: tenantId, workspace,
        status: 'running', cost_usd: 0, num_turns: 0, model: model ?? null,
        created_at, finished_at: null,
      };
    },
    finishRun(id, { status, costUsd, numTurns }) {
      db.prepare('UPDATE runs SET status = ?, cost_usd = ?, num_turns = ?, finished_at = ? WHERE id = ?')
        .run(status, costUsd, numTurns, new Date().toISOString(), id);
    },
    getRun(id) {
      return db.prepare(
        'SELECT id, user_id, tenant_id, workspace, status, cost_usd, num_turns, model, created_at, finished_at ' +
        'FROM runs WHERE id = ?',
      ).get(id) as {
        id: string; user_id: string; tenant_id: string; workspace: string;
        status: string; cost_usd: number; num_turns: number; model: string | null;
        created_at: string; finished_at: string | null;
      } | undefined;
    },
    usageSince(userId, sinceIso) {
      const row = db.prepare(
        'SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS costUsd FROM runs WHERE user_id = ? AND created_at >= ?',
      ).get(userId, sinceIso) as { runs: number; costUsd: number };
      return { runs: row.runs, costUsd: row.costUsd };
    },

    close() {
      db.close();
    },
  };
}
