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
type Entry = { at: number; v?: unknown; p?: Promise<unknown>; r?: Promise<unknown>; rAt?: number };
/** A background refresh that hasn't answered in this long no longer blocks the next one. */
const REFRESH_STUCK_MS = 30_000;
const g = globalThis as unknown as { __outllyCache?: Map<string, Entry> };
const store = (g.__outllyCache ??= new Map());
const MAX = 500;
/** Bumped by invalidate(), so a read that started before a write can't put the old value back. */
let gen = 0;

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const e = store.get(key);
  if (e) {
    if (e.p) return e.p as Promise<T>;
    if (now - e.at < ttlMs) return e.v as T;
  }
  const born = gen;
  const p = load().then(
    (v) => {
      if (born === gen) store.set(key, { at: Date.now(), v });
      else if (store.get(key)?.p === p) store.delete(key);
      return v;
    },
    (err) => {
      if (store.get(key)?.p === p) store.delete(key);
      throw err;
    },
  );
  store.set(key, { at: now, p });
  if (store.size > MAX) store.delete(store.keys().next().value as string);
  return p;
}

/**
 * 1142: stale-while-revalidate. A value younger than `freshMs` is reused as `cached` does; one younger than
 * `staleMs` is answered at once while a single background read replaces it, so a page never waits on a slow read
 * it has a recent copy of. Past `staleMs` (or nothing kept) the caller waits, as with `cached`.
 */
export async function cachedStale<T>(key: string, freshMs: number, staleMs: number, load: () => Promise<T>): Promise<T> {
  const e = store.get(key);
  if (e && !e.p && "v" in e && Date.now() - e.at < staleMs) {
    if (Date.now() - e.at >= freshMs && (!e.r || Date.now() - (e.rAt ?? 0) > REFRESH_STUCK_MS)) {
      const born = gen;
      e.rAt = Date.now();
      const r: Promise<unknown> = Promise.resolve()
        .then(load) // a load that throws synchronously still lands in the catch below
        .then(
          (v) => {
            if (born === gen && store.get(key) === e) store.set(key, { at: Date.now(), v });
          },
          () => {
            if (store.get(key) === e && e.r === r) e.r = undefined; // keep the copy; the next read tries again
          },
        );
      e.r = r;
    }
    return e.v as T;
  }
  return cached(key, freshMs, load);
}

export function invalidate(prefix: string) {
  gen++;
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

/** Test hook. */
export function cacheSize() {
  return store.size;
}
