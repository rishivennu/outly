/**
 * R1242: the outcomes loop. Pure verdicts and lift maths (lib/intelligence/outcome-core.ts), owner-checked links,
 * one outcome per recommendation per 24 hours, the dashboard read, and the bounded /api/cron/sweep step.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PostRecord } from "../lib/intelligence/core";
import { computeOutcome, OUTCOME_MIN_AGE_MS } from "../lib/intelligence/outcome-core";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let out: typeof import("../lib/intelligence/outcome");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  out = await import("../lib/intelligence/outcome");
}, 60_000);

const DAY = 864e5;
const HOUR = 36e5;
const NOW = Date.UTC(2026, 10, 20, 12);
const CAUSAL = /because|caused|thanks to|led to|drove|due to/i;

const rec = (id: string, views: number | null, ageMs: number, extra: Partial<PostRecord> = {}): PostRecord => ({
  id,
  platform: "instagram",
  format: "video",
  publishedAt: new Date(NOW - ageMs).toISOString(),
  metrics: { views },
  ...extra,
});
const cohortOf = (...views: number[]) => views.map((v, i) => rec(`c${i}`, v, 10 * DAY));

describe("R1242 outcome-core", () => {
  test("too early: not published, under 48 h, no numbers yet, or fewer than 3 cohort posts", () => {
    expect(OUTCOME_MIN_AGE_MS).toBe(48 * HOUR);
    const cohort = cohortOf(100, 200, 300);
    expect(computeOutcome(null, cohort, "views", NOW).verdict).toBe("too early");
    const young = computeOutcome(rec("p", 900, 47 * HOUR), cohort, "views", NOW);
    expect(young.verdict).toBe("too early");
    expect(young.lift).toBeNull();
    expect(computeOutcome(rec("p", null, 3 * DAY), cohort, "views", NOW).verdict).toBe("too early");
    const thin = computeOutcome(rec("p", 900, 3 * DAY), cohortOf(100, 200), "views", NOW);
    expect(thin.verdict).toBe("too early");
    expect(thin.n).toBe(2);
    expect(thin.summary).toContain("at least 3");
    // Young cohort posts, other formats and platforms, and the post itself never count.
    const mixed = [...cohortOf(100, 200), rec("y", 5000, HOUR), rec("ph", 5000, 10 * DAY, { format: "photo" }), rec("yt", 5000, 10 * DAY, { platform: "youtube" }), rec("p", 900, 3 * DAY)];
    expect(computeOutcome(rec("p", 900, 3 * DAY), mixed, "views", NOW).n).toBe(2);
  });

  test("lift against the cohort median, with early-signal wording and never causal", () => {
    const cohort = cohortOf(100, 200, 300);
    const up = computeOutcome(rec("p", 300, 3 * DAY), cohort, "views", NOW);
    expect(up).toMatchObject({ metric: "views", value: 300, cohortMedian: 200, lift: 50, n: 3, verdict: "early signal up", confidence: "low" });
    expect(up.summary).toContain("50% above");
    expect(up.summary).toContain("One post is not proof");
    const down = computeOutcome(rec("p", 150, 3 * DAY), cohort, "views", NOW);
    expect(down).toMatchObject({ lift: -25, verdict: "early signal down" });
    expect(down.summary).toContain("25% below");
    const level = computeOutcome(rec("p", 210, 3 * DAY), cohort, "views", NOW);
    expect(level).toMatchObject({ lift: 5, verdict: "in line" });
    const fromZero = computeOutcome(rec("p", 40, 3 * DAY), cohortOf(0, 0, 0), "views", NOW);
    expect(fromZero).toMatchObject({ lift: null, cohortMedian: 0, verdict: "early signal up" });
    const big = computeOutcome(rec("p", 300, 3 * DAY), cohortOf(100, 200, 200, 200, 300, 300), "views", NOW);
    expect(big.confidence).toBe("medium");
    for (const o of [up, down, level, fromZero, big]) {
      expect(o.summary).not.toMatch(CAUSAL);
      expect(o.summary).not.toContain("\u2014");
    }
  });
});

let n = 0;
const user = async () => db.user.create({ data: { name: `O ${++n}`, email: `r1242-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x" } });

async function seed(ownerId: string) {
  const account = await db.socialAccount.create({ data: { userId: ownerId, platform: "instagram", platformUserId: `ig-r1242-${Date.now()}-${Math.random()}`, username: "@o", accessToken: "x", status: "connected" } });
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1242/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready" } });
  const post = async (views: number | null, ageMs: number) => {
    const at = new Date(Date.now() - ageMs);
    const p = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at } });
    const t = await db.postTarget.create({ data: { postId: p.id, platform: "instagram", socialAccountId: account.id, platformStatus: "published", publishedAt: at } });
    if (views !== null) await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views, likes: 1 } });
    return p;
  };
  return { post };
}

const recommendation = (ownerId: string) =>
  db.recommendation.create({
    data: {
      ownerId,
      dedupeKey: `k-${Math.random()}`,
      title: "Post another Instagram video",
      format: "video",
      platform: "instagram",
      concept: "c",
      why: "w",
      evidence: JSON.stringify({ metric: "views", value: 300, baseline: 100, unit: "count", lift: 200, n: 3, baselineN: 3, period: "p", rule: "rec:format:instagram:video:views" }),
      postsAnalyzed: 6,
      periodFrom: new Date(Date.now() - 28 * DAY).toISOString(),
      periodTo: new Date().toISOString(),
      confidence: "low",
      nextAction: "{}",
    },
  });

const events = (recommendationId: string, type: string) => db.recommendationEvent.findMany({ where: { recommendationId, type } });

describe("R1242 linkOutcome", () => {
  test("another owner's post or recommendation is refused; a good link is stored once and fills contentItemId", async () => {
    const a = await user();
    const b = await user();
    const sa = await seed(a.id);
    const sb = await seed(b.id);
    const ra = await recommendation(a.id);
    const rb = await recommendation(b.id);
    const pa = await sa.post(300, 3 * DAY);
    const pb = await sb.post(300, 3 * DAY);
    expect(await out.linkOutcome(a.id, ra.id, pb.id)).toEqual({ ok: false, error: "Not found" });
    expect(await out.linkOutcome(a.id, rb.id, pa.id)).toEqual({ ok: false, error: "Not found" });
    expect(await events(ra.id, "outcome_link")).toHaveLength(0);
    expect(await events(rb.id, "outcome_link")).toHaveLength(0);

    const item = await db.contentItem.create({ data: { ownerId: a.id, format: "video", origin: "recommendation" } });
    await db.contentVariation.create({ data: { itemId: item.id, postId: pa.id, platform: "instagram" } });
    expect(await out.linkOutcome(a.id, ra.id, pa.id)).toEqual({ ok: true });
    expect(await out.linkOutcome(a.id, ra.id, pa.id)).toEqual({ ok: true });
    const links = await events(ra.id, "outcome_link");
    expect(links).toHaveLength(1);
    expect(JSON.parse(links[0].data!)).toEqual({ postId: pa.id });
    expect((await db.recommendation.findUnique({ where: { id: ra.id } }))!.contentItemId).toBe(item.id);
  });
});

describe("R1242 measureOutcomes", () => {
  test("one outcome per 24 hours, lift against the owner's cohort, and outcomesFor is owner-scoped", async () => {
    const a = await user();
    const s = await seed(a.id);
    for (const v of [100, 200, 300]) await s.post(v, 10 * DAY);
    const p = await s.post(300, 5 * DAY);
    const r = await recommendation(a.id);
    await out.linkOutcome(a.id, r.id, p.id);
    const t0 = Date.now();
    expect(await out.measureOutcomes(a.id, { now: t0 })).toEqual({ measured: 1 });
    expect(await out.measureOutcomes(a.id, { now: t0 + HOUR })).toEqual({ measured: 0 });
    expect(await events(r.id, "outcome")).toHaveLength(1);
    expect(await out.measureOutcomes(a.id, { now: t0 + 25 * HOUR })).toEqual({ measured: 1 });
    expect(await events(r.id, "outcome")).toHaveLength(2);

    const got = await out.outcomesFor(a.id, [r.id, "nope"]);
    expect(Object.keys(got)).toEqual([r.id]);
    expect(got[r.id]).toMatchObject({ postId: p.id, metric: "views", value: 300, cohortMedian: 200, lift: 50, n: 3, verdict: "early signal up" });
    expect(got[r.id].measuredAt).toBe(new Date(t0 + 25 * HOUR).toISOString());
    const other = await user();
    expect(await out.outcomesFor(other.id, [r.id])).toEqual({});
    expect(await out.measureOutcomes(other.id, { now: t0 + 50 * HOUR })).toEqual({ measured: 0 });
  });

  test("a post under 48 hours old is recorded as too early, and nothing is measured without a link", async () => {
    const a = await user();
    const s = await seed(a.id);
    for (const v of [100, 200, 300]) await s.post(v, 10 * DAY);
    const unlinked = await recommendation(a.id);
    const p = await s.post(900, 20 * HOUR);
    const r = await recommendation(a.id);
    await out.linkOutcome(a.id, r.id, p.id);
    expect(await out.measureOutcomes(a.id)).toEqual({ measured: 1 });
    const got = await out.outcomesFor(a.id, [r.id, unlinked.id]);
    expect(Object.keys(got)).toEqual([r.id]);
    expect(got[r.id]).toMatchObject({ verdict: "too early", lift: null });
  });
});

describe("R1242 sweep step", () => {
  test("at most 10 owners a run, the rest picked up next run, every pending one measured", async () => {
    const recIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const u = await user();
      const s = await seed(u.id);
      const p = await s.post(300, 3 * DAY);
      const r = await recommendation(u.id);
      await out.linkOutcome(u.id, r.id, p.id);
      recIds.push(r.id);
    }
    const now = Date.now();
    const first = await out.sweepOutcomes({ maxOwners: 10, now });
    expect(first.owners).toBe(10);
    expect(first.failed).toBe(0);
    let runs = 1;
    while ((await out.sweepOutcomes({ maxOwners: 10, now })).owners > 0 && runs < 20) runs++;
    for (const id of recIds) expect(await events(id, "outcome")).toHaveLength(1);
    expect((await out.sweepOutcomes({ maxOwners: 10, now })).owners).toBe(0);
  }, 60_000);

  test("the cron route runs it gated, bounded and never fatal", () => {
    const s = readFileSync("app/api/cron/sweep/route.ts", "utf8");
    expect(s).toContain('getMinutes() % 10 === 4 ? await import("@/lib/intelligence/outcome").then((m) => m.sweepOutcomes({ maxOwners: 10 })).catch(');
    expect(s).toContain("campaign, outcomes, subs");
  });
});
