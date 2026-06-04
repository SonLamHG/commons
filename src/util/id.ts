let counter = 0;

export function generateId(prefix = ''): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  const c = (counter++).toString(36); // guards against same-ms collisions
  const id = `${t}-${r}${c}`;
  return prefix ? `${prefix}-${id}` : id;
}
