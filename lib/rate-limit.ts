import "server-only";

// Sliding-window limiter. In-memory per process; swap to Redis (INCR + EXPIRE) when REDIS_URL is set in multi-instance deploys.
type Bucket = { hits: number[] };
const g = globalThis as unknown as { __rl?: Map<string, Bucket> };
const store: Map<string, Bucket> = (g.__rl ??= new Map<string, Bucket>());

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
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
