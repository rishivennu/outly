/**
 * Small per-process read cache for hot, shared, rarely-written data (plans, FAQ, admin metrics).
 *
 * - TTL: a value is reused until it is `ttlMs` old, so 1,000 visitors hitting the landing page
 *   in the same second cost one database read, not 1,000.
 * - Single-flight: while one read is in progress, every other caller awaits the same promise,
 *   so a cold cache under load does not stampede the database.
 * - invalidate(prefix): writers clear this instance at once. Other instances (cluster / serverless)
 *   catch up within the TTL, which is why TTLs here are short.
 * - Errors are never cached.
 */
type Entry = { at: number; v?: unknown; p?: Promise<unknown> };
const g = globalThis as unknown as { __outllyCache?: Map<string, Entry> };
const store = (g.__outllyCache ??= new Map());
const MAX = 500;

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const e = store.get(key);
  if (e) {
    if (e.p) return e.p as Promise<T>;
    if (now - e.at < ttlMs) return e.v as T;
  }
  const p = load().then(
    (v) => {
      store.set(key, { at: Date.now(), v });
      return v;
    },
    (err) => {
      store.delete(key);
      throw err;
    },
  );
  store.set(key, { at: now, p });
  if (store.size > MAX) store.delete(store.keys().next().value as string);
  return p;
}

export function invalidate(prefix: string) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

/** Test hook. */
export function cacheSize() {
  return store.size;
}
