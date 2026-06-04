export class WorkspaceSerializer {
  private chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn); // run fn after prev settles (success or failure)
    this.chains.set(key, next.then(() => undefined, () => undefined));
    return next;
  }
}
