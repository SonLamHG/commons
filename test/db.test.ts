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

describe('db: invites (allowlist)', () => {
  it('adds an invite and checks membership case-insensitively', () => {
    db.addInvite('Bob@Example.com');
    expect(db.isInvited('bob@example.com')).toBe(true);
    expect(db.isInvited('nobody@example.com')).toBe(false);
  });

  it('is idempotent on re-invite and tracks acceptance', () => {
    const first = db.addInvite('c@x.com');
    expect(first.accepted_at).toBeNull();
    db.addInvite('c@x.com'); // no throw, idempotent
    db.markInviteAccepted('C@X.com');
    const again = db.addInvite('c@x.com');
    expect(again.accepted_at).not.toBeNull();
  });
});

describe('db: runs & usage', () => {
  const seedUser = () => { db.createTenant('acme'); return db.createUser('a@x.com', 'acme').id; };

  it('creates a running run and finishes it', () => {
    const userId = seedUser();
    const run = db.createRun({ userId, tenantId: 'acme', workspace: 'ws1', model: 'claude-haiku-4-5' });
    expect(run.status).toBe('running');
    expect(run.cost_usd).toBe(0);
    db.finishRun(run.id, { status: 'success', costUsd: 0.012, numTurns: 5 });
    const got = db.getRun(run.id);
    expect(got?.status).toBe('success');
    expect(got?.cost_usd).toBeCloseTo(0.012);
    expect(got?.num_turns).toBe(5);
    expect(got?.finished_at).not.toBeNull();
  });

  it('summarises usage for a user since a timestamp', () => {
    const userId = seedUser();
    const r1 = db.createRun({ userId, tenantId: 'acme', workspace: 'ws1' });
    const r2 = db.createRun({ userId, tenantId: 'acme', workspace: 'ws1' });
    db.finishRun(r1.id, { status: 'success', costUsd: 0.01, numTurns: 2 });
    db.finishRun(r2.id, { status: 'success', costUsd: 0.02, numTurns: 3 });

    const all = db.usageSince(userId, '1970-01-01T00:00:00.000Z');
    expect(all.runs).toBe(2);
    expect(all.costUsd).toBeCloseTo(0.03);

    const future = db.usageSince(userId, '2999-01-01T00:00:00.000Z');
    expect(future).toEqual({ runs: 0, costUsd: 0 });
  });
});

describe('db: feedback & events', () => {
  it('stores and lists feedback', () => {
    const f1 = db.addFeedback({ message: 'first', userId: null, tenantId: null });
    const f2 = db.addFeedback({ message: 'second', context: 'proposals tab' });
    const list = db.listFeedback();
    expect(list.length).toBe(2);
    expect(list.map((f) => f.message)).toContain('first');
    expect(list.find((f) => f.id === f2.id)?.context).toBe('proposals tab');
    expect(list.find((f) => f.id === f1.id)?.context).toBeNull();
  });

  it('records events and counts by name', () => {
    db.recordEvent({ name: 'workspace_created', tenantId: 'acme' });
    db.recordEvent({ name: 'proposal_merged', userId: 'u1', props: { ws: 'ws1' } });
    db.recordEvent({ name: 'proposal_merged' });
    expect(db.countEvents('proposal_merged')).toBe(2);
    expect(db.countEvents('workspace_created')).toBe(1);
    expect(db.countEvents('never')).toBe(0);
  });
});
