/** Profile review: the score is maths over real numbers, Gemini text is cleaned, avatars resolve safely. */
import { describe, expect, test } from "bun:test";
import { clean, combine, combinedDelta, mergeAi, overall, pillars, platformFacts, rulesReview, type ReviewFacts } from "../lib/live/review-core";
import { defaultOrb, isOrbValue, orbValue, resolveAvatar } from "../lib/avatar";
import type { LivePost } from "../lib/live/types";

const now = new Date("2026-10-15T12:00:00Z");
const post = (i: number, views: number, extra: Partial<LivePost> = {}): LivePost => ({
  id: `p${i}`, title: `Post ${i}`, thumb: null, url: null, publishedAt: new Date(now.getTime() - i * 3 * 864e5).toISOString(), format: "reel",
  views, likes: Math.round(views * 0.04), comments: Math.round(views * 0.005), shares: Math.round(views * 0.005), captionLength: 120, hashtags: 4, ...extra,
});

const ig = platformFacts({
  platform: "instagram",
  handle: "@maya",
  headline: [{ key: "followers", label: "Followers", value: 10_000, delta: 5 }, { key: "views", label: "Views", value: 60_000, delta: 20 }],
  posts: [post(1, 12_000), post(2, 6_000), post(3, 4_000), post(4, 1_000), post(5, 3_000), post(12, 2_000)],
  hours: [{ label: "7 PM", value: 90 }, { label: "9 AM", value: 30 }],
  rangeDays: 28,
  now,
});

const stored = { views: 0, prevViews: 0, engagement: 0, prevEngagement: 0, likes: 0, comments: 0, shares: 0, bestDay: "Thursday", top: null, hasData: false };
const facts: ReviewFacts = { name: "Maya", goalPerWeek: 3, publishedLast30: 4, publishedPrev30: 2, platforms: [ig], stored };

describe("platformFacts", () => {
  test("reads followers, views and engagement from the dashboard", () => {
    expect(ig.followers).toBe(10_000);
    expect(ig.views).toBe(60_000);
    expect(ig.engagementRate).toBe(5);
    expect(ig.bestHour).toBe("7 PM");
    expect(ig.bestPost?.views).toBe(12_000);
    expect(ig.weakestPost?.views).toBe(1_000);
    // 5 of the 6 posts sit inside the 28-day window
    expect(ig.postsInWindow).toBe(5);
    // average 4,667: posts at or above 2,333 are 12k, 6k, 4k, 3k
    expect(ig.hitRate).toBe(67);
  });
});

describe("scoring", () => {
  test("combinedDelta back-solves one change across platforms", () => {
    expect(combinedDelta([{ value: 110, delta: 10 }, { value: 90, delta: -10 }])).toBe(0);
    expect(combinedDelta([{ value: 100, delta: null }])).toBeNull();
  });

  test("cross-posting counts the busiest platform, not the sum", () => {
    const twin = { ...ig, platform: "youtube" as const };
    expect(combine({ ...facts, platforms: [ig, twin] }).perWeek).toBe(combine(facts).perWeek);
  });

  test("every pillar states its number and stays in 0-100", () => {
    const ps = pillars(facts);
    expect(ps.map((p) => p.key).sort()).toEqual(["consistency", "content", "engagement", "growth", "reach"]);
    for (const p of ps) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(100);
      expect(p.note).toMatch(/\d/);
    }
    expect(ps.find((p) => p.key === "growth")?.score).toBe(70);
  });

  test("one pillar is not enough for a score", () => {
    expect(overall([{ key: "reach", label: "Reach", score: 80, note: "x" }])).toBeNull();
  });

  test("no data gives an empty review instead of a made-up score", () => {
    const r = rulesReview({ ...facts, platforms: [], publishedLast30: 0, publishedPrev30: 0 });
    expect(r.empty).toBe(true);
    expect(r.score).toBeNull();
  });

  test("the rules review is complete and has no emoji or em dashes", () => {
    const r = rulesReview(facts, now);
    expect(r.score).not.toBeNull();
    expect(r.actions.length).toBeGreaterThan(0);
    expect(r.bestTimes).toBe("Thursdays around 7 PM");
    expect(JSON.stringify(r)).not.toMatch(/[\u2014\u2013]|\p{Extended_Pictographic}/u);
  });
});

describe("Gemini output", () => {
  test("clean strips emoji, dashes and markdown, and caps length", () => {
    expect(clean("Great hooks \u{1F525} \u2014 **keep** going")).toBe("Great hooks, keep going");
    expect(clean("a".repeat(50), 10)).toHaveLength(10);
    expect(clean(42)).toBe("");
  });

  test("mergeAi keeps the maths and falls back on bad fields", () => {
    const base = rulesReview(facts, now);
    const m = mergeAi(base, { headline: "Your hooks work", strengths: [], actions: [{ title: "Reply to comments", body: "Answer the first ten replies." }, { title: "" }], perPlatform: [{ platform: "instagram", verdict: "Strong reach" }] }, now);
    expect(m.source).toBe("ai");
    expect(m.score).toBe(base.score);
    expect(m.headline).toBe("Your hooks work");
    expect(m.strengths).toEqual(base.strengths);
    expect(m.actions).toHaveLength(1);
    expect(m.actions[0].href).toBe("/inbox");
    expect(m.perPlatform[0].verdict).toBe("Strong reach");
    expect(mergeAi(base, null)).toBe(base);
  });
});

describe("orb avatars", () => {
  test("values round-trip and junk is rejected", () => {
    expect(isOrbValue(orbValue({ color: "mint", face: "joy" }))).toBe(true);
    expect(isOrbValue("orb:mint:nope")).toBe(false);
    expect(isOrbValue("javascript:alert(1)")).toBe(false);
  });

  test("default orb is stable per seed", () => {
    expect(defaultOrb("a@b.co")).toEqual(defaultOrb("a@b.co"));
  });

  test("a photo wins, then a saved orb, then the default", () => {
    expect(resolveAvatar("https://cdn.example.com/me.jpg", "x")).toEqual({ photo: "https://cdn.example.com/me.jpg" });
    expect(resolveAvatar("orb:sky:calm", "x")).toEqual({ orb: { color: "sky", face: "calm" } });
    expect(resolveAvatar(null, "x")).toEqual({ orb: defaultOrb("x") });
  });
});
