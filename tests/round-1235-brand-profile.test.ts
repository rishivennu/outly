/**
 * R1235: the brand profile. The form rules (lib/intelligence/brand-core.ts) are pure and tested on their own, the
 * route is exercised against the test database as the signed-in owner, and the UI is pinned on the honesty rule that
 * traffic, leads and sales are only ever measured by a proxy.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { BRAND_LIMITS, brandProfileSchema, objectiveOptions } from "../lib/intelligence/brand-core";
import { OBJECTIVES, OBJECTIVE_METRICS } from "../lib/intelligence/core";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const g = globalThis as unknown as { __brandUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__brandUser !== undefined ? g.__brandUser : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let brandRoute: typeof import("../app/api/settings/brand/route");
let n = 0;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  brandRoute = await import("../app/api/settings/brand/route");
}, 60_000);

const asOwner = (u: { id: string }) => {
  g.__brandUser = { ...u, actor: null, role: "owner", joinedAt: new Date(), scope: null };
};
const owner = async () => {
  const u = await db.user.create({ data: { name: `B ${++n}`, email: `r1235-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  asOwner(u);
  return u;
};
const req = (body?: unknown) =>
  new NextRequest("http://localhost/api/settings/brand", {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
  });

describe("R1235 the form rules", () => {
  test("the objective must be one the engine knows", () => {
    expect(brandProfileSchema.safeParse({ objective: "awareness" }).success).toBe(true);
    expect(brandProfileSchema.safeParse({ objective: "virality" }).success).toBe(false);
    expect(brandProfileSchema.safeParse({}).success).toBe(false);
    for (const o of OBJECTIVES) expect(brandProfileSchema.safeParse({ objective: o }).success).toBe(true);
  });
  test("text fields are capped", () => {
    expect(brandProfileSchema.safeParse({ objective: "sales", name: "a".repeat(BRAND_LIMITS.name) }).success).toBe(true);
    expect(brandProfileSchema.safeParse({ objective: "sales", name: "a".repeat(BRAND_LIMITS.name + 1) }).success).toBe(false);
    expect(brandProfileSchema.safeParse({ objective: "sales", audience: "a".repeat(BRAND_LIMITS.audience + 1) }).success).toBe(false);
    expect(brandProfileSchema.safeParse({ objective: "sales", tone: "a".repeat(BRAND_LIMITS.tone + 1) }).success).toBe(false);
  });
  test("both chip lists cap the count and each item", () => {
    const many = Array.from({ length: BRAND_LIMITS.listItems + 1 }, (_, i) => `p${i}`);
    for (const key of ["pillars", "avoid"] as const) {
      expect(brandProfileSchema.safeParse({ objective: "engagement", [key]: many.slice(0, BRAND_LIMITS.listItems) }).success).toBe(true);
      expect(brandProfileSchema.safeParse({ objective: "engagement", [key]: many }).success).toBe(false);
      expect(brandProfileSchema.safeParse({ objective: "engagement", [key]: ["a".repeat(BRAND_LIMITS.listItem + 1)] }).success).toBe(false);
      expect(brandProfileSchema.safeParse({ objective: "engagement", [key]: ["  "] }).success).toBe(false);
    }
  });
  test("every objective option carries the engine's own reason and proxy flag", () => {
    const opts = objectiveOptions();
    expect(opts.map((o) => o.id)).toEqual([...OBJECTIVES]);
    for (const o of opts) {
      expect(o.reason).toBe(OBJECTIVE_METRICS[o.id].reason);
      expect(o.proxy).toBe(OBJECTIVE_METRICS[o.id].proxy);
      expect(o.label.length).toBeGreaterThan(0);
    }
    expect(opts.filter((o) => o.proxy).map((o) => o.id)).toEqual(["traffic", "leads", "sales"]);
  });
});

describe("R1235 /api/settings/brand", () => {
  test("GET has no profile yet, and still lists the objectives", async () => {
    await owner();
    const r = await brandRoute.GET(req(), { params: {} });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { profile: unknown; objectives: { id: string; proxy: boolean }[] };
    expect(body.profile).toBeNull();
    expect(body.objectives).toHaveLength(OBJECTIVES.length);
    expect(body.objectives.filter((o) => o.proxy).map((o) => o.id)).toEqual(["traffic", "leads", "sales"]);
  });
  test("POST saves, GET reads it back, a second POST replaces it", async () => {
    const u = await owner();
    const r1 = await brandRoute.POST(req({ objective: "community", name: "Outlly", audience: "Solo creators", tone: "Plain", pillars: ["teardowns", "behind the scenes"], avoid: ["politics"] }), { params: {} });
    expect(r1.status).toBe(200);
    const saved = ((await r1.json()) as { profile: { scopeKey: string; objective: string; pillars: string[] } }).profile;
    expect(saved.scopeKey).toBe("");
    expect(saved.objective).toBe("community");
    expect(saved.pillars).toEqual(["teardowns", "behind the scenes"]);

    const r2 = await brandRoute.GET(req(), { params: {} });
    const back = ((await r2.json()) as { profile: { name: string; avoid: string[] } }).profile;
    expect(back.name).toBe("Outlly");
    expect(back.avoid).toEqual(["politics"]);

    await brandRoute.POST(req({ objective: "sales", pillars: [] }), { params: {} });
    const r3 = await brandRoute.GET(req(), { params: {} });
    const after = ((await r3.json()) as { profile: { objective: string; pillars: string[] } }).profile;
    expect(after.objective).toBe("sales");
    expect(after.pillars).toEqual([]);
    expect(await db.brandProfile.count({ where: { ownerId: u.id } })).toBe(1);
  });
  test("a bad objective and an over-long list are refused", async () => {
    await owner();
    const bad = await brandRoute.POST(req({ objective: "virality" }), { params: {} });
    expect(bad.status).toBe(400);
    const long = await brandRoute.POST(req({ objective: "awareness", pillars: Array.from({ length: BRAND_LIMITS.listItems + 1 }, (_, i) => `p${i}`) }), { params: {} });
    expect(long.status).toBe(400);
  });
  test("one workspace never sees another's brand profile", async () => {
    const a = await owner();
    await brandRoute.POST(req({ objective: "awareness", name: "A" }), { params: {} });
    await owner();
    const r = await brandRoute.GET(req(), { params: {} });
    expect(((await r.json()) as { profile: unknown }).profile).toBeNull();
    expect(await db.brandProfile.count({ where: { ownerId: a.id } })).toBe(1);
  });
  test("the route sits under /api/settings, which lib/team/roles.ts keeps owner-only", () => {
    expect(read("lib/team/roles.ts")).toContain('"/api/settings"');
  });
});

describe("R1235 the card and the settings page", () => {
  const card = read("components/settings/BrandProfileCard.tsx");
  test("Settings has a Brand section with the card", () => {
    const view = read("components/settings/SettingsView.tsx");
    expect(view).toContain('id: "brand"');
    expect(view).toContain("<BrandProfileCard />");
    expect(view.indexOf('id: "brand"')).toBeGreaterThan(view.indexOf('id: "personalization"'));
    expect(view.indexOf('id: "brand"')).toBeLessThan(view.indexOf('id: "notifications"'));
  });
  test("the card says plainly that the three proxy objectives are not really measured", () => {
    expect(card).toContain("Measured by a proxy");
    expect(card).toContain("no platform gives Outlly clicks or sales");
    expect(card).toContain("o.proxy &&");
  });
  test("the card keeps the house rules", () => {
    expect(card).not.toContain("transition-all");
    expect(card).not.toContain("\u2014");
    expect(card).toContain("focus-visible:outline");
    expect(card).toContain("min-h-11");
    expect(card).toContain('type="radio"');
    expect(card).toContain("aria-label={`Remove ${v}`}");
  });
});
