/**
 * 1140 analytics maths: ranges stay inside the plan window, a metric a platform does not report is
 * missing rather than zero, headlines only say what the numbers hold, and growth needs real history.
 */
import { describe, expect, test } from "bun:test";
import {
  changePct,
  combinedNote,
  compareValue,
  engagementPct,
  freshness,
  growth,
  headline,
  kpiMetrics,
  rangeLabel,
  rankStandouts,
  ranksFor,
  resolveRange,
  vsAverage,
  type StandoutPost,
} from "../lib/analytics/core";
import { activeDays, activeHours, bestBucket, formatBreakdown, type FormatPost } from "../lib/analytics/profile-core";

const NOW = Date.parse("2026-11-05T09:30:00Z");

describe("ranges", () => {
  test("a day count ends tomorrow midnight and covers exactly that many days", () => {
    const w = resolveRange({ days: 7 }, 90, NOW);
    expect(w.from).toBe("2026-10-30T00:00:00.000Z");
    expect(w.to).toBe("2026-11-06T00:00:00.000Z");
    expect(w.days).toBe(7);
    expect(w.custom).toBe(false);
    expect(w.clamped).toBe(false);
  });

  test("a day count past the plan window is trimmed and says so", () => {
    const w = resolveRange({ days: 365 }, 90, NOW);
    expect(w.days).toBe(90);
    expect(w.clamped).toBe(true);
  });

  test("custom dates are inclusive on both ends", () => {
    const w = resolveRange({ from: "2026-11-01", to: "2026-11-03" }, 90, NOW);
    expect(w.custom).toBe(true);
    expect(w.days).toBe(3);
    expect(w.from).toBe("2026-11-01T00:00:00.000Z");
    expect(w.to).toBe("2026-11-04T00:00:00.000Z");
  });

  test("a custom start before the plan window is pulled forward, never read further back", () => {
    const w = resolveRange({ from: "2020-01-01", to: "2026-11-03" }, 30, NOW);
    expect(Date.parse(w.from)).toBe(Date.parse("2026-11-06T00:00:00.000Z") - 30 * 864e5);
    expect(w.clamped).toBe(true);
  });

  test("rubbish or backwards dates fall back to the day count", () => {
    for (const bad of [{ from: "nonsense", to: "2026-11-03" }, { from: "2026-11-09", to: "2026-11-03" }, { from: "2026-11-03", to: null }]) {
      const w = resolveRange({ days: 30, ...bad }, 90, NOW);
      expect(w.custom).toBe(false);
      expect(w.days).toBe(30);
    }
  });

  test("the label names the days the window actually covers", () => {
    expect(rangeLabel({ from: "2026-11-01T00:00:00.000Z", to: "2026-11-04T00:00:00.000Z" })).toBe("1 to 3 Nov 2026");
    expect(rangeLabel({ from: "2026-11-03T00:00:00.000Z", to: "2026-11-04T00:00:00.000Z" })).toBe("3 Nov 2026");
    expect(rangeLabel({ from: "2025-12-30T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" })).toBe("30 Dec 2025 to 1 Jan 2026");
  });
});

describe("what a platform actually reports", () => {
  test("saves are offered for Instagram, not for YouTube", () => {
    const only = kpiMetrics(["youtube"]).map((c) => c.metric);
    expect(only).not.toContain("saves");
    expect(kpiMetrics(["instagram"]).map((c) => c.metric)).toContain("saves");
  });

  test("a combined selection names the platforms a metric leaves out", () => {
    const cards = kpiMetrics(["instagram", "facebook"]);
    const shares = cards.find((c) => c.metric === "shares")!;
    expect(shares.from).toEqual(["instagram"]);
    expect(shares.missing).toEqual(["facebook"]);
  });

  test("a platform with no per-post reader contributes no cards at all", () => {
    expect(kpiMetrics(["linkedin", "threads"])).toEqual([]);
  });

  test("the note says what is added up, what is left out, and what is never summed", () => {
    const note = combinedNote([{ platform: "instagram", name: "Instagram" }, { platform: "facebook", name: "Facebook" }], [{ platform: "facebook", name: "Facebook" }]);
    expect(note).toContain("Added up across Instagram and Facebook");
    expect(note).toContain("Facebook does not report every one of these");
    expect(note).toContain("never added across platforms");
    expect(combinedNote([], [])).toContain("No platform has sent numbers");
  });

  test("engagement needs views to divide by", () => {
    expect(engagementPct({ views: 0, likes: 5, comments: 1, shares: 0 })).toBeNull();
    expect(engagementPct({ views: 100, likes: 5, comments: 4, shares: 1, saves: 10 })).toBeCloseTo(20, 6);
  });

  test("a change against nothing is nothing, not a 100% rise", () => {
    expect(changePct(50, 0)).toBeNull();
    expect(changePct(150, 100)).toBe(50);
  });
});

describe("headlines", () => {
  const base = { views: 0, previousViews: 0, followerGain: null, bestPlatform: null, bestDay: null, posts: 0, rangePhrase: "this week", accountName: null };

  test("real follower growth leads", () => {
    const h = headline({ ...base, views: 10, followerGain: { platform: "youtube", name: "YouTube", metric: "subscribers", gain: 42 } });
    expect(h.variant).toBe("followers");
    expect(h.value).toBe(42);
    expect(h.after).toContain("subscribers this week");
  });

  test("views lead when there is no growth to report", () => {
    const h = headline({ ...base, views: 1200, previousViews: 1000, bestDay: "Tuesday" });
    expect(h.variant).toBe("views");
    expect(h.value).toBe(1200);
    expect(h.notes[0]).toBe("20% more than the period before.");
    expect(h.notes).toContain("Tuesdays are your day.");
  });

  test("posts with no numbers back yet say exactly that", () => {
    const h = headline({ ...base, posts: 3 });
    expect(h.variant).toBe("posts");
    expect(h.notes[0]).toContain("No view counts have come back");
  });

  test("nothing published says nothing published", () => {
    const h = headline(base);
    expect(h.variant).toBe("none");
    expect(h.value).toBeNull();
    expect(h.notes).toEqual([]);
  });

  test("a growth of zero is not called growth", () => {
    const h = headline({ ...base, views: 5, followerGain: { platform: "instagram", name: "Instagram", metric: "followers", gain: 0 } });
    expect(h.variant).toBe("views");
  });
});

describe("standouts", () => {
  const p = (over: Partial<StandoutPost>): StandoutPost => ({
    targetId: "t", postId: "p", title: "x", thumbnailUrl: null, platform: "instagram", accountId: "a", username: "u", url: null, publishedAt: null,
    views: 0, likes: 0, comments: 0, shares: 0, saves: 0, engagement: null, ...over,
  });

  test("a post with no number for the ranking sorts last instead of reading as zero", () => {
    const list = [p({ targetId: "a", views: 10, engagement: null }), p({ targetId: "b", views: 5, engagement: 3 })];
    expect(rankStandouts(list, "engaged").map((x) => x.targetId)).toEqual(["b", "a"]);
  });

  test("views break a tie on another ranking", () => {
    const list = [p({ targetId: "a", shares: 2, views: 1 }), p({ targetId: "b", shares: 2, views: 9 })];
    expect(rankStandouts(list, "shares")[0].targetId).toBe("b");
  });

  test("only rankings the platforms can fill are offered", () => {
    expect(ranksFor(["youtube"]).map((r) => r.k)).toEqual(["views", "engaged", "shares"]);
    expect(ranksFor(["instagram"]).map((r) => r.k)).toEqual(["views", "engaged", "shares", "saves"]);
    expect(ranksFor(["facebook"]).map((r) => r.k)).toEqual(["views", "engaged"]);
  });

  test("against your average needs an average", () => {
    expect(vsAverage(100, 0)).toBeNull();
    expect(vsAverage(150, 100)).toBe(50);
  });
});

describe("growth and comparison", () => {
  test("one day of history is not a trend", () => {
    const g = growth([{ day: "2026-11-01", followers: 100, posts: null, views: null }]);
    expect(g.enough).toBe(false);
    expect(g.gain).toBeNull();
  });

  test("days the platform did not answer on are skipped, not read as zero", () => {
    const g = growth([
      { day: "2026-11-03", followers: 120, posts: null, views: null },
      { day: "2026-11-02", followers: null, posts: null, views: null },
      { day: "2026-11-01", followers: 100, posts: null, views: null },
    ]);
    expect(g.enough).toBe(true);
    expect(g.first).toBe(100);
    expect(g.last).toBe(120);
    expect(g.gain).toBe(20);
  });

  test("a comparison with a missing side is no comparison", () => {
    expect(compareValue(10, null)).toBeNull();
    expect(compareValue(null, 10)).toBeNull();
    expect(compareValue(150, 100)).toEqual({ diff: 50, pct: 50 });
    expect(compareValue(5, 0)).toEqual({ diff: 5, pct: null });
  });

  test("freshness says when, and when it is too old to trust", () => {
    expect(freshness(null).label).toBe("Not synced yet");
    expect(freshness(null).stale).toBe(true);
    expect(freshness(new Date(NOW - 60_000).toISOString(), NOW).label).toBe("Synced just now");
    expect(freshness(new Date(NOW - 25 * 3600_000).toISOString(), NOW).stale).toBe(true);
  });
});

describe("per-profile breakdowns", () => {
  const post = (over: Partial<FormatPost>): FormatPost => ({ format: "Reels", publishedAt: "2026-11-02T09:00:00Z", views: 100, likes: 5, comments: 1, ...over });

  test("formats are grouped and sorted by how many you publish", () => {
    const b = formatBreakdown([post({}), post({}), post({ format: "Images" })]);
    expect(b.map((x) => [x.label, x.posts])).toEqual([["Reel", 2], ["Image", 1]]);
    expect(b[0].avgViews).toBe(100);
  });

  test("a format the platform reported no views for says so instead of showing zero", () => {
    const b = formatBreakdown([post({ format: "Stories", views: null })]);
    expect(b[0].views).toBeNull();
    expect(b[0].avgViews).toBeNull();
    expect(b[0].engagement).toBeNull();
  });

  test("days and hours land in the creator's own timezone", () => {
    const days = activeDays([post({ publishedAt: "2026-11-02T20:00:00Z" })], "Asia/Kolkata");
    expect(days.find((d) => d.posts > 0)!.label).toBe("Tuesday");
    const hours = activeHours([post({ publishedAt: "2026-11-02T20:00:00Z" })], "Asia/Kolkata");
    expect(hours.map((h) => h.label)).toEqual(["01:00"]);
  });

  test("a best bucket needs something to beat", () => {
    expect(bestBucket(formatBreakdown([post({})]))).toBeNull();
    const two = formatBreakdown([post({ format: "Reels", views: 10 }), post({ format: "Images", views: 900 })]);
    expect(bestBucket(two)!.label).toBe("Image");
  });
});
