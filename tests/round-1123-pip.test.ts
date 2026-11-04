import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import * as A from "../lib/pip/analytics-core";
import { followUpPlan, keywordPlan, readPlan, wantsData } from "../lib/pip/plan";
import { numbersBacked } from "../lib/pip/run";
import { ANALYTIC_TOOLS, PIP_TOOLS } from "../lib/pip/types";

const read = (p: string) => readFileSync(p, "utf8");
const tool = (q: string) => keywordPlan(q)?.tool ?? null;
const week = (i: number, views: number, inter: number, posts = 3, days = 7): A.Week => ({
  key: `2026-08-${String(3 + i * 7).padStart(2, "0")}`,
  days,
  views,
  inter,
  posts,
  perDay: views / days,
  er: A.erOf(inter, views),
});
let n = 0;
const post = (p: Partial<A.StatPost> = {}): A.StatPost => ({
  key: `t${++n}`,
  postId: `p${n}`,
  platform: "instagram",
  accountId: "a1",
  title: `Post ${n}`,
  url: null,
  publishedAt: Date.UTC(2026, 9, 1) + n * 3600_000 * 13,
  format: "Video",
  orientation: "Vertical",
  duration: 30,
  captionLen: 80,
  hashtags: [],
  views: 1000,
  likes: 50,
  comments: 5,
  shares: 5,
  hasMetrics: true,
  ...p,
});

describe("1123 statistics", () => {
  test("a steady climb is a real upward trend; noise around a flat line is not", () => {
    const up = A.trendOf([100, 120, 140, 165, 180, 205, 230, 250]);
    expect(up.enough && up.direction).toBe("up");
    expect(up.enough && up.significant).toBe(true);
    const flat = A.trendOf([100, 104, 97, 101, 99, 103, 98, 100]);
    expect(flat.enough && flat.direction).toBe("flat");
    expect(A.trendOf([5, 6, 7]).enough).toBe(false);
    expect(A.trendOf([0, 0, 0, 0, 0]).enough).toBe(false);
  });
  test("Mann-Kendall and Spearman agree with obvious cases", () => {
    expect(A.mannKendall([1, 2, 3, 4, 5, 6, 7, 8])!.p).toBeLessThan(0.01);
    expect(A.spearman([1, 2, 3, 4, 5, 6], [10, 20, 30, 40, 50, 60])!).toBeCloseTo(1, 6);
    expect(A.spearman([1, 2, 3, 4, 5, 6], [60, 50, 40, 30, 20, 10])!).toBeCloseTo(-1, 6);
    // Too few pairs to say anything.
    expect(A.spearman([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBeNull();
  });
  test("a spike is flagged, ordinary days are not", () => {
    const v = [100, 110, 95, 105, 98, 102, 900, 101];
    const a = A.anomaliesOf(v, v.map((_, i) => `d${i}`));
    expect(a.length).toBe(1);
    expect(a[0]).toMatchObject({ label: "d6", kind: "spike" });
    expect(A.anomaliesOf([1, 2, 3], ["a", "b", "c"])).toEqual([]);
    // Mostly-zero series: a zero is not a "dip".
    expect(A.anomaliesOf([0, 0, 0, 0, 0, 0, 0], ["a", "b", "c", "d", "e", "f", "g"]).filter((x) => x.kind === "dip")).toEqual([]);
  });
  test("engagement rate and change are honest about zeros", () => {
    expect(A.erOf(10, 0)).toBeNull();
    expect(A.erOf(5, 100)).toBe(5);
    expect(A.fmtRate(null)).toBe("Not available");
    expect(A.changePct(5, 0)).toBeNull();
    expect(A.median([3, 1, 2])).toBe(2);
  });
});

describe("1123 forecasts are estimates with a band, and refuse thin history", () => {
  test("needs six full weeks", () => {
    const five = [0, 1, 2, 3, 4].map((i) => week(i, 7000, 300));
    expect(A.forecastOf(five, 30)).toBeNull();
    const partial = [...five, week(5, 1000, 50, 1, 3)];
    expect(A.forecastOf(partial, 30)).toBeNull();
  });
  test("a flat 1000 views a day projects about 30,000 over 30 days, inside its own band", () => {
    const ws = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => week(i, 7000 + (i % 2 ? 70 : -70), 300));
    const f = A.forecastOf(ws, 30)!;
    expect(f.weeksUsed).toBe(8);
    expect(f.total).toBeGreaterThan(28_000);
    expect(f.total).toBeLessThan(32_000);
    expect(f.low).toBeLessThanOrEqual(f.total);
    expect(f.high).toBeGreaterThanOrEqual(f.total);
  });
  test("the per-week pieces cover exactly the asked days and add up to the headline", () => {
    const ws = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => week(i, 7000 + i * 350, 300));
    for (const days of [7, 30, 90]) {
      const f = A.forecastOf(ws, days)!;
      expect(f.chunks.reduce((s, c) => s + c.days, 0)).toBe(days);
      expect(Math.abs(f.chunks.reduce((s, c) => s + c.total, 0) - f.total)).toBeLessThan(1e-6);
    }
    expect(A.forecastOf(ws, 30)!.chunks.map((c) => c.days)).toEqual([7, 7, 7, 7, 2]);
  });
  test("a falling line never forecasts negative views", () => {
    const ws = [0, 1, 2, 3, 4, 5].map((i) => week(i, Math.max(0, 7000 - i * 1400), 100));
    const f = A.forecastOf(ws, 60)!;
    expect(f.total).toBeGreaterThanOrEqual(0);
    expect(f.low).toBeGreaterThanOrEqual(0);
  });
});

describe("1123 consistency, segments and best times", () => {
  const DAY = A.DAY_MS;
  const now = Date.UTC(2026, 10, 1);
  test("posting every week is consistent; long gaps are irregular", () => {
    const ws = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => week(i, 7000, 300, 3));
    const times = Array.from({ length: 24 }, (_, i) => now - (24 - i) * 2.3 * DAY);
    expect(A.consistencyOf(ws, times, now).verdict).toBe("Very consistent");
    const gappy = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => week(i, 7000, 300, i % 3 === 0 ? 4 : 0));
    const c = A.consistencyOf(gappy, [now - 50 * DAY, now - 30 * DAY, now - 9 * DAY], now);
    expect(c.verdict).toBe("Irregular");
    expect(c.longestGapDays).toBe(21);
    expect(c.daysSinceLast).toBe(9);
    expect(A.consistencyOf(ws, [now - DAY], now).verdict).toBe("Not enough posts");
  });
  test("relative views compare each post with its own platform's usual", () => {
    const rows = A.relative([post({ platform: "youtube", views: 10_000 }), post({ platform: "youtube", views: 20_000 }), post({ platform: "x", views: 100 }), post({ platform: "x", views: 300 })]);
    const x = rows.find((r) => r.p.platform === "x" && r.p.views === 300)!;
    const yt = rows.find((r) => r.p.platform === "youtube" && r.p.views === 20_000)!;
    // 300 on X is a bigger win against X's usual than 20,000 is against YouTube's.
    expect(x.rel).toBeGreaterThan(yt.rel);
    expect(A.relative([post({ hasMetrics: false })])).toEqual([]);
  });
  test("a platform with a usual of 0 views gets no made-up multiple", () => {
    const rows = A.relative([post({ platform: "x", views: 0 }), post({ platform: "x", views: 0 }), post({ platform: "x", views: 40 }), post({ platform: "youtube", views: 500 })]);
    expect(rows.every((r) => r.p.platform === "youtube")).toBe(true);
    expect(rows[0].rel).toBe(1);
  });
  test("high reach, low interaction posts land in their own quadrant; below six posts there is no split", () => {
    const xs = [
      post({ views: 5000, likes: 10, comments: 0, shares: 0 }),
      post({ views: 4000, likes: 400, comments: 40, shares: 40 }),
      post({ views: 800, likes: 120, comments: 10, shares: 10 }),
      post({ views: 700, likes: 5, comments: 0, shares: 0 }),
      post({ views: 1000, likes: 60, comments: 5, shares: 5 }),
      post({ views: 1200, likes: 40, comments: 2, shares: 2 }),
    ];
    const q = A.quadrants(A.relative(xs))!;
    expect(q.highReachLowInteraction.map((r) => r.p.views)).toContain(5000);
    expect(q.stars.map((r) => r.p.views)).toContain(4000);
    expect(A.quadrants(A.relative(xs.slice(0, 5)))).toBeNull();
  });
  test("best times need at least ten posts", () => {
    const few = A.relative(Array.from({ length: 9 }, () => post()));
    expect(A.bestTimesOf(few, "Asia/Kolkata").enough).toBe(false);
    const many = A.relative(Array.from({ length: 30 }, (_, i) => post({ views: 500 + i * 37 })));
    const t = A.bestTimesOf(many, "Asia/Kolkata");
    expect(t.enough).toBe(true);
    if (t.enough) for (const b of t.blocks) expect(A.BLOCKS).toContain(b.label);
  });
  test("caption, hashtag and format buckets", () => {
    expect(A.captionBucket(0)).toBe("No caption");
    expect(A.hashtagBucket(2)).toBe("1 to 3 hashtags");
    expect(A.hashtagsIn("New drop #Reels #reels #India_2026")).toEqual(["#reels", "#india_2026"]);
    expect(A.orientationOf(1080, 1920)).toBe("Vertical");
    expect(A.orientationOf(null, 1920)).toBeNull();
  });
});

describe("1123 nudges are rare and carry their numbers", () => {
  const ws = [0, 1, 2, 3, 4, 5].map((i) => week(i, 7000, 300));
  test("nothing to say means no nudge", () => {
    expect(A.insightsFrom({ weeks: ws, postsLast14: 6, postsPrev28: 12, scheduledNoCaption: 0, formats: [] })).toEqual([]);
  });
  test("slower posting and empty captions are flagged with evidence, three at most", () => {
    const falling = [0, 1, 2, 3].map((i) => week(i, 7000, 700 - i * 150));
    const out = A.insightsFrom({ weeks: falling, postsLast14: 1, postsPrev28: 12, scheduledNoCaption: 2, formats: [] });
    expect(out.length).toBeLessThanOrEqual(3);
    expect(out.map((x) => x.id.split("-")[0])).toEqual(expect.arrayContaining(["er", "freq", "nocap"]));
    for (const x of out) {
      expect(x.evidence).toMatch(/\d/);
      expect(x.ask.length).toBeGreaterThan(5);
      // Every nudge's follow-up question must reach a real lookup.
      expect(keywordPlan(x.ask)).not.toBeNull();
    }
  });
});

describe("1123 routing: the brief's example questions reach the right lookup", () => {
  const cases: [string, string | null][] = [
    // basic
    ["How many views did I get this week?", "overview"],
    ["views this week", "overview"],
    ["How many posts did I publish this month?", "posts"],
    ["Which platform has the most followers?", "compare_platforms"],
    ["How many posts do I have scheduled?", "posts"],
    ["What was my engagement rate yesterday?", "overview"],
    // intermediate
    ["What was my best performing post this month?", "top_posts"],
    ["Compare Instagram and YouTube over the last 30 days", "compare_platforms"],
    ["Instagram vs YouTube this month", "compare_platforms"],
    ["Which content type performs best for me?", "formats"],
    ["Which post got the most shares?", "overview"],
    ["Am I consistent?", "consistency"],
    ["How did my followers change over the last 30 days?", "engagement"],
    // advanced
    ["Analyze my performance over the last 90 days", "report"],
    ["What patterns do my top posts share?", "formats"],
    ["Which formats work best for me?", "formats"],
    ["Which of my posts have high reach but low engagement?", "segments"],
    ["Does posting more often get me more views?", "consistency"],
    ["Which of my content is underperforming?", "segments"],
    ["What should I post next month?", "report"],
    // expert
    ["Give me a full cross-platform performance report", "report"],
    ["Are there statistically meaningful trends in my views?", "trend"],
    ["Compare this month with last month", "overview"],
    ["Any anomalies in my views lately?", "trend"],
    ["Forecast my views for next month", "forecast"],
    ["When should I post?", "best_times"],
    ["What's the best time to post for me?", "best_times"],
    ["Show my upcoming scheduled posts", "schedule"],
    ["Which accounts are connected?", null],
    ["Show my connected accounts", "account"],
    ["How many AI requests do I have left?", "account"],
    ["Why did my post do so well?", "post_insight"],
  ];
  for (const [q, want] of cases) test(q, () => expect(tool(q)).toBe(want));

  test("platform words and comparisons are read", () => {
    expect(keywordPlan("How many views did I get on YouTube this week?")!.args.platform).toBe("youtube");
    expect(keywordPlan("Compare my views this month vs last month")!.args.compare).toBe(true);
  });
});

describe("1123 routing: older questions keep their old answers", () => {
  const keep: [string, string | null][] = [
    ["my engagement this month", "engagement"],
    ["what are my trending posts this week", "top_posts"],
    ["my top 5 instagram posts", "top_posts"],
    ["show my scheduled posts", "posts"],
    ["summarise my activity", "activity"],
    ["show my invoices from last month", "invoices"],
    ["my failed payments", "payments"],
  ];
  for (const [q, want] of keep) test(q, () => expect(tool(q)).toBe(want));

  test("help questions stay with the help centre", () => {
    for (const q of ["Why did my post fail?", "Why was I charged twice?", "Why did my payment fail?", "How do I connect Instagram?", "How do I post to Instagram and YouTube at once?", "How do I cancel my plan?"])
      expect(wantsData(q)).toBe(false);
  });
  test("change requests never become lookups", () => {
    expect(keywordPlan("delete my scheduled posts")).toBeNull();
    expect(keywordPlan("reschedule my next post")).toBeNull();
  });
});

describe("1123 follow-ups remember the post and the range", () => {
  const card = { tool: "top_posts" as const, period: "this month", focus: "acct1:post9" };
  test("'why did it do better?' means the post on the last card", () => {
    expect(followUpPlan("why did it perform better?", card, false)).toEqual({ tool: "post_insight", args: { focus: "acct1:post9", period: null } });
    expect(followUpPlan("why?", card, false)?.args.focus).toBe("acct1:post9");
    expect(followUpPlan("and why that one?", card, false)?.tool).toBe("post_insight");
  });
  test("a new question is not hijacked by the last post", () => {
    expect(followUpPlan("why is my engagement dropping?", card, false)).toBeNull();
    expect(tool("why is my engagement dropping?")).toBe("trend");
    expect(followUpPlan("why did it fail?", card, false)).toBeNull();
  });
  test("without a post, 'why' explains the best one in the same range", () => {
    expect(followUpPlan("why did it do better?", { tool: "overview", period: "last 30 days" }, false)).toEqual({ tool: "post_insight", args: { period: "last 30 days" } });
  });
  test("'and on YouTube?' reruns the same question for one platform", () => {
    expect(followUpPlan("and on YouTube?", { tool: "overview", period: "last 30 days" }, false)).toEqual({ tool: "overview", args: { period: "last 30 days", platform: "youtube" } });
    expect(followUpPlan("and in August?", { tool: "trend", period: "last 90 days" }, true)?.tool).toBe("trend");
  });
  test("the model can name the new tools but nothing else", () => {
    expect(readPlan({ tool: "forecast", period: "next month" })?.tool).toBe("forecast");
    expect(readPlan({ tool: "run_sql" })).toBeNull();
    expect(PIP_TOOLS.length).toBe(25);
    for (const t of ANALYTIC_TOOLS) expect(PIP_TOOLS).toContain(t);
  });
});

describe("1123 summaries", () => {
  test("numbers must come from the facts or the range label", () => {
    expect(numbersBacked("You got 12,400 views, up 8%.", ["Views: 12,400", "Change: +8%"])).toBe(true);
    expect(numbersBacked("You'll get 50,000 views.", ["Views: 12,400"])).toBe(false);
  });
  test("the summariser refuses causal claims and keeps estimates labelled", () => {
    const run = read("lib/pip/run.ts");
    expect(run).toMatch(/caused\|because of/);
    expect(run).toMatch(/These are estimates: say so/);
  });
});

describe("1123 wiring: isolation, permissions, storage", () => {
  const ta = read("lib/pip/tools-analytics.ts");
  const route = read("app/api/support/chat/route.ts");
  const ins = read("app/api/pip/insights/route.ts");
  const widget = read("components/support/ChatWidget.tsx");
  const card = read("components/support/PipDataCard.tsx");
  test("every analytics query is pinned to the session owner and the teammate's scope", () => {
    expect(ta).toMatch(/^import "server-only";/m);
    expect(ta).toContain("userId: ctx.ownerId");
    expect(ta).toContain("ctx.scope");
    // The owner id never comes from the message or the model's plan.
    expect(ta).not.toMatch(/ownerId:\s*(a|args|plan)\./);
    expect(ta).not.toMatch(/\$queryRaw|\$executeRaw/);
    // The cache key carries owner and scope, so two people never share a cached answer.
    expect(ta).toMatch(/pip:stats:\$\{ctx\.ownerId\}:\$\{scopeKey\}/);
  });
  test("a focused post id from the browser is ownership-checked before use", () => {
    expect(ta).toMatch(/targetScope/);
  });
  test("billing stays owner only for teammates", () => {
    const tools = read("lib/pip/tools.ts");
    expect(tools).toMatch(/ctx\.actorId && BILLING_TOOLS\.includes\(tool\)/);
  });
  test("the chat route accepts a focus but still takes the user from the session", () => {
    expect(route).toMatch(/focus: z\.string\(\)\.max\(200\)\.nullable\(\)\.optional\(\)/);
    expect(route).toMatch(/runPip\(\{ id: me\.id/);
  });
  test("nudges are signed-in only and never cached", () => {
    expect(ins).toMatch(/if \(!me\) return json\(\{ items: \[\] \}\)/);
    expect(ins).toContain("no-store");
    expect(ins).toContain("scope: me.scope");
  });
  test("records, charts and nudge text stay out of sessionStorage", () => {
    expect(widget).toMatch(/map\(\(\{ data: _d, \.\.\.m \}\) => m\)/);
    expect(widget).not.toMatch(/sessionStorage\.setItem\([^)]*insights/);
    expect(widget).toContain("insight:${n.id}");
    expect(widget).toContain("focus: lastData.ask.focus");
  });
  test("estimates are badged; Pip answers carry no charts, number cards or tables (user rule)", () => {
    expect(card).toContain("Estimate");
    expect(card).not.toMatch(/chart/i);
    expect(card).not.toMatch(/<table|r\.cards|r\.totals|pd-kpi/);
    // A list question still names its top items, each with its own link, and points to the download for the rest.
    expect(card).toContain("const TOP = 5");
    expect(card).toContain("ANALYTIC_TOOLS.includes(r.tool) ? [] : r.rows.slice(0, TOP)");
    expect(card).toContain("Download the full list below.");
    expect(read("app/globals.css")).not.toMatch(/\.pd-(table|kpi|cards|total)\b/);
    expect(read("lib/pip/types.ts")).not.toMatch(/charts\?:/);
    expect(read("lib/pip/tools-analytics.ts")).not.toMatch(/\.charts\b/);
    expect(existsSync("components/support/PipChartView.tsx")).toBe(false);
  });
});

describe("1123 browser check fixes", () => {
  const ta = read("lib/pip/tools-analytics.ts");
  test("'Instagram vs YouTube' compares just those two", async () => {
    const { platformsNamed } = await import("../lib/pip/plan");
    expect(platformsNamed("Compare Instagram and YouTube over the last 30 days")).toEqual(["instagram", "youtube"]);
    expect(platformsNamed("which platform has the most followers")).toEqual([]);
    expect(ta).toContain("platformsNamed(ctx.message)");
  });
  test("a forecast card is only an estimate when it holds a projection", () => {
    const i = ta.indexOf("export const forecast");
    const body = ta.slice(i, ta.indexOf("export const", i + 10));
    expect(body.indexOf("r.estimate = true")).toBeGreaterThan(body.indexOf("if (!f)"));
  });
  test("an unknown post id is said out loud, not quietly swapped", () => {
    expect(ta).toContain("I couldn't find that post among yours");
  });
  test("no 'only 0 other posts' wording", () => {
    expect(ta).toContain("There are no other posts on the same platform");
  });
  test("forecast rows reuse the headline's projection; live posts without a usable date are skipped", () => {
    expect(ta).toContain("f.chunks.map((c) => Math.round(c.total))");
    expect(ta).not.toContain("lr.slope * (full.length + i)");
    expect(ta).toContain("Number.isFinite(Date.parse(x.publishedAt))");
    expect(ta).toContain("didn't send a usable publish date");
  });
});
