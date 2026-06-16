export interface Tenant { id: string; created_at: string; }
export interface User { id: string; email: string; tenant_id: string; created_at: string; }
export interface Invite { email: string; invited_at: string; accepted_at: string | null; }
export interface Run {
  id: string; user_id: string; tenant_id: string; workspace: string;
  status: string; cost_usd: number; num_turns: number; model: string | null;
  created_at: string; finished_at: string | null;
}
export interface UsageSummary { runs: number; costUsd: number; }

export interface Db {
  createTenant(id: string): Tenant;
  getTenant(id: string): Tenant | undefined;

  createUser(email: string, tenantId: string): User;
  getUserByEmail(email: string): User | undefined;
  getUserById(id: string): User | undefined;

  addInvite(email: string): Invite;
  isInvited(email: string): boolean;
  markInviteAccepted(email: string): void;

  createRun(input: { userId: string; tenantId: string; workspace: string; model?: string | null }): Run;
  finishRun(id: string, result: { status: string; costUsd: number; numTurns: number }): void;
  getRun(id: string): Run | undefined;
  usageSince(userId: string, sinceIso: string): UsageSummary;

  close(): void;
}
