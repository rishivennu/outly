import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { AI_FEATURES, isAiFeature, type AiFeature } from "./features";

/**
 * Phase 3 (A4/A5): admin-granted Unlimited AI Access. One live AiEntitlement per person at most; granting again
 * while one is live changes it in place. Time decides expiry (no cron): a grant past expiresAt simply stops
 * matching. A grant lifts AI quotas and the plan's AI budget for the features it covers, never auth, rate
 * limits, file size limits or abuse checks (those live in route() and the routes themselves).
 */

export type GrantFeatures = "all" | AiFeature[];
export type GrantState = "active" | "expired" | "revoked";
export interface Actor {
  login: string;
  role?: string | null;
}

type Row = { id: string; userId: string; features: string; expiresAt: Date | null; note: string; grantedBy: string; revokedAt: Date | null; revokedBy: string | null; createdAt: Date; updatedAt: Date };

export const utcDayKey = (now: Date) => now.toISOString().slice(0, 10);
export const utcMonthKey = (now: Date) => now.toISOString().slice(0, 8); // "YYYY-MM-", a prefix of every day key that month

/** Stored text -> features. Unknown ids are dropped, so a renamed feature never widens a grant. */
export function parseFeatures(raw: string): GrantFeatures {
  if (raw.trim() === "all") return "all";
  const set = new Set(raw.split(",").map((s) => s.trim()).filter(isAiFeature));
  return AI_FEATURES.filter((f) => set.has(f));
}

export function serializeFeatures(f: GrantFeatures): string {
  if (f === "all") return "all";
  const set = new Set(f);
  if (AI_FEATURES.every((x) => set.has(x))) return "all";
  return AI_FEATURES.filter((x) => set.has(x)).join(",");
}

/** Does this grant cover `feature`? "all" asks for a grant on every feature. */
export function covers(features: GrantFeatures, feature: AiFeature | "all"): boolean {
  if (features === "all") return true;
  if (feature === "all") return false;
  return features.includes(feature);
}

export function grantState(g: { revokedAt: Date | null; expiresAt: Date | null }, now: Date): GrantState {
  if (g.revokedAt) return "revoked";
  if (g.expiresAt && g.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

const liveWhere = (now: Date) => ({ revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

/**
 * The live grant covering `feature` for this person, or null. One indexed query (userId, revokedAt), no cache,
 * so a revoke takes effect on the very next call.
 */
export async function activeAiGrant(userId: string, feature: AiFeature | "all", now: Date = new Date()) {
  if (!userId) return null;
  const rows = await db.aiEntitlement.findMany({ where: { userId, ...liveWhere(now) }, select: { id: true, features: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 5 });
  for (const r of rows) {
    const features = parseFeatures(r.features);
    if (covers(features, feature)) return { id: r.id, features, expiresAt: r.expiresAt };
  }
  return null;
}

/** Any live grant for this person (whatever it covers), for the UI. */
export async function liveAiGrant(userId: string, now: Date = new Date()) {
  const r = await db.aiEntitlement.findFirst({ where: { userId, ...liveWhere(now) }, orderBy: { createdAt: "desc" } });
  return r ? view(r, now) : null;
}

export function view(r: Row, now: Date) {
  return { id: r.id, userId: r.userId, features: parseFeatures(r.features), expiresAt: r.expiresAt, note: r.note, grantedBy: r.grantedBy, revokedAt: r.revokedAt, revokedBy: r.revokedBy, createdAt: r.createdAt, updatedAt: r.updatedAt, state: grantState(r, now) };
}
export type AiGrantView = ReturnType<typeof view>;

const snap = (v: unknown) => (v == null ? null : JSON.stringify(v).slice(0, 4000));
const auditSnap = (r: Row | null) => (r ? { features: r.features, expiresAt: r.expiresAt, note: r.note, revokedAt: r.revokedAt } : null);

/** Same AuditLog trail as plan grants (targetType "ai"). Never throws: the change itself already happened. */
async function audit(e: { actor: Actor; action: "ai.grant" | "ai.change" | "ai.revoke"; targetId: string; email: string; before: unknown; after: unknown; note: string }) {
  await db.auditLog
    .create({ data: { actor: e.actor.login.slice(0, 120), actorRole: e.actor.role ?? null, action: e.action, targetType: "ai", targetId: e.targetId, email: e.email.toLowerCase(), before: snap(e.before), after: snap(e.after), note: e.note.slice(0, 500) } })
    .catch((err) => console.error("[audit ai]", err));
}

async function userOf(target: { userId?: string | null; email?: string | null }) {
  const email = target.email?.trim().toLowerCase();
  const user = target.userId
    ? await db.user.findUnique({ where: { id: target.userId }, select: { id: true, email: true, name: true } })
    : email
      ? await db.user.findUnique({ where: { email }, select: { id: true, email: true, name: true } })
      : null;
  if (!user) throw new HttpError(404, "No account with that email or id. Unlimited AI Access needs a registered account.", "NOT_FOUND");
  return user;
}

/** Grant, or change the live grant. expiresAt null = permanent. */
export async function grantAi(input: { userId?: string | null; email?: string | null; features: GrantFeatures; expiresAt: Date | null; note?: string }, actor: Actor, now: Date = new Date()) {
  const features = serializeFeatures(input.features);
  if (!features) throw new HttpError(400, "Pick at least one AI feature.", "VALIDATION");
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) throw new HttpError(400, "Pick an end date in the future.", "VALIDATION");
  const user = await userOf(input);
  const note = (input.note ?? "").trim().slice(0, 500);
  const live = await db.aiEntitlement.findFirst({ where: { userId: user.id, ...liveWhere(now) }, orderBy: { createdAt: "desc" } });
  if (live) {
    const row = await db.aiEntitlement.update({ where: { id: live.id }, data: { features, expiresAt: input.expiresAt, note: note || live.note, grantedBy: actor.login.slice(0, 120) } });
    await audit({ actor, action: "ai.change", targetId: row.id, email: user.email, before: auditSnap(live), after: auditSnap(row), note });
    return { grant: view(row, now), user, changed: true };
  }
  const row = await db.aiEntitlement.create({ data: { userId: user.id, features, expiresAt: input.expiresAt, note, grantedBy: actor.login.slice(0, 120) } });
  await audit({ actor, action: "ai.grant", targetId: row.id, email: user.email, before: null, after: auditSnap(row), note });
  return { grant: view(row, now), user, changed: false };
}

export async function revokeAi(id: string, actor: Actor, note = "", now: Date = new Date()) {
  const before = await db.aiEntitlement.findUnique({ where: { id }, include: { user: { select: { email: true } } } });
  if (!before) throw new HttpError(404, "That grant is gone.", "NOT_FOUND");
  if (before.revokedAt) throw new HttpError(409, "That grant was already revoked.", "ALREADY_REVOKED");
  const row = await db.aiEntitlement.update({ where: { id }, data: { revokedAt: now, revokedBy: actor.login.slice(0, 120) } });
  await audit({ actor, action: "ai.revoke", targetId: id, email: before.user.email, before: auditSnap(before), after: auditSnap(row), note: note.trim() });
  return { grant: view(row, now), userId: row.userId, email: before.user.email };
}

/** Count one AI call per person, day and feature. `unlimited` = it was covered by a grant. Never throws. */
export async function countFeatureUse(userId: string, feature: AiFeature, unlimited: boolean, now: Date = new Date()) {
  const day = utcDayKey(now);
  await db.aiFeatureUsage
    .upsert({
      where: { userId_day_feature: { userId, day, feature } },
      create: { userId, day, feature, count: 1, unlimited: unlimited ? 1 : 0 },
      update: { count: { increment: 1 }, ...(unlimited ? { unlimited: { increment: 1 } } : {}) },
    })
    .catch((err) => console.error("[ai usage]", err));
}

/** This month's AI calls by feature for one person (counted calls, and how many were unlimited). */
export async function featureUsageMonth(userId: string, now: Date = new Date()) {
  const rows = await db.aiFeatureUsage.groupBy({ by: ["feature"], where: { userId, day: { startsWith: utcMonthKey(now) } }, _sum: { count: true, unlimited: true } });
  return AI_FEATURES.map((f) => {
    const r = rows.find((x) => x.feature === f);
    return { feature: f, count: r?._sum.count ?? 0, unlimited: r?._sum.unlimited ?? 0 };
  });
}

const ACTIONS = ["ai.grant", "ai.change", "ai.revoke"];

/** One account's AI picture for the admin: plan, this month's usage, the limit, grants and their trail. */
export async function aiAccessFor(target: { userId?: string | null; email?: string | null }, now: Date = new Date()) {
  const user = await userOf(target);
  const { entitlements } = await import("../billing/entitlements");
  const [ent, byFeature, charged, grants, history] = await Promise.all([
    entitlements(user.id),
    featureUsageMonth(user.id, now),
    db.aiUsage.aggregate({ where: { userId: user.id, kind: "ai", day: { startsWith: utcMonthKey(now) } }, _sum: { count: true } }),
    db.aiEntitlement.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.auditLog.findMany({ where: { email: user.email, action: { in: ACTIONS } }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const views = grants.map((g) => view(g, now));
  return {
    user: { id: user.id, name: user.name, email: user.email },
    plan: ent.planName,
    monthLimit: Math.max(0, ent.aiMonthly),
    monthUsed: charged._sum.count ?? 0,
    byFeature,
    live: views.find((g) => g.state === "active") ?? null,
    grants: views,
    history: history.map((h) => ({ id: h.id, actor: h.actor, actorRole: h.actorRole, action: h.action, note: h.note, createdAt: h.createdAt, before: h.before, after: h.after })),
  };
}

/** Compact AI columns for a page of users (admin Users list): usage this month, limit, live grant. */
export async function aiAccessRows(userIds: string[], now: Date = new Date()) {
  if (!userIds.length) return new Map<string, { monthUsed: number; total: number; monthLimit: number; grant: AiGrantView | null }>();
  const { entitlements } = await import("../billing/entitlements");
  const month = utcMonthKey(now);
  const [charged, totals, grants, limits] = await Promise.all([
    db.aiUsage.groupBy({ by: ["userId"], where: { userId: { in: userIds }, kind: "ai", day: { startsWith: month } }, _sum: { count: true } }),
    db.aiFeatureUsage.groupBy({ by: ["userId"], where: { userId: { in: userIds }, day: { startsWith: month } }, _sum: { count: true } }),
    db.aiEntitlement.findMany({ where: { userId: { in: userIds }, ...liveWhere(now) }, orderBy: { createdAt: "desc" } }),
    Promise.all(userIds.map((id) => entitlements(id).then((e) => [id, Math.max(0, e.aiMonthly)] as const, () => [id, 0] as const))),
  ]);
  const lim = new Map(limits);
  const out = new Map<string, { monthUsed: number; total: number; monthLimit: number; grant: AiGrantView | null }>();
  for (const id of userIds) {
    const g = grants.find((x) => x.userId === id);
    out.set(id, {
      monthUsed: charged.find((x) => x.userId === id)?._sum.count ?? 0,
      total: totals.find((x) => x.userId === id)?._sum.count ?? 0,
      monthLimit: lim.get(id) ?? 0,
      grant: g ? view(g, now) : null,
    });
  }
  return out;
}

export type MonitorFilter = { from?: string; to?: string; q?: string; feature?: AiFeature | ""; status?: GrantState | "" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Admin monitoring (A5). Real aggregates over AiFeatureUsage, AiUsage and AiEntitlement only. */
export async function aiMonitoring(filter: MonitorFilter = {}, now: Date = new Date()) {
  const to = filter.to && DAY.test(filter.to) ? filter.to : utcDayKey(now);
  const from = filter.from && DAY.test(filter.from) && filter.from <= to ? filter.from : `${utcMonthKey(now)}01`;
  const feature = filter.feature && isAiFeature(filter.feature) ? filter.feature : "";
  const q = filter.q?.trim().slice(0, 120) ?? "";
  const status = filter.status === "active" || filter.status === "expired" || filter.status === "revoked" ? filter.status : "";
  const range = { day: { gte: from, lte: to } };
  const ci = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? { mode: "insensitive" as const } : {};
  const who = q ? { user: { OR: [{ email: { contains: q, ...ci } }, { name: { contains: q, ...ci } }] } } : {};

  // Counts come from the whole table (the list below is capped at 200 and follows the status filter).
  // Feature ids are never substrings of each other, so `contains` matches one id in "a,b,c".
  const covering = feature ? { OR: [{ features: "all" }, { features: { contains: feature } }] } : {};
  const [byFeatureRaw, liveRows, grantRows, monthRows, activeCount, expiredCount] = await Promise.all([
    db.aiFeatureUsage.groupBy({ by: ["feature"], where: { ...range, ...(feature ? { feature } : {}), ...who }, _sum: { count: true, unlimited: true } }),
    db.aiEntitlement.findMany({ where: liveWhere(now), select: { userId: true, features: true } }),
    db.aiEntitlement.findMany({
      where: {
        ...who,
        ...(status === "active" ? liveWhere(now) : status === "revoked" ? { revokedAt: { not: null } } : status === "expired" ? { revokedAt: null, expiresAt: { lte: now } } : {}),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.aiUsage.groupBy({ by: ["userId"], where: { kind: "ai", day: { startsWith: utcMonthKey(now) }, ...who }, _sum: { count: true }, orderBy: { _sum: { count: "desc" } }, take: 100 }),
    db.aiEntitlement.count({ where: { ...who, AND: [covering, liveWhere(now)] } }),
    db.aiEntitlement.count({ where: { ...who, AND: [covering, { revokedAt: null, expiresAt: { lte: now } }] } }),
  ]);

  const byFeature = AI_FEATURES.filter((f) => !feature || f === feature)
    .map((f) => {
      const r = byFeatureRaw.find((x) => x.feature === f);
      return { feature: f, count: r?._sum.count ?? 0, unlimited: r?._sum.unlimited ?? 0 };
    })
    .sort((a, b) => b.count - a.count);
  const total = byFeature.reduce((s, r) => s + r.count, 0);
  const unlimitedCalls = byFeature.reduce((s, r) => s + r.unlimited, 0);
  const unlimitedUsers = new Set(liveRows.map((r) => r.userId)).size;

  const grants = grantRows
    .map((g) => ({ ...view(g, now), user: g.user }))
    .filter((g) => !feature || covers(g.features, feature));

  // Near limits: this month's charged AI calls at 80% or more of the plan's monthly cap. Top 100 users by use only.
  const { entitlements } = await import("../billing/entitlements");
  const liveAll = new Map(liveRows.map((r) => [r.userId, parseFeatures(r.features)]));
  const near: { userId: string; used: number; limit: number; pct: number }[] = [];
  await Promise.all(
    monthRows.map(async (r) => {
      const used = r._sum.count ?? 0;
      const e = await entitlements(r.userId).catch(() => null);
      const limit = Math.max(0, e?.aiMonthly ?? 0);
      if (!limit || used < limit * 0.8) return;
      const lf = liveAll.get(r.userId);
      if (lf === "all") return; // unlimited on everything: no limit to be near
      near.push({ userId: r.userId, used, limit, pct: Math.round((used / limit) * 100) });
    }),
  );
  near.sort((a, b) => b.pct - a.pct);
  const nearUsers = near.length ? await db.user.findMany({ where: { id: { in: near.map((n) => n.userId) } }, select: { id: true, name: true, email: true } }) : [];
  const nearLimits = near.map((n) => ({ ...n, user: nearUsers.find((u) => u.id === n.userId) ?? null })).filter((n) => n.user);

  return {
    range: { from, to },
    filter: { q, feature, status },
    total,
    unlimitedCalls,
    unlimitedUsers,
    byFeature,
    mostUsed: byFeature.filter((r) => r.count > 0).slice(0, 3).map((r) => r.feature),
    activeCount,
    expiredCount,
    grants,
    nearLimits,
  };
}
