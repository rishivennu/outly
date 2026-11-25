/**
 * R1318: Personal Intelligence, the data foundation. Versioned feature rows per published destination (no copy stored,
 * only counts and flags), honest `measured`, creator profiles with the personalization ladder and trait lifts, weekly
 * snapshots written once, the learning log with dedupe, tenant isolation, the bounded sweep step, and the API routes
 * and schema wiring read from the files.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PostRecord } from "../lib/intelligence/core";
import { aspectOf, extractFeatures, extractPerf, FEATURE_VERSION, hookTypeOf, localWeekdayHour, MEASURE_MIN_AGE_MS, parseFeatures, parsePerf, type ContentFeatures } from "../lib/intelligence/features-core";
import { BLENDED_MIN, buildProfile, levelOf, PERSONAL_MIN, traitLifts, weekKey, type FeatureRow } from "../lib/intelligence/profile-core";
import { withIntelligence } from "./helpers/intelligence-plan";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let feat: typeof import("../lib/intelligence/features");
let prof: typeof import("../lib/intelligence/profile");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  feat = await import("../lib/intelligence/features");
  prof = await import("../lib/intelligence/profile");
}, 60_000);

const DAY = 864e5;
const NOW = Date.UTC(2026, 10, 20, 12);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const rec = (id: string, over: Partial<PostRecord> = {}): PostRecord => ({ id, platform: "instagram", format: "video", publishedAt: new Date(NOW - 10 * DAY).toISOString(), metrics: { views: 100, likes: 10, comments: 2, shares: 1, saves: 3 }, ...over });

describe("R1318 features-core", () => {
  test("extracts counts and flags, never the text; hook type, aspect and local time", () => {
    const f = extractFeatures({
      record: rec("t1", { topic: "fitness", categories: ["Health", "Tips"] }),
      title: "Morning routine",
      caption: "Three things I do every day 💪 #fitness #morning @coach https://outlly.com/x Save this for later!",
      hashtags: "#health #routine",
      hook: "3 things nobody tells you?",
      firstComment: "Link in bio",
      coverKey: "covers/a.jpg",
      media: { duration: 42.26, width: 1080, height: 1920 },
      timezone: "Asia/Kolkata",
      previousPublishedAt: new Date(NOW - 13 * DAY).toISOString(),
      crossPosted: 3,
      isAdapted: true,
      slides: 0,
    });
    expect(f.version).toBe(FEATURE_VERSION);
    expect(f).toMatchObject({ platform: "instagram", format: "video", titleLen: 15, hashtagCount: 4, mentionCount: 1, emojiCount: 1, linkCount: 1, hasHook: true, hasQuestion: true, hasCta: true, hasFirstComment: true, hasCover: true, durationSec: 42.26, aspect: "vertical", gapDays: 3, crossPosted: 3, isAdapted: true, topic: "fitness", categories: ["Health", "Tips"] });
    expect(f.hookType).toBe("question");
    expect(JSON.stringify(f)).not.toContain("Morning routine");
    expect(JSON.stringify(f)).not.toContain("nobody tells");
    // The record went live 10 days before NOW: 2026-11-10 12:00 UTC, a Tuesday, 17:30 in Kolkata.
    expect({ weekday: f.weekday, hour: f.hour }).toEqual({ weekday: 2, hour: 17 });
    expect(localWeekdayHour(NOW, "Asia/Kolkata")).toEqual({ weekday: 5, hour: 17 });
    expect(localWeekdayHour(NOW, "Not/AZone")).toEqual({ weekday: 5, hour: 12 });
    expect(hookTypeOf("90% of creators quit")).toBe("number");
    expect(hookTypeOf("Stop doing this")).toBe("statement");
    expect(hookTypeOf("")).toBe("none");
    expect(aspectOf(1920, 1080)).toBe("horizontal");
    expect(aspectOf(1080, 1080)).toBe("square");
    expect(aspectOf(null, 5)).toBe("unknown");
    const photo = extractFeatures({ record: rec("t2", { format: "photo" }), media: { duration: 12 }, slides: 4 });
    expect(photo.durationSec).toBeNull();
    expect(photo.slides).toBe(4);
    expect(photo.gapDays).toBeNull();
    expect(photo.crossPosted).toBe(1);
  });

  test("perf: only reported metrics, measured needs views and a day of age, parse is defensive", () => {
    const p = extractPerf(rec("t1"), NOW, 2000);
    expect(p.totals).toEqual({ views: 100, likes: 10, comments: 2, shares: 1, saves: 3 });
    expect(p).toMatchObject({ ageDays: 10, measured: true, viewsPerFollower: 0.05 });
    expect(p.engagementRate).toBe(16);
    const young = extractPerf(rec("t2", { publishedAt: new Date(NOW - MEASURE_MIN_AGE_MS + 60_000).toISOString() }), NOW);
    expect(young.measured).toBe(false);
    const noViews = extractPerf(rec("t3", { metrics: { views: null } }), NOW);
    expect(noViews.measured).toBe(false);
    expect("views" in noViews.totals).toBe(false);
    // X reports no per-post metrics: nothing is booked as 0.
    const x = extractPerf(rec("t4", { platform: "x", metrics: { views: 0, likes: 0 } }), NOW);
    expect(x.totals).toEqual({});
    expect(x.measured).toBe(false);
    expect(parseFeatures("{bad")).toBeNull();
    expect(parseFeatures(JSON.stringify({ platform: "x" }))).toBeNull();
    expect(parsePerf(JSON.stringify(p))?.measured).toBe(true);
  });
});

const row = (i: number, over: Partial<ContentFeatures> = {}, views: number | null = 100, ageDays = 10, platform = "instagram"): FeatureRow => {
  const f = extractFeatures({ record: rec(`t${i}`, { platform, publishedAt: new Date(NOW - ageDays * DAY).toISOString() }), caption: "x" });
  const features = { ...f, ...over };
  const perf = extractPerf(rec(`t${i}`, { platform, publishedAt: new Date(NOW - ageDays * DAY).toISOString(), metrics: { views } }), NOW);
  return { targetId: `t${i}`, postId: `p${i}`, platform, format: features.format, publishedAt: new Date(NOW - ageDays * DAY), features, perf };
};

describe("R1318 profile-core", () => {
  test("the personalization ladder", () => {
    expect(levelOf(0)).toBe("none");
    expect(levelOf(1)).toBe("general");
    expect(levelOf(BLENDED_MIN)).toBe("blended");
    expect(levelOf(PERSONAL_MIN - 1)).toBe("blended");
    expect(levelOf(PERSONAL_MIN)).toBe("personal");
  });

  test("a profile from rows: window, platform filter, cadence, shares, medians, level", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => row(i, { hasHook: true, weekday: 2, hour: 9 }, 300, 3 + i * 7)),
      ...Array.from({ length: 6 }, (_, i) => row(10 + i, { hasHook: false, weekday: 6, hour: 21 }, 100, 5 + i * 7)),
      row(99, {}, 5000, 1 / 24), // an hour old: counted as a post, never measured
      row(98, {}, 5000, 120), // outside the 90 day window
      row(97, { format: "photo" }, 50, 20, "youtube"),
    ];
    const all = buildProfile(rows, { now: NOW });
    expect(all.platform).toBe("");
    expect(all.posts).toEqual({ total: 14, measured: 13 });
    expect(all.level).toBe("personal");
    expect(all.window.days).toBe(90);
    expect(all.formats[0]).toMatchObject({ key: "video", n: 13 });
    expect(all.cadence.postsPerWeek).toBeCloseTo(14 / (90 / 7), 1);
    expect(all.cadence.medianGapDays).not.toBeNull();
    expect(all.copy.hookRate).toBe(Math.round((6 / 14) * 100));
    expect(all.timing.weekdays[0].key).toMatch(/Tue|Sat/);
    const views = all.performance.find((p) => p.metric === "views");
    expect(views).toMatchObject({ n: 13 });
    expect(all.leadMetric).toBe("views");
    const ig = buildProfile(rows, { now: NOW, platform: "instagram" });
    expect(ig.posts.total).toBe(13);
    const yt = buildProfile(rows, { now: NOW, platform: "youtube" });
    expect(yt.posts).toEqual({ total: 1, measured: 1 });
    expect(yt.level).toBe("general");
    expect(yt.lifts).toEqual([]);
    const none = buildProfile([], { now: NOW });
    expect(none.level).toBe("none");
    expect(none.performance).toEqual([]);
    expect(none.leadMetric).toBeNull();
  });

  test("trait lifts: both sides need 3 measured posts, small lifts are dropped, wording carries the sample", () => {
    const rows = [...Array.from({ length: 4 }, (_, i) => row(i, { hasHook: true }, 300)), ...Array.from({ length: 4 }, (_, i) => row(10 + i, { hasHook: false }, 100))];
    const lifts = traitLifts(rows, "views");
    const hook = lifts.find((l) => l.trait === "hasHook");
    expect(hook).toMatchObject({ withMedian: 300, withoutMedian: 100, nWith: 4, nWithout: 4, liftPct: 200, metric: "views" });
    // A trait every post shares has no "without" side: no lift.
    expect(lifts.find((l) => l.trait === "hasCta")).toBeUndefined();
    const flat = traitLifts([...Array.from({ length: 4 }, (_, i) => row(i, { hasHook: true }, 110)), ...Array.from({ length: 4 }, (_, i) => row(10 + i, { hasHook: false }, 100))], "views");
    expect(flat.find((l) => l.trait === "hasHook")).toBeUndefined();
    const thin = traitLifts([...Array.from({ length: 2 }, (_, i) => row(i, { hasHook: true }, 300)), ...Array.from({ length: 4 }, (_, i) => row(10 + i, { hasHook: false }, 100))], "views");
    expect(thin).toEqual([]);
  });

  test("ISO week keys", () => {
    expect(weekKey(Date.UTC(2026, 0, 1))).toBe("2026-W01");
    expect(weekKey(Date.UTC(2026, 10, 20))).toBe("2026-W47");
    expect(weekKey(Date.UTC(2027, 0, 3))).toBe("2026-W53");
  });
});

let n = 0;
const user = async () => withIntelligence(await db.user.create({ data: { name: `O ${++n}`, email: `r1318-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x", timezone: "Asia/Kolkata" } }));

async function seed(ownerId: string, platform = "instagram") {
  const account = await db.socialAccount.create({ data: { userId: ownerId, platform, platformUserId: `${platform}-r1318-${Date.now()}-${Math.random()}`, username: "@o", accessToken: "x", status: "connected" } });
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1318/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 40, width: 1080, height: 1920 } });
  const post = async (views: number | null, ageMs: number, extra: { hook?: string; caption?: string; practice?: boolean } = {}) => {
    const at = new Date(Date.now() - ageMs);
    const p = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at, hook: extra.hook ?? null } });
    const t = await db.postTarget.create({ data: { postId: p.id, platform, socialAccountId: account.id, platformStatus: "published", publishedAt: at, caption: extra.caption ?? "A caption #one #two", practice: extra.practice ?? false } });
    if (views !== null) await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views, likes: 1 } });
    return { post: p, target: t, at };
  };
  return { account, post };
}

describe("R1318 features + profiles (db)", () => {
  test("refreshFeatures writes one row per live destination, skips practice posts, honours version and age; another owner sees nothing", async () => {
    const a = await user();
    const b = await user();
    const sa = await seed(a.id);
    const made = [] as Awaited<ReturnType<typeof sa.post>>[];
    for (let i = 0; i < 5; i++) made.push(await sa.post(100 + i * 50, (3 + i * 5) * DAY, { hook: i % 2 ? "Why?" : undefined }));
    await sa.post(999, 2 * DAY, { practice: true });
    const young = await sa.post(5, 60_000);
    const sb = await seed(b.id);
    await sb.post(10, 3 * DAY);
    const r = await feat.refreshFeatures(a.id, { batch: 100 });
    expect(r).toMatchObject({ scanned: 6, written: 6 });
    const rows = await db.contentFeature.findMany({ where: { ownerId: a.id } });
    expect(rows).toHaveLength(6);
    expect(rows.every((x) => x.version === FEATURE_VERSION)).toBe(true);
    const youngRow = rows.find((x) => x.targetId === young.target.id)!;
    expect(youngRow.measured).toBe(false);
    expect(rows.filter((x) => x.measured)).toHaveLength(5);
    const f = parseFeatures(rows.find((x) => x.targetId === made[1].target.id)!.features)!;
    expect(f).toMatchObject({ hasHook: true, hookType: "question", hashtagCount: 2, aspect: "vertical", durationSec: 40, crossPosted: 1 });
    expect(f.gapDays).not.toBeNull();
    expect(rows.find((x) => x.targetId === made[4].target.id) && parseFeatures(rows.find((x) => x.targetId === made[4].target.id)!.features)!.gapDays).toBeNull();
    // A second run finds nothing due (all computed just now).
    expect((await feat.refreshFeatures(a.id)).written).toBe(0);
    // An old version is recomputed; a young row older than a day is too; a settled one is left alone.
    await db.contentFeature.update({ where: { targetId: made[0].target.id }, data: { version: 0 } });
    await db.contentFeature.update({ where: { targetId: made[1].target.id }, data: { computedAt: new Date(Date.now() - 25 * 36e5) } });
    await db.contentFeature.update({ where: { targetId: made[4].target.id }, data: { computedAt: new Date(Date.now() - 25 * 36e5), publishedAt: new Date(Date.now() - 60 * DAY) } });
    expect((await feat.refreshFeatures(a.id)).written).toBe(2);
    expect(await db.contentFeature.count({ where: { ownerId: b.id } })).toBe(0);
    expect((await feat.loadFeatureRows(b.id, { days: 90 })).length).toBe(0);
  });

  test("rebuildProfiles: workspace + platform rows, one snapshot a week, learning log deduped, stale platforms dropped, status read", async () => {
    const a = await user();
    const ig = await seed(a.id, "instagram");
    const yt = await seed(a.id, "youtube");
    for (let i = 0; i < 4; i++) await ig.post(200, (2 + i * 3) * DAY, { hook: "Hook" });
    await yt.post(50, 5 * DAY);
    await feat.refreshFeatures(a.id);
    const r = await prof.rebuildProfiles(a.id, { now: Date.now() });
    expect(r.platforms).toEqual(["instagram", "youtube"]);
    expect(r.profiles).toBe(3);
    expect(r.snapshots).toBe(3);
    const profiles = await prof.getProfiles(a.id);
    expect(profiles.map((p) => p.platform)).toEqual(["", "instagram", "youtube"]);
    expect(profiles[0]).toMatchObject({ level: "blended", postsTotal: 5, postsMeasured: 5 });
    expect(profiles[1]).toMatchObject({ level: "blended", postsMeasured: 4 });
    expect(profiles[2]).toMatchObject({ level: "general", postsMeasured: 1 });
    expect(profiles[1].data.copy.hookRate).toBe(100);
    // Again in the same week: same rows, no new snapshot, no second learning event.
    const r2 = await prof.rebuildProfiles(a.id, { now: Date.now() });
    expect(r2.snapshots).toBe(0);
    expect(await db.creatorProfileSnapshot.count({ where: { profile: { ownerId: a.id } } })).toBe(3);
    expect(await db.learningEvent.count({ where: { ownerId: a.id, type: "profile_rebuilt" } })).toBe(1);
    // The YouTube post leaves the window: its profile row stays (weekly history kept) at level none with no posts.
    await db.contentFeature.updateMany({ where: { ownerId: a.id, platform: "youtube" }, data: { publishedAt: new Date(Date.now() - 100 * DAY) } });
    const r3 = await prof.rebuildProfiles(a.id, { now: Date.now() });
    expect(r3.platforms).toEqual(["instagram"]);
    const after = await prof.getProfiles(a.id);
    expect(after.map((p) => p.platform)).toEqual(["", "instagram", "youtube"]);
    expect(after[2]).toMatchObject({ level: "none", postsTotal: 0 });
    expect(after[2].data.copy.hookRate).toBeNull();
    // A removed destination drops out of the rows the profile reads, before any recompute.
    const gone = await db.postTarget.findFirst({ where: { post: { userId: a.id }, platform: "instagram" } });
    await db.postTarget.update({ where: { id: gone!.id }, data: { removedAt: new Date() } });
    expect((await feat.loadFeatureRows(a.id, { days: 90 })).length).toBe(3);
    await db.postTarget.update({ where: { id: gone!.id }, data: { removedAt: null } });
    const status = await prof.personalStatus(a.id);
    expect(status.levels.map((l) => l.platform)).toEqual(["", "instagram", "youtube"]);
    expect(status).toMatchObject({ featureRows: 5, measuredRows: 5 });
    expect(status.lastComputedAt).not.toBeNull();
    expect(status.lastLearningAt).not.toBeNull();
    // Another owner: empty, never this owner's rows.
    const b = await user();
    expect(await prof.getProfiles(b.id)).toEqual([]);
    expect((await prof.personalStatus(b.id)).levels).toEqual([]);
  });

  test("logLearning dedupes; ensureBaselineModel is idempotent", async () => {
    const a = await user();
    expect(await prof.logLearning(a.id, "post_published", { subjectType: "post", subjectId: "p1", dedupeKey: "pub:p1" })).toBe(true);
    expect(await prof.logLearning(a.id, "post_published", { subjectType: "post", subjectId: "p1", dedupeKey: "pub:p1" })).toBe(false);
    expect(await prof.logLearning(a.id, "note")).toBe(true);
    expect(await prof.logLearning(a.id, "note")).toBe(true);
    expect(await db.learningEvent.count({ where: { ownerId: a.id } })).toBe(3);
    const m1 = await prof.ensureBaselineModel();
    const m2 = await prof.ensureBaselineModel();
    expect(m1.id).toBe(m2.id);
    expect(m1).toMatchObject({ key: "baseline-ts-1", kind: "baseline", status: "active" });
  });

  test("sweepPersonal: bounded, stalest first, a fresh profile is skipped, one failure never stops the rest", async () => {
    const a = await user();
    const b = await user();
    const c = await user();
    for (const u of [a, b, c]) {
      const s = await seed(u.id);
      await s.post(100, 3 * DAY);
    }
    // c already has a fresh profile.
    await prof.rebuildProfiles(c.id, { now: Date.now() });
    // ownerIds narrows the candidates so other tenants in this database never change the ordering under test.
    const ids = [a.id, b.id, c.id];
    const r = await prof.sweepPersonal({ maxOwners: 20, ownerIds: ids });
    expect(r).toEqual({ owners: 2, features: 2, failed: 0, skipped: 0 }); // R1334: skipped = owners with neither the perk nor consent
    expect(await db.creatorProfile.count({ where: { ownerId: a.id, platform: "" } })).toBe(1);
    expect(await db.creatorProfile.count({ where: { ownerId: b.id, platform: "" } })).toBe(1);
    // Everyone fresh now: nothing due.
    const again = await prof.sweepPersonal({ maxOwners: 20, ownerIds: ids });
    expect(again.owners).toBe(0);
    // Stale profile of b is picked up again, bounded to one owner.
    await db.creatorProfile.updateMany({ where: { ownerId: b.id }, data: { computedAt: new Date(Date.now() - 7 * 36e5) } });
    await db.creatorProfile.updateMany({ where: { ownerId: a.id }, data: { computedAt: new Date(Date.now() - 8 * 36e5) } });
    const one = await prof.sweepPersonal({ maxOwners: 1, ownerIds: ids });
    expect(one.owners).toBe(1);
    const aRow = await db.creatorProfile.findFirst({ where: { ownerId: a.id, platform: "" } });
    expect(Date.now() - aRow!.computedAt.getTime()).toBeLessThan(60_000);
  });
});

describe("R1318 wiring", () => {
  test("schema has the five models in the template, the sweep runs the step on slot 2, routes exist with the conventions", () => {
    const schema = read("prisma/schema.template.prisma");
    for (const m of ["ContentFeature", "CreatorProfile", "CreatorProfileSnapshot", "LearningEvent", "ModelVersion"]) expect(schema).toContain(`model ${m} {`);
    expect(schema).toContain("@@unique([ownerId, scopeKey, platform])");
    expect(schema).toContain("@@unique([ownerId, dedupeKey])");
    const sweep = read("app/api/cron/sweep/route.ts");
    expect(sweep).toContain("getMinutes() % 10 === 2");
    expect(sweep).toContain("sweepPersonal({ maxOwners: 5 })");
    expect(sweep).toContain("rollup, personal, running"); // after rollup: R1242/R1247 pin "outcomes, backfill, subs"
    for (const r of ["profile", "status", "refresh"]) {
      const src = read(`app/api/intelligence/${r}/route.ts`);
      expect(src).toContain("route(");
      expect(src).toContain("limit:");
    }
    expect(read("app/api/intelligence/refresh/route.ts")).toContain("[2, 60_000]");
    expect(read("lib/intelligence/features.ts")).toContain('import "server-only"');
    expect(read("lib/intelligence/profile.ts")).toContain('import "server-only"');
    expect(read("lib/intelligence/features-core.ts")).not.toContain("prisma");
    expect(read("lib/intelligence/profile-core.ts")).not.toContain("prisma");
  });
});
