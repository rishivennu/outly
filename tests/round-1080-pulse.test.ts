import { describe, expect, test } from "bun:test";
import { bucket, compact, dayKeys, delta, isPulseRange, niceMax, rate, resample, total } from "@/lib/dashboard/pulse-core";
import { DASHBOARD_DEFAULT, normalizeDashboard, resolveDashboard } from "@/lib/dashboard-config";
import { lastActive } from "@/components/settings/ActiveSessionsCard";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const D = 864e5;

describe("1080 pulse: days and buckets", () => {
  test("dayKeys ends today, oldest first", () => {
    expect(dayKeys(NOW, 3)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });
  test("ranges", () => {
    expect([7, 30, 90].every(isPulseRange)).toBe(true);
    expect(isPulseRange(14)).toBe(false);
  });
  test("bucket splits current and previous period, per platform and all", () => {
    const m = (daysAgo: number, platform: string, views: number, postId = "p1") => ({ at: NOW - daysAgo * D, platform, postId, views, likes: 1, comments: 1, shares: 0 });
    const b = bucket(NOW, 7, ["instagram", "youtube"], [m(0, "instagram", 100), m(2, "youtube", 50, "p2"), m(8, "instagram", 30), m(20, "instagram", 999)], [{ at: NOW, platform: "instagram" }, { at: NOW - 9 * D, platform: "youtube" }]);
    expect(b.dates.length).toBe(7);
    expect(total(b.cur.all.views)).toBe(150);
    expect(total(b.cur.instagram.views)).toBe(100);
    expect(total(b.cur.youtube.views)).toBe(50);
    expect(total(b.prev.all.views)).toBe(30); // 20 days ago is outside both periods
    expect(total(b.cur.all.interactions)).toBe(4);
    expect(total(b.cur.all.posts)).toBe(1);
    expect(total(b.prev.youtube.posts)).toBe(1);
    expect(b.ranked.map((r) => r.postId)).toEqual(["p1", "p2"]);
  });
  test("unknown platform still counts toward all", () => {
    const b = bucket(NOW, 7, ["instagram"], [{ at: NOW, platform: "tiktok", postId: "x", views: 5, likes: 0, comments: 0, shares: 0 }], []);
    expect(total(b.cur.all.views)).toBe(5);
    expect(b.cur.tiktok).toBeUndefined();
  });
});

describe("1080 pulse: maths", () => {
  test("delta is null with nothing to compare", () => {
    expect(delta(10, 0)).toBeNull();
    expect(delta(15, 10)).toBe(50);
    expect(delta(5, 10)).toBe(-50);
  });
  test("rate", () => {
    expect(rate(5, 100)).toBe(5);
    expect(rate(5, 0)).toBe(0);
  });
  test("resample keeps the ends and length", () => {
    const r = resample([0, 10], 5);
    expect(r).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(resample([], 3)).toEqual([0, 0, 0]);
    expect(resample([4], 3)).toEqual([4, 4, 4]);
    expect(resample([1, 2, 3, 4, 5, 6, 7], 60).length).toBe(60);
  });
  test("niceMax", () => {
    expect(niceMax(0)).toBe(10);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(220)).toBe(250);
    expect(niceMax(4200)).toBe(5000);
    expect(niceMax(100)).toBe(100);
  });
  test("compact", () => {
    expect(compact(1234)).toBe("1,234");
    expect(compact(12_340)).toBe("12.3K");
    expect(compact(10_000)).toBe("10K");
    expect(compact(250_000)).toBe("250K");
    expect(compact(4_500_000)).toBe("4.5M");
  });
});

describe("1080 dashboard style", () => {
  test("normalize falls back to classic, switch off", () => {
    expect(normalizeDashboard(null)).toEqual(DASHBOARD_DEFAULT);
    expect(normalizeDashboard({ style: "weird" as never, userSwitch: "yes" as never })).toEqual({ style: "classic", userSwitch: false });
    expect(normalizeDashboard({ style: "pulse", userSwitch: true })).toEqual({ style: "pulse", userSwitch: true });
  });
  test("the cookie only counts while switching is allowed", () => {
    expect(resolveDashboard({ style: "classic", userSwitch: false }, "pulse")).toBe("classic");
    expect(resolveDashboard({ style: "classic", userSwitch: true }, "pulse")).toBe("pulse");
    expect(resolveDashboard({ style: "pulse", userSwitch: true }, "junk")).toBe("pulse");
    expect(resolveDashboard({ style: "pulse", userSwitch: true }, undefined)).toBe("pulse");
  });
});

describe("1080 active sessions", () => {
  test("lastActive", () => {
    expect(lastActive(new Date(NOW - 60_000).toISOString(), NOW)).toBe("Active now");
    expect(lastActive(new Date(NOW - 3 * 3600_000).toISOString(), NOW)).toMatch(/^Active .*3 hours ago$/);
    expect(lastActive(new Date(NOW - 2 * D).toISOString(), NOW)).toMatch(/^Active /);
  });
});
