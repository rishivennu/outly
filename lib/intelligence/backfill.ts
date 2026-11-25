import "server-only";
import { db } from "../db";
import { backfillDue, backfillLockKey, type BackfillVerdict } from "./backfill-core";
import { hasIntelligence } from "./entitlements";
import { runJob } from "./jobs";
import { logLearning } from "./learning";
import { PROFILE_STALE_MS, refreshOwner } from "./profile";
import { PROFILE_WINDOW_DAYS } from "./profile-core";

export type { BackfillVerdict, ColdStart } from "./backfill-core";

/**
 * R1338: kick the upgrade backfill from a read. Called by the first personal reads of /intelligence (GET
 * /api/intelligence/status and /predictions) after the plan check passed: when the owner's workspace profile is missing
 * or stale and they have a published post in the window, `refreshOwner` runs in the background (held open on Vercel
 * through the request context, like the queue), once per owner per BACKFILL_LOCK_MINUTES. The read itself never waits
 * for it and never fails because of it. Logged as IntelligenceJobRun `personal` (trigger api), so the admin page counts
 * backfills with the sweep's runs. Downgrade: `hasIntelligence` is false, nothing runs, nothing is deleted.
 */
export async function kickBackfill(ownerId: string, opts: { now?: Date | number; wait?: boolean } = {}): Promise<{ verdict: BackfillVerdict; coldStart: boolean }> {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const profile = await db.creatorProfile.findUnique({ where: { ownerId_scopeKey_platform: { ownerId, scopeKey: "", platform: "" } }, select: { computedAt: true } });
  const coldStart = !profile;
  if (!backfillDue(profile?.computedAt ?? null, now, PROFILE_STALE_MS)) return { verdict: "fresh", coldStart };
  if (!(await hasIntelligence(ownerId, "personal_learning_enabled").catch(() => false))) return { verdict: "not-entitled", coldStart };
  const posts = await db.post.count({ where: { userId: ownerId, publishedAt: { gte: new Date(now - PROFILE_WINDOW_DAYS * 864e5) }, targets: { some: { platformStatus: "published", practice: false } } }, take: 1 });
  if (!posts) return { verdict: "no-posts", coldStart };
  // The lock: a LearningEvent with a dedupe key per owner per window; the loser of a race reads false.
  const won = await logLearning(ownerId, "backfill_kicked", { dedupeKey: backfillLockKey(now), data: { coldStart } }).catch(() => false);
  if (!won) return { verdict: "locked", coldStart };
  const job = runJob("personal", "api", () => refreshOwner(ownerId, { now, batch: 200, maxBatches: 3 }), {
    summary: (r) => ({ owners: r.skipped ? 0 : 1, features: r.features.written, failed: 0, skipped: r.skipped ? 1 : 0, backfill: true }),
  }).then(
    () => undefined,
    (e) => console.error("[intel] backfill", e instanceof Error ? e.message : e),
  );
  holdOpen(job);
  if (opts.wait) await job;
  return { verdict: "kicked", coldStart };
}

/** Vercel freezes a function once its response is sent; the request context's waitUntil keeps this promise alive. Elsewhere a no-op. */
function holdOpen(p: Promise<unknown>) {
  try {
    const ctx = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined } | undefined>)[Symbol.for("@vercel/request-context")]?.get?.();
    ctx?.waitUntil?.(p);
  } catch {
    /* not on Vercel */
  }
}
