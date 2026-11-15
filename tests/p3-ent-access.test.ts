/**
 * Phase 3 (A4/A5/A6): admin Unlimited AI Access. Grants are per person and per feature, expire by time, revoke
 * at once, write the audit log, are admin only, and never change anyone else's limits. Every AI call is counted
 * in AiFeatureUsage; covered calls spend no AiUsage quota. Monitoring reads real aggregates.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const DAY = 86_400_000;
let db: typeof import("../lib/db").db;
let quota: typeof import("../lib/ai-quota");
let ents: typeof import("../lib/ai/entitlements");
let billing: typeof import("../lib/billing/entitlements");
let adminAuth: typeof import("../lib/admin/auth");
let accessRoute: typeof import("../app/api/admin/ai-access/route");
let grantRoute: typeof import("../app/api/admin/ai-access/[id]/route");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  quota = await import("../lib/ai-quota");
  ents = await import("../lib/ai/entitlements");
  billing = await import("../lib/billing/entitlements");
  adminAuth = await import("../lib/admin/auth");
  accessRoute = await import("../app/api/admin/ai-access/route");
  grantRoute = await import("../app/api/admin/ai-access/[id]/route");
}, 60_000);
afterAll(() => jar.clear());

let n = 0;
const tag = () => `${Date.now().toString(36)}${n++}`;
const actor = { login: "fin@outlly.test", role: "finance" };
const status = async (p: Promise<unknown>) => p.then(() => 0, (e) => e as { status?: number; code?: string });
const NOW = new Date("2026-11-10T10:00:00Z");
async function onPlan(caps: { aiDaily?: number; aiMonthly?: number; captionVideos?: number; aiCaptions?: boolean } = {}) {
  const p = await db.plan.create({ data: { slug: `p3e-${tag()}`, name: "Tight", priceMinor: 100, state: "hidden", aiDaily: caps.aiDaily ?? 1, aiMonthly: caps.aiMonthly ?? 2, captionVideos: caps.captionVideos ?? 1, aiCaptions: caps.aiCaptions ?? true } });
  const u = await db.user.create({ data: { name: `E ${tag()}`, email: `p3e-${tag()}@test.dev`, passwordHash: "x" } });
  await db.subscription.create({ data: { userId: u.id, planId: p.id, status: "active", priceMinor: 100, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(NOW.getTime() + 60 * DAY) } });
  return u;
}
const usage = (userId: string, feature: string, day = "2026-11-10") => db.aiFeatureUsage.findUnique({ where: { userId_day_feature: { userId, day, feature } } });

describe("pure helpers", () => {
  test("features round-trip, unknown ids dropped, every feature collapses to all", () => {
    expect(ents.parseFeatures("all")).toBe("all");
    expect(ents.parseFeatures("translation,bogus,captions")).toEqual(["captions", "translation"]);
    expect(ents.serializeFeatures(["translation", "captions"])).toBe("captions,translation");
    expect(ents.serializeFeatures(["captions", "transcription", "translation", "rewrite", "content", "other"])).toBe("all");
    expect(ents.covers("all", "content")).toBe(true);
    expect(ents.covers(["content"], "content")).toBe(true);
    expect(ents.covers(["content"], "captions")).toBe(false);
    expect(ents.covers(["content"], "all")).toBe(false);
  });
  test("state is decided by time and revocation", () => {
    expect(ents.grantState({ revokedAt: null, expiresAt: null }, NOW)).toBe("active");
    expect(ents.grantState({ revokedAt: null, expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe("expired");
    expect(ents.grantState({ revokedAt: NOW, expiresAt: null }, NOW)).toBe("revoked");
  });
});

describe("quota enforcement", () => {
  test("grant to one user: they go past the cap, another user on the same limits is unchanged", async () => {
    const a = await onPlan();
    const b = await onPlan();
    await ents.grantAi({ userId: a.id, features: "all", expiresAt: null, note: "partner" }, actor, NOW);
    for (let i = 0; i < 5; i++) expect((await quota.chargeAi(a.id, "ai", NOW, undefined, "content")).unlimited).toBe(true);
    expect(await db.aiUsage.findUnique({ where: { userId_day_kind: { userId: a.id, day: "2026-11-10", kind: "ai" } } })).toBeNull();
    expect(await usage(a.id, "content")).toMatchObject({ count: 5, unlimited: 5 });
    await quota.chargeAi(b.id, "ai", NOW, undefined, "content");
    expect(await status(quota.chargeAi(b.id, "ai", NOW, undefined, "content"))).toMatchObject({ status: 429, code: "AI_QUOTA" });
    expect(await usage(b.id, "content")).toMatchObject({ count: 1, unlimited: 0 });
    expect(await quota.aiQuota(a.id, "ai", NOW)).toMatchObject({ unlimited: true, expiresAt: null, monthLimit: 0, limit: 0 });
    expect(await quota.aiQuota(b.id, "ai", NOW)).toMatchObject({ unlimited: false, monthLimit: 2, grant: null });
  });

  test("selected features only: a feature that is not granted is still limited", async () => {
    const u = await onPlan();
    await ents.grantAi({ userId: u.id, features: ["translation"], expiresAt: null }, actor, NOW);
    for (let i = 0; i < 3; i++) await quota.chargeAi(u.id, "ai", NOW, undefined, "translation");
    await quota.chargeAi(u.id, "ai", NOW, undefined, "content");
    expect(await status(quota.chargeAi(u.id, "ai", NOW, undefined, "content"))).toMatchObject({ status: 429 });
    expect(await usage(u.id, "translation")).toMatchObject({ count: 3, unlimited: 3 });
    expect(await usage(u.id, "content")).toMatchObject({ count: 1, unlimited: 0 });
    const q = await quota.aiQuota(u.id, "ai", NOW);
    expect(q.unlimited).toBe(false); // not every feature
    expect(q.grant).toMatchObject({ features: ["translation"] });
    expect((await quota.aiQuota(u.id, "ai", NOW, "translation")).unlimited).toBe(true);
  });

  test("revoke: the limit is back on the very next call", async () => {
    const u = await onPlan();
    const g = await ents.grantAi({ userId: u.id, features: "all", expiresAt: null }, actor, NOW);
    await quota.chargeAi(u.id, "ai", NOW, undefined, "other");
    await quota.chargeAi(u.id, "ai", NOW, undefined, "other");
    await ents.revokeAi(g.grant.id, actor, "trial over", NOW);
    expect((await quota.chargeAi(u.id, "ai", NOW, undefined, "other")).unlimited).toBe(false);
    expect(await status(quota.chargeAi(u.id, "ai", NOW, undefined, "other"))).toMatchObject({ status: 429 });
    expect(await status(ents.revokeAi(g.grant.id, actor, "", NOW))).toMatchObject({ status: 409 });
  });

  test("auto expiry: an end date in the past means limited, no cron needed", async () => {
    const u = await onPlan();
    await ents.grantAi({ userId: u.id, features: "all", expiresAt: new Date(NOW.getTime() + DAY) }, actor, NOW);
    expect((await quota.chargeAi(u.id, "ai", NOW, undefined, "content")).unlimited).toBe(true);
    const later = new Date(NOW.getTime() + 2 * DAY);
    expect(await ents.activeAiGrant(u.id, "content", later)).toBeNull();
    await quota.chargeAi(u.id, "ai", later, undefined, "content");
    expect(await status(quota.chargeAi(u.id, "ai", later, undefined, "content"))).toMatchObject({ status: 429 });
    const m = await ents.aiMonitoring({ q: u.email, status: "expired", from: "2026-11-01", to: "2026-11-30" }, later);
    expect(m.grants.map((x) => x.state)).toEqual(["expired"]);
    expect(await status(ents.grantAi({ userId: u.id, features: "all", expiresAt: new Date(NOW.getTime() - DAY) }, actor, NOW))).toMatchObject({ status: 400 });
  });

  test("support chat keeps its abuse cap even with an all-features grant, and is not counted as a feature", async () => {
    const u = await onPlan();
    await ents.grantAi({ userId: u.id, features: "all", expiresAt: null }, actor, NOW);
    const r = await quota.chargeAi(u.id, "support", NOW);
    expect(r.unlimited).toBe(false);
    expect(await db.aiFeatureUsage.count({ where: { userId: u.id } })).toBe(0);
  });

  test("caption videos: a transcription grant lifts the monthly video cap and the plan gate; others still capped", async () => {
    const u = await onPlan({ captionVideos: 1, aiCaptions: false });
    expect(await status(billing.assertCaptionVideo(u.id, "a.mp4:300", NOW))).toMatchObject({ status: 402 });
    await ents.grantAi({ userId: u.id, features: ["transcription"], expiresAt: null }, actor, NOW);
    for (const ref of ["a.mp4:300", "b.mp4:300", "c.mp4:300"]) expect((await billing.assertCaptionVideo(u.id, ref, NOW)).unlimited).toBe(true);
    expect(await db.featureUse.count({ where: { userId: u.id } })).toBe(0);
    expect(await billing.captionUsage(u.id, NOW)).toMatchObject({ unlimited: true, captionVideos: 0, left: Infinity, aiCaptions: true });
    const other = await onPlan({ captionVideos: 1 });
    await billing.assertCaptionVideo(other.id, "a.mp4:300", NOW);
    expect(await status(billing.assertCaptionVideo(other.id, "b.mp4:300", NOW))).toMatchObject({ status: 402 });
    expect((await billing.captionUsage(other.id, NOW)).unlimited).toBe(false);
  });

  test("granting again changes the live grant in place; audit rows for grant, change, revoke", async () => {
    const u = await onPlan();
    const first = await ents.grantAi({ userId: u.id, features: ["content"], expiresAt: null, note: "first" }, actor, NOW);
    const second = await ents.grantAi({ email: u.email.toUpperCase(), features: ["content", "captions"], expiresAt: new Date(NOW.getTime() + 7 * DAY), note: "widen" }, actor, NOW);
    expect(second.changed).toBe(true);
    expect(second.grant.id).toBe(first.grant.id);
    expect(await db.aiEntitlement.count({ where: { userId: u.id } })).toBe(1);
    await ents.revokeAi(first.grant.id, actor, "done", NOW);
    const rows = await db.auditLog.findMany({ where: { email: u.email, targetType: "ai" }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["ai.grant", "ai.change", "ai.revoke"]);
    expect(rows.every((r) => r.actor === actor.login && r.actorRole === "finance" && r.targetId === first.grant.id)).toBe(true);
    expect(JSON.parse(rows[1].before!)).toMatchObject({ features: "content" });
    expect(JSON.parse(rows[1].after!)).toMatchObject({ features: "captions,content" });
    expect(rows[2].note).toBe("done");
  });
});

describe("monitoring aggregates", () => {
  test("totals by feature, unlimited users, near limits", async () => {
    const a = await onPlan({ aiDaily: 10, aiMonthly: 5 });
    const near = await onPlan({ aiDaily: 10, aiMonthly: 5 });
    await ents.grantAi({ userId: a.id, features: "all", expiresAt: null }, actor, NOW);
    for (let i = 0; i < 3; i++) await quota.chargeAi(a.id, "ai", NOW, undefined, "rewrite");
    for (let i = 0; i < 4; i++) await quota.chargeAi(near.id, "ai", NOW, undefined, "rewrite");
    const m = await ents.aiMonitoring({ from: "2026-11-10", to: "2026-11-10" }, NOW);
    const rewrite = m.byFeature.find((r) => r.feature === "rewrite")!;
    expect(rewrite.count).toBeGreaterThanOrEqual(7);
    expect(rewrite.unlimited).toBeGreaterThanOrEqual(3);
    expect(m.unlimitedUsers).toBeGreaterThanOrEqual(1);
    expect(m.nearLimits.find((x) => x.userId === near.id)).toMatchObject({ used: 4, limit: 5, pct: 80 });
    expect(m.nearLimits.find((x) => x.userId === a.id)).toBeUndefined();
    const mine = await ents.aiMonitoring({ q: near.email, from: "2026-11-10", to: "2026-11-10", feature: "rewrite" }, NOW);
    expect(mine.total).toBe(4);
    expect(mine.byFeature).toHaveLength(1);
    const rows = await ents.aiAccessRows([a.id, near.id], NOW);
    expect(rows.get(near.id)).toMatchObject({ monthUsed: 4, total: 4, monthLimit: 5, grant: null });
    expect(rows.get(a.id)).toMatchObject({ monthUsed: 0, total: 3 });
    expect(rows.get(a.id)!.grant?.features).toBe("all");
  });
});

describe("admin API", () => {
  const req = (method: string, path: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, { method, headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function signIn(role: "super" | "finance" | "support") {
    jar.clear();
    const a = await db.adminUser.create({ data: { login: `p3e-${role}-${tag()}`, name: `Admin ${role}`, role, passwordHash: "hash" } });
    await adminAuth.createAdminSession(a);
    return a;
  }

  test("no admin session (a signed-in creator granting themselves): 401, nothing stored", async () => {
    const u = await onPlan();
    jar.clear();
    const r = await accessRoute.POST(req("POST", "/api/admin/ai-access", { userId: u.id, features: "all", duration: { kind: "permanent" } }), { params: {} } as never);
    expect(r.status).toBe(401);
    expect(await db.aiEntitlement.count({ where: { userId: u.id } })).toBe(0);
  });

  test("support can read usage but cannot grant (403)", async () => {
    const u = await onPlan();
    await signIn("support");
    expect((await accessRoute.GET(req("GET", `/api/admin/ai-access?userId=${u.id}`), { params: {} } as never)).status).toBe(200);
    const r = await accessRoute.POST(req("POST", "/api/admin/ai-access", { userId: u.id, features: "all", duration: { kind: "permanent" } }), { params: {} } as never);
    expect(r.status).toBe(403);
    expect(await db.aiEntitlement.count({ where: { userId: u.id } })).toBe(0);
  });

  test("finance grants by days, validation refuses bad input, then revokes", async () => {
    const u = await onPlan();
    const admin = await signIn("finance");
    const bad = await accessRoute.POST(req("POST", "/api/admin/ai-access", { userId: u.id, features: [], duration: { kind: "permanent" } }), { params: {} } as never);
    expect(bad.status).toBe(400);
    const r = await accessRoute.POST(req("POST", "/api/admin/ai-access", { userId: u.id, features: ["captions", "rewrite"], duration: { kind: "days", days: 30 }, note: "launch" }), { params: {} } as never);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.access.live.features).toEqual(["captions", "rewrite"]);
    expect(new Date(body.access.live.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(body.access.history[0]).toMatchObject({ action: "ai.grant", actor: admin.login, actorRole: "finance" });
    const rv = await grantRoute.PATCH(req("PATCH", `/api/admin/ai-access/${body.grant.id}`, { action: "revoke", note: "ended" }), { params: { id: body.grant.id } } as never);
    expect(rv.status).toBe(200);
    expect((await rv.json()).access.live).toBeNull();
    const missing = await accessRoute.POST(req("POST", "/api/admin/ai-access", { email: `nobody-${tag()}@test.dev`, features: "all", duration: { kind: "permanent" } }), { params: {} } as never);
    expect(missing.status).toBe(404);
  });
});
