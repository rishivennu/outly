/**
 * R1239: stored recommendations (lib/intelligence/reco.ts) and their pure rules (reco-core.ts): idempotent
 * regeneration with one 'generated' event per row, closed rows never reopened, expiry, the number-preserving
 * wording check, AI wording only when it passes, and overview returning stored ids.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { Recommendation, Signal } from "../lib/intelligence/core";
import { dedupeKeyOf, isExpired, ruleKeyOf, validateWording } from "../lib/intelligence/reco-core";

const jar = new Map<string, { value: string }>();
mock.module("next/headers", () => ({
  cookies: () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined), getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let reco: typeof import("../lib/intelligence/reco");
let core: typeof import("../lib/intelligence/core");
let svc: typeof import("../lib/intelligence/service");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  reco = await import("../lib/intelligence/reco");
  core = await import("../lib/intelligence/core");
  svc = await import("../lib/intelligence/service");
}, 60_000);

const DAY = 864e5;
let n = 0;
const user = async () => db.user.create({ data: { name: `R ${++n}`, email: `r1239-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });

const signal = (id: string, lift: number, nPosts = 6, format = "video"): Signal => ({
  id,
  kind: "format_trend",
  direction: "up",
  title: id,
  platform: "instagram",
  format,
  topic: null,
  evidence: { metric: "views", value: 100 + lift, baseline: 100, unit: "count", lift, n: nPosts, baselineN: nPosts, period: "22 Oct to 20 Nov 2026" },
  confidence: "medium",
  postsAnalyzed: nPosts * 2,
  examples: ["t1", "t2"],
});
const drafts = (): Recommendation[] => {
  const r = (globalThis as unknown as { __c?: typeof import("../lib/intelligence/core") }).__c ?? core;
  return r.recommendationsFrom([signal("format:instagram:video:views", 50), signal("format:instagram:carousel:views", 30, 6, "carousel")]).recommendations;
};
const period = { from: "2026-10-22T00:00:00.000Z", to: "2026-11-21T00:00:00.000Z" };
const NOW = Date.parse("2026-11-20T12:00:00Z");

describe("R1239 reco-core", () => {
  const d = { id: "format:instagram:video:views", platform: "instagram", format: "video", nextAction: { kind: "create" as const, label: "Draft it", prefill: { platform: "instagram", format: "video", topic: null, basedOn: [] } } };
  test("dedupe key is stable and changes with the period or subject", () => {
    expect(dedupeKeyOf(d, period)).toBe(dedupeKeyOf({ ...d }, { ...period }));
    expect(dedupeKeyOf(d, period)).toMatch(/^[0-9a-f]{16}$/);
    expect(dedupeKeyOf(d, period)).not.toBe(dedupeKeyOf(d, { ...period, from: "2026-10-23T00:00:00.000Z" }));
    expect(dedupeKeyOf(d, period)).not.toBe(dedupeKeyOf({ ...d, format: "carousel" }, period));
    expect(ruleKeyOf(d)).toBe("format:instagram:video:views|instagram|video|");
  });
  test("open rows expire after twice their period length; closed ones never do", () => {
    const base = { periodFrom: "2026-11-01T00:00:00.000Z", periodTo: "2026-11-08T00:00:00.000Z", createdAt: new Date("2026-11-08T00:00:00Z") };
    expect(isExpired({ ...base, status: "open" }, Date.parse("2026-11-21T00:00:00Z"))).toBe(false);
    expect(isExpired({ ...base, status: "open" }, Date.parse("2026-11-23T00:00:00Z"))).toBe(true);
    expect(isExpired({ ...base, status: "rejected" }, Date.parse("2027-01-01T00:00:00Z"))).toBe(false);
    expect(isExpired({ ...base, status: "open", periodTo: "bad" }, Date.parse("2027-01-01T00:00:00Z"))).toBe(false);
  });
  test("validateWording keeps every number, platform and format", () => {
    const original = {
      title: "Post another Instagram video",
      concept: "Another Instagram video, in the style of your best recent ones.",
      why: "Your Instagram videos got a median of 1.2K views (6 posts, 22 Oct to 20 Nov 2026), up 35% on 900 across the 6 before.",
      nextAction: { label: "Draft it in Content Studio" },
    };
    const faithful = {
      title: "Make one more Instagram video",
      concept: "One more Instagram video like your best recent ones.",
      why: "Up 35%: your Instagram videos reached a median of 1.2K views across 6 posts (22 Oct to 20 Nov 2026), against 900 for the 6 before.",
      nextAction: { label: "Start the draft" },
    };
    expect(validateWording(original, faithful)).toEqual({ ok: true, reason: null });
    expect(validateWording(original, { ...faithful, why: faithful.why.replace("35%", "53%") }).ok).toBe(false);
    expect(validateWording(original, { ...faithful, why: faithful.why.replace("1.2K", "1.5K") }).ok).toBe(false);
    expect(validateWording(original, { ...faithful, title: "Make one more TikTok video" }).ok).toBe(false);
    expect(validateWording(original, { ...faithful, title: "Make one more Instagram carousel" }).ok).toBe(false);
    expect(validateWording(original, { ...faithful, why: `${faithful.why} 3 times better.` }).ok).toBe(false);
    expect(validateWording(original, { ...faithful, concept: "" }).ok).toBe(false);
    expect(validateWording(original, { ...faithful, title: "Instagram video \u2014 again" }).ok).toBe(false);
    expect(validateWording(original, null).ok).toBe(false);
  });
});

describe("R1239 persistRecommendations", () => {
  test("the same drafts twice give the same rows and one 'generated' event each", async () => {
    const u = await user();
    const a = await reco.persistRecommendations(u.id, "", drafts(), period, { now: NOW, ask: null });
    const b = await reco.persistRecommendations(u.id, "", drafts(), period, { now: NOW + 3600e3, ask: null });
    expect(a.length).toBe(2);
    expect(b.map((r) => r.id)).toEqual(a.map((r) => r.id));
    expect(await db.recommendation.count({ where: { ownerId: u.id } })).toBe(2);
    expect(await db.recommendationEvent.count({ where: { recommendationId: { in: a.map((r) => r.id) }, type: "generated" } })).toBe(2);
    expect(a[0]).toMatchObject({ status: "open", wordedBy: "rules", platform: "instagram", format: "video", confidence: "medium" });
    expect(a[0].evidence.lift).toBe(50);
    expect(a[0].nextAction.prefill.basedOn).toEqual(["t1", "t2"]);
    // A day later the window has moved, but the same rule keeps its row.
    const c = await reco.persistRecommendations(u.id, "", drafts(), { from: "2026-10-23T00:00:00.000Z", to: "2026-11-22T00:00:00.000Z" }, { now: NOW + DAY, ask: null });
    expect(c.map((r) => r.id)).toEqual(a.map((r) => r.id));
  });
  test("a rejected one stays rejected and is not recreated", async () => {
    const u = await user();
    const [first] = await reco.persistRecommendations(u.id, "", drafts(), period, { now: NOW, ask: null });
    await db.recommendation.update({ where: { id: first.id }, data: { status: "rejected" } });
    const again = await reco.persistRecommendations(u.id, "", drafts(), period, { now: NOW + DAY, ask: null });
    expect(again[0].id).toBe(first.id);
    expect(again[0].status).toBe("rejected");
    expect(await db.recommendation.count({ where: { ownerId: u.id } })).toBe(2);
  });
  test("stale open rows expire, with an event, and fresh numbers may then make a new one", async () => {
    const u = await user();
    const [first] = await reco.persistRecommendations(u.id, "", drafts(), period, { now: NOW, ask: null });
    const later = NOW + 61 * DAY;
    const p2 = { from: "2026-12-21T00:00:00.000Z", to: "2027-01-20T00:00:00.000Z" };
    const next = await reco.persistRecommendations(u.id, "", drafts(), p2, { now: later, ask: null });
    expect((await db.recommendation.findUnique({ where: { id: first.id } }))?.status).toBe("expired");
    expect(await db.recommendationEvent.count({ where: { recommendationId: first.id, type: "expired" } })).toBe(1);
    expect(next[0].id).not.toBe(first.id);
    expect(next[0].status).toBe("open");
  });
  test("scopes and owners are isolated", async () => {
    const [u, other] = [await user(), await user()];
    await reco.persistRecommendations(u.id, "", drafts(), period, { now: NOW, ask: null });
    await reco.persistRecommendations(u.id, "client-a", drafts(), period, { now: NOW, ask: null });
    expect((await reco.listRecommendations(u.id, "")).length).toBe(2);
    expect((await reco.listRecommendations(u.id, "client-a")).length).toBe(2);
    expect(await reco.listRecommendations(other.id, "")).toEqual([]);
    expect(await reco.listRecommendations(u.id, "", { status: "nonsense" })).toEqual([]);
    expect((await reco.listRecommendations(u.id, "", { status: "open", limit: 1 })).length).toBe(1);
  });
  test("AI wording is used only when it keeps the facts; otherwise the rule text stays", async () => {
    const u = await user();
    const faithful = async (_s: string, prompt: string) => {
      const o = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as { title: string; concept: string; why: string; label: string };
      return { title: o.title.replace("Post another", "Make one more"), concept: o.concept, why: o.why, label: "Start the draft" };
    };
    const [good] = await reco.persistRecommendations(u.id, "", drafts().slice(0, 1), period, { now: NOW, ask: faithful });
    expect(good.wordedBy).toBe("ai");
    expect(good.title).toBe("Make one more Instagram video");
    expect(good.nextAction.label).toBe("Start the draft");
    expect((await db.recommendation.findUnique({ where: { id: good.id } }))?.wordedBy).toBe("ai");

    const v = await user();
    const liar = async () => ({ title: "Post another TikTok video", concept: "x", why: "Up 900%.", label: "Go" });
    const [kept] = await reco.persistRecommendations(v.id, "", drafts().slice(0, 1), period, { now: NOW, ask: liar });
    expect(kept.wordedBy).toBe("rules");
    expect(kept.title).toBe("Post another Instagram video");
    const broken = async () => {
      throw new Error("down");
    };
    const w = await user();
    const [fallback] = await reco.persistRecommendations(w.id, "", drafts().slice(0, 1), period, { now: NOW, ask: broken });
    expect(fallback.wordedBy).toBe("rules");
  });
  test("no drafts: nothing stored", async () => {
    const u = await user();
    expect(await reco.persistRecommendations(u.id, "", [], period, { ask: null })).toEqual([]);
    expect(await db.recommendation.count({ where: { ownerId: u.id } })).toBe(0);
  });
});

describe("R1239 overview returns stored ids", () => {
  test("recommendations carry their row id, status and wordedBy, and stay the same on a second read", async () => {
    const u = await user();
    const account = await db.socialAccount.create({ data: { userId: u.id, platform: "instagram", platformUserId: `ig-r1239-${Date.now()}`, username: "@r", accessToken: "x", status: "connected" } });
    const media = await db.media.create({ data: { userId: u.id, originalFilename: "v.mp4", storageKey: `r1239/${Date.now()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready" } });
    const mk = async (views: number, daysAgo: number) => {
      const at = new Date(Date.now() - daysAgo * DAY);
      const p = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published", publishedAt: at } });
      const t = await db.postTarget.create({ data: { postId: p.id, platform: "instagram", socialAccountId: account.id, platformStatus: "published", publishedAt: at } });
      await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views, likes: 1 } });
    };
    for (const v of [300, 300, 300]) await mk(v, 3);
    for (const v of [100, 100, 100]) await mk(v, 40);
    const scope = { id: u.id, scope: null };
    const o = await svc.overview(scope, { days: 28, objective: "awareness", accountIds: null });
    expect(o.recommendations.length).toBe(1);
    const r = o.recommendations[0];
    expect(r.id).toMatch(/^c/);
    expect(r.status).toBe("open");
    expect(r.wordedBy).toBe("rules");
    expect(r.rule.startsWith("rec:format:instagram:video:views")).toBe(true);
    expect(r.evidence.lift).toBe(200);
    const again = await svc.overview(scope, { days: 28, objective: "awareness", accountIds: null });
    expect(again.recommendations.map((x) => x.id)).toEqual([r.id]);
    await db.recommendation.update({ where: { id: r.id }, data: { status: "rejected" } });
    const third = await svc.overview(scope, { days: 28, objective: "awareness", accountIds: null });
    expect(third.recommendations).toEqual([]);
    expect(third.recommendationsReason).toContain("already closed");
  });
});
