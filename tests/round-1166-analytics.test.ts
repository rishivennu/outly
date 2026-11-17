/** 1166: Admin > Analytics, Outlly data: one window drives every panel, posts are not double counted, breakdowns add up. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAnalytics, MAX_CUSTOM_DAYS, parseWindow, topWithOther, windowDays, windowLabel, type AnalyticsInput } from "../lib/admin/analytics-core";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-11-17T12:00:00Z");
const DAY = 86_400_000;
const at = (n: number, h = 10) => new Date(Date.parse(new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10) + "T00:00:00Z") + h * 3_600_000);
const key = (n: number) => at(n).toISOString().slice(0, 10);
const cn = (c: string | null) => (c === "IN" ? "India" : c === "US" ? "United States" : c ? c : "Unknown");
const pn = (p: string) => ({ youtube: "YouTube", x: "X" })[p] ?? p;

describe("parseWindow", () => {
  test("presets cover today and the days before, both ends included", () => {
    const w = parseWindow({ d: "7" }, NOW);
    expect(w).toEqual({ from: key(6), to: key(0), days: 7, preset: 7, custom: false });
    expect(windowDays(w)).toHaveLength(7);
    expect(parseWindow({}, NOW).days).toBe(30);
    expect(parseWindow({ d: "13" }, NOW).days).toBe(30);
    expect(parseWindow({ d: "90" }, NOW).days).toBe(90);
    expect(windowLabel(w)).toBe("Last 7 days");
  });

  test("custom ranges: real days only, from before to, capped at today and at the maximum span", () => {
    expect(parseWindow({ from: "2026-11-01", to: "2026-11-10" }, NOW)).toEqual({ from: "2026-11-01", to: "2026-11-10", days: 10, preset: null, custom: true });
    expect(parseWindow({ from: "2026-11-10", to: "2027-01-01" }, NOW).to).toBe("2026-11-17");
    expect(parseWindow({ from: "2026-11-10", to: "2026-11-01" }, NOW).custom).toBe(false);
    expect(parseWindow({ from: "2026-02-30", to: "2026-03-02" }, NOW).custom).toBe(false);
    expect(parseWindow({ from: "nope", to: "2026-03-02" }, NOW).custom).toBe(false);
    expect(parseWindow({ from: "2027-01-01", to: "2027-01-05" }, NOW).custom).toBe(false);
    const long = parseWindow({ from: "2020-01-01", to: "2026-11-17" }, NOW);
    expect(long.days).toBe(MAX_CUSTOM_DAYS);
    expect(long.to).toBe("2026-11-17");
    expect(windowLabel(parseWindow({ from: "2026-11-01", to: "2026-11-10" }, NOW))).toBe("1 Nov 2026 to 10 Nov 2026");
  });
});

function input(): AnalyticsInput {
  return {
    users: [
      { id: "a", email: "a@x.dev", createdAt: at(1), signupSource: "instagram/social/launch", locCountry: "IN" },
      { id: "b", email: "B@x.dev", createdAt: at(2), signupSource: null, locCountry: "IN" },
      { id: "c", email: "c@x.dev", createdAt: at(3), signupSource: "referral", locCountry: null },
      { id: "z", email: "z@x.dev", createdAt: at(40), signupSource: null, locCountry: "US" }, // outside a 7 day window
    ],
    connected: ["a", "b", "z"],
    publishers: ["a", "c", "z"], // c published without connecting now: skipped
    paying: ["a"],
    waitlist: [{ email: "b@x.dev", createdAt: at(4) }, { email: "w@x.dev", createdAt: at(1) }, { email: "q@x.dev", createdAt: at(20) }],
    accountEmails: ["a@x.dev", "B@x.dev", "c@x.dev", "z@x.dev"],
    activity: [{ userId: "a", day: key(0) }, { userId: "a", day: key(1) }, { userId: "b", day: key(2) }, { userId: "z", day: key(20) }],
    published: [
      // one post to two platforms on two days: one post, two publishes
      { postId: "p1", platform: "youtube", publishedAt: at(2) },
      { postId: "p1", platform: "x", publishedAt: at(1) },
      { postId: "p2", platform: "youtube", publishedAt: at(1) },
      { postId: "old", platform: "x", publishedAt: at(30) },
    ],
  };
}

describe("buildAnalytics", () => {
  const w = parseWindow({ d: "7" }, NOW);
  const r = buildAnalytics(input(), w, cn, pn, NOW);

  test("totals use the window; posts are counted once however many platforms they reached", () => {
    expect(r.totals).toEqual({ signups: 3, waitlist: 2, active: 2, activeToday: 1, postsPublished: 2, publishes: 3 });
    expect(r.daily).toHaveLength(7);
    const sum = (k: "signups" | "waitlist" | "posts" | "publishes") => r.daily.reduce((t, d) => t + d[k], 0);
    expect([sum("signups"), sum("waitlist"), sum("posts"), sum("publishes")]).toEqual([3, 2, 2, 3]);
    // p1 lands on the day of its first publish (2 days ago), p2 yesterday
    expect(r.daily.find((d) => d.day === key(2))!.posts).toBe(1);
    expect(r.daily.find((d) => d.day === key(1))!.posts).toBe(1);
    expect(r.timezone).toBe("UTC");
  });

  test("funnel: one cohort, nested, skips reported; the waitlist sits outside it", () => {
    expect(r.funnel.map((s) => s.count)).toEqual([3, 2, 1, 1]);
    expect(r.funnel.map((s) => s.dropped)).toEqual([0, 1, 1, 0]);
    expect(r.funnel[2].skipped).toBe(1);
    for (let i = 1; i < r.funnel.length; i++) expect(r.funnel[i].count).toBeLessThanOrEqual(r.funnel[i - 1].count);
    expect(r.funnel.some((s) => s.key === "waitlist")).toBe(false);
    expect(r.waitlist).toEqual({ joined: 2, withAccount: 1, inCohort: 1 });
  });

  test("breakdowns add up to their totals", () => {
    expect(r.sources.reduce((t, s) => t + s.signups, 0)).toBe(r.totals.signups);
    expect(r.countries.reduce((t, c) => t + c.count, 0)).toBe(r.totals.signups);
    expect(r.countries[0]).toEqual({ label: "India", count: 2 });
    expect(r.countries.find((c) => c.label === "Unknown")!.count).toBe(1);
    expect(r.platforms.reduce((t, p) => t + p.count, 0)).toBe(r.totals.publishes);
    expect(r.platforms[0]).toEqual({ label: "YouTube", count: 2 });
  });

  test("a quiet window is all zeros, nothing invented", () => {
    const q = buildAnalytics({ ...input(), users: [], waitlist: [], published: [], activity: [] }, w, cn, pn, NOW);
    expect(q.totals).toEqual({ signups: 0, waitlist: 0, active: 0, activeToday: 0, postsPublished: 0, publishes: 0 });
    expect(q.funnel.every((s) => s.count === 0 && s.pctOfStart === 0)).toBe(true);
    expect(q.sources).toEqual([]);
    expect(q.daily.every((d) => d.signups + d.posts + d.waitlist + d.publishes === 0)).toBe(true);
  });

  test("a custom window changes every panel together", () => {
    const c = buildAnalytics(input(), parseWindow({ from: key(45), to: key(25) }, NOW), cn, pn, NOW);
    expect(c.totals.signups).toBe(1);
    expect(c.totals.waitlist).toBe(0);
    expect(c.totals.publishes).toBe(1);
    expect(c.countries).toEqual([{ label: "United States", count: 1 }]);
    expect(c.daily).toHaveLength(21);
  });
});

describe("topWithOther", () => {
  test("keeps the top rows and folds the rest into one row so the total still holds", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ label: `r${i}`, count: i + 1 }));
    const out = topWithOther(rows, 10, (r) => r.count, (rest) => ({ label: `Other (${rest.length})`, count: rest.reduce((t, r) => t + r.count, 0) }));
    expect(out).toHaveLength(11);
    expect(out[10].label).toBe("Other (4)");
    expect(out.reduce((t, r) => t + r.count, 0)).toBe(rows.reduce((t, r) => t + r.count, 0));
    expect(topWithOther(rows.slice(0, 11), 10, (r) => r.count, () => ({ label: "x", count: 0 }))).toHaveLength(11);
  });
});

describe("analytics page", () => {
  test("shows source, range, timezone and update time; labels PostHog when off; never adds the sources", () => {
    const p = src("app/admin/(panel)/analytics/page.tsx");
    expect(p).toContain('<ReportMeta source="Outlly data" range={windowLabel(win)} tz={r.timezone} updatedAt={r.generatedAt} />');
    expect(p).toContain('custom={src === "outlly"}');
    expect(p).toContain("never added together");
    expect(p).toContain("PostHog is not connected");
    expect(p).toContain("Custom dates work with Outlly data only.");
    expect(p).toContain("<SeriesChart");
    expect(p).not.toContain("outllyReport(");
    const c = src("components/admin/SeriesChart.tsx");
    expect(c).toContain("<AdminChartCard");
    expect(c).toContain("table={table}");
    expect(c).toContain("useSeen");
  });
});
