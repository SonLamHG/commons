export class WorkspaceSerializer {
  private chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn); // run fn after prev settles (success or failure)
    this.chains.set(key, next.then(() => undefined, () => undefined));
    return next;
  }
}

/** Build a serializer key scoped to a tenant so locks never collide across
 *  tenants: tenant A's workspace "ws1" must not block tenant B's "ws1".
 *  Tenant ids are validated to [A-Za-z0-9_-]+, so ':' is an unambiguous separator. */
export function scopeKey(tenantId: string, workspace: string): string {
  return `${tenantId}:${workspace}`;
}
