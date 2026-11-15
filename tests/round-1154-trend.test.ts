/**
 * 1154 mobile audit: comparisons only when both periods were tracked (no fake -100%), insights only with enough
 * data and naming their metric, headlines that say the range they cover, and the phone Home, Analytics, drawer
 * and Pip changes that go with them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { bestWeekday, fairPrevious, leadPlatform, pointsTrend, trend, TREND_LONG, TREND_SHORT } from "../lib/analytics/trend";
import { headline, rangePhrase } from "../lib/analytics/core";

const src = (p: string) => readFileSync(p, "utf8");
const DAY = 864e5;
const now = Date.parse("2026-11-15T00:00:00Z");
const p7 = { curStart: now - 6 * DAY, prevStart: now - 13 * DAY, curEnd: now };
const tracked = (since: number, rows = 5, lastSync: number | null = now) => ({ trackedSince: since, rows, lastSync });

describe("trend: a fair comparison or a reason", () => {
  test("nothing on either side is no data, not 0%", () => {
    expect(trend(0, 0, p7).kind).toBe("none");
  });
  test("never counted and nothing on either side: no data", () => {
    expect(trend(0, 0, p7, { trackedSince: null, rows: 0, lastSync: null }).kind).toBe("none");
  });
  test("counting started inside the period before: no history, never a big rise", () => {
    expect(trend(500, 20, p7, tracked(p7.prevStart + 3 * DAY)).kind).toBe("history");
  });
  test("tracked all along, nothing synced yet this period: not synced, never -100%", () => {
    expect(trend(0, 400, p7, tracked(now - 60 * DAY, 0, p7.curStart - DAY)).kind).toBe("pending");
  });
  test("synced this period and really zero is a real change", () => {
    const t = trend(0, 400, p7, tracked(now - 60 * DAY, 3, now));
    expect(t).toEqual({ kind: "change", pct: -100 });
  });
  test("nothing before: new", () => {
    expect(trend(30, 0, p7, tracked(now - 60 * DAY)).kind).toBe("new");
  });
  test("a real change", () => {
    expect(trend(150, 100, p7, tracked(now - 60 * DAY))).toEqual({ kind: "change", pct: 50 });
  });
  test("Outlly's own counts (posts) need no coverage", () => {
    expect(trend(3, 2, p7)).toEqual({ kind: "change", pct: 50 });
  });
  test("engagement moves in points, and only with views behind it", () => {
    expect(pointsTrend(5, 4, 100, 100, p7, tracked(now - 60 * DAY))).toEqual({ kind: "change", pct: 1 });
    expect(pointsTrend(0, 4, 0, 100, p7, tracked(now - 60 * DAY, 3)).kind).toBe("none");
  });
  test("numbers but the first-row lookup failed: unknown history, not no data", () => {
    expect(trend(500, 200, p7, { trackedSince: null, rows: 4, lastSync: now }).kind).toBe("history");
  });
  test("a sync that stalled days ago: incomplete, never a drop", () => {
    expect(trend(120, 400, p7, tracked(now - 60 * DAY, 2, now - 4 * DAY), now).kind).toBe("stale");
    // A past range that the sync covered to its end is complete however long ago the last sync ran.
    const past = { curStart: now - 40 * DAY, prevStart: now - 47 * DAY, curEnd: now - 33 * DAY };
    expect(trend(120, 400, past, tracked(now - 90 * DAY, 2, now - 30 * DAY), now)).toEqual({ kind: "change", pct: -70 });
  });
  test("downloads print the earlier number only when the comparison is fair", () => {
    expect(fairPrevious(150, 100, p7, tracked(now - 60 * DAY))).toEqual({ previousViews: 100, compareNote: null });
    expect(fairPrevious(500, 20, p7, tracked(p7.prevStart + 3 * DAY))).toEqual({ previousViews: null, compareNote: TREND_LONG.history });
  });
  test("every reason has a short badge and a sentence, no em dashes", () => {
    for (const k of ["new", "none", "history", "pending", "stale"] as const) {
      expect(TREND_SHORT[k].length).toBeLessThanOrEqual(10);
      expect(TREND_LONG[k]).not.toContain("\u2014");
    }
  });
});

describe("insights need enough data", () => {
  const series = (f: (d: Date) => number, n = 28) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(now - (n - 1 - i) * DAY);
      return { date: d.toISOString().slice(0, 10), views: f(d) };
    });
  test("a short range has no best day", () => {
    expect(bestWeekday(series(() => 100, 10))).toBeNull();
  });
  test("one spike is not a pattern", () => {
    let once = true;
    expect(bestWeekday(series((d) => (d.getUTCDay() === 2 && once ? ((once = false), 5000) : 20)))).toBeNull();
  });
  test("a flat month has no best day", () => {
    expect(bestWeekday(series(() => 100))).toBeNull();
  });
  test("a real weekly pattern names its day and lift", () => {
    const b = bestWeekday(series((d) => (d.getUTCDay() === 2 ? 600 : 100)));
    expect(b?.day).toBe("Tuesday");
    expect(b!.lift).toBeGreaterThan(1.25);
  });
  test("a lead platform needs two platforms and a clear lead", () => {
    expect(leadPlatform([{ platform: "instagram", views: 900 }])).toBeNull();
    expect(leadPlatform([{ platform: "instagram", views: 30 }, { platform: "youtube", views: 5 }])).toBeNull();
    expect(leadPlatform([{ platform: "instagram", views: 520 }, { platform: "youtube", views: 480 }])).toBeNull();
    expect(leadPlatform([{ platform: "instagram", views: 800 }, { platform: "youtube", views: 200 }])).toEqual({ row: { platform: "instagram", views: 800 }, share: 80 });
    // Never "100%" while another platform has views.
    expect(leadPlatform([{ platform: "instagram", views: 9990 }, { platform: "youtube", views: 4 }])?.share).toBe(99);
  });
});

describe("headlines say the range they cover", () => {
  const w = (days: number, custom = false) => ({ from: new Date(now - (days - 1) * DAY), to: new Date(now), days, custom });
  test("presets", () => {
    expect(rangePhrase(w(7))).toBe("in the last 7 days");
    expect(rangePhrase(w(30))).toBe("in the last 30 days");
    expect(rangePhrase(w(90))).toBe("in the last 90 days");
    expect(rangePhrase(w(180))).toBe("in the last 6 months");
    expect(rangePhrase(w(365))).toBe("in the last year");
    expect(rangePhrase(w(730))).toBe("in the last 2 years");
    for (const d of [7, 30, 90]) expect(rangePhrase(w(d))).not.toMatch(/this (week|month)/);
  });
  test("a custom range names its dates", () => {
    expect(rangePhrase(w(10, true))).toMatch(/^from .*2026/);
  });
  test("notes name their metric, and say why there is no comparison", () => {
    const base = { views: 1000, previousViews: 0, followerGain: null, bestDay: null, posts: 4, rangePhrase: "in the last 30 days", accountName: null };
    const h = headline({ ...base, bestPlatform: { platform: "instagram", name: "Instagram", share: 80 }, bestDay: "Tuesday", bestDayLift: 2.4, viewsTrend: { kind: "history" } });
    expect(h.after).toBe(" views in the last 30 days.");
    expect(h.notes).toContain("No comparison yet: Outlly started counting recently.");
    expect(h.notes).toContain("Instagram brought 80% of your views.");
    expect(h.notes).toContain("Tuesdays bring you the most views, 2.4 times a usual day.");
    expect(h.notes.some((n) => n.includes("%") && n.includes("period before"))).toBe(false);
  });
});

describe("phone screens (source)", () => {
  const view = src("components/analytics/AnalyticsView.tsx");
  const pulse = src("components/dashboard/PulseHome.tsx");
  const drawer = src("components/shell/MobileDrawer.tsx");
  const drill = src("components/analytics/AccountDrill.tsx");
  const css = src("app/globals.css");
  test("Analytics: no calendar words, range from the window, fair comparison", () => {
    expect(view).not.toContain("this month");
    expect(view).not.toContain("this week");
    expect(view).toContain("rangePhrase(data.window)");
    expect(view).toContain("trend(data.totals.views, data.previous.views, data.periods, data.coverage)");
    expect(view).toContain("leadPlatform(data.byPlatform)");
    expect(view).toContain('aria-label="Time range"');
    expect(view).toMatch(/edge-fade scrollbar-none[^"]*overflow-x-auto/);
  });
  test("Download: fetched with progress and a shown error, CSV and PDF only", () => {
    expect(drill).toContain("res.body.getReader()");
    expect(drill).toContain('role={job && "error" in job ? "alert" : "status"}');
    expect(drill).toContain("Try again");
    expect(drill.match(/get\("(pdf|csv)"\)/g)?.length).toBe(2);
  });
  test("Home: badges in words, two cards a row, the tab row fades and follows", () => {
    expect(pulse).not.toMatch(/\bdelta\(/);
    expect(pulse).toContain("TREND_SHORT[t.kind]");
    expect(pulse).toContain("grid grid-cols-2 gap-3");
    expect(pulse).toContain("useEdgeFade(key, tabsS.box)");
    expect(css).toContain('.edge-fade[data-fade="end"]');
  });
  test("Classic / Analytics shows the pick at once and swaps without a page load", () => {
    const sw = src("components/home/DashboardSwitch.tsx");
    expect(sw).toContain("setPicked(style)");
    expect(sw).toContain("start(() => router.refresh())");
    expect(sw).not.toContain("location.reload");
  });
  test("drawer: profile link, three sections, labelled theme, Log out outside the list", () => {
    expect(drawer).toContain('<WhoCard size={44} href="/settings?tab=profile"');
    for (const t of ['title="Workspace"', 'title="My account"', '"Support & billing"']) expect(drawer).toContain(t);
    expect(drawer).toContain("<ThemeToggle plain");
    expect(drawer).not.toContain("<ThemeToggle compact");
    expect(drawer.lastIndexOf("Log out")).toBeGreaterThan(drawer.lastIndexOf("Appearance"));
    expect(drawer).toContain("w-[min(85vw,360px)]");
    expect(drawer).toContain("h-12");
    expect(drawer).toContain("panel.current?.focus({ preventScroll: true })");
  });
  test("Pip tucks with the tab bar and the page makes room for it", () => {
    expect(src("components/support/ChatWidget.tsx")).toContain("pc pc-dock fixed");
    expect(src("components/shell/Nav.tsx")).toContain('toggleAttribute("data-tabs-tucked", hidden)');
    expect(css).toContain("html[data-tabs-tucked] .pc-dock:not([data-open])");
    expect(css).toContain("html:has(.pc-dock[data-lift]:not(.hidden)) .mmain");
  });
});
