/**
 * R1247: the Content Memory backfill sweep (last 180 days, bounded, idempotent) and AI wording of recommendations
 * gated by the "ai-insights" plan perk or an admin AI grant, with the 30 a day cap on both paths.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { Recommendation, Signal } from "../lib/intelligence/core";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let mem: typeof import("../lib/intelligence/memory");
let core: typeof import("../lib/intelligence/core");
let reco: typeof import("../lib/intelligence/reco");
let rules: typeof import("../lib/billing/plan-rules");
let preset: typeof import("../lib/billing/pricing-preset");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  mem = await import("../lib/intelligence/memory");
  core = await import("../lib/intelligence/core");
  reco = await import("../lib/intelligence/reco");
  rules = await import("../lib/billing/plan-rules");
  preset = await import("../lib/billing/pricing-preset");
}, 60_000);

const DAY = 864e5;
let n = 0;
const tag = () => `${++n}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const user = async () => db.user.create({ data: { name: `B ${n}`, email: `r1247-${tag()}@test.dev`, passwordHash: "x" } });

async function post(userId: string, o: { publishedAt?: Date; targetPublishedAt?: Date | null; createdAt?: Date; practice?: boolean } = {}) {
  const media = await db.media.create({ data: { userId, storageKey: `sample/r1247-${tag()}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  const p = await db.post.create({
    data: { userId, mediaId: media.id, status: "published", title: `Post ${n}`, story: "One idea. More words.", format: "video", publishedAt: o.publishedAt ?? new Date(), ...(o.createdAt ? { createdAt: o.createdAt } : {}) },
  });
  await db.postTarget.create({ data: { postId: p.id, platform: "instagram", platformStatus: "published", practice: o.practice ?? false, publishedAt: o.targetPublishedAt === undefined ? (o.publishedAt ?? new Date()) : o.targetPublishedAt } });
  return p;
}
const hasItem = async (postId: string) => (await db.contentVariation.count({ where: { postId } })) === 1;

describe("R1247 backfillOwner since", () => {
  test("a post older than since is skipped, a recent one gets an item", async () => {
    const u = await user();
    const old = await post(u.id, { publishedAt: new Date(Date.now() - 200 * DAY) });
    const recent = await post(u.id, { publishedAt: new Date(Date.now() - 10 * DAY) });
    const r = await mem.backfillOwner(u.id, { since: new Date(Date.now() - mem.BACKFILL_DAYS * DAY) });
    expect(mem.BACKFILL_DAYS).toBe(180);
    expect(r).toMatchObject({ scanned: 1, created: 1 });
    expect(await hasItem(old.id)).toBe(false);
    expect(await hasItem(recent.id)).toBe(true);
    // Without since every live post is backfilled, as before.
    expect((await mem.backfillOwner(u.id)).created).toBe(1);
    expect(await hasItem(old.id)).toBe(true);
  });

  test("a target with no publish date of its own falls back to the post's", async () => {
    const u = await user();
    const recent = await post(u.id, { publishedAt: new Date(Date.now() - 5 * DAY), targetPublishedAt: null });
    const old = await post(u.id, { publishedAt: new Date(Date.now() - 300 * DAY), targetPublishedAt: null });
    await mem.backfillOwner(u.id, { since: new Date(Date.now() - 180 * DAY) });
    expect(await hasItem(recent.id)).toBe(true);
    expect(await hasItem(old.id)).toBe(false);
  });
});

describe("R1247 sweepBackfill", () => {
  // The sweep reads the whole shared test database, so it runs on a clock far past every other file's posts: its
  // 180 day window then holds only the posts made here, whatever ran before.
  const SWEEP_NOW = Date.UTC(2101, 0, 1);
  const ago = (days: number) => new Date(SWEEP_NOW - days * DAY);
  const sweep = () => mem.sweepBackfill({ maxOwners: 5, batch: 100, now: SWEEP_NOW });

  test("at most 5 owners a run, oldest post first, practice and old posts left alone, idempotent", async () => {
    const owners = await Promise.all(Array.from({ length: 7 }, () => user()));
    // Created long ago, so this owner holds the oldest pending post in the window.
    const first = await post(owners[0].id, { createdAt: new Date("2000-01-01T00:00:00Z"), publishedAt: ago(20) });
    const mine = [first, ...(await Promise.all(owners.slice(1).map((o) => post(o.id, { publishedAt: ago(3) }))))];
    const practice = await post(owners[1].id, { practice: true, publishedAt: ago(1) });
    const old = await post(owners[2].id, { publishedAt: ago(400) });

    const one = await sweep();
    expect(one.owners).toBe(5);
    expect(one.failed).toBe(0);
    expect(await hasItem(first.id)).toBe(true);

    let runs = 1;
    for (let r = one; r.owners > 0 && runs < 100; runs++) r = await sweep();
    for (const p of mine) expect(await hasItem(p.id)).toBe(true);
    expect(await hasItem(practice.id)).toBe(false);
    expect(await hasItem(old.id)).toBe(false);

    const items = await db.contentItem.count();
    expect(await sweep()).toEqual({ owners: 0, items: 0, failed: 0 });
    expect(await db.contentItem.count()).toBe(items);
  });

  test("the cron route runs it in its own minute slot, bounded, never fatal, reported as backfill", () => {
    const s = readFileSync("app/api/cron/sweep/route.ts", "utf8");
    expect(s).toContain('getMinutes() % 10 === 7\n    ? await import("@/lib/intelligence/memory").then((m) => m.sweepBackfill({ maxOwners: 5, batch: 100 }))');
    expect(s).toContain('.then((r) => ({ owners: r.owners, items: r.items })).catch((e) => (console.error("[sweep] backfill", e), null))');
    expect(s).toContain("outcomes, backfill, subs");
  });
});

/* ------------------------------------------------------------------ AI wording gate */

const signal = (format: string, lift: number): Signal => ({
  id: `format:instagram:${format}:views`,
  kind: "format_trend",
  direction: "up",
  title: format,
  platform: "instagram",
  format,
  topic: null,
  evidence: { metric: "views", value: 100 + lift, baseline: 100, unit: "count", lift, n: 6, baselineN: 6, period: "22 Oct to 20 Nov 2026" },
  confidence: "medium",
  postsAnalyzed: 12,
  examples: ["t1"],
});
const draftsOf = (...formats: string[]): Recommendation[] => core.recommendationsFrom(formats.map((f, i) => signal(f, 60 - i * 5))).recommendations;
const period = { from: "2026-10-22T00:00:00.000Z", to: "2026-11-21T00:00:00.000Z" };
const NOW = Date.now();
const today = new Date(NOW).toISOString().slice(0, 10);
let calls = 0;
const faithful = async (_s: string, prompt: string) => {
  calls++;
  const o = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as { title: string; concept: string; why: string; label: string };
  return { title: o.title.replace("Post another", "Make one more"), concept: o.concept, why: o.why, label: "Start the draft" };
};
const usageRow = (userId: string) => db.aiFeatureUsage.findUnique({ where: { userId_day_feature: { userId, day: today, feature: "intelligence_wording" } } });

async function onPlan(perks: string) {
  const u = await user();
  const plan = await db.plan.create({ data: { slug: `t1247-${tag()}`, name: "Test Paid", priceMinor: 100, state: "hidden", perks } });
  await db.subscription.create({ data: { userId: u.id, planId: plan.id, status: "active", priceMinor: 100, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(Date.now() + 30 * DAY), autoRenew: false } });
  return u;
}

describe("R1247 ai-insights perk", () => {
  test("the perk exists, is labelled, and is on Creator and Agency in both presets but not Free or Starter", () => {
    expect(rules.PERKS).toContain("ai-insights");
    expect(rules.PERK_LABEL["ai-insights"]).toBe("AI wording for Intelligence recommendations");
    for (const block of [preset.PRICING_2026_11, preset.PRICING_2026_11_R2]) {
      const perks = Object.fromEntries(block.map((p) => [p.slug, p.data.perks]));
      expect(perks.creator).toContain("ai-insights");
      expect(perks["pro-manager"]).toContain("ai-insights");
      expect(perks.free).not.toContain("ai-insights");
      expect(perks.starter).not.toContain("ai-insights");
    }
  });

  test("planAllowsWording: a perk list decides; 'every perk' counts on paid plans, never on Free", () => {
    expect(reco.planAllowsWording({ perks: ["ai-insights"], source: "paid" })).toBe(true);
    expect(reco.planAllowsWording({ perks: ["ai-insights"], source: "free" })).toBe(true);
    expect(reco.planAllowsWording({ perks: ["weekly-digest"], source: "paid" })).toBe(false);
    expect(reco.planAllowsWording({ perks: [], source: "paid" })).toBe(false);
    expect(reco.planAllowsWording({ perks: null, source: "paid" })).toBe(true);
    expect(reco.planAllowsWording({ perks: null, source: "admin" })).toBe(true);
    expect(reco.planAllowsWording({ perks: null, source: "free" })).toBe(false);
  });

  test("a plan with the perk: allowance 30, it goes down per wording, counted as not unlimited", async () => {
    const u = await onPlan('["ai-insights"]');
    expect(await reco.wordingAllowance(u.id, NOW)).toBe(30);
    calls = 0;
    const rows = await reco.persistRecommendations(u.id, "", draftsOf("video", "carousel"), period, { now: NOW, ask: faithful });
    expect(rows.filter((r) => r.wordedBy === "ai")).toHaveLength(2);
    expect(calls).toBe(2);
    expect(await reco.wordingAllowance(u.id, NOW)).toBe(28);
    expect(await usageRow(u.id)).toMatchObject({ count: 2, unlimited: 0 });
  });

  test("a paid plan without the perk gets rule wording and no call", async () => {
    const u = await onPlan('["weekly-digest"]');
    expect(await reco.wordingAllowance(u.id, NOW)).toBe(0);
    calls = 0;
    const rows = await reco.persistRecommendations(u.id, "", draftsOf("video"), period, { now: NOW, ask: faithful });
    expect(rows[0].wordedBy).toBe("rules");
    expect(calls).toBe(0);
  });

  test("Free with no grant: 0, rule wording, no error, nothing counted", async () => {
    const u = await user();
    expect(await reco.wordingAllowance(u.id, NOW)).toBe(0);
    calls = 0;
    const rows = await reco.persistRecommendations(u.id, "", draftsOf("video"), period, { now: NOW, ask: faithful });
    expect(rows[0].wordedBy).toBe("rules");
    expect((await reco.wordRecommendation(rows[0], { ask: faithful, now: NOW })).wordedBy).toBe("rules");
    expect(calls).toBe(0);
    expect(await usageRow(u.id)).toBeNull();
  });

  test("an admin grant still works on Free, counted as unlimited", async () => {
    const u = await user();
    await db.aiEntitlement.create({ data: { userId: u.id, features: "intelligence_wording", note: "", grantedBy: "test" } });
    expect(await reco.wordingAllowance(u.id, NOW)).toBe(30);
    calls = 0;
    const rows = await reco.persistRecommendations(u.id, "", draftsOf("video"), period, { now: NOW, ask: faithful });
    expect(rows[0].wordedBy).toBe("ai");
    expect(await usageRow(u.id)).toMatchObject({ count: 1, unlimited: 1 });
  });

  test("the day cap holds on the perk path", async () => {
    const u = await onPlan('["ai-insights"]');
    await db.aiFeatureUsage.create({ data: { userId: u.id, day: today, feature: "intelligence_wording", count: 29, unlimited: 0 } });
    expect(await reco.wordingAllowance(u.id, NOW)).toBe(1);
    calls = 0;
    const rows = await reco.persistRecommendations(u.id, "", draftsOf("video", "carousel", "photo"), period, { now: NOW, ask: faithful });
    expect(rows.filter((r) => r.wordedBy === "ai")).toHaveLength(1);
    expect(calls).toBe(1);
    expect(await reco.wordingAllowance(u.id, NOW)).toBe(0);
    expect((await reco.wordRecommendation(rows.find((r) => r.wordedBy === "rules")!, { ask: faithful, now: NOW })).wordedBy).toBe("rules");
    expect(calls).toBe(1);
    expect(await reco.wordingAllowance(u.id, NOW + DAY)).toBe(30);
  });
});
