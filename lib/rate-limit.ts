import "server-only";

// Sliding-window limiter. In-memory per process; swap to Redis (INCR + EXPIRE) when REDIS_URL is set in multi-instance deploys.
type Bucket = { hits: number[] };
const g = globalThis as unknown as { __rl?: Map<string, Bucket> };
const store: Map<string, Bucket> = (g.__rl ??= new Map<string, Bucket>());

let lastSweep = 0;
/** Drop idle buckets now and then, so memory stays flat however many distinct visitors arrive. */
function sweep(now: number) {
  if (now - lastSweep < 60_000 || store.size < 5_000) return;
  lastSweep = now;
  for (const [k, v] of store) if (!v.hits.length || now - v.hits[v.hits.length - 1] > 15 * 60_000) store.delete(k);
}

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  sweep(now);
  const b = store.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    store.set(key, b);
    return { ok: false as const, retryAfter: Math.ceil((windowMs - (now - b.hits[0])) / 1000) };
  }
  b.hits.push(now);
  store.set(key, b);
  return { ok: true as const, remaining: limit - b.hits.length };
}

/** Is the key over its limit right now? Reads only, records nothing (pair with rateLimit() on failures). */
export function isLimited(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = store.get(key);
  return !!b && b.hits.filter((t) => now - t < windowMs).length >= limit;
}
