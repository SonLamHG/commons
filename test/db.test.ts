import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb } from '../src/db/index.js';

let db: ReturnType<typeof createDb>;
beforeEach(() => { db = createDb(':memory:'); });
afterEach(() => { db.close(); });

describe('db: tenants & users', () => {
  it('creates and reads a tenant', () => {
    const t = db.createTenant('acme');
    expect(t.id).toBe('acme');
    expect(db.getTenant('acme')?.id).toBe('acme');
    expect(db.getTenant('nope')).toBeUndefined();
  });

  it('rejects an invalid tenant id', () => {
    expect(() => db.createTenant('bad id!')).toThrow(/invalid tenant id/);
  });

  it('creates a user and looks it up by email (case-insensitive)', () => {
    db.createTenant('acme');
    const u = db.createUser('Alice@Example.com', 'acme');
    expect(u.email).toBe('alice@example.com');
    expect(u.tenant_id).toBe('acme');
    expect(db.getUserByEmail('ALICE@example.com')?.id).toBe(u.id);
    expect(db.getUserById(u.id)?.email).toBe('alice@example.com');
  });

  it('enforces unique email', () => {
    db.createTenant('acme');
    db.createUser('a@x.com', 'acme');
    expect(() => db.createUser('a@x.com', 'acme')).toThrow();
  });

  it('rejects a user for a non-existent tenant (FK)', () => {
    expect(() => db.createUser('a@x.com', 'ghost')).toThrow();
  });
});
