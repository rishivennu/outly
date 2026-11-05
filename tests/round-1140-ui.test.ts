/**
 * 1140 analytics hub, read from the source: a custom range inside the plan window, a metric switcher with
 * an honest empty state, accounts that say how fresh they are, a standout list that never invents a number,
 * not-connected rows that offer the fix, the Pip AI rename, and a method anyone can read.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const view = src("components/analytics/AnalyticsView.tsx");
const live = src("components/analytics/LiveStrip.tsx");
const standouts = src("components/analytics/Standouts.tsx");
const compare = src("components/analytics/Compare.tsx");
const extras = src("components/analytics/ProfileExtras.tsx");
const review = src("components/analytics/ProfileReview.tsx");
const dash = src("components/analytics/PlatformDashboardView.tsx");

describe("overview: range and chart", () => {
  test("a custom range is offered and is bounded by the plan's history", () => {
    expect(view).toContain("Custom");
    expect(view).toContain("<CustomRange");
    expect(view).toContain("dayKey(Date.now() - (maxDays - 1) * DAY_MS)");
    expect(view).toContain('min={earliest}');
    // The server has the last word on the window; the page only keeps dates it honoured.
    expect(view).toContain("setCustom(next.window.custom ? c : null)");
    expect(view).toContain("&from=${c.from}&to=${c.to}");
  });

  test("the page says exactly which days it covers", () => {
    expect(view).toContain("rangeLabel(data.window)");
    expect(view).toContain("data.window.clamped");
  });

  test("three metrics, and followers say so when there is no history", () => {
    for (const label of ["Views", "Engagement", "Followers"]) expect(view).toContain(`label: "${label}"`);
    expect(view).toContain('aria-label="Chart metric"');
    expect(view).toContain("No follower history yet.");
    // A day with no views has no engagement rate, so the line must break rather than dip to zero.
    expect(view).toContain('connectNulls={false}');
    expect(view).not.toContain("connectNulls={true}");
  });

  test("the chart still draws the platforms in the data, and the switcher did not break it", () => {
    const chart = view.slice(view.indexOf('<h2 id="trend"'), view.indexOf("</AreaChart>"));
    expect(chart).toContain("drawn.map(");
    expect(chart).not.toContain("live.map(");
  });
});

describe("overview: honest numbers", () => {
  test("the KPI cards come from what the platforms report, not from a fixed list", () => {
    expect(view).toContain("kpiMetrics(");
    expect(view).toContain("combinedNote(");
    expect(view).toContain("Not reported by");
    // No hand-written five-card list any more: that is what showed shares as 0 on Facebook.
    expect(view).not.toContain('{ k: "Likes", v: data.totals.likes }');
  });

  test("the headline is chosen from the facts", () => {
    expect(view).toContain("buildHeadline({");
    expect(view).toContain("head.variant");
    expect(view).toContain("views {range.phrase}");
  });

  test("where it landed links through, and a platform you have not linked offers Connect", () => {
    expect(view).toContain("href={`/analytics/${b.platform}`}");
    expect(view).toContain("Not connected");
    expect(view).toContain('<Link href="/accounts"');
    expect(view).toContain("const offline = data.byPlatform.filter((b) => !b.connected && b.views <= 0);");
  });

  test("the standout list ranks real numbers and says when one is missing", () => {
    expect(view).toContain("<Standouts posts={data.standouts}");
    expect(standouts).toContain("rankStandouts(");
    expect(standouts).toContain('aria-label="Filter by platform"');
    expect(standouts).toContain('"Not available"');
    expect(standouts).toContain("vsAverage(");
  });

  test("comparing accounts only offers metrics that mean the same thing on each", () => {
    expect(compare).toContain("compareValue(");
    expect(compare).toMatch(/counts|its own way/);
    expect(compare).not.toContain('k: "followers"');
  });
});

describe("accounts right now", () => {
  test("one tile per account, with how fresh it is, a refresh and a way to reconnect", () => {
    expect(live).toContain("/api/analytics/accounts");
    expect(live).toContain("freshness(");
    expect(live).toContain("Reconnect");
    expect(live).toContain("Connect");
    expect(live).toContain("aria-label={`Refresh");
    // The tiles are per account, so two Instagram accounts are two tiles.
    expect(live).toContain("accountId");
  });
});

describe("per-profile dashboards", () => {
  test("several accounts on one platform can be switched between, one at a time", () => {
    expect(extras).toContain("accounts.length < 2");
    expect(extras).toContain("ProfileAccounts");
    expect(dash).toContain("/api/analytics/profile?");
    expect(dash).toContain("<ProfileAccounts");
    expect(dash).toContain("focusAccount");
  });

  test("formats and timing come from the posts the platform returned, in the creator's timezone", () => {
    expect(extras).toContain("x.formats");
    expect(extras).toContain("What you post here");
    expect(extras).toContain("When you post");
    expect(extras).toContain("{x.timezone}");
    expect(extras).toContain("No views reported");
  });

  test("audience details nobody authorised are not shown at all", () => {
    for (const word of ["age range", "gender", "Age", "Gender"]) expect(extras).not.toContain(word);
  });
});

describe("profile review", () => {
  test("the button says Pip AI and no Gemini is left in the copy", () => {
    expect(review).toContain("Analyse with Pip AI");
    expect(review).not.toContain("Gemini");
  });

  test("the method is written out, not implied", () => {
    expect(review).toContain("How this is worked out");
    expect(review).toContain("never added together across platforms");
    expect(review).toContain("left out of the average rather than counted as zero");
  });
});

describe("reports", () => {
  const route = src("app/api/reports/route.ts");
  const report = src("lib/analytics/report.ts");
  const client = src("lib/reports/client-report.ts");

  test("a custom range is exported as the window on screen, still inside the plan", () => {
    expect(route).toContain("resolveRange({ days, from: q.get(\"from\"), to: q.get(\"to\") }");
    expect(route).toContain("buildRangeReport");
    expect(route).toContain("reportStamp(range)");
    expect(report).toContain("capturedAt: { gte: since, lt: until }");
  });

  test("the file carries the range, the profile, the key metrics, the comparison and when it was made", () => {
    for (const bit of ["Accounts", "Period", "Generated", "Totals", "Platform", "Account", "Post"]) expect(client).toContain(`"${bit}"`);
    expect(client).toContain("Views, previous period");
    expect(client).toContain("By account");
    expect(client).toContain("By platform");
  });

  test("the analytics page hands its dates to the export buttons", () => {
    expect(view).toContain("from={custom?.from ?? null} to={custom?.to ?? null}");
    expect(src("components/analytics/AccountDrill.tsx")).toContain("${from && to ? `&from=${from}&to=${to}` : \"\"}");
  });
});

describe("accessibility and house style", () => {
  const files = [view, live, standouts, compare, extras];
  test("no emoji and no em dashes in the new analytics copy", () => {
    for (const f of files) {
      expect(f).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(f).not.toContain("\u2014");
    }
  });

  test("every new control is reachable and big enough to tap", () => {
    for (const f of files) {
      const buttons = f.split("<button").slice(1).map((s) => s.slice(0, 700));
      expect(buttons.length).toBeGreaterThan(0);
      // Either a height class on the tag, or a shared pill class that carries one.
      for (const b of buttons) expect(b).toMatch(/h-11|min-h-11|h-9|h-10|cn\(pill/);
      expect(f).toContain("focus-visible:outline");
      expect(f).not.toContain("outline:none");
    }
  });

  test("motion respects a reduced-motion setting", () => {
    for (const f of [view, standouts, extras]) expect(f).toContain("useReducedMotion");
  });
});
