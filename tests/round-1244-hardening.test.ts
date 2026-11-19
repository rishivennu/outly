/**
 * R1244: hardening. Pip's read-only Content Intelligence tool, AI wording behind an AI grant with a day cap,
 * act() refusing expired rows (and marking them), and the overview's post cap flag.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { Recommendation, Signal } from "../lib/intelligence/core";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let core: typeof import("../lib/intelligence/core");
let reco: typeof import("../lib/intelligence/reco");
let svc: typeof import("../lib/intelligence/service");
let planner: typeof import("../lib/intelligence/planner");
let tools: typeof import("../lib/pip/tools");
let plan: typeof import("../lib/pip/plan");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  core = await import("../lib/intelligence/core");
  reco = await import("../lib/intelligence/reco");
  svc = await import("../lib/intelligence/service");
  planner = await import("../lib/intelligence/planner");
  tools = await import("../lib/pip/tools");
  plan = await import("../lib/pip/plan");
}, 60_000);

const DAY = 864e5;
let n = 0;
const user = async () => db.user.create({ data: { name: `H ${++n}`, email: `r1244-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x" } });
const grant = (userId: string) => db.aiEntitlement.create({ data: { userId, features: "intelligence_wording", note: "", grantedBy: "test" } });

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
const NOW = Date.parse("2026-11-20T12:00:00Z");
let calls = 0;
const faithful = async (_s: string, prompt: string) => {
  calls++;
  const o = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1)) as { title: string; concept: string; why: string; label: string };
  return { title: o.title.replace("Post another", "Make one more"), concept: o.concept, why: o.why, label: "Start the draft" };
};
const usage = async (userId: string) =>
  (await db.aiFeatureUsage.findUnique({ where: { userId_day_feature: { userId, day: new Date(NOW).toISOString().slice(0, 10), feature: "intelligence_wording" } } }))?.count ?? 0;

describe("R1244 AI wording gate", () => {
  test("no AI grant: rule wording, no model call, no error, nothing counted", async () => {
    const u = await user();
    calls = 0;
    const rows = await reco.persistRecommendations(u.id, "", draftsOf("video"), period, { now: NOW, ask: faithful });
    expect(rows).toHaveLength(1);
    expect(rows[0].wordedBy).toBe("rules");
    expect(rows[0].title).toBe("Post another Instagram video");
    expect(calls).toBe(0);
    expect(await usage(u.id)).toBe(0);
    expect(await reco.wordingAllowance(u.id, NOW)).toBe(0);
    expect((await reco.wordRecommendation(rows[0], { ask: faithful, now: NOW })).wordedBy).toBe("rules");
    expect(calls).toBe(0);
  });

  test("with a grant: counted per call, and the 30 a day cap is honoured", async () => {
    const u = await user();
    await grant(u.id);
    expect(reco.WORDING_DAY_CAP).toBe(30);
    expect(await reco.wordingAllowance(u.id, NOW)).toBe(30);
    await db.aiFeatureUsage.create({ data: { userId: u.id, day: new Date(NOW).toISOString().slice(0, 10), feature: "intelligence_wording", count: 28, unlimited: 28 } });
    calls = 0;
    const rows = await reco.persistRecommendations(u.id, "", draftsOf("video", "carousel", "photo", "story"), period, { now: NOW, ask: faithful });
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.wordedBy === "ai")).toHaveLength(2);
    expect(rows.filter((r) => r.wordedBy === "rules")).toHaveLength(2);
    expect(calls).toBe(2);
    expect(await usage(u.id)).toBe(30);
    const more = await reco.persistRecommendations(u.id, "client-b", draftsOf("video", "carousel"), period, { now: NOW, ask: faithful });
    expect(more.every((r) => r.wordedBy === "rules")).toBe(true);
    expect(calls).toBe(2);
    expect(await usage(u.id)).toBe(30);
    // The next UTC day starts a fresh allowance.
    expect(await reco.wordingAllowance(u.id, NOW + DAY)).toBe(30);
  });
});

describe("R1244 act on an expired row", () => {
  test("400 EXPIRED, and the row is marked expired with an event; feedback still works", async () => {
    const u = await user();
    const old = new Date(NOW - 70 * DAY);
    const rec = await db.recommendation.create({
      data: {
        ownerId: u.id,
        dedupeKey: `x-${Math.random()}`,
        title: "Post another Instagram video",
        format: "video",
        platform: "instagram",
        concept: "c",
        why: "w",
        evidence: JSON.stringify({ metric: "views", rule: "rec:format:instagram:video:views" }),
        postsAnalyzed: 6,
        periodFrom: new Date(NOW - 98 * DAY).toISOString(),
        periodTo: new Date(NOW - 70 * DAY).toISOString(),
        confidence: "low",
        nextAction: JSON.stringify({ kind: "create", label: "Draft it", prefill: { platform: "instagram", format: "video", topic: null, basedOn: [] } }),
        createdAt: old,
      },
    });
    const actor = { id: u.id, role: "owner" };
    let err: unknown = null;
    await planner.act(u.id, rec.id, "accept", null, actor, NOW).catch((e) => (err = e));
    expect(err).toMatchObject({ status: 400, code: "EXPIRED" });
    expect((await db.recommendation.findUnique({ where: { id: rec.id } }))!.status).toBe("expired");
    const evs = await db.recommendationEvent.findMany({ where: { recommendationId: rec.id } });
    expect(evs.map((e) => e.type)).toEqual(["expired"]);
    // Already expired: still refused, no second event.
    err = null;
    await planner.act(u.id, rec.id, "done", null, actor, NOW).catch((e) => (err = e));
    expect(err).toMatchObject({ status: 400, code: "EXPIRED" });
    expect(await db.recommendationEvent.count({ where: { recommendationId: rec.id, type: "expired" } })).toBe(1);
    const fb = await planner.act(u.id, rec.id, "feedback", { helpful: true }, actor, NOW);
    expect(fb.recommendation.status).toBe("expired");
    expect(await db.recommendationEvent.count({ where: { recommendationId: rec.id, type: "feedback" } })).toBe(1);
  });

  test("a fresh open row is acted on as before", async () => {
    const u = await user();
    const [row] = await reco.persistRecommendations(u.id, "", draftsOf("video"), period, { now: Date.now(), ask: null });
    const r = await planner.act(u.id, row.id, "reject", null, { id: u.id, role: "owner" });
    expect(r.recommendation.status).toBe("rejected");
  });
});

async function fixture() {
  const u = await user();
  const account = await db.socialAccount.create({ data: { userId: u.id, platform: "instagram", platformUserId: `ig-r1244-${Date.now()}-${Math.random()}`, username: "@h", accessToken: "x", status: "connected" } });
  const media = await db.media.create({ data: { userId: u.id, originalFilename: "v.mp4", storageKey: `r1244/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready" } });
  const mk = async (views: number, daysAgo: number) => {
    const at = new Date(Date.now() - daysAgo * DAY);
    const p = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published", publishedAt: at } });
    const t = await db.postTarget.create({ data: { postId: p.id, platform: "instagram", socialAccountId: account.id, platformStatus: "published", publishedAt: at } });
    await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views, likes: 1 } });
  };
  for (const v of [300, 300, 300]) await mk(v, 3);
  for (const v of [100, 100, 100]) await mk(v, 40);
  return u;
}

const counts = async (ownerId: string) => {
  const ids = (await db.recommendation.findMany({ where: { ownerId }, select: { id: true } })).map((r) => r.id);
  return { recs: ids.length, events: await db.recommendationEvent.count({ where: { recommendationId: { in: ids } } }), all: await db.recommendationEvent.count() };
};

describe("R1244 Pip intelligence_overview", () => {
  test("routes from plain questions", () => {
    expect(plan.keywordPlan("what is working in my content?")?.tool).toBe("intelligence_overview");
    expect(plan.keywordPlan("show my content recommendations")?.tool).toBe("intelligence_overview");
    expect(plan.readPlan({ tool: "intelligence_overview" })?.tool).toBe("intelligence_overview");
  });

  test("returns the compact summary and never writes, before or after the dashboard stored the rows", async () => {
    const u = await fixture();
    const ctx = { ownerId: u.id, actorId: null, scope: null, tz: "UTC", now: new Date(), message: "what is working for awareness?" };
    const before = await counts(u.id);
    expect(before.recs).toBe(0);
    const r = await tools.runTool("intelligence_overview", ctx, {});
    expect(await counts(u.id)).toEqual(before);
    expect(r.tool).toBe("intelligence_overview");
    expect(r.cards?.map((c) => c.label)).toEqual(["Posts analysed", "Judged for", "Recommendations"]);
    expect(r.cards?.[0].value).toBe("6");
    expect(r.cards?.[2].value).toBe("1");
    const sections = r.rows.map((x) => x.cells.section).filter(Boolean);
    expect(sections).toEqual(["Working", "Needs attention", "Next"]);
    expect(r.facts.some((f) => f.startsWith("Next: Post another Instagram video (medium confidence).") || f.startsWith("Next: Post another Instagram video (low confidence)."))).toBe(true);
    expect(r.facts.some((f) => f.startsWith("Working: ") && f.includes("views"))).toBe(true);
    expect(r.facts.join(" ")).not.toContain("\u2014");

    // The dashboard stores the row; Pip then reads that row and still writes nothing.
    const o = await svc.overview({ id: u.id, scope: null }, { days: 28, objective: "awareness", accountIds: null });
    expect(o.recommendations).toHaveLength(1);
    expect(o.postsCapped).toBe(false);
    const stored = await counts(u.id);
    expect(stored.recs).toBe(1);
    const again = await tools.runTool("intelligence_overview", ctx, {});
    expect(await counts(u.id)).toEqual(stored);
    expect(again.facts.filter((f) => f.startsWith("Next: "))).toEqual(r.facts.filter((f) => f.startsWith("Next: ")));
    // A rejected row is closed for Pip too.
    await db.recommendation.update({ where: { id: o.recommendations[0].id }, data: { status: "rejected" } });
    const third = await tools.runTool("intelligence_overview", ctx, {});
    expect(third.facts.some((f) => f.includes("already closed"))).toBe(true);
    expect(await counts(u.id)).toEqual(stored);
  });

  test("not enough posts: the dashboard's empty-state words, no rows", async () => {
    const u = await user();
    const r = await tools.runTool("intelligence_overview", { ownerId: u.id, actorId: null, scope: null, tz: "UTC", now: new Date(), message: "content intelligence" }, {});
    expect(r.rows).toEqual([]);
    expect(r.empty).toContain("Outlly needs at least 3 published posts");
  });
});

describe("R1244 overview load", () => {
  test("postsCapped is false on a small fixture, and the cap is 2000", async () => {
    expect(svc.POSTS_CAP).toBe(2000);
    const u = await fixture();
    const o = await svc.overview({ id: u.id, scope: null }, { days: 28, objective: "awareness", accountIds: null, readOnly: true });
    expect(o.postsCapped).toBe(false);
    expect(o.postsAnalyzed).toBe(6);
    expect(await db.recommendation.count({ where: { ownerId: u.id } })).toBe(0);
  });

  test("the loader is one post query plus one groupBy, cached by window, accounts and brand", () => {
    const src = require("node:fs").readFileSync("lib/intelligence/service.ts", "utf8") as string;
    const body = src.slice(src.indexOf("async function computePostRecords"), src.indexOf("export interface Overview"));
    expect(body.match(/db\.\w+\.(findMany|groupBy|findFirst|findUnique)\(/g)).toEqual(["db.postTarget.findMany(", "db.targetMetric.groupBy("]);
    expect(body).toContain("take: POSTS_CAP");
    expect(svc.postsCacheKey("u", core.periodOf(NOW, 28), ["b", "a"], "client")).toContain(":a,b:client");
  });
});
