import { join } from 'node:path';
import { createEngine } from './index.js';
import type { Engine } from './types.js';

const TENANT_ID = /^[A-Za-z0-9_-]+$/;

export interface EngineRegistry {
  /** Engine scoped to one tenant's isolated storage subtree. Cached per tenant. */
  forTenant(tenantId: string): Engine;
  /** Absolute-ish storage root for a tenant (for backup / repair tooling). Validates id. */
  rootFor(tenantId: string): string;
}

/** Per-tenant engine factory. Each tenant gets an isolated subtree at
 *  <rootDir>/tenants/<tenantId>; the underlying engine is reused unchanged. */
export function createEngineRegistry(rootDir: string): EngineRegistry {
  const cache = new Map<string, Engine>();
  const rootFor = (tenantId: string): string => {
    if (!TENANT_ID.test(tenantId)) throw new Error(`invalid tenant id: ${tenantId}`);
    return join(rootDir, 'tenants', tenantId);
  };
  return {
    rootFor,
    forTenant(tenantId: string): Engine {
      const path = rootFor(tenantId); // throws on invalid id
      let engine = cache.get(tenantId);
      if (!engine) {
        engine = createEngine(path);
        cache.set(tenantId, engine);
      }
      return engine;
    },
  };
}
