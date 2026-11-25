/**
 * R1324 (Phase 6): shared learning. The pure aggregator (thresholds, the owner cap and share rule, category
 * buckets, no identity in the output, the scaled prior), the governance maths (weekly accuracy, drift), the stored
 * side (rebuild honours opt-outs and stores one ModelVersion; a creator with no history gets a shared prior scaled to
 * their followers; the governance view carries no creator id), and the wiring (admin area, nav, sweep slot, the
 * sharing switch, owner-only PATCH).
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { accuracyByWeek, buildShared, driftOf, parseShared, pickBucket, quantile, SHARED_MAX_OWNER_SHARE, SHARED_MIN_OWNERS, SHARED_MIN_POSTS, SHARED_OWNER_CAP, sharedFor, weeklyAccuracy, type SharedRow } from "../lib/intelligence/shared-core";
import { baselineScorer, cohortSize, EVAL_MIN_AGE_DAYS } from "../lib/intelligence/model/scorer-core";
import { can } from "../lib/admin/perms";
import { withIntelligence } from "./helpers/intelligence-plan";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let shared: typeof import("../lib/intelligence/shared");
let pred: typeof import("../lib/intelligence/model/predict");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  shared = await import("../lib/intelligence/shared");
  pred = await import("../lib/intelligence/model/predict");
}, 60_000);

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DAY = 864e5;
const NOW = Date.UTC(2026, 10, 24, 12);
// Rows start a week + 1 day back: a post joins the cohort only once its first week is over.
const row = (owner: string, i: number, o: Partial<SharedRow> = {}): SharedRow => ({ owner, platform: "instagram", format: "video", publishedAt: new Date(NOW - (i + EVAL_MIN_AGE_DAYS + 1) * DAY), categories: ["finance"], views: 100 + i, viewsPerFollower: 0.1 + i / 100, engagementRate: 2, ...o });

/* ------------------------------------------------------------------ core */

describe("R1324 shared-core", () => {
  test("a bucket is published only with enough creators and posts, and no creator above half", () => {
    // 5 creators x 4 posts = 20: exactly the floor.
    const rows = Array.from({ length: 5 }, (_, o) => Array.from({ length: 4 }, (_, i) => row(`o${o}`, i))).flat();
    const b = buildShared(rows, NOW);
    expect(b.buckets.map((x) => x.key).sort()).toEqual(["instagram|video", "instagram|video|finance"]);
    expect(b.buckets[0]).toMatchObject({ n: 20, owners: 5, topOwnerShare: 0.2 });
    expect(b.rows).toBe(20);
    expect(b.owners).toBe(5);
    expect(b.dropped).toBe(0);
    // One creator short: nothing published, counted as dropped.
    expect(buildShared(rows.filter((r) => r.owner !== "o4"), NOW)).toMatchObject({ buckets: [], dropped: 2 });
    // Enough creators but 19 posts: dropped.
    expect(buildShared(rows.slice(1), NOW).buckets).toEqual([]);
    // One creator holding 60% of a 25-post bucket: dropped even though 5 creators are in it.
    const dominated = [...Array.from({ length: 15 }, (_, i) => row("big", i)), ...Array.from({ length: 4 }, (_, o) => Array.from({ length: 3 }, (_, i) => row(`s${o}`, i))).flat()];
    expect(dominated.length).toBe(27);
    expect(buildShared(dominated, NOW).buckets).toEqual([]);
    expect(SHARED_MIN_OWNERS).toBe(5);
    expect(SHARED_MIN_POSTS).toBe(20);
    expect(SHARED_MAX_OWNER_SHARE).toBe(0.5);
  });

  test("one creator contributes at most SHARED_OWNER_CAP most-recent posts; old rows and rows without numbers are skipped", () => {
    const rows = [...Array.from({ length: 50 }, (_, i) => row("big", i, { views: i < 30 ? 10 : 100000 })), ...Array.from({ length: 6 }, (_, o) => Array.from({ length: 6 }, (_, i) => row(`s${o}`, i, { views: 10 }))).flat()];
    const b = buildShared(rows, NOW);
    const all = b.buckets.find((x) => x.category === null)!;
    expect(all.n).toBe(SHARED_OWNER_CAP + 36);
    // The capped creator's kept rows are their newest 30 (views 10), so the huge old ones never reach the median.
    expect(all.views!.median).toBe(10);
    expect(all.topOwnerShare).toBeLessThanOrEqual(SHARED_MAX_OWNER_SHARE);
    // Outside the 180-day window, or nothing measured: not counted.
    const stale = Array.from({ length: 5 }, (_, o) => Array.from({ length: 5 }, (_, i) => row(`o${o}`, i, { publishedAt: new Date(NOW - 200 * DAY) }))).flat();
    expect(buildShared(stale, NOW).rows).toBe(0);
    const empty = Array.from({ length: 5 }, (_, o) => Array.from({ length: 5 }, (_, i) => row(`o${o}`, i, { views: null, viewsPerFollower: null, engagementRate: null }))).flat();
    expect(buildShared(empty, NOW).rows).toBe(0);
  });

  test("review fixes: each statistic clears the gates on its own rows, and a post younger than a week stays out", () => {
    // 5 creators x 4 posts clear the bucket gates, but only one creator has a follower count: no views-per-follower
    // median is published (it would be that creator's numbers), while views and engagement (every row) are.
    const rows = Array.from({ length: 5 }, (_, o) => Array.from({ length: 4 }, (_, i) => row(`o${o}`, i, { viewsPerFollower: o === 0 ? 0.5 : null }))).flat();
    const b = buildShared(rows, NOW);
    const all = b.buckets.find((x) => x.category === null)!;
    expect(all).toMatchObject({ n: 20, owners: 5 });
    expect(all.viewsPerFollower).toBeNull();
    expect(all.views).toMatchObject({ n: 20, owners: 5 });
    expect(all.engagementRate).toMatchObject({ n: 20, owners: 5 });
    // One creator is the only one with an engagement rate (12 of 32 rows, so the bucket itself stands): that statistic
    // is dropped, the others stand.
    const skewed = [...Array.from({ length: 5 }, (_, o) => Array.from({ length: 4 }, (_, i) => row(`o${o}`, i, { engagementRate: null }))).flat(), ...Array.from({ length: 12 }, (_, i) => row("big", i, { engagementRate: 9 }))];
    const sk = buildShared(skewed, NOW).buckets.find((x) => x.category === null)!;
    expect(sk.engagementRate).toBeNull();
    expect(sk.views).not.toBeNull();
    // A bucket whose every statistic fails on its own is dropped, not published empty.
    const thin = Array.from({ length: 5 }, (_, o) => Array.from({ length: 4 }, (_, i) => row(`o${o}`, i, { views: null, engagementRate: null, viewsPerFollower: o < 2 ? 0.3 : null }))).flat();
    expect(buildShared(thin, NOW)).toMatchObject({ buckets: [], dropped: 2 });
    // Posts 1..6 days old carry partial first-week numbers: not in the cohort (the scorer's own lag rule).
    const young = Array.from({ length: 5 }, (_, o) => Array.from({ length: 4 }, (_, i) => row(`o${o}`, i, { publishedAt: new Date(NOW - (i + 1) * DAY) }))).flat();
    expect(buildShared(young, NOW).rows).toBe(0);
    expect(buildShared(young, NOW + 7 * DAY).rows).toBe(20);
    // sharedFor carries the cohort's spread and owner count with the median.
    const prior = sharedFor(b, { platform: "instagram", format: "video", followers: null })!;
    expect(prior).toMatchObject({ n: 20, owners: 5 });
    expect(prior.p25!).toBeLessThanOrEqual(prior.median);
    expect(prior.p75!).toBeGreaterThanOrEqual(prior.median);
    // The scorer uses that spread for the band when the creator has under 3 posts, and records the prior's sample.
    const p = baselineScorer.score({ platform: "instagram", format: "video", features: {}, history: [], asOf: NOW, shared: { source: "cohort", median: 1000, n: 20, owners: 5, p25: 600, p75: 1900 } })!;
    expect(p).toMatchObject({ predicted: 1000, low: 600, high: 1900, n: 0 });
    expect(p.basis.prior).toMatchObject({ shared: true, n: 20, owners: 5, value: 1000 });
  });

  test("the stored document carries no identity: counts and quantiles only", () => {
    const rows = Array.from({ length: 6 }, (_, o) => Array.from({ length: 5 }, (_, i) => row(`owner-secret-${o}`, i, { categories: ["Finance", " money "] }))).flat();
    const b = buildShared(rows, NOW);
    const json = JSON.stringify(b);
    expect(json).not.toContain("owner-secret");
    expect(json).not.toContain('"owner"');
    expect(b.buckets.map((x) => x.category).sort()).toEqual([null, "finance", "money"].sort());
    const fin = b.buckets.find((x) => x.category === "finance")!;
    expect(fin.views).toMatchObject({ n: 30 });
    expect(fin.views!.p25).toBeLessThanOrEqual(fin.views!.median);
    expect(fin.views!.median).toBeLessThanOrEqual(fin.views!.p75);
    expect(fin.engagementRate).toMatchObject({ median: 2 });
    expect(parseShared(json)).toEqual(b);
    expect(parseShared("{}")).toBeNull();
    expect(parseShared("not json")).toBeNull();
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBe(0);
  });

  test("sharedFor: the category bucket wins, views scale to the creator's followers, raw views stand in without a count", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, o) => Array.from({ length: 5 }, (_, i) => row(`a${o}`, i, { categories: ["finance"], viewsPerFollower: 0.5, views: 500 }))).flat(),
      ...Array.from({ length: 6 }, (_, o) => Array.from({ length: 5 }, (_, i) => row(`b${o}`, i, { categories: ["travel"], viewsPerFollower: 0.1, views: 100 }))).flat(),
    ];
    const b = buildShared(rows, NOW);
    expect(pickBucket(b, { platform: "instagram", format: "video", categories: ["travel"] })?.category).toBe("travel");
    expect(pickBucket(b, { platform: "instagram", format: "video", categories: ["unknown"] })?.category).toBeNull();
    expect(pickBucket(b, { platform: "youtube", format: "video" })).toBeNull();
    const fin = sharedFor(b, { platform: "instagram", format: "video", categories: ["finance"], followers: 2000 })!;
    expect(fin.median).toBe(1000);
    expect(fin.n).toBe(30);
    expect(fin.source).toContain("6 creators' 30 video posts on instagram about finance");
    expect(fin.source).toContain("accounts your size");
    const raw = sharedFor(b, { platform: "instagram", format: "video", categories: ["travel"], followers: null })!;
    expect(raw.median).toBe(100);
    expect(raw.source).toContain("not scaled to your size");
    expect(sharedFor(b, { platform: "instagram", format: "video", metric: "engagementRate" })).toMatchObject({ median: 2 });
    expect(sharedFor(null, { platform: "instagram", format: "video" })).toBeNull();
  });

  test("weekly accuracy is n-weighted across creators and names no one; drift reads the last 4 weeks against the 4 before", () => {
    const rows = [
      { owner: "a", platform: "", week: "2026-W40", n: 2, medianApe: 10, mape: 10, within: 100, biasPct: 5 },
      { owner: "b", platform: "", week: "2026-W40", n: 6, medianApe: 50, mape: 50, within: 50, biasPct: -5 },
      { owner: "a", platform: "instagram", week: "2026-W40", n: 2, medianApe: 10, mape: 10, within: 100, biasPct: 5 },
      { owner: "a", platform: "", week: "2026-W41", n: 4, medianApe: 20, mape: null, within: null, biasPct: null },
    ];
    const weeks = accuracyByWeek(rows);
    expect(weeks).toEqual([
      { week: "2026-W40", owners: 2, n: 8, mape: 40, within: 62.5, biasPct: -2.5 },
      { week: "2026-W41", owners: 1, n: 4, mape: null, within: null, biasPct: null },
    ]);
    expect(JSON.stringify(weeks)).not.toContain('"owner"');
    expect(accuracyByWeek(rows, { platform: "instagram" })).toHaveLength(1);
    const w = (i: number, mape: number) => ({ week: `2026-W${10 + i}`, owners: 3, n: 10, mape, within: 60, biasPct: 0 });
    expect(driftOf([w(0, 30), w(1, 30), w(2, 30), w(3, 30), w(4, 45), w(5, 45), w(6, 45), w(7, 45)])).toEqual({ recentMape: 45, priorMape: 30, deltaPts: 15, verdict: "drifting" });
    expect(driftOf([w(0, 45), w(1, 45), w(2, 45), w(3, 45), w(4, 30), w(5, 30), w(6, 30), w(7, 30)]).verdict).toBe("improving");
    expect(driftOf([w(0, 30), w(1, 32), w(2, 30), w(3, 30), w(4, 35), w(5, 35), w(6, 35), w(7, 35)]).verdict).toBe("steady");
    expect(driftOf([w(0, 30)])).toMatchObject({ verdict: "unknown", deltaPts: null });
  });

  test("weeklyAccuracy files each evaluated forecast under the week its outcome was known, so weeks do not overlap", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 9, d, 12));
    const rows = [
      { owner: "a", platform: "instagram", predicted: 100, low: 80, high: 120, actual: 100, evaluatedAt: at(5) }, // W41, ape 0, in band
      { owner: "b", platform: "instagram", predicted: 150, low: 100, high: 200, actual: 100, evaluatedAt: at(6) }, // W41, ape 50, in band
      { owner: "b", platform: "youtube", predicted: 50, low: 40, high: 60, actual: 100, evaluatedAt: at(7) }, // W41, ape 50, out of band
      { owner: "a", platform: "instagram", predicted: 100, low: 80, high: 120, actual: 200, evaluatedAt: at(12) }, // W42
    ];
    const weeks = weeklyAccuracy(rows);
    expect(weeks.map((w) => w.week)).toEqual(["2026-W41", "2026-W42"]);
    expect(weeks[0]).toEqual({ week: "2026-W41", owners: 2, n: 3, mape: 33.3, within: 66.7, biasPct: 0 });
    expect(weeks[1]).toMatchObject({ owners: 1, n: 1, mape: 50, within: 0, biasPct: -50 });
    expect(weeklyAccuracy(rows, { platform: "youtube" })).toEqual([{ week: "2026-W41", owners: 1, n: 1, mape: 50, within: 0, biasPct: -50 }]);
    expect(JSON.stringify(weeks)).not.toContain('"owner"');
  });

  test("cohortSize counts the creator's own measured posts of that platform + format before asOf, less the lag", () => {
    const f = (platform: string, format: string, ageDays: number, views: number | null) => ({ targetId: "t", postId: "p", platform, format, publishedAt: new Date(NOW - ageDays * DAY), features: { platform, format } as never, perf: views === null ? null : ({ measured: true, totals: { views } } as never) });
    const rows = [f("instagram", "video", 30, 10), f("instagram", "video", 20, 10), f("instagram", "video", 2, 10), f("instagram", "photo", 30, 10), f("youtube", "video", 30, 10), f("instagram", "video", 40, null)];
    expect(cohortSize(rows, "instagram", "video", NOW)).toBe(2);
    expect(cohortSize(rows, "instagram", "photo", NOW)).toBe(1);
    expect(cohortSize(rows, "threads", "video", NOW)).toBe(0);
  });
});

/* ------------------------------------------------------------------ stored */

let n = 0;
const mk = async (extra: { shareLearning?: boolean } = {}) => withIntelligence(await db.user.create({ data: { name: `S ${++n}`, email: `r1324-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x", ...extra } }));

/** Measured ContentFeature rows for one owner, written the way the feature store writes them. */
async function featureRows(ownerId: string, posts: { views: number; vpf: number; ageDays: number; categories?: string[] }[], platform = "instagram") {
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1324/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 30, width: 1080, height: 1920 } });
  for (const p of posts) {
    const at = new Date(Date.now() - p.ageDays * DAY);
    const post = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at } });
    const t = await db.postTarget.create({ data: { postId: post.id, platform, platformStatus: "published", publishedAt: at } });
    await db.contentFeature.create({
      data: {
        ownerId, targetId: t.id, postId: post.id, platform, format: "video", publishedAt: at, version: 1, measured: true,
        features: JSON.stringify({ version: 1, platform, format: "video", categories: p.categories ?? ["finance"], topic: "money" }),
        perf: JSON.stringify({ version: 1, ageDays: p.ageDays, measured: true, totals: { views: p.views, likes: 1 }, engagementRate: 1.5, viewsPerFollower: p.vpf }),
      },
    });
  }
}

describe("R1324 stored shared learning (db)", () => {
  test("rebuildShared aggregates consenting creators only, stores one ModelVersion, and a creator with no history reads a prior scaled to their followers", async () => {
    // Six creators in, one opted out with numbers that would move the median a lot.
    const owners = [];
    for (let i = 0; i < 6; i++) {
      const u = await mk();
      owners.push(u);
      await featureRows(u.id, Array.from({ length: 4 }, (_, k) => ({ views: 1000, vpf: 0.5, ageDays: 10 + k * 7 })));
    }
    const out = await mk({ shareLearning: false });
    await featureRows(out.id, Array.from({ length: 10 }, (_, k) => ({ views: 9_000_000, vpf: 900, ageDays: 10 + k })));
    const r = await shared.rebuildShared();
    expect(r.optedOut).toBeGreaterThanOrEqual(1);
    const all = r.baselines.buckets.find((b) => b.platform === "instagram" && b.format === "video" && b.category === null)!;
    expect(all).toBeDefined();
    expect(all.owners).toBeGreaterThanOrEqual(6);
    // The opted-out creator's 900 views/follower is not in here: the median stays where the consenting rows put it.
    expect(all.viewsPerFollower!.median).toBeLessThan(10);
    const stored = await db.modelVersion.findUnique({ where: { key: shared.SHARED_MODEL_KEY } });
    expect(stored).toMatchObject({ kind: "shared", status: "active" });
    expect(stored!.data).not.toContain(owners[0].id);
    expect(stored!.data).not.toContain(out.id);
    expect(parseShared(stored!.data)?.buckets.length).toBe(r.baselines.buckets.length);
    expect(await shared.loadShared({ fresh: true })).toEqual(r.baselines);

    // A brand-new creator with 2,000 followers and nothing measured: an estimate from the cohort, said plainly.
    const fresh = await mk();
    const acct = await db.socialAccount.create({ data: { userId: fresh.id, platform: "instagram", platformUserId: `ig-${Date.now()}-${Math.random()}`, username: "@fresh", accessToken: "x", status: "connected" } });
    await db.accountSnapshot.create({ data: { accountId: acct.id, day: "2026-11-23", followers: 2000 } });
    expect(await shared.followersOn(fresh.id, "instagram")).toBe(2000);
    expect(await shared.followersOn(fresh.id, "youtube")).toBeNull();
    const prior = await shared.sharedPriorFor(fresh.id, { platform: "instagram", format: "video", categories: ["finance"] });
    expect(prior).not.toBeNull();
    const fin = r.baselines.buckets.find((b) => b.platform === "instagram" && b.format === "video" && b.category === "finance") ?? all;
    expect(prior!.median).toBe(Math.round(fin.viewsPerFollower!.median * 2000));
    const p = await pred.predictDraft(fresh.id, { platform: "instagram", format: "video", caption: "Hello", timezone: "Asia/Kolkata" });
    expect(p).not.toBeNull();
    expect(p!.n).toBe(0);
    expect(p!.level).toBe("general");
    expect(p!.predicted).toBe(prior!.median);
    expect(p!.basis.prior?.source).toContain("creators'");
    expect(p!.explanation).toContain("no measured video post of yours on instagram yet");
    // The same creator on a platform the cohort has nothing for: still no number (no invented prior).
    expect(await pred.predictDraft(fresh.id, { platform: "threads", format: "video", caption: "Hello", timezone: "Asia/Kolkata" })).toBeNull();
    // Their live states lean on the cohort too, and name it.
    const states = await pred.modelStates(fresh.id, { scopeKey: "x", targetIds: [] });
    expect(states).toEqual([]); // no rows of their own on any platform: nothing to list
  });

  test("the shared prior is offered only below the personal level; the governance view is aggregates only", async () => {
    const u = await mk();
    await featureRows(u.id, Array.from({ length: 14 }, (_, k) => ({ views: 50, vpf: 0.01, ageDays: 10 + k * 3 })));
    const p = await pred.predictDraft(u.id, { platform: "instagram", format: "video", caption: "Hello", timezone: "Asia/Kolkata" });
    expect(p!.level).toBe("personal");
    expect(p!.basis.prior).toBeNull();
    expect(p!.predicted).toBe(50);
    const g = await shared.intelligenceGovernance({ modelKey: pred.ACTIVE_MODEL });
    expect(g.shared?.stored).toBe(true);
    expect(g.participation.optedOut).toBeGreaterThanOrEqual(1);
    expect(g.participation.creators).toBeGreaterThan(g.participation.optedOut);
    expect(g.versions.some((v) => v.key === shared.SHARED_MODEL_KEY)).toBe(true);
    expect(Array.isArray(g.accuracy)).toBe(true);
    expect(["steady", "improving", "drifting", "unknown"]).toContain(g.drift.verdict);
    const json = JSON.stringify(g);
    expect(json).not.toContain(u.id);
    expect(json).not.toContain("ownerId");
    expect(json).not.toContain("@test.dev");
    // Retired: readers see nothing until it is active again.
    await db.modelVersion.update({ where: { key: shared.SHARED_MODEL_KEY }, data: { status: "retired" } });
    shared.resetSharedCache();
    expect(await shared.loadShared()).toBeNull();
    await db.modelVersion.update({ where: { key: shared.SHARED_MODEL_KEY }, data: { status: "active" } });
    shared.resetSharedCache();
    expect(await shared.loadShared()).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ wiring */

describe("R1324 wiring", () => {
  test("admin area, nav entry, API and page exist; super only", () => {
    expect(can("super", "intelligence")).toBe(true);
    expect(can("finance", "intelligence")).toBe(false);
    expect(can("support", "intelligence")).toBe(false);
    expect(read("components/admin/AdminShell.tsx")).toContain('href: "/admin/intelligence", label: "Intelligence"');
    expect(read("app/api/admin/intelligence/route.ts")).toContain('adminRoute("intelligence"');
    expect(read("app/api/admin/intelligence/route.ts")).toContain('"ACTIVE_SCORER"');
    expect(read("app/admin/(panel)/intelligence/page.tsx")).toContain('requireAdmin("intelligence")');
  });

  test("the sweep rebuilds hourly, the scorer is wired for live estimates only, and the sharing switch is owner-only", () => {
    expect(read("app/api/cron/sweep/route.ts")).toContain("m.sweepShared(now)");
    const p = read("lib/intelligence/model/predict.ts");
    expect(p).toContain("shared: shared({ platform: draft.platform, format: draft.format, categories: known.categories, measured: measuredOn(rows, draft.platform) })");
    expect(p).toContain("q.measured >= PERSONAL_MIN ? null :");
    // A draft forecast is stored only for a post still ahead of its outcome, never over a judged one (no hindsight).
    expect(p).toContain('status: { in: ["draft", "scheduled"] }');
    expect(p).toContain("actual: { not: null } }, select: { id: true } });\n    if (judged) return null;");
    // The sweep slot runs every tick and gates on the document's age, not on one minute of the hour.
    expect(read("app/api/cron/sweep/route.ts")).not.toContain("getMinutes() === 12");
    expect(read("lib/intelligence/shared.ts")).toContain("SHARED_REBUILD_MS");
    // syncPredictions (backfilled forecasts) never takes a shared prior: no hindsight in the evaluation.
    const sync = p.slice(p.indexOf("export async function syncPredictions"), p.indexOf("export interface FormatBaseline"));
    expect(sync).not.toContain("shared");
    const r = read("app/api/intelligence/sharing/route.ts");
    expect(r).toContain('if (user.role !== "owner") throw new HttpError(403');
    expect(r).toContain('canChange');
    expect(read("components/intelligence/SharingRow.tsx")).toContain("disabled={busy || !canChange}");
    expect(read("components/intelligence/SharingRow.tsx")).toContain('role="status" aria-live="polite"');
    expect(r).toContain("export const PATCH = route(");
    expect(read("components/intelligence/SharingRow.tsx")).toContain('role="switch"');
    expect(read("components/intelligence/SharingRow.tsx")).toContain("/api/intelligence/sharing");
    expect(read("prisma/schema.template.prisma")).toContain("shareLearning Boolean  @default(true)");
    expect(read("lib/intelligence/shared-core.ts")).not.toContain("prisma");
    expect(read("lib/intelligence/shared.ts")).toContain('import "server-only"');
  });
});
