export interface Tenant { id: string; created_at: string; }
export interface User { id: string; email: string; tenant_id: string; created_at: string; }

export interface Db {
  createTenant(id: string): Tenant;
  getTenant(id: string): Tenant | undefined;

  createUser(email: string, tenantId: string): User;
  getUserByEmail(email: string): User | undefined;
  getUserById(id: string): User | undefined;

  close(): void;
}
