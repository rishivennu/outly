import "server-only";
import { env } from "./env";

/**
 * Rate limits.
 *
 * In-memory sliding window per process (good enough for one box and for dev), plus a shared fixed
 * window in Upstash Redis when UPSTASH_REDIS_REST_URL/_TOKEN are set — on Vercel each lambda has its
 * own empty Map, so an attacker spread across instances used to get the limit times the instances.
 *
 * `rateLimit()` / `isLimited()` stay synchronous (lib/otp, lib/admin call them from sync code): they
 * answer from local state, and when Upstash is configured they also fire a background INCR and park a
 * local block when the SHARED counter is over the limit. That makes the limit global with at most one
 * request of lag. `limitShared()` is the awaited version, used by lib/http.ts's route() wrapper.
 */
type Bucket = { hits: number[]; blockedUntil?: number };
const g = globalThis as unknown as { __rl?: Map<string, Bucket> };
const store: Map<string, Bucket> = (g.__rl ??= new Map<string, Bucket>());

const REST_TIMEOUT_MS = 300;

export function sharedLimiterReady() {
  return !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

let lastSweep = 0;
/** Drop idle buckets now and then, so memory stays flat however many distinct visitors arrive. */
function sweep(now: number) {
  if (now - lastSweep < 60_000 || store.size < 5_000) return;
  lastSweep = now;
  for (const [k, v] of store)
    if (!v.hits.length && !v.blockedUntil) store.delete(k);
    else if (now - (v.hits[v.hits.length - 1] ?? 0) > 15 * 60_000 && (v.blockedUntil ?? 0) < now) store.delete(k);
}

function bucket(key: string) {
  const b = store.get(key) ?? { hits: [] };
  store.set(key, b);
  return b;
}

/** Fixed window key: one counter per key per window, so INCR + PEXPIRE is all the state we need. */
function windowKey(key: string, windowMs: number) {
  return `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
}

/** Upstash pipeline: INCR then PEXPIRE. Returns the new count, or null when Redis isn't usable. */
async function remoteIncr(key: string, windowMs: number): Promise<number | null> {
  if (!sharedLimiterReady()) return null;
  const k = windowKey(key, windowMs);
  try {
    const res = await fetch(`${env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", k],
        ["PEXPIRE", k, String(windowMs)],
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { result?: unknown; error?: string }[];
    const n = Number(rows?.[0]?.result);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null; // network, timeout or bad config: fall back to the in-memory window
  }
}

function localTake(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  sweep(now);
  const b = bucket(key);
  if (b.blockedUntil && b.blockedUntil > now) return { ok: false as const, retryAfter: Math.ceil((b.blockedUntil - now) / 1000) };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) return { ok: false as const, retryAfter: Math.ceil((windowMs - (now - b.hits[0])) / 1000) };
  b.hits.push(now);
  return { ok: true as const, remaining: limit - b.hits.length };
}

/** Record a hit and say whether it is allowed. Synchronous; see the file comment. */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const local = localTake(key, limit, windowMs);
  if (sharedLimiterReady()) {
    void remoteIncr(key, windowMs).then((n) => {
      if (n !== null && n > limit) bucket(key).blockedUntil = Math.max(bucket(key).blockedUntil ?? 0, Date.now() + windowMs);
    });
  }
  return local;
}

/**
 * Shared (cross-instance) limit when Upstash is configured, in-memory otherwise. Same shape as
 * rateLimit(), but awaited — the shared counter decides before the request is let through.
 */
export async function limitShared(key: string, limit: number, windowMs: number) {
  if (!sharedLimiterReady()) return rateLimit(key, limit, windowMs);
  const n = await remoteIncr(key, windowMs);
  if (n === null) return rateLimit(key, limit, windowMs); // Redis down: local window still applies
  const b = bucket(key);
  if (n > limit) {
    const retryAfter = Math.ceil((windowMs - (Date.now() % windowMs)) / 1000) || 1;
    b.blockedUntil = Date.now() + retryAfter * 1000;
    return { ok: false as const, retryAfter };
  }
  return { ok: true as const, remaining: Math.max(0, limit - n) };
}

/** Is the key over its limit right now? Reads only, records nothing (pair with rateLimit() on failures). */
export function isLimited(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = store.get(key);
  if (!b) return false;
  if (b.blockedUntil && b.blockedUntil > now) return true;
  return b.hits.filter((t) => now - t < windowMs).length >= limit;
}
