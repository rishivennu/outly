/**
 * 1316: Infrastructure & Costs, Phase 3. One read-only token per provider, encrypted at rest and proven before it is
 * stored; adapters book only what each public API exposes (Render plans and bandwidth, Supabase plans, Vercel facts)
 * with references so a re-run never double counts; the sweep syncs every connection and a failure is one alert a day.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let db: typeof import("../lib/db").db;
let conn: typeof import("../lib/costs/connections");
let providers: typeof import("../lib/costs/providers");
let manual: typeof import("../lib/costs/manual");
let crypto: typeof import("../lib/crypto");
const by = { login: "finance@outlly.test" };
const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");
const realFetch = globalThis.fetch;
const calls: string[] = [];

/** A fake provider internet: each test installs the responses it needs; unknown URLs are a 404. */
function fakeNet(routes: Record<string, unknown | ((url: URL, init?: RequestInit) => unknown)>) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(`${url.host}${url.pathname}`);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (auth === "Bearer bad-token-0000") return new Response("{}", { status: 401 });
    const hit = Object.entries(routes).find(([k]) => `${url.host}${url.pathname}` === k);
    if (!hit) return new Response("{}", { status: 404 });
    const body = typeof hit[1] === "function" ? (hit[1] as (u: URL, i?: RequestInit) => unknown)(url, init) : hit[1];
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  conn = await import("../lib/costs/connections");
  providers = await import("../lib/costs/providers");
  manual = await import("../lib/costs/manual");
  crypto = await import("../lib/crypto");
});
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });
afterAll(async () => {
  await db.costProviderConnection.deleteMany({});
  await db.costEvent.deleteMany({ where: { ref: { startsWith: "render:" } } });
  await db.costEvent.deleteMany({ where: { ref: { startsWith: "supabase:plan:" } } });
  await db.costAlert.deleteMany({ where: { key: { startsWith: "sync:" } } });
  await db.$disconnect();
});

const RENDER = {
  "api.render.com/v1/owners": [{ owner: { id: "tea-1", name: "Outlly", type: "team" } }],
  "api.render.com/v1/services": [
    { service: { id: "srv-web", name: "outlly-web", type: "web_service", suspended: "not_suspended", serviceDetails: { plan: "starter" } } },
    { service: { id: "srv-cron", name: "outlly-cron", type: "cron_job", suspended: "not_suspended", serviceDetails: { plan: "free" } } },
    { service: { id: "srv-old", name: "old-api", type: "web_service", suspended: "suspended", serviceDetails: { plan: "standard" } } },
  ],
  "api.render.com/v1/metrics/bandwidth": (u: URL) => u.searchParams.get("resource") === "srv-web"
    ? [{ labels: [{ field: "resource", value: "srv-web" }], unit: "bytes", values: [{ timestamp: "2026-10-20T03:00:00Z", value: 2.5e9 }, { timestamp: "2026-10-20T15:00:00Z", value: 1.5e9 }, { timestamp: "2026-10-21T10:00:00Z", value: 1e9 }, { timestamp: "2026-10-22T10:00:00Z", value: 7e9 }] }]
    : [],
};
const SUPABASE = {
  "api.supabase.com/v1/organizations": [{ id: "org-1", slug: "outlly", name: "Outlly" }, { id: "org-2", slug: "sandbox", name: "Sandbox" }],
  "api.supabase.com/v1/organizations/outlly": { id: "org-1", slug: "outlly", name: "Outlly", plan: "pro" },
  "api.supabase.com/v1/organizations/sandbox": { id: "org-2", slug: "sandbox", name: "Sandbox", plan: "free" },
  "api.supabase.com/v1/projects": [{ id: "p1", ref: "abcdefgh", name: "outlly-prod", organization_id: "org-1", status: "ACTIVE_HEALTHY", region: "ap-south-1" }, { id: "p2", ref: "zzz", name: "scratch", organization_id: "org-2", status: "INACTIVE", region: "us-east-1" }],
};
const VERCEL = {
  "api.vercel.com/v2/teams/team_abc": { id: "team_abc", slug: "outlly", name: "Outlly", billing: { plan: "pro" } },
  "api.vercel.com/v9/projects": { projects: [{ id: "prj_1", name: "outly" }, { id: "prj_2", name: "outlly-docs" }] },
};

describe("1316 connections", () => {
  test("a refused token is not stored; a good one is tested, encrypted, and shown by its last four characters only", async () => {
    fakeNet(RENDER);
    await expect(conn.connectProvider({ provider: "render", token: "bad-token-0000" }, by)).rejects.toMatchObject({ status: 400, code: "PROVIDER_REFUSED" });
    expect(await db.costProviderConnection.count({ where: { provider: "render" } })).toBe(0);
    const v = await conn.connectProvider({ provider: "render", token: "rnd_live_secret_ABCD1234" }, by);
    expect(v.status).toBe("ok");
    expect(v.label).toBe("Outlly");
    expect(v.last4).toBe("1234");
    expect(JSON.stringify(v)).not.toContain("rnd_live_secret");
    const row = await db.costProviderConnection.findUniqueOrThrow({ where: { provider: "render" } });
    expect(row.tokenEnc.startsWith("v1.")).toBe(true);
    expect(row.tokenEnc).not.toContain("rnd_live");
    expect(crypto.decrypt(row.tokenEnc)).toBe("rnd_live_secret_ABCD1234");
    expect((v.facts.services as unknown[]).length).toBe(3);
    const list = await conn.listConnections();
    expect(list.map((c) => c.provider)).toEqual(["vercel", "render", "supabase"]);
    expect(list.find((c) => c.provider === "vercel")!.status).toBe("none");
    expect(list.find((c) => c.provider === "render")!.status).toBe("ok");
    expect(() => conn.ConnectionBody.parse({ provider: "aws", token: "x".repeat(20) })).toThrow();
  });
  test("Render sync books each paid, running service's daily plan share and the reported bandwidth, with refs so a re-run books nothing", async () => {
    fakeNet(RENDER);
    const range = { from: "2026-10-20", to: "2026-10-22", now: new Date("2026-10-22T18:00:00Z") };
    const r = await conn.syncProvider("render", range);
    expect(r.ok).toBe(true);
    // 3 days of starter plan (web) + 2 bandwidth days (20th, 21st; the 22nd is today and still growing). Free cron and suspended old-api: nothing.
    expect(r.result!.booked).toBe(5);
    const plan = await db.costEvent.findMany({ where: { ref: { startsWith: "render:plan:srv-web:" } }, orderBy: { day: "asc" } });
    expect(plan.map((p) => p.day)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(plan[0].amountMinor).toBeCloseTo((7 / 31) * 100, 6); // October has 31 days, USD minor
    expect(plan[0].source).toBe("estimate");
    expect(plan[0].category).toBe("hosting");
    expect(await db.costEvent.count({ where: { ref: { startsWith: "render:plan:srv-old:" } } })).toBe(0);
    expect(await db.costEvent.count({ where: { ref: { startsWith: "render:plan:srv-cron:" } } })).toBe(0);
    const bw = await db.costEvent.findMany({ where: { ref: { startsWith: "render:bandwidth:" } }, orderBy: { day: "asc" } });
    expect(bw.map((b) => [b.day, b.units, b.ref])).toEqual([["2026-10-20", 4, "render:bandwidth:srv-web:2026-10-20"], ["2026-10-21", 1, "render:bandwidth:srv-web:2026-10-21"]]); // per service, so one failed metrics call never undercounts a day for good
    expect(bw[0].source).toBe("reported");
    expect(bw[0].amountMinor).toBeCloseTo(4 * 0.15 * 100, 6);
    const again = await conn.syncProvider("render", range);
    expect(again.result!.booked).toBe(0);
    expect(await db.costEvent.count({ where: { ref: { startsWith: "render:" } } })).toBe(5);
    const c = await db.costProviderConnection.findUniqueOrThrow({ where: { provider: "render" } });
    expect(c.lastSyncAt?.toISOString()).toBe("2026-10-22T18:00:00.000Z");
  });
  test("Supabase sync books the Pro organisation's plan share only; a scoped slug limits what is seen; usage is declared not available", async () => {
    fakeNet(SUPABASE);
    await expect(conn.connectProvider({ provider: "supabase", token: "sbp_scoped_token_WXYZ", scope: "nope" }, by)).rejects.toMatchObject({ status: 400 });
    const v = await conn.connectProvider({ provider: "supabase", token: "sbp_scoped_token_WXYZ" }, by);
    expect(v.label).toBe("Outlly, Sandbox");
    expect((v.facts.projects as unknown[]).length).toBe(2);
    const r = await conn.syncProvider("supabase", { from: "2026-11-01", to: "2026-11-02", now: new Date("2026-11-02T20:00:00Z") });
    expect(r.result!.booked).toBe(2);
    const rows = await db.costEvent.findMany({ where: { ref: { startsWith: "supabase:plan:" } } });
    expect(rows.every((x) => x.ref!.startsWith("supabase:plan:outlly:"))).toBe(true);
    expect(rows[0].amountMinor).toBeCloseTo((25 / 30) * 100, 6);
    expect(rows[0].category).toBe("database");
    expect(r.result!.notes.join(" ")).toContain("not exposed");
    const scoped = await conn.connectProvider({ provider: "supabase", token: "sbp_scoped_token_WXYZ", scope: "outlly" }, by);
    expect(scoped.label).toBe("Outlly");
    expect((scoped.facts.projects as unknown[]).length).toBe(1);
  });
  test("Vercel: the token and plan are checked, projects recorded, and nothing is booked because the public API has no usage", async () => {
    fakeNet(VERCEL);
    const v = await conn.connectProvider({ provider: "vercel", token: "vercel_token_QRST", scope: "team_abc" }, by);
    expect(v.label).toBe("Outlly (outlly)");
    expect(v.facts.plan).toBe("pro");
    const r = await conn.syncProvider("vercel", conn.syncRange(new Date("2026-11-10T10:00:00Z")));
    expect(r.result!.booked).toBe(0);
    expect(r.result!.facts.projectCount).toBe(2);
    expect(r.result!.notes[0]).toContain("no usage or invoice endpoint");
    expect(calls.some((c) => c.includes("/v9/projects"))).toBe(true);
    expect(calls.every((c) => c.startsWith("api.vercel.com"))).toBe(true);
  });
  test("a failing sync marks the connection, raises one alert per provider per day, and the sweep carries on", async () => {
    fakeNet({}); // every provider API now 404s
    const now = new Date("2026-11-12T03:00:00Z");
    const r = await conn.syncProvider("render", conn.syncRange(now));
    expect(r.ok).toBe(false);
    expect((await db.costProviderConnection.findUniqueOrThrow({ where: { provider: "render" } })).status).toBe("error");
    await conn.syncProvider("render", conn.syncRange(now));
    expect(await db.costAlert.count({ where: { key: "sync:render:2026-11-12" } })).toBe(1);
    const sweep = await manual.sweepCosts(now);
    expect(sweep.synced.map((s) => s.provider).sort()).toEqual(["render", "supabase", "vercel"]);
    expect(sweep.synced.every((s) => !s.ok)).toBe(true);
    const t = await conn.testConnection("vercel");
    expect(t.status).toBe("error");
    expect(t.lastError).toContain("Not found");
    fakeNet(VERCEL);
    expect((await conn.testConnection("vercel")).status).toBe("ok");
  });
  test("remove by provider or id; the ledger keeps what was booked", async () => {
    await conn.removeConnection("render", by);
    expect(await db.costProviderConnection.count({ where: { provider: "render" } })).toBe(0);
    expect(await db.costEvent.count({ where: { ref: { startsWith: "render:plan:" } } })).toBe(3);
    await expect(conn.removeConnection("render", by)).rejects.toMatchObject({ status: 404 });
    await expect(conn.syncProvider("render")).rejects.toMatchObject({ status: 404 });
    expect(conn.syncRange(new Date("2026-11-12T03:00:00Z"))).toMatchObject({ from: "2026-11-10", to: "2026-11-12" });
  });
});

describe("1316 wiring", () => {
  test("plan prices are seeded for Render and Supabase; adapters name their limits", async () => {
    const prices = await import("../lib/costs/prices");
    expect((await prices.priceFor("render", "render:plan-starter-month"))?.price).toBe(7);
    expect((await prices.priceFor("supabase", "supabase:plan-pro-month"))?.price).toBe(25);
    for (const a of providers.ADAPTERS) { expect(a.capability.length).toBeGreaterThan(40); expect(a.tokenHelp.length).toBeGreaterThan(20); }
    expect(providers.adapterFor("aws")).toBeNull();
  });
  test("API, page and card are wired; the token never reaches the client type", () => {
    const kind = read("app/api/admin/costs/[kind]/route.ts");
    expect(kind).toContain('params.kind === "connections"');
    expect(kind).toContain('params.kind === "sync"');
    const id = read("app/api/admin/costs/[kind]/[id]/route.ts");
    expect(id).toContain("testConnection(params.id)");
    expect(id).toContain("removeConnection(params.id, by)");
    const panel = read("components/admin/costs/CostsPanel.tsx");
    expect(panel).toContain("export function ConnectionsCard");
    expect(panel).toContain('type="password"');
    expect(panel).toContain('import type { ConnectionView } from "@/lib/costs/connections"');
    expect(read("app/admin/(panel)/costs/page.tsx")).toContain("<ConnectionsCard items={o.connections} />");
    const view = read("lib/costs/connections.ts").match(/export interface ConnectionView \{[^}]+\}/)![0];
    expect(view).not.toMatch(/\btoken(Enc)?:/); // last4 and tokenHelp only
    expect(read("lib/costs/manual.ts")).toContain("m.syncAll(now)");
    expect(read("prisma/schema.template.prisma")).toContain("model CostProviderConnection");
  });
});
