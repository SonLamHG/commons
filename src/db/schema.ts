/** DDL for the SaaS metadata DB. Idempotent (IF NOT EXISTS), applied on open.
 *  Kept separate from git state — see SAAS_BETA_ARCHITECTURE.md ADR-7. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  email TEXT PRIMARY KEY,
  invited_at TEXT NOT NULL,
  accepted_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  status TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  num_turns INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_user_created ON runs(user_id, created_at);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  tenant_id TEXT,
  message TEXT NOT NULL,
  context TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  tenant_id TEXT,
  name TEXT NOT NULL,
  props TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
`;
