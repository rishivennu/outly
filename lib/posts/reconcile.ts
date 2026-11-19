import "server-only";
import type { PostTarget, Prisma, SocialAccount } from "@prisma/client";
import { db } from "../db";
import { isPlatform, PLATFORM_META, type Platform } from "../domain";
import { liveAccount } from "../live/account";
import { invalidateDashboards } from "../live";
import { invalidateComments } from "../inbox";
import { snapshotTarget, targetInsights } from "../insights/post";
import { publisherForAccount } from "../social/registry";
import { asPublisherError } from "../social/types";
import { CONFIRM_MS, nextVerify, type VerifyOutcome } from "./lifecycle";

/**
 * R1219: cross-platform sync. Asks a platform whether a live post is still there and records the answer with
 * lib/posts/lifecycle's rules (two misses, CONFIRM_MS apart, before anything is called deleted).
 *
 * Where the check comes from, per platform:
 *  - a publisher with `exists` (Instagram): one cheap lookup;
 *  - otherwise the per-post insights read (YouTube, Facebook): "GONE" is a miss, numbers are a sighting
 *    (and are saved, so a Sync now also refreshes the figures);
 *  - X, Threads, LinkedIn, TikTok: no read path yet, so nothing is claimed ("unsupported").
 * Practice posts never reached a platform and are skipped.
 */
type Row = PostTarget & { socialAccount: SocialAccount | null };

export type CheckOutcome = "live" | "missing" | "deleted" | "unavailable" | "unsupported" | "error";
export type CheckResult = { targetId: string; postId: string; platform: string; outcome: CheckOutcome; code?: string };
export interface ReconcileSummary {
  checked: number;
  live: number;
  missing: number;
  deleted: number;
  unavailable: number;
  unsupported: number;
  errors: number;
  results: CheckResult[];
  /** Set when a Sync now came too soon after the last one; nothing was asked. */
  cooldownMs?: number;
}

const WITH_INSIGHTS: readonly string[] = ["instagram", "youtube", "facebook"];

async function ask(t: Row): Promise<VerifyOutcome> {
  if (t.practice) return "unsupported";
  if (!isPlatform(t.platform) || !t.platformPostId) return "unsupported";
  const acct = t.socialAccount;
  if (!acct || acct.status !== "connected") return "unavailable";
  const publisher = publisherForAccount(t.platform, acct);
  if (publisher.exists) {
    try {
      return (await publisher.exists(await liveAccount(acct), t.platformPostId)) ? "live" : "missing";
    } catch (e) {
      const pe = asPublisherError(e);
      console.warn(`[reconcile] ${t.platform} exists ${t.id}: ${pe.code}`);
      return { error: pe.code };
    }
  }
  if (!WITH_INSIGHTS.includes(t.platform)) return "unsupported";
  const ins = await targetInsights(t).catch(() => null);
  if (!ins) return { error: "FETCH_FAILED" };
  if (ins.status === "live") {
    await snapshotTarget(ins).catch(() => {});
    return "live";
  }
  if (ins.status === "error") {
    if (ins.code === "GONE") return "missing";
    if (ins.code === "NOT_CONNECTED") return "unavailable";
    return { error: ins.code ?? "FETCH_FAILED" };
  }
  return "unsupported";
}

const name = (p: string) => (isPlatform(p) ? PLATFORM_META[p as Platform].name : p);

/**
 * Record one check. Idempotent: the same answer twice writes the same row. A confirmed delete also leaves a
 * note in the post's activity (who did what, when) and clears the dashboards and comment caches that counted it.
 */
export async function applyVerify(t: Row, outcome: VerifyOutcome, now = new Date()): Promise<CheckResult> {
  const { confirmedGone, ...data } = nextVerify(t, outcome, now);
  const base = { targetId: t.id, postId: t.postId, platform: t.platform };
  if (Object.keys(data).length) await db.postTarget.update({ where: { id: t.id }, data: { ...data, metricsCheckedAt: now } }).catch((e) => console.warn(`[reconcile] save ${t.id}: ${(e as Error).message}`));
  if (confirmedGone) {
    const mins = t.missingSince ? Math.max(1, Math.round((now.getTime() - t.missingSince.getTime()) / 60_000)) : Math.round(CONFIRM_MS / 60_000);
    await db.postNote
      .create({ data: { postId: t.postId, authorId: "system", authorName: "Outlly", kind: "sync", body: `${name(t.platform)} no longer has this post. Outlly checked twice, ${mins} minutes apart, before recording it as deleted there. The numbers it had are kept.` } })
      .catch(() => {});
    invalidateComments(t.id);
    const owner = await db.post.findUnique({ where: { id: t.postId }, select: { userId: true } });
    if (owner) invalidateDashboards(owner.userId);
    return { ...base, outcome: "deleted" };
  }
  if (typeof outcome === "object") return { ...base, outcome: "error", code: outcome.error };
  return { ...base, outcome };
}

export async function verifyTarget(t: Row, now = new Date()): Promise<CheckResult> {
  return applyVerify(t, await ask(t), now);
}

function summarize(results: CheckResult[]): ReconcileSummary {
  const s: ReconcileSummary = { checked: 0, live: 0, missing: 0, deleted: 0, unavailable: 0, unsupported: 0, errors: 0, results };
  for (const r of results) {
    if (r.outcome !== "unsupported") s.checked++;
    if (r.outcome === "error") s.errors++;
    else s[r.outcome]++;
  }
  return s;
}

/** Destinations worth asking about: live on a platform, not already recorded as gone. */
const openWhere = (): Prisma.PostTargetWhereInput => ({ platformStatus: "published", platformPostId: { not: null }, practice: false, OR: [{ removeMode: null }, { removeMode: { not: "deleted" } }] });
const withAccount = { socialAccount: true } as const;

/** In-flight runs on this instance: a double tap or two tabs share one answer. */
const running = new Map<string, Promise<ReconcileSummary>>();
const lastRun = new Map<string, number>();
export const USER_COOLDOWN_MS = 60_000;
export const USER_BATCH = 25;

function once(key: string, go: () => Promise<ReconcileSummary>) {
  const r = running.get(key);
  if (r) return r;
  const p = go().finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

/** Check every live destination of one post now (the post sheet's "Check now"). */
export function reconcilePost(userId: string, postId: string, now = new Date()): Promise<ReconcileSummary> {
  return once(`post:${userId}:${postId}`, async () => {
    const rows: Row[] = await db.postTarget.findMany({ where: { postId, post: { userId }, ...openWhere() }, include: withAccount });
    const out: CheckResult[] = [];
    for (const t of rows) out.push(await verifyTarget(t, now));
    return summarize(out);
  });
}

/**
 * The library's "Sync now": the posts most in need of a check first (flagged ones, then never checked, then the
 * oldest check), USER_BATCH at a time, at most once a minute per workspace so a tap storm can't hammer a platform.
 */
export function reconcileUser(userId: string, now = new Date()): Promise<ReconcileSummary> {
  return once(`user:${userId}`, async () => {
    const last = lastRun.get(userId) ?? 0;
    if (now.getTime() - last < USER_COOLDOWN_MS) return { ...summarize([]), cooldownMs: USER_COOLDOWN_MS - (now.getTime() - last) };
    lastRun.set(userId, now.getTime());
    const base: Prisma.PostTargetWhereInput = { post: { userId, archivedAt: null }, ...openWhere() };
    const flagged: Row[] = await db.postTarget.findMany({ where: { ...base, verifyState: { not: null } }, include: withAccount, take: USER_BATCH, orderBy: { missingSince: "asc" } });
    const seen = new Set(flagged.map((t) => t.id));
    const never: Row[] = flagged.length < USER_BATCH ? await db.postTarget.findMany({ where: { ...base, verifyState: null, lastVerifiedAt: null }, include: withAccount, take: USER_BATCH - flagged.length, orderBy: { publishedAt: "desc" } }) : [];
    for (const t of never) seen.add(t.id);
    const left = USER_BATCH - seen.size;
    const oldest: Row[] = left > 0 ? await db.postTarget.findMany({ where: { ...base, verifyState: null, lastVerifiedAt: { not: null }, id: { notIn: [...seen] } }, include: withAccount, take: left, orderBy: { lastVerifiedAt: "asc" } }) : [];
    const out: CheckResult[] = [];
    for (const t of [...flagged, ...never, ...oldest]) out.push(await verifyTarget(t, now));
    return summarize(out);
  });
}

/** Tests and the sync worker reset the per-workspace cooldown. */
export function resetReconcileCooldown(userId?: string) {
  if (userId) lastRun.delete(userId);
  else lastRun.clear();
}
