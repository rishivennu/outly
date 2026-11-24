/**
 * R1319: Personal Intelligence, the prediction engine. The deterministic baseline scorer (cohort median, shrinkage,
 * trait adjustments, cohort spread, honesty ladder, no leakage past asOf), the evaluation maths and wording, the stored
 * loop (forecast before the outcome, actual after the first week, weekly accuracy, per-platform calibration), the draft
 * endpoint's owner check, tenant isolation, and the wiring (routes, account deletion, FK, view section).
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { PostRecord } from "../lib/intelligence/core";
import { extractFeatures, extractPerf } from "../lib/intelligence/features-core";
import type { FeatureRow } from "../lib/intelligence/profile-core";
import { accuracyWords, adjustmentsFor, apeOf, baselineScorer, BASELINE_KEY, evaluate, MAX_ADJ, MIN_ADJ, SHRINK_K, traitOf } from "../lib/intelligence/model/scorer-core";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let feat: typeof import("../lib/intelligence/features");
let prof: typeof import("../lib/intelligence/profile");
let pred: typeof import("../lib/intelligence/model/predict");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  feat = await import("../lib/intelligence/features");
  prof = await import("../lib/intelligence/profile");
  pred = await import("../lib/intelligence/model/predict");
}, 60_000);

const DAY = 864e5;
const NOW = Date.UTC(2026, 10, 20, 12);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const row = (i: number, views: number, ageDays: number, over: { platform?: string; format?: string; hasHook?: boolean } = {}): FeatureRow => {
  const platform = over.platform ?? "instagram";
  const format = over.format ?? "video";
  const rec: PostRecord = { id: `t${i}`, platform, format, publishedAt: new Date(NOW - ageDays * DAY).toISOString(), metrics: { views, likes: 1 } };
  const features = { ...extractFeatures({ record: rec, caption: "x", hook: over.hasHook ? "Why?" : undefined }), hasHook: over.hasHook ?? false };
  return { targetId: `t${i}`, postId: `p${i}`, platform, format, publishedAt: new Date(NOW - ageDays * DAY), features, perf: extractPerf(rec, NOW) };
};

describe("R1319 scorer-core", () => {
  test("nothing measured and no prior: null, never a number", () => {
    expect(baselineScorer.score({ platform: "instagram", format: "video", features: {}, history: [], asOf: NOW })).toBeNull();
    // Only posts of another platform: still null (a platform is never a prior for another one).
    const yt = [row(1, 500, 10, { platform: "youtube" }), row(2, 600, 12, { platform: "youtube" })];
    expect(baselineScorer.score({ platform: "instagram", format: "video", features: {}, history: yt, asOf: NOW })).toBeNull();
  });

  test("the cohort median, shrunk toward the platform prior; level and confidence follow the sample", () => {
    const hist = [100, 200, 300, 400, 500].map((v, i) => row(i, v, 5 + i * 3));
    const p = baselineScorer.score({ platform: "instagram", format: "video", features: {}, history: hist, asOf: NOW })!;
    expect(p).toMatchObject({ modelKey: BASELINE_KEY, metric: "views", n: 5, level: "blended", confidence: "medium", predicted: 300 });
    // No other format on the platform: no prior, the median stands; weight n/(n+K) is recorded anyway.
    expect(p.basis.prior).toBeNull();
    expect(p.basis.shrinkWeight).toBe(Math.round((5 / (5 + SHRINK_K)) * 100) / 100);
    expect(p.low).toBe(200);
    expect(p.high).toBe(400);
    expect(p.explanation).toContain("last 5 measured video posts on instagram");
    expect(p.explanation).toContain("not a promise");
    // Photos on the same platform give a prior: a single video is pulled hard toward it.
    const mixed = [...[1000, 1200, 1100, 900].map((v, i) => row(10 + i, v, 5 + i, { format: "photo" })), row(20, 100, 8)];
    const one = baselineScorer.score({ platform: "instagram", format: "video", features: {}, history: mixed, asOf: NOW })!;
    expect(one.level).toBe("general");
    expect(one.basis.prior?.source).toContain("other formats");
    expect(one.predicted).toBeGreaterThan(100);
    expect(one.predicted).toBeLessThan(1050);
    expect(one.basis.cohortP25).toBeNull();
    expect(one.low).toBe(Math.round(one.predicted * 0.5));
    // A format with no post of its own but a platform prior: general, from the prior alone.
    const none = baselineScorer.score({ platform: "instagram", format: "carousel", features: {}, history: mixed, asOf: NOW })!;
    expect(none).toMatchObject({ n: 0, level: "general", confidence: "low" });
    expect(none.explanation).toContain("no measured carousel post");
    // A shared baseline wins over the platform prior when given.
    const shared = baselineScorer.score({ platform: "instagram", format: "video", features: {}, history: hist, asOf: NOW, shared: { source: "creators like you", median: 1000, n: 50 } })!;
    expect(shared.basis.prior).toEqual({ source: "creators like you", value: 1000 });
    expect(shared.predicted).toBeGreaterThan(300);
  });

  test("no leakage: posts at or after asOf are not in the cohort", () => {
    const hist = [row(1, 100, 10), row(2, 100, 9), row(3, 100, 8), row(4, 9000, 2), row(5, 9000, 1)];
    const p = baselineScorer.score({ platform: "instagram", format: "video", features: {}, history: hist, asOf: NOW - 5 * DAY })!;
    expect(p.n).toBe(3);
    expect(p.predicted).toBe(100);
    const later = baselineScorer.score({ platform: "instagram", format: "video", features: {}, history: hist, asOf: NOW })!;
    expect(later.n).toBe(5);
  });

  test("trait adjustments: known traits move the estimate, unknown ones are skipped, the product is clamped", () => {
    const hist = [...Array.from({ length: 6 }, (_, i) => row(i, 400, 5 + i * 2, { hasHook: true })), ...Array.from({ length: 6 }, (_, i) => row(10 + i, 100, 6 + i * 2, { hasHook: false }))];
    const withHook = baselineScorer.score({ platform: "instagram", format: "video", features: { hasHook: true }, history: hist, asOf: NOW })!;
    const noHook = baselineScorer.score({ platform: "instagram", format: "video", features: { hasHook: false }, history: hist, asOf: NOW })!;
    const unknown = baselineScorer.score({ platform: "instagram", format: "video", features: {}, history: hist, asOf: NOW })!;
    expect(withHook.predicted).toBeGreaterThan(unknown.predicted);
    expect(noHook.predicted).toBeLessThan(unknown.predicted);
    expect(unknown.basis.adjustments).toEqual([]);
    expect(withHook.basis.adjustments[0]).toMatchObject({ trait: "hasHook", has: true });
    expect(withHook.explanation).toContain("has a written hook");
    expect(noHook.explanation).toContain("lacks a written hook");
    expect(traitOf("longCaption", { captionLen: 200 })).toBe(true);
    expect(traitOf("longCaption", {})).toBeNull();
    expect(traitOf("shortVideo", { format: "video", durationSec: 12 })).toBe(true);
    expect(traitOf("shortVideo", { format: "photo" })).toBeNull();
    expect(traitOf("weekend", { weekday: 6 })).toBe(true);
    expect(traitOf("nope", {})).toBeNull();
    // Caps: a 300% lift counts as 50, damped by the weight.
    const adj = adjustmentsFor([{ trait: "hasHook", label: "a written hook", metric: "views", withMedian: 4, withoutMedian: 1, nWith: 3, nWithout: 3, liftPct: 300 }], { hasHook: true }, 1);
    expect(adj[0].factor).toBe(1.25);
    expect(MIN_ADJ).toBe(0.5);
    expect(MAX_ADJ).toBe(1.5);
  });

  test("evaluation maths and words", () => {
    expect(evaluate([])).toEqual({ n: 0, medianApe: null, mape: null, within: null, biasPct: null });
    const e = evaluate([
      { predicted: 100, low: 50, high: 150, actual: 100 },
      { predicted: 100, low: 50, high: 150, actual: 200 },
      { predicted: 100, low: 50, high: 150, actual: 80 },
    ]);
    expect(e).toMatchObject({ n: 3, medianApe: 25, within: 67 });
    expect(e.mape).toBeCloseTo((0 + 50 + 25) / 3, 1);
    expect(e.biasPct).toBe(0);
    expect(apeOf(100, 0)).toBe(100);
    expect(apeOf(0, 0)).toBe(0);
    expect(accuracyWords(null)).toContain("cannot be judged");
    expect(accuracyWords(e)).toContain("too few to trust");
    const many = evaluate(Array.from({ length: 6 }, () => ({ predicted: 120, low: 50, high: 150, actual: 100 })));
    expect(accuracyWords(many)).toContain("Over 6 posts");
    expect(accuracyWords(many)).toContain("over-estimate");
  });
});

let n = 0;
const user = async () => db.user.create({ data: { name: `O ${++n}`, email: `r1319-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x" } });

async function seed(ownerId: string, platform = "instagram") {
  const account = await db.socialAccount.create({ data: { userId: ownerId, platform, platformUserId: `${platform}-r1319-${Date.now()}-${Math.random()}`, username: "@o", accessToken: "x", status: "connected" } });
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1319/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 40, width: 1080, height: 1920 } });
  const post = async (views: number | null, ageMs: number) => {
    const at = new Date(Date.now() - ageMs);
    const p = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at } });
    const t = await db.postTarget.create({ data: { postId: p.id, platform, socialAccountId: account.id, platformStatus: "published", publishedAt: at, caption: "A caption" } });
    if (views !== null) await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views, likes: 1 } });
    return { post: p, target: t };
  };
  return { account, post };
}

describe("R1319 stored loop (db)", () => {
  test("syncPredictions forecasts from the history before each post, fills actuals after a week, rolls up accuracy, calibrates", async () => {
    const a = await user();
    const s = await seed(a.id);
    // Six posts, oldest first: 100,100,100 then 200,200,200 views; the newest is 2 days old (measured, not a week).
    const made = [];
    for (const [i, v] of [100, 100, 100, 200, 200, 200].entries()) made.push(await s.post(v, (40 - i * 7) * DAY + (i === 5 ? -3 * DAY : 0)));
    await feat.refreshFeatures(a.id);
    const r = await pred.syncPredictions(a.id);
    // The oldest post has no history before it: skipped; the five others are scored.
    expect(r).toMatchObject({ scored: 5, skipped: 1 });
    const recs = await db.predictionRecord.findMany({ where: { ownerId: a.id }, orderBy: { createdAt: "asc" } });
    expect(recs).toHaveLength(5);
    expect(recs.every((x) => x.modelKey === BASELINE_KEY && x.subjectType === "target" && x.metric === "views")).toBe(true);
    const fourth = recs.find((x) => x.subjectId === made[3].target.id)!;
    expect(fourth.predicted).toBe(100); // three posts of 100 before it
    expect(fourth.level).toBe("general");
    // Actuals for the posts past a week (the newest is 2 days old: still open).
    expect(r.evaluated).toBe(4);
    const open = recs.filter((x) => x.actual === null);
    expect(open.map((x) => x.subjectId)).toEqual([made[5].target.id]);
    expect(fourth.actual).toBe(200);
    expect(fourth.errorPct).toBe(50);
    expect(await db.learningEvent.count({ where: { ownerId: a.id, type: "prediction_evaluated" } })).toBe(4);
    // Weekly accuracy rows: one for "" and one for instagram.
    const evals = await db.intelligenceEvaluation.findMany({ where: { ownerId: a.id } });
    expect(evals.map((e) => e.platform).sort()).toEqual(["", "instagram"]);
    expect(evals[0].n).toBe(4);
    // Calibration: one state for instagram with a video baseline over the 6 measured posts.
    const states = await db.creatorModelState.findMany({ where: { ownerId: a.id } });
    expect(states).toHaveLength(1);
    const st = JSON.parse(states[0].state);
    expect(st).toMatchObject({ platform: "instagram", level: "blended", measured: 6 });
    expect(st.byFormat[0]).toMatchObject({ format: "video", n: 6 });
    // Idempotent: a second run scores nothing new and keeps the counts.
    const again = await pred.syncPredictions(a.id);
    expect(again).toMatchObject({ scored: 0, evaluated: 0 });
    expect(await db.predictionRecord.count({ where: { ownerId: a.id } })).toBe(5);
    expect(await db.intelligenceEvaluation.count({ where: { ownerId: a.id } })).toBe(2);
    // The read model.
    const ov = await pred.predictionsOverview(a.id);
    expect(ov.platforms).toHaveLength(1);
    expect(ov.platforms[0].accuracy?.n).toBe(4);
    expect(ov.recent).toHaveLength(5);
    expect(ov.overall.accuracy?.n).toBe(4);
    // Another owner sees nothing.
    const b = await user();
    const empty = await pred.predictionsOverview(b.id);
    expect(empty.platforms).toEqual([]);
    expect(empty.recent).toEqual([]);
    expect(await db.predictionRecord.count({ where: { ownerId: b.id } })).toBe(0);
  });

  test("predictDraft: null with no history, a number with one, stored only for the owner's own post", async () => {
    const a = await user();
    const b = await user();
    expect(await pred.predictDraft(a.id, { platform: "instagram", format: "video", caption: "hi" })).toBeNull();
    const s = await seed(a.id);
    const mine = [];
    for (const v of [300, 300, 300, 300]) mine.push(await s.post(v, 10 * DAY));
    await feat.refreshFeatures(a.id);
    const p = await pred.predictDraft(a.id, { platform: "instagram", format: "video", caption: "A new one", hook: "Ready?", postId: mine[0].post.id });
    expect(p).toMatchObject({ n: 4, level: "blended", predicted: 300 });
    expect(await db.predictionRecord.count({ where: { ownerId: a.id, subjectType: "post", subjectId: mine[0].post.id } })).toBe(1);
    // Another owner naming this post: scored from their (empty) history, nothing stored.
    expect(await pred.predictDraft(b.id, { platform: "instagram", format: "video", postId: mine[0].post.id })).toBeNull();
    expect(await db.predictionRecord.count({ where: { subjectId: mine[0].post.id } })).toBe(1);
    // Same draft again: the stored forecast is updated, not duplicated.
    await pred.predictDraft(a.id, { platform: "instagram", format: "video", caption: "Edited", postId: mine[0].post.id });
    expect(await db.predictionRecord.count({ where: { ownerId: a.id, subjectType: "post" } })).toBe(1);
  });

  test("refreshOwner runs the prediction loop and reports it", async () => {
    const a = await user();
    const s = await seed(a.id);
    for (const v of [100, 120, 140]) await s.post(v, 20 * DAY);
    const r = await prof.refreshOwner(a.id);
    expect(r.predictions).not.toBeNull();
    expect(r.predictions!.scored).toBe(2);
    expect(await db.creatorModelState.count({ where: { ownerId: a.id } })).toBe(1);
  });
});

describe("R1319 wiring", () => {
  test("schema, routes, account deletion, view section, README", () => {
    const schema = read("prisma/schema.template.prisma");
    for (const m of ["PredictionRecord", "CreatorModelState", "IntelligenceEvaluation"]) expect(schema).toContain(`model ${m} {`);
    expect(schema).toContain("@@unique([ownerId, modelKey, subjectType, subjectId, metric])");
    expect(schema).toContain("target PostTarget @relation(fields: [targetId], references: [id], onDelete: Cascade)");
    expect(schema).toContain("feature       ContentFeature?");
    const account = read("lib/account.ts");
    for (const t of ["creatorProfile", "learningEvent", "predictionRecord", "creatorModelState", "intelligenceEvaluation"]) expect(account).toContain(`db.${t}.deleteMany({ where: { ownerId: me.id } })`);
    const route = read("app/api/intelligence/predictions/route.ts");
    expect(route).toContain("export const GET");
    expect(route).toContain("export const POST");
    expect(route).toContain("resolveClient(user");
    expect(read("app/api/intelligence/platforms/[platform]/route.ts")).toContain("params.platform");
    expect(read("components/intelligence/IntelligenceView.tsx")).toContain("<PersonalBaselines client={client || null} />");
    expect(read("lib/intelligence/model/scorer-core.ts")).not.toContain("prisma");
    expect(read("lib/intelligence/model/predict.ts")).toContain('import "server-only"');
    expect(read("lib/intelligence/profile.ts")).toContain("syncPredictions(ownerId");
  });
});
