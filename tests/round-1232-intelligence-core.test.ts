/**
 * R1232: Outlly Intelligence engine core (lib/intelligence/core.ts). Empty input, minimum samples, unavailable vs
 * unsupported vs zero, like-with-like grouping, lift maths, confidence thresholds, recommendation order and the
 * no-data path.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  availabilityOf,
  classifyTopic,
  confidenceOf,
  formatPerformance,
  MAX_RECOMMENDATIONS,
  MIN_SAMPLE,
  NO_DATA_REASON,
  OBJECTIVE_METRICS,
  OBJECTIVES,
  PER_POST_METRICS,
  periodOf,
  previousPeriod,
  recommendationsFrom,
  topicInsights,
  whatIsWorking,
  whatNeedsAttention,
  type PostRecord,
  type Signal,
} from "../lib/intelligence/core";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const period = periodOf(NOW, 30);
const DAY = 864e5;
let seq = 0;
const post = (o: Partial<PostRecord> & { views?: number | null; daysAgo?: number }): PostRecord => {
  const { views, daysAgo = 3, ...rest } = o;
  return {
    id: `p${String(++seq).padStart(3, "0")}`,
    platform: "instagram",
    format: "video",
    publishedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    metrics: { views: views ?? 100, likes: 10, comments: 1, shares: 1, saves: 1 },
    ...rest,
  };
};

describe("R1232 objectives and confidence", () => {
  test("every objective has metrics and a reason", () => {
    expect(OBJECTIVES.length).toBe(6);
    for (const o of OBJECTIVES) {
      expect(OBJECTIVE_METRICS[o].metrics.length).toBeGreaterThan(0);
      expect(OBJECTIVE_METRICS[o].reason.length).toBeGreaterThan(10);
    }
    expect(OBJECTIVE_METRICS.awareness.metrics[0]).toBe("views");
    expect(OBJECTIVE_METRICS.traffic.proxy).toBe(true);
  });
  test("confidence thresholds: low < 5, medium < 12, high >= 12", () => {
    expect(confidenceOf(0)).toBe("low");
    expect(confidenceOf(4)).toBe("low");
    expect(confidenceOf(5)).toBe("medium");
    expect(confidenceOf(11)).toBe("medium");
    expect(confidenceOf(12)).toBe("high");
    expect(confidenceOf(Number.NaN)).toBe("low");
    expect(MIN_SAMPLE).toBe(3);
  });
});

describe("R1232 availability", () => {
  test("unavailable vs unsupported vs zero vs available", () => {
    expect(availabilityOf("instagram", "video", "views", 120)).toBe("available");
    expect(availabilityOf("instagram", "video", "views", 0)).toBe("zero");
    expect(availabilityOf("instagram", "video", "views", null)).toBe("unavailable");
    expect(availabilityOf("tiktok", "video", "views", 500)).toBe("unavailable");
    expect(availabilityOf("x", "video", "likes", 3)).toBe("unavailable");
    expect(availabilityOf("linkedin", "video", "likes", 3)).toBe("unavailable");
    expect(availabilityOf("threads", "video", "likes", 3)).toBe("unavailable");
    expect(availabilityOf("youtube", "video", "saves", 4)).toBe("unavailable");
    expect(availabilityOf("instagram", "video", "saves", 4)).toBe("available");
    expect(availabilityOf("instagram", "carousel", "watchTimeMin", 9)).toBe("unsupported");
    expect(availabilityOf("instagram", "photo", "avgWatchSec", 9)).toBe("unsupported");
    expect(availabilityOf("instagram", "story", "watchTimeMin", 9)).toBe("unsupported");
    expect(availabilityOf("instagram", "video", "avgWatchSec", 9)).toBe("available");
    expect(availabilityOf("youtube", "carousel", "views", 9)).toBe("unsupported");
  });
  test("the mirror of CAN agrees with lib/insights/post.ts", () => {
    const src = readFileSync("lib/insights/post.ts", "utf8");
    const block = src.slice(src.indexOf("export const CAN"), src.indexOf("};", src.indexOf("export const CAN")));
    for (const [p, list] of Object.entries(PER_POST_METRICS)) {
      const line = block.split(/\r?\n/).find((l) => l.trim().startsWith(`${p}:`)) ?? "";
      const got = [...line.matchAll(/"(\w+)"/g)].map((m) => m[1]);
      expect(got).toEqual([...list]);
    }
  });
});

describe("R1232 empty input never throws", () => {
  test("all functions are total", () => {
    expect(formatPerformance([], "awareness")).toEqual([]);
    expect(topicInsights([], "engagement")).toEqual([]);
    expect(whatIsWorking([], "awareness", period)).toEqual([]);
    expect(whatNeedsAttention([], "awareness", period)).toEqual([]);
    expect(recommendationsFrom([])).toEqual({ recommendations: [], reason: NO_DATA_REASON });
    expect(classifyTopic("", [])).toBeNull();
    expect(periodOf(Number.NaN, Number.NaN).days).toBe(1);
  });
});

describe("R1232 format performance", () => {
  test("groups by platform+format, insufficient below MIN_SAMPLE, unavailable for tiktok", () => {
    const posts = [
      post({ views: 100 }), post({ views: 300 }), post({ views: 200 }),
      post({ format: "carousel", views: 50 }), post({ format: "carousel", views: 60 }),
      post({ platform: "tiktok", views: 9000 }), post({ platform: "tiktok", views: 9000 }), post({ platform: "tiktok", views: 9000 }),
    ];
    const g = formatPerformance(posts, "awareness");
    expect(g.map((x) => `${x.platform}|${x.format}`)).toEqual(["instagram|video", "instagram|carousel", "tiktok|video"]);
    const [video, carousel, tiktok] = g;
    expect(video.status).toBe("ok");
    expect(video.primary).toBe("views");
    expect(video.metrics.find((m) => m.metric === "views")?.median).toBe(200);
    expect(video.top.map((t) => t.value)).toEqual([300, 200, 100]);
    expect(video.viewShare).toBe(84.5);
    expect(carousel.status).toBe("insufficient");
    expect(carousel.top).toEqual([]);
    expect(tiktok.status).toBe("unavailable");
    expect(tiktok.metrics.find((m) => m.metric === "views")?.median).toBeNull();
    expect(tiktok.viewShare).toBeNull();
    expect(video.postShare).toBe(37.5);
  });
  test("a group of real zeroes says zero, not unavailable", () => {
    const g = formatPerformance([post({ views: 0 }), post({ views: 0 }), post({ views: 0 })], "awareness");
    expect(g[0].metrics.find((m) => m.metric === "views")?.availability).toBe("zero");
    expect(g[0].metrics.find((m) => m.metric === "views")?.median).toBe(0);
  });
});

describe("R1232 topics and lift", () => {
  test("lift is measured against each post's own platform+format median", () => {
    // Videos: median 200 views. Carousels: median 20 views. "Recipes" posts sit at 2x their own group's median.
    const posts = [
      post({ views: 400, topic: "Recipes" }), post({ views: 200 }), post({ views: 200 }), post({ views: 100 }),
      post({ format: "carousel", views: 40, topic: "Recipes" }), post({ format: "carousel", views: 40, categories: ["Recipes"] }),
      post({ format: "carousel", views: 20 }), post({ format: "carousel", views: 20 }), post({ format: "carousel", views: 10, topic: "Travel" }),
    ];
    const t = topicInsights(posts, "awareness");
    const recipes = t.find((x) => x.topic === "Recipes");
    expect(recipes?.n).toBe(3);
    expect(recipes?.lift).toBe(100);
    expect(recipes?.sufficient).toBe(true);
    expect(recipes?.rank).toBe(1);
    expect(recipes?.confidence).toBe("low");
    expect(recipes?.platform).toBe("instagram");
    expect(recipes?.format).toBe("carousel");
    const travel = t.find((x) => x.topic === "Travel");
    expect(travel?.sufficient).toBe(false);
    expect(travel?.rank).toBeNull();
  });
});

describe("R1232 what is working and what needs attention", () => {
  const prevVideos = [100, 100, 100].map((v) => post({ views: v, daysAgo: 40 }));
  const curVideos = [150, 150, 150].map((v) => post({ views: v, daysAgo: 5 }));
  const prevCar = [100, 100, 100].map((v) => post({ format: "carousel", views: v, daysAgo: 40 }));
  const curCar = [50, 50, 50].map((v) => post({ format: "carousel", views: v, daysAgo: 5 }));
  const all = [...prevVideos, ...curVideos, ...prevCar, ...curCar];

  test("period helpers", () => {
    expect(period.days).toBe(30);
    expect(period.to).toBe("2026-11-21T00:00:00.000Z");
    expect(previousPeriod(period).to).toBe(period.from);
  });
  test("format trends use the same platform+format in the previous period", () => {
    const up = whatIsWorking(all, "awareness", period);
    expect(up.length).toBe(1);
    expect(up[0].kind).toBe("format_trend");
    expect(up[0].format).toBe("video");
    expect(up[0].evidence).toMatchObject({ metric: "views", value: 150, baseline: 100, lift: 50, n: 3, baselineN: 3, period: period.label });
    const down = whatNeedsAttention(all, "awareness", period);
    expect(down.length).toBe(1);
    expect(down[0].format).toBe("carousel");
    expect(down[0].evidence.lift).toBe(-50);
  });
  test("no previous group, no trend claim", () => {
    expect(whatIsWorking(curVideos, "awareness", period)).toEqual([]);
  });
  test("small changes are noise", () => {
    const flat = [...prevVideos, ...[110, 110, 110].map((v) => post({ views: v, daysAgo: 5 }))];
    expect(whatIsWorking(flat, "awareness", period)).toEqual([]);
  });
});

describe("R1232 recommendations", () => {
  const sig = (id: string, lift: number, n: number, direction: "up" | "down" = "up"): Signal => ({
    id,
    kind: "format_trend",
    direction,
    title: id,
    platform: "instagram",
    format: "video",
    topic: null,
    evidence: { metric: "views", value: 100 + lift, baseline: 100, unit: "count", lift, n, baselineN: n, period: period.label },
    confidence: confidenceOf(n),
    postsAnalyzed: n * 2,
    examples: [],
  });
  test("ordered by confidence then lift, max 5, down signals ignored, duplicates dropped", () => {
    const signals = [sig("a", 30, 3), sig("b", 90, 3), sig("c", 25, 12), sig("d", 40, 6), sig("e", 50, 6), sig("f", 60, 4), sig("g", 70, 4), sig("h", 99, 20, "down"), sig("b", 90, 3)];
    const { recommendations, reason } = recommendationsFrom(signals, { niche: "fitness" });
    expect(reason).toBeNull();
    expect(recommendations.length).toBe(MAX_RECOMMENDATIONS);
    expect(recommendations.map((r) => r.id)).toEqual(["rec:c", "rec:e", "rec:d", "rec:b", "rec:g"]);
    expect(recommendations[0].concept).toContain("fitness");
    expect(recommendations[0].postsAnalyzed).toBe(24);
    expect(recommendations[0].nextAction.prefill.format).toBe("video");
    expect(recommendationsFrom([...signals].reverse()).recommendations.map((r) => r.id)).toEqual(recommendations.map((r) => r.id));
  });
  test("no upward signal: empty list and the not-enough-data reason", () => {
    const r = recommendationsFrom([sig("x", -40, 12, "down")]);
    expect(r.recommendations).toEqual([]);
    expect(r.reason).toContain("Not enough data yet");
  });
  test("end to end from measured posts", () => {
    const posts = [...[100, 100, 100].map((v) => post({ views: v, daysAgo: 40 })), ...[200, 200, 200].map((v) => post({ views: v, daysAgo: 5 }))];
    const r = recommendationsFrom(whatIsWorking(posts, "awareness", period));
    expect(r.recommendations.length).toBe(1);
    expect(r.recommendations[0].why).toContain("up 100%");
    expect(r.recommendations[0].nextAction.prefill.basedOn.length).toBe(3);
  });
});

describe("R1232 classifyTopic", () => {
  const cats = [
    { id: "food", name: "Food", keywords: ["recipe", "cooking"] },
    { id: "fit", name: "Fitness", keywords: ["workout", "gym"] },
    { id: "cook2", name: "Kitchen", keywords: ["recipe", "cooking"] },
  ];
  test("case-insensitive, whole words, ties go to the first", () => {
    expect(classifyTopic("My GYM workout today", cats)?.id).toBe("fit");
    expect(classifyTopic("A quick Recipe for cooking", cats)?.id).toBe("food");
    expect(classifyTopic("recipes are not a whole-word match for recipe? yes: recipe", cats)?.id).toBe("food");
    expect(classifyTopic("gymnastics", cats)).toBeNull();
    expect(classifyTopic("nothing here", cats)).toBeNull();
  });
});
