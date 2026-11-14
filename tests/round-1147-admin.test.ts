/**
 * 1147 admin: subscriptions report data (trial funnel, subscribers + history, risk queue, monthly economics)
 * and the admin routes that change things (risk review, policy, economics) with their audit trail.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const ADMIN = { id: "adm1", name: "Asha", login: "asha", role: "super" as const };
let role: "super" | "support" = "super";
const realAuth = await import("../lib/admin/auth");
mock.module("../lib/admin/auth", () => ({ ...realAuth, getAdmin: async () => ({ ...ADMIN, role }) }));
const realCache = await import("next/cache");
mock.module("next/cache", () => ({ ...realCache, revalidatePath: () => {}, revalidateTag: () => {} }));

const DAY = 86_400_000;
let db: typeof import("../lib/db").db;
let rep: typeof import("../app/api/admin/subscriptions/_lib/report");
let plans: typeof import("../lib/billing/plans");

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  rep = await import("../app/api/admin/subscriptions/_lib/report");
  plans = await import("../lib/billing/plans");
  await plans.ensurePlans();
});

// Leave the shared test database with the shipped policy for the files that run after this one.
afterAll(async () => {
  await db.setting.deleteMany({ where: { key: { in: ["subs.policy", "subs.policy.prev", "subs.economics"] } } });
  (await import("../lib/subscriptions/policy")).clearPolicyCache();
});

let n = 0;
const mkUser = (tag: string) => db.user.create({ data: { name: `Sub ${tag}`, email: `sub-${tag}-${Date.now()}-${n++}@test.dev`, passwordHash: "x" } });
const plan = (slug: string) => db.plan.findUniqueOrThrow({ where: { slug } });
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) }) as never;

describe("trial funnel", () => {
  test("counts each status and both conversion rates", async () => {
    await db.trial.deleteMany({});
    const p = await plan("creator");
    const statuses = ["active", "converted", "converted", "expired", "canceled"];
    for (const [i, s] of statuses.entries()) {
      const u = await mkUser(`t${i}`);
      await db.trial.create({ data: { userId: u.id, planId: p.id, endsAt: new Date(Date.now() + 7 * DAY), status: s, startedAt: new Date(Date.now() - i * DAY) } });
    }
    const f = await rep.trialFunnel();
    expect(f).toMatchObject({ started: 5, active: 1, converted: 2, expired: 1, canceled: 1 });
    expect(f.conversionPct).toBeCloseTo(0.4);
    expect(f.decidedPct).toBeCloseTo(0.5);
    const recent = await rep.trialFunnel({ from: new Date(Date.now() - 1.5 * DAY) });
    expect(recent.started).toBe(2);
    expect((await rep.trialFunnel({ from: new Date(Date.now() + DAY) })).conversionPct).toBe(0);
  });
});

describe("subscribers + history", () => {
  test("list filters by tier and email, history is newest first and covers every source", async () => {
    const p = await plan("creator");
    const u = await mkUser("hist");
    const sub = await db.subscription.create({ data: { userId: u.id, planId: p.id, priceMinor: 79900, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(Date.now() + 20 * DAY), priceTier: "intro", policyVersion: "v1" } });
    await db.payment.create({ data: { userId: u.id, subscriptionId: sub.id, planId: p.id, amountMinor: 79900, currency: "INR", provider: "mock", status: "succeeded", priceTier: "intro", providerRef: `ref-${sub.id}` } });
    await db.offerLedger.create({ data: { kind: "email", keyHash: `h-${sub.id}`, userId: u.id, firstPaidAt: new Date() } });
    await db.riskFlag.create({ data: { userId: u.id, score: 45, level: "medium", action: "verify", context: "checkout" } });
    await db.subscriberMonth.create({ data: { userId: u.id, month: rep.monthKey(), tier: "intro", revenueMinor: 67712, feeMinor: 3524, costMinor: 22645, budgetMinor: 23561 } });

    const intro = await rep.listSubscribers({ tier: "intro", q: u.email.toUpperCase() });
    expect(intro.total).toBe(1);
    expect(intro.rows[0]).toMatchObject({ email: u.email, tier: "intro", priceMinor: 79900, planSlug: "creator", policyVersion: "v1" });
    expect((await rep.listSubscribers({ tier: "standard", q: u.email })).total).toBe(0);
    expect((await rep.listSubscribers({ tier: "bogus", q: u.email })).total).toBe(1);

    const h = await rep.subscriberHistory(u.id);
    expect(h).not.toBeNull();
    const kinds = new Set(h!.timeline.map((e) => e.kind));
    for (const k of ["subscription", "payment", "ledger", "risk"]) expect(kinds.has(k)).toBe(true);
    const ats = h!.timeline.map((e) => e.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(h!.timeline.find((e) => e.kind === "subscription")!.detail).toContain("₹799");
    expect(h!.months[0].margin).toBeCloseTo((67712 - 3524 - 22645) / 67712);
    expect(await rep.subscriberHistory("nope")).toBeNull();
  });
});

describe("risk queue", () => {
  test("open flags by score with emails, related accounts and the appeal ticket", async () => {
    await db.riskFlag.deleteMany({});
    const a = await mkUser("ra");
    const b = await mkUser("rb");
    const t = await db.ticket.create({ data: { ref: `T-${Date.now()}`, email: a.email, subject: "Offer review", source: "form", userId: a.id } });
    await db.riskFlag.create({ data: { userId: a.id, score: 80, level: "high", action: "deny_offer", reasons: JSON.stringify([{ code: "device_match", weight: 60, detail: "Same device" }, { code: "same_ip", weight: 5 }]), relatedUserIds: JSON.stringify([b.id]), ticketId: t.id } });
    await db.riskFlag.create({ data: { userId: b.id, score: 45, level: "medium", action: "verify", reasons: "not json" } });
    await db.riskFlag.create({ data: { userId: b.id, score: 10, level: "low", action: "none", status: "cleared" } });
    const q = await rep.listFlags();
    expect(q.rows.map((r) => r.score)).toEqual([80, 45]);
    expect(q.rows[0]).toMatchObject({ email: a.email, ticket: { id: t.id }, related: [{ id: b.id, email: b.email }] });
    expect(q.rows[0].reasons).toHaveLength(2);
    expect(q.rows[1].reasons).toEqual([]);
    expect(q.counts).toMatchObject({ open: 2, cleared: 1, verified: 0, confirmed: 0 });
    expect((await rep.listFlags({ status: "all" })).rows).toHaveLength(3);
  });
});

describe("monthly economics", () => {
  test("per subscriber and per plan margin, over-budget and below-target counts", async () => {
    const m = "2026-10";
    await db.subscriberMonth.deleteMany({ where: { month: m } });
    const [s, c] = await Promise.all([plan("free"), plan("creator")]);
    const good = await mkUser("eg");
    const heavy = await mkUser("eh");
    for (const [u, p] of [[good, s], [heavy, c]] as const) await db.subscription.create({ data: { userId: u.id, planId: p.id, priceMinor: 100, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(Date.now() + DAY) } });
    await db.subscriberMonth.create({ data: { userId: good.id, month: m, tier: "intro", revenueMinor: 10000, feeMinor: 500, costMinor: 2000, budgetMinor: 3500 } });
    await db.subscriberMonth.create({ data: { userId: heavy.id, month: m, tier: "standard", revenueMinor: 10000, feeMinor: 500, costMinor: 6000, budgetMinor: 3500 } });
    const r = await rep.economicsReport(m, 0.6);
    expect(r.month).toBe(m);
    expect(r.totals).toMatchObject({ subscribers: 2, revenueMinor: 20000, feeMinor: 1000, costMinor: 8000, profitMinor: 11000, belowTarget: 1 });
    expect(r.totals.margin).toBeCloseTo(0.55);
    const h = r.rows.find((x) => x.userId === heavy.id)!;
    expect(h).toMatchObject({ overBudget: true, profitMinor: 3500 });
    expect(r.rows.find((x) => x.userId === good.id)!.margin).toBeCloseTo(0.75);
    expect(r.plans.reduce((a, p) => a + p.subscribers, 0)).toBe(2);
    expect(rep.validMonth("2026-13")).toBe(rep.monthKey());
    expect(rep.marginOf(0, 0, 0)).toBeNull();
  });
});

describe("risk review route", () => {
  test("clear / confirm / note write the flag, an AuditLog row and an AdminEvent; support role is refused", async () => {
    const { POST } = await import("../app/api/admin/subscriptions/risk/[id]/route");
    const u = await mkUser("rv");
    const f = await db.riskFlag.create({ data: { userId: u.id, score: 75, level: "high", action: "deny_offer" } });
    const ev0 = await db.adminEvent.count({ where: { kind: "subscriptions" } });

    let res = await POST(req(`/api/admin/subscriptions/risk/${f.id}`, "POST", { action: "note" }), ctx({ id: f.id }));
    expect(res.status).toBe(400);
    res = await POST(req(`/api/admin/subscriptions/risk/${f.id}`, "POST", { action: "clear", note: "Same family, separate person" }), ctx({ id: f.id }));
    expect(res.status).toBe(200);
    expect(await db.riskFlag.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: "cleared", reviewedBy: "asha", note: "Same family, separate person" });
    res = await POST(req(`/api/admin/subscriptions/risk/${f.id}`, "POST", { action: "confirm" }), ctx({ id: f.id }));
    expect((await db.riskFlag.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("confirmed");
    const logs = await db.auditLog.findMany({ where: { targetType: "risk_flag", targetId: f.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["subs.risk.clear", "subs.risk.confirm"]);
    expect(logs[0].email).toBe(u.email.toLowerCase());
    expect(await db.adminEvent.count({ where: { kind: "subscriptions" } })).toBe(ev0 + 2);
    expect((await POST(req("/api/admin/subscriptions/risk/missing", "POST", { action: "clear" }), ctx({ id: "missing" }))).status).toBe(404);

    role = "support";
    try {
      expect((await POST(req(`/api/admin/subscriptions/risk/${f.id}`, "POST", { action: "clear" }), ctx({ id: f.id }))).status).toBe(403);
    } finally {
      role = "super";
    }
  });
});

describe("policy editor routes", () => {
  const P = "/api/admin/subscriptions/policy";
  let route: typeof import("../app/api/admin/subscriptions/policy/route");
  let core: typeof import("../lib/subscriptions");
  beforeAll(async () => {
    route = await import("../app/api/admin/subscriptions/policy/route");
    core = await import("../lib/subscriptions");
    // The revised live prices (1112), so the default first-time prices sit under them.
    const rev: Record<string, [number, Record<string, number>]> = { starter: [37900, { USD: 800, EUR: 800, GBP: 700 }], creator: [97900, { USD: 1700, EUR: 1700, GBP: 1400 }], "pro-manager": [347900, { USD: 4300, EUR: 4300, GBP: 3600 }] };
    for (const [slug, [priceMinor, prices]] of Object.entries(rev)) {
      const data = { priceMinor, prices: JSON.stringify(prices), currency: "INR", interval: "month" };
      await db.plan.upsert({ where: { slug }, update: data, create: { slug, name: slug === "starter" ? "Starter" : slug, features: "[]", ...data } });
    }
    await db.setting.deleteMany({ where: { key: { startsWith: "subs." } } });
    core.clearPolicyCache();
  });
  const body = async (r: Response) => (await r.json()) as any;

  test("GET shows the policy off, every first-time price clears its floor, yearly never under floor", async () => {
    const s = await body(await route.GET(req(P), ctx()));
    expect(s.enabled).toBe(false);
    expect(s.errors).toEqual([]);
    expect(s.plans.map((p: any) => p.slug)).toEqual(["starter", "creator", "pro-manager"]);
    const row = (plan: string, cur: string, interval: string, tier: string) => s.grid.find((g: any) => g.plan === plan && g.currency === cur && g.interval === interval && g.tier === tier);
    const ci = row("creator", "INR", "month", "intro");
    expect(ci).toMatchObject({ priceMinor: 79900, ok: true });
    expect(ci.margin).toBeGreaterThanOrEqual(0.6);
    expect(Math.round(ci.margin * 100)).toBe(61);
    expect(row("creator", "INR", "month", "standard").priceMinor).toBe(97900);
    expect(Math.round(row("creator", "USD", "month", "standard").margin * 100)).toBe(78);
    for (const g of s.grid.filter((x: any) => x.interval === "year" && x.priceMinor != null)) expect(g.priceMinor).toBeGreaterThanOrEqual(g.floorMinor);
    expect(s.form.risk.find((r: any) => r.path === "device").value).toBe(60);
  });

  test("check flags a price under the floor without saving; PUT refuses it with field errors", async () => {
    const s = await body(await route.GET(req(P), ctx()));
    const bad = { ...s.form, intro: { ...s.form.intro, creator: { ...s.form.intro.creator, INR: 50000 } } };
    const c = await body(await route.POST(req(P, "POST", { action: "check", form: bad }), ctx()));
    expect(c.errors.map((e: any) => e.field)).toContain("intro.creator.INR");
    expect(c.grid.find((g: any) => g.plan === "creator" && g.currency === "INR" && g.interval === "month" && g.tier === "intro").ok).toBe(false);
    const res = await route.PUT(req(P, "PUT", { form: bad }), ctx());
    expect(res.status).toBe(400);
    expect((await body(res)).errors[0].field).toBe("intro.creator.INR");
    core.clearPolicyCache();
    expect((await core.getPolicy()).intro.creator.INR).toBe(79900);
  });

  test("save, preview, enable and undo are audited; support role is refused", async () => {
    const s = await body(await route.GET(req(P), ctx()));
    const saved = await body(await route.PUT(req(P, "PUT", { form: { ...s.form, trialDays: 5, budgetMode: "alert" } }), ctx()));
    expect(saved.form).toMatchObject({ trialDays: 5, budgetMode: "alert" });
    expect(saved.enabled).toBe(false);
    expect(saved.prev).not.toBeNull();

    const pv = await body(await route.POST(req(P, "POST", { action: "preview" }), ctx()));
    expect(pv.changes.join(" ")).toContain("5-day");
    expect(typeof pv.activeSubs).toBe("number");

    const on = await body(await route.POST(req(P, "POST", { action: "enable" }), ctx()));
    expect(on.enabled).toBe(true);
    core.clearPolicyCache();
    expect((await core.getPolicy()).enabled).toBe(true);
    const back = await body(await route.POST(req(P, "POST", { action: "undo" }), ctx()));
    expect(back.enabled).toBe(false);
    expect(back.form.trialDays).toBe(5);

    const acts = (await db.auditLog.findMany({ where: { targetId: "subs.policy" }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(acts).toEqual(["subs.policy.save", "subs.policy.enable", "subs.policy.undo"]);

    role = "support";
    try {
      expect((await route.PUT(req(P, "PUT", { form: s.form }), ctx())).status).toBe(403);
    } finally {
      role = "super";
    }
  });
});

describe("cost rate editor route", () => {
  const E = "/api/admin/subscriptions/economics";
  test("lists every rate, saves an edit, refuses unknown paths and floors pushed over first-time prices", async () => {
    const { GET, PUT } = await import("../app/api/admin/subscriptions/economics/route");
    const core = await import("../lib/subscriptions");
    const s = (await (await GET(req(`${E}?rates=1`), ctx())).json()) as any;
    const paths = s.fields.map((f: any) => f.path);
    for (const p of ["fx.USD", "gstRate", "rates.ai", "typicalCost.creator", "typicalUsage.creator.videos"]) expect(paths).toContain(p);
    expect(paths).not.toContain("fx.INR");

    const ok = (await (await PUT(req(E, "PUT", { values: { "rates.ai": 0.7, "typicalUsage.creator.videos": 40 } }), ctx())).json()) as any;
    expect(ok.fields.find((f: any) => f.path === "rates.ai").value).toBe(0.7);
    core.clearPolicyCache();
    const econ = await core.getEconomics();
    expect(econ.typicalUsage.creator).toMatchObject({ videos: 40, posts: 50 });

    expect((await PUT(req(E, "PUT", { values: { "rates.bogus": 1 } }), ctx())).status).toBe(400);
    const floor = await PUT(req(E, "PUT", { values: { "typicalCost.creator": 5000 } }), ctx());
    expect(floor.status).toBe(400);
    expect(((await floor.json()) as any).error).toContain("creator");
    core.clearPolicyCache();
    expect((await core.getEconomics()).typicalCost.creator).toBe(226.45);
    expect(await db.auditLog.count({ where: { action: "subs.economics.save" } })).toBe(1);

    const rep = (await (await GET(req(`${E}?month=2026-10`), ctx())).json()) as any;
    expect(rep.month).toBe("2026-10");
    expect(rep.target).toBe(0.6);
  });
});
