/**
 * R1320: Personal Intelligence, the recommendation engine. Pure drafts from the creator's own model states (trait
 * lifts and format baselines, honesty ladder, caps, deterministic ids), the stored read (idempotent ids through the
 * shared recommendation store, read-only reads store nothing, tenant isolation), the planner's learning events, the
 * routes and the dashboard section.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ModelState } from "../lib/intelligence/model/predict";
import { FORMAT_GAP_PCT, NO_PERSONAL_REASON, PER_PLATFORM_MAX, PERSONAL_MAX, isPersonalId, personalEvidenceLine, personalId, personalRecommendations, traitSubject } from "../lib/intelligence/personal-reco-core";
import { ruleKeyOf } from "../lib/intelligence/reco-core";
import { withIntelligence } from "./helpers/intelligence-plan";

mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));

let db: typeof import("../lib/db").db;
let feat: typeof import("../lib/intelligence/features");
let pred: typeof import("../lib/intelligence/model/predict");
let personal: typeof import("../lib/intelligence/personal-reco");
let planner: typeof import("../lib/intelligence/planner");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  feat = await import("../lib/intelligence/features");
  pred = await import("../lib/intelligence/model/predict");
  personal = await import("../lib/intelligence/personal-reco");
  planner = await import("../lib/intelligence/planner");
}, 60_000);

const DAY = 864e5;
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const WINDOW = { from: "2026-08-22", to: "2026-11-20", label: "last 90 days" };

const baseline = (format: string, n: number, predicted: number, level: "personal" | "blended" | "general" = "blended") =>
  ({ format, n, level, predicted, low: Math.round(predicted * 0.7), high: Math.round(predicted * 1.4), confidence: "medium", explanation: "x" }) as ModelState["byFormat"][number];
const lift = (trait: string, label: string, withMedian: number, withoutMedian: number, nWith = 4, nWithout = 4) =>
  ({ trait, label, metric: "views", withMedian, withoutMedian, nWith, nWithout, liftPct: Math.round(((withMedian - withoutMedian) / withoutMedian) * 100) }) as ModelState["lifts"][number];
const state = (platform: string, over: Partial<ModelState> = {}): ModelState => ({ modelKey: "baseline-ts-1", platform, level: "blended", measured: 10, byFormat: [], lifts: [], computedAt: "2026-11-20T00:00:00.000Z", ...over });

describe("R1320 personal-reco-core", () => {
  test("nothing measured, or too little: no recommendation, a reason that names the level", () => {
    const empty = personalRecommendations({ states: [], window: WINDOW });
    expect(empty.recommendations).toEqual([]);
    expect(empty.reason).toContain("Nothing measured yet");
    const thin = personalRecommendations({ states: [state("instagram", { level: "general", measured: 2, lifts: [lift("hasHook", "a written hook", 400, 100)] }), state("youtube", { level: "none", measured: 0 })], window: WINDOW });
    expect(thin.recommendations).toEqual([]);
    expect(thin.reason).toContain(NO_PERSONAL_REASON);
    expect(thin.reason).toContain('Instagram is at "General guidance (few posts measured yet)"');
    expect(thin.reason).toContain('YouTube is at "No measured posts yet"');
    expect(thin.levels).toEqual([
      { platform: "instagram", level: "general", measured: 2 },
      { platform: "youtube", level: "none", measured: 0 },
    ]);
    // Enough posts but no split: a different reason, still no made-up card.
    const flat = personalRecommendations({ states: [state("instagram", { byFormat: [baseline("video", 5, 100), baseline("photo", 5, 95)] })], window: WINDOW });
    expect(flat.recommendations).toEqual([]);
    expect(flat.reason).toContain("do not split");
  });

  test("a trait lift becomes a card with both sides, the right direction and a stable id", () => {
    const up = personalRecommendations({ states: [state("instagram", { lifts: [lift("hasHook", "a written hook", 420, 150, 5, 6)] })], window: WINDOW });
    expect(up.recommendations).toHaveLength(1);
    const r = up.recommendations[0];
    expect(r.id).toBe(personalId("trait", traitSubject("hasHook", true), "instagram"));
    expect(r.id).toBe("personal:trait:hasHook+:instagram");
    expect(isPersonalId(r.id)).toBe(true);
    expect(r.title).toBe("Open with a written hook on Instagram");
    expect(r.platform).toBe("instagram");
    expect(r.format).toBe("");
    expect(r.concept).toContain("420");
    expect(r.concept).toContain("150");
    expect(r.why).toContain("5 posts on one side against 6 posts");
    expect(r.why).toContain("180% apart");
    expect(r.evidence).toEqual({ metric: "views", value: 420, baseline: 150, unit: "count", lift: 180, n: 5, baselineN: 6, period: WINDOW.label });
    expect(r.confidence).toBe("medium"); // min(5,6)*2 = 10 -> medium
    expect(r.postsAnalyzed).toBe(10);
    expect(r.nextAction).toEqual({ kind: "create", label: "Draft one for Instagram", prefill: { platform: "instagram", format: "", topic: null, basedOn: [] } });
    expect(personalEvidenceLine(r.evidence)).toBe("Median 420 views over 5 posts vs 150 over 6 posts, last 90 days");
    // The other direction: without the trait does better, so the advice is to drop it; the better side is the value.
    const down = personalRecommendations({ states: [state("youtube", { lifts: [lift("manyTags", "five or more hashtags", 100, 200, 3, 3)] })], window: WINDOW }).recommendations[0];
    expect(down.title).toBe("Use fewer than five hashtags on YouTube");
    expect(down.id).toBe("personal:trait:manyTags-:youtube");
    expect(down.evidence).toMatchObject({ value: 200, baseline: 100, lift: 50, n: 3, baselineN: 3 });
    expect(down.confidence).toBe("medium"); // 3*2 = 6
    expect(down.concept).toContain("without five or more hashtags");
    // Unknown trait or too thin a side: skipped.
    const skip = personalRecommendations({ states: [state("youtube", { lifts: [lift("mystery", "x", 100, 200), lift("hasCta", "a call to action", 300, 100, 2, 9)] })], window: WINDOW });
    expect(skip.recommendations).toEqual([]);
  });

  test("format baselines: the best beats the next by FORMAT_GAP_PCT with real samples", () => {
    const st = state("instagram", { byFormat: [baseline("photo", 6, 200), baseline("video", 5, 500), baseline("carousel", 2, 900), baseline("story", 7, 100, "general")] });
    const r = personalRecommendations({ states: [st], window: WINDOW }).recommendations[0];
    // The carousel (2 posts) and the story (general level) do not count; video beats photo by 150%.
    expect(r.id).toBe(personalId("format", "video", "instagram"));
    expect(r.title).toBe("Make your next Instagram post a video");
    expect(r.format).toBe("video");
    expect(r.evidence).toMatchObject({ value: 500, baseline: 200, lift: 150, n: 5, baselineN: 6 });
    expect(r.why).toContain("5 measured video posts against 6 measured photo posts");
    expect(r.nextAction.prefill).toEqual({ platform: "instagram", format: "video", topic: null, basedOn: [] });
    // Under the gap: nothing.
    const close = state("instagram", { byFormat: [baseline("photo", 6, 200), baseline("video", 5, 200 * (1 + (FORMAT_GAP_PCT - 1) / 100))] });
    expect(personalRecommendations({ states: [close], window: WINDOW }).recommendations).toEqual([]);
  });

  test("ordering and caps: by gap, at most PER_PLATFORM_MAX per platform and PERSONAL_MAX in all; deterministic", () => {
    const ig = state("instagram", { byFormat: [baseline("video", 5, 500), baseline("photo", 6, 200)], lifts: [lift("hasHook", "a written hook", 400, 100), lift("hasCta", "a call to action", 130, 100), lift("weekend", "a weekend publish", 300, 100)] });
    const yt = state("youtube", { lifts: [lift("shortVideo", "a video under 30 seconds", 1000, 100), lift("hasQuestion", "a question in the hook or opening", 120, 100)] });
    const fb = state("facebook", { lifts: [lift("longCaption", "a caption over 150 characters", 160, 100), lift("hasCover", "your own cover image", 150, 100)] });
    const a = personalRecommendations({ states: [ig, yt, fb], window: WINDOW });
    const b = personalRecommendations({ states: [fb, yt, ig], window: WINDOW });
    expect(a.recommendations.map((r) => r.id)).toEqual(b.recommendations.map((r) => r.id));
    expect(a.recommendations.length).toBeLessThanOrEqual(PERSONAL_MAX);
    const perPlatform = new Map<string, number>();
    for (const r of a.recommendations) perPlatform.set(r.platform, (perPlatform.get(r.platform) ?? 0) + 1);
    for (const n of perPlatform.values()) expect(n).toBeLessThanOrEqual(PER_PLATFORM_MAX);
    // Largest gaps first: YouTube's short video (900%), then Instagram's hook (300%) and the weekend/format pair.
    expect(a.recommendations[0].id).toBe(personalId("trait", "shortVideo+", "youtube"));
    expect(a.recommendations[1].id).toBe(personalId("trait", "hasHook+", "instagram"));
    const lifts = a.recommendations.map((r) => r.evidence.lift);
    expect([...lifts].sort((x, y) => y - x)).toEqual(lifts);
    expect(a.reason).toBeNull();
    // Rule keys never include the period: the same advice is one live row whatever the window.
    expect(ruleKeyOf(a.recommendations[0])).toBe("personal:trait:shortVideo+:youtube|youtube||");
  });
});

let n = 0;
const user = async () => withIntelligence(await db.user.create({ data: { name: `O ${++n}`, email: `r1320-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x" } }));

async function seed(ownerId: string, platform = "instagram") {
  const account = await db.socialAccount.create({ data: { userId: ownerId, platform, platformUserId: `${platform}-r1320-${Date.now()}-${Math.random()}`, username: "@o", accessToken: "x", status: "connected" } });
  const media = await db.media.create({ data: { userId: ownerId, originalFilename: "v.mp4", storageKey: `r1320/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready", duration: 40, width: 1080, height: 1920 } });
  const post = async (views: number, ageMs: number, hook: string | null) => {
    const at = new Date(Date.now() - ageMs);
    const p = await db.post.create({ data: { userId: ownerId, mediaId: media.id, status: "published", publishedAt: at, hook } });
    const t = await db.postTarget.create({ data: { postId: p.id, platform, socialAccountId: account.id, platformStatus: "published", publishedAt: at, caption: "A caption" } });
    await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views, likes: 1 } });
    return { post: p, target: t };
  };
  return { account, post };
}

describe("R1320 stored read (db)", () => {
  test("drafts from the creator's own states are stored once, keep their ids, take planner actions and log learning events", async () => {
    const a = await user();
    const s = await seed(a.id);
    // Five hooked posts around 400 views, five plain ones around 100: a hook lift on Instagram.
    for (const [i, v] of [380, 400, 420, 390, 410].entries()) await s.post(v, (60 - i * 4) * DAY, "Why does this work?");
    for (const [i, v] of [90, 100, 110, 95, 105].entries()) await s.post(v, (58 - i * 4) * DAY, null);
    await feat.refreshFeatures(a.id);
    await pred.syncPredictions(a.id);
    const first = await personal.personalRead(a.id);
    expect(first.levels).toEqual([{ platform: "instagram", level: "blended", measured: 10 }]);
    expect(first.recommendations.length).toBeGreaterThanOrEqual(1);
    const hook = first.recommendations.find((r) => r.rule.startsWith("personal:trait:hasHook+:instagram"))!;
    expect(first.window.label).toBe(first.recommendations[0].period);
    expect(hook).toBeDefined();
    expect(hook.status).toBe("open");
    expect(hook.ownerId).toBe(a.id);
    expect(hook.scopeKey).toBe("");
    expect(hook.evidence).toMatchObject({ metric: "views", n: 5, baselineN: 5 });
    expect(hook.evidence.value).toBe(400);
    expect(hook.evidence.baseline).toBe(100);
    expect(hook.title).toContain("hook");
    // Idempotent: the same read returns the same stored ids, no new rows or events.
    const rows = await db.recommendation.count({ where: { ownerId: a.id } });
    const second = await personal.personalRead(a.id);
    expect(second.recommendations.map((r) => r.id)).toEqual(first.recommendations.map((r) => r.id));
    expect(await db.recommendation.count({ where: { ownerId: a.id } })).toBe(rows);
    expect(await db.recommendationEvent.count({ where: { recommendationId: { in: first.recommendations.map((r) => r.id) }, type: "generated" } })).toBe(first.recommendations.length);
    // The planner acts on it like any recommendation; the action is also a learning event.
    const acted = await planner.act(a.id, hook.id, "accept", undefined, { id: a.id, role: "owner" });
    expect(acted.recommendation.status).toBe("accepted");
    expect(acted.prefill?.platform).toBe("instagram");
    const learned = await db.learningEvent.findMany({ where: { ownerId: a.id, type: "recommendation_accepted" } });
    expect(learned).toHaveLength(1);
    expect(learned[0].subjectId).toBe(hook.id);
    expect(JSON.parse(learned[0].data!)).toMatchObject({ platform: "instagram", status: "accepted", personal: true });
    // A double click is deduped by the planner and logs nothing more.
    const again = await planner.act(a.id, hook.id, "accept", undefined, { id: a.id, role: "owner" });
    expect(again.deduped).toBe(true);
    expect(await db.learningEvent.count({ where: { ownerId: a.id, type: "recommendation_accepted" } })).toBe(1);
    // An accepted row stays in the read (active); a rejected one leaves it and is not regenerated.
    expect((await personal.personalRead(a.id)).recommendations.some((r) => r.id === hook.id)).toBe(true);
    await planner.act(a.id, hook.id, "done", undefined, { id: a.id, role: "owner" });
    const after = await personal.personalRead(a.id);
    expect(after.recommendations.some((r) => r.id === hook.id)).toBe(false);
    expect(await db.recommendation.count({ where: { ownerId: a.id } })).toBe(rows);
    // Another owner sees nothing of this, and a read-only read stores nothing for them.
    const b = await user();
    const empty = await personal.personalRead(b.id, { readOnly: true });
    expect(empty.recommendations).toEqual([]);
    expect(empty.reason).toContain("Nothing measured yet");
    expect(await db.recommendation.count({ where: { ownerId: b.id } })).toBe(0);
    // A row whose rule the numbers no longer support is retired: an open personal row from a rule not drafted now.
    const stale = await db.recommendation.create({ data: { ownerId: a.id, scopeKey: "", dedupeKey: `stale-${Date.now()}`, title: "Old", concept: "Old advice", why: "Old numbers", evidence: JSON.stringify({ metric: "views", value: 1, baseline: 2, unit: "count", lift: 50, n: 3, baselineN: 3, period: "x", rule: "personal:trait:hasHook-:instagram|instagram||" }), postsAnalyzed: 6, periodFrom: "2026-01-01", periodTo: "2026-06-30", confidence: "low", nextAction: "{}" } });
    await personal.personalRead(a.id);
    expect((await db.recommendation.findUnique({ where: { id: stale.id } }))!.status).toBe("expired");
    expect(await db.recommendationEvent.count({ where: { recommendationId: stale.id, type: "expired" } })).toBe(1);
    // Read-only for the owner: the stored rows come back, nothing new is written.
    const ro = await personal.personalRead(a.id, { readOnly: true });
    expect(ro.recommendations.map((r) => r.id)).toEqual(after.recommendations.map((r) => r.id));
    expect(await db.recommendation.count({ where: { ownerId: a.id } })).toBe(rows + 1);
  });
});

describe("R1320 wiring", () => {
  test("routes, view section, pure core, README, plan", () => {
    for (const r of ["recommendations", "history", "feedback", "insights"]) expect(read(`app/api/intelligence/${r}/route.ts`)).toContain("route(");
    expect(read("app/api/intelligence/recommendations/route.ts")).toContain("resolveClient(user");
    expect(read("app/api/intelligence/insights/route.ts")).toContain("readOnly: true");
    expect(read("app/api/intelligence/feedback/route.ts")).toContain("act(user.id");
    expect(read("app/api/intelligence/history/route.ts")).toContain("take: limit");
    expect(read("components/intelligence/IntelligenceView.tsx")).toContain("<PersonalRecommendations client={client || null} />");
    expect(read("components/intelligence/PersonalRecommendations.tsx")).toContain("Why this fits you");
    const core = read("lib/intelligence/personal-reco-core.ts");
    expect(core).not.toContain("prisma");
    expect(core).not.toContain("Date.now");
    expect(read("lib/intelligence/personal-reco.ts")).toContain('import "server-only"');
    expect(read("lib/intelligence/planner.ts")).toContain("logLearning(ownerId, `recommendation_${type}`");
    expect(read("lib/intelligence/README.md")).toContain("personal-reco-core.ts");
    expect(read("docs/intelligence-clipper-plan.md")).toMatch(/\| 4 Recommendation engine \(personal\) \| R1320 \(DONE\)/);
  });
});
