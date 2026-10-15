/** Retention + Growth: the local week, goal streaks, nudges, next steps, churn risk, pause, lead scoring, UTM, CSV. */
import { describe, expect, test } from "bun:test";
import { goalState, nextSteps, nudgeDue, pickRecyclable, riskOf, weekDay, weekStart, weeklyCounts, winbackAllowed, type RiskFacts, type StepFacts } from "../lib/retention/core";
import { isPaused, pausePlan, resumePlan } from "../lib/billing/pause";
import { campaignUrl, fill, firstName, funnel, isSource, leadScore, parseSource, resolveSource, sourceFromParams, toCsv, worstStep } from "../lib/growth/core";

const TZ = "Asia/Kolkata";
const D = 864e5;
// Thursday 15 Oct 2026, 17:30 IST
const thu = new Date("2026-10-15T12:00:00Z");

describe("local week", () => {
  test("weeks start Monday 00:00 in the creator's zone", () => {
    expect(weekStart(thu, TZ).toISOString()).toBe("2026-10-11T18:30:00.000Z");
    expect(weekStart(thu, "UTC").toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
  test("Sunday night in IST is still the same week; Monday 00:10 IST starts a new one", () => {
    const sun = new Date("2026-10-18T18:00:00Z"); // Sun 23:30 IST
    const mon = new Date("2026-10-18T18:40:00Z"); // Mon 00:10 IST
    expect(weekDay(sun, TZ)).toBe(7);
    expect(weekStart(sun, TZ).toISOString()).toBe("2026-10-11T18:30:00.000Z");
    expect(weekDay(mon, TZ)).toBe(1);
    expect(weekStart(mon, TZ).toISOString()).toBe("2026-10-18T18:30:00.000Z");
  });
  test("a bad zone falls back to UTC instead of throwing", () => {
    expect(weekStart(thu, "Not/AZone").toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
  test("weekly counts bucket newest first and ignore the future", () => {
    const c = weeklyCounts([thu, new Date(thu.getTime() - 7 * D), new Date(thu.getTime() - 8 * D), new Date(thu.getTime() + D)], thu, TZ, 4);
    expect(c).toEqual([1, 2, 0, 0]);
  });
});

describe("goal and streak", () => {
  const weeks = (perWeek: number[]) => perWeek.flatMap((n, w) => Array.from({ length: n }, (_, i) => new Date(thu.getTime() - w * 7 * D - i * 36e5)));
  test("this week only counts toward the streak once it's met", () => {
    expect(goalState(weeks([1, 3, 3, 0]), 3, thu, TZ)).toMatchObject({ done: 1, left: 2, met: false, streak: 2 });
    expect(goalState(weeks([3, 3, 3, 0]), 3, thu, TZ)).toMatchObject({ done: 3, left: 0, met: true, streak: 3, progress: 1 });
  });
  test("goal 0 means no goal: no streak, no progress", () => {
    expect(goalState(weeks([5]), 0, thu, TZ)).toMatchObject({ streak: 0, progress: 0, met: false });
  });
  test("days left counts today (Thursday = 4)", () => {
    expect(goalState([], 3, thu, TZ).daysLeft).toBe(4);
  });
});

describe("nudge", () => {
  const fri11 = new Date("2026-10-16T05:30:00Z"); // Fri 11:00 IST
  const fri9 = new Date("2026-10-16T03:00:00Z"); // Fri 08:30 IST
  const u = { postingGoal: 3, nudgeAt: null as Date | null, timezone: TZ };
  test("fires Friday from 10 am local when behind", () => {
    expect(nudgeDue(u, 1, fri11)).toBe(true);
    expect(nudgeDue(u, 1, fri9)).toBe(false);
    expect(nudgeDue(u, 1, thu)).toBe(false);
  });
  test("never when the goal is met, off, or already nudged this week", () => {
    expect(nudgeDue(u, 3, fri11)).toBe(false);
    expect(nudgeDue({ ...u, postingGoal: 0 }, 0, fri11)).toBe(false);
    expect(nudgeDue({ ...u, nudgeAt: new Date("2026-10-13T10:00:00Z") }, 1, fri11)).toBe(false);
    expect(nudgeDue({ ...u, nudgeAt: new Date("2026-10-09T10:00:00Z") }, 1, fri11)).toBe(true);
  });
});

describe("next steps", () => {
  const goal = goalState([], 3, thu, TZ);
  const base: StepFacts = { failed: 0, reconnect: [], expiring: [], connected: 1, published: 4, drafts: [], scheduledThisWeek: 0, goal, ideas: 0, recyclable: null };
  test("broken things come first, and the list is capped", () => {
    const s = nextSteps({ ...base, failed: 2, reconnect: [{ platform: "instagram", name: "Instagram" }], expiring: [{ platform: "youtube", name: "YouTube", days: 3 }], ideas: 2 });
    expect(s.map((x) => x.kind)).toEqual(["failed", "reconnect", "expiring"]);
    expect(s[1].href).toBe("/accounts");
  });
  test("a brand-new creator is told to connect, not to hit a goal", () => {
    expect(nextSteps({ ...base, connected: 0, published: 0 }).map((x) => x.kind)).toEqual(["connect"]);
    expect(nextSteps({ ...base, published: 0 }).map((x) => x.kind)).toEqual(["first_post"]);
  });
  test("goal step accounts for posts already scheduled", () => {
    expect(nextSteps({ ...base, scheduledThisWeek: 1 })[0]).toMatchObject({ kind: "goal", title: "2 more posts to hit this week's goal" });
    expect(nextSteps({ ...base, scheduledThisWeek: 3 }).some((x) => x.kind === "goal")).toBe(false);
  });
  test("no copy uses emoji or em dashes", () => {
    const s = nextSteps({ ...base, failed: 1, drafts: [{ id: "d", title: "Reel" }], ideas: 1, recyclable: { id: "r", title: "Old hit" } }, 10);
    for (const x of s) expect(`${x.title} ${x.body} ${x.action}`).not.toMatch(/[\u2014\u{1F300}-\u{1FAFF}]/u);
  });
});

test("recyclable posts: old enough, with views, best first", () => {
  const p = (id: string, ageDays: number, views: number) => ({ id, views, publishedAt: new Date(thu.getTime() - ageDays * D) });
  expect(pickRecyclable([p("new", 5, 9000), p("a", 30, 100), p("b", 40, 800), p("zero", 60, 0)], thu).map((x) => x.id)).toEqual(["b", "a"]);
});

describe("churn risk", () => {
  const ok: RiskFacts = { paid: false, cancelling: false, paused: false, daysSincePost: 2, daysSinceActive: 1, failed7d: 0, reconnect: 0, postsLast30: 6, postsPrev30: 6 };
  test("a healthy creator is low", () => {
    expect(riskOf(ok)).toEqual({ score: 0, level: "low", reasons: [] });
  });
  test("cancelling and quiet stack up to high, paid weighs more", () => {
    const free = riskOf({ ...ok, cancelling: true, daysSincePost: 30, daysSinceActive: 30 });
    const paid = riskOf({ ...ok, paid: true, cancelling: true, daysSincePost: 30, daysSinceActive: 30 });
    expect(free.reasons).toEqual(["cancelling", "quiet"]);
    expect(free.level).toBe("high");
    expect(paid.score).toBeGreaterThan(free.score);
    expect(paid.score).toBeLessThanOrEqual(100);
  });
  test("quiet uses the more recent of post and visit", () => {
    expect(riskOf({ ...ok, daysSincePost: 40, daysSinceActive: 2 }).reasons).not.toContain("quiet");
  });
  test("never posted only counts after a week", () => {
    expect(riskOf({ ...ok, daysSincePost: null, daysSinceActive: 3 }).reasons).toEqual([]);
    expect(riskOf({ ...ok, daysSincePost: null, daysSinceActive: 9 }).reasons).toEqual(["never_posted"]);
  });
  test("slowing and broken", () => {
    expect(riskOf({ ...ok, postsPrev30: 8, postsLast30: 3, failed7d: 1 }).reasons).toEqual(["slowing", "broken"]);
    expect(riskOf({ ...ok, postsPrev30: 2, postsLast30: 0 }).reasons).not.toContain("slowing");
  });
  test("win-back at most once every 30 days", () => {
    expect(winbackAllowed(null, thu)).toBe(true);
    expect(winbackAllowed(new Date(thu.getTime() - 29 * D), thu)).toBe(false);
    expect(winbackAllowed(new Date(thu.getTime() - 30 * D), thu)).toBe(true);
  });
});

describe("pause instead of cancel", () => {
  const end = new Date(thu.getTime() + 10 * D);
  test("paid days left are kept and pushed past the pause", () => {
    const p = pausePlan(thu, end, 1);
    expect(p.pausedUntil.toISOString()).toBe("2026-11-15T12:00:00.000Z");
    expect(p.daysKept).toBe(10);
    expect(p.periodEnd.getTime()).toBe(p.pausedUntil.getTime() + 10 * D);
  });
  test("31 Jan + 1 month lands on the last day of Feb", () => {
    expect(pausePlan(new Date("2027-01-31T00:00:00Z"), new Date("2027-02-05T00:00:00Z"), 1).pausedUntil.toISOString()).toBe("2027-02-28T00:00:00.000Z");
  });
  test("only 1, 2 or 3 months", () => {
    expect(() => pausePlan(thu, end, 4)).toThrow();
  });
  test("resuming early gives the unused pause back", () => {
    const p = pausePlan(thu, end, 2);
    const later = new Date(thu.getTime() + 5 * D);
    const r = resumePlan(later, p.pausedUntil, p.periodEnd);
    expect(r.periodEnd.getTime()).toBe(later.getTime() + 10 * D);
    expect(isPaused({ pausedUntil: p.pausedUntil }, later)).toBe(true);
    expect(isPaused({ pausedUntil: null }, later)).toBe(false);
  });
});

describe("growth: campaign links", () => {
  test("utm params become a clean first-touch source", () => {
    expect(sourceFromParams(new URLSearchParams("utm_source=Instagram&utm_medium=social&utm_campaign=Diwali Offer!"))).toBe("instagram/social/diwali-offer");
    expect(sourceFromParams(new URLSearchParams("utm_medium=social"))).toBeNull();
  });
  test("only values we wrote are trusted", () => {
    expect(isSource("instagram/social/launch")).toBe(true);
    expect(isSource("x//")).toBe(true);
    expect(isSource("<script>/a/b")).toBe(false);
    expect(isSource("a/b")).toBe(false);
    expect(resolveSource("<bad>", true)).toBe("referral");
    expect(resolveSource(undefined, false)).toBe("direct");
    expect(resolveSource("youtube/social/", true)).toBe("youtube/social/");
  });
  test("parse and build", () => {
    expect(parseSource("youtube/social/launch")).toEqual({ source: "youtube", medium: "social", campaign: "launch" });
    expect(parseSource(null).source).toBe("direct");
    expect(campaignUrl("https://outlly.app", "instagram", "social", "Launch Week", "/signup")).toBe("https://outlly.app/signup?utm_source=instagram&utm_medium=social&utm_campaign=launch-week");
  });
});

describe("growth: funnel and leads", () => {
  test("rates are against the step before; the worst step is flagged", () => {
    const f = funnel([{ key: "a", label: "A", count: 100 }, { key: "b", label: "B", count: 60 }, { key: "c", label: "C", count: 12 }, { key: "d", label: "D", count: 6 }]);
    expect(f.map((s) => s.rate)).toEqual([null, 0.6, 0.2, 0.5]);
    expect(f[2].lost).toBe(48);
    expect(worstStep(f)?.key).toBe("c");
  });
  test("a step bigger than the one before never shows over 100% or negative loss", () => {
    const f = funnel([{ key: "w", label: "W", count: 3 }, { key: "s", label: "S", count: 10 }]);
    expect(f[1]).toMatchObject({ rate: 1, lost: 0 });
  });
  test("lead temperature: fresh and active is hot, old and idle is cold", () => {
    expect(leadScore("free_active", { ageDays: 1, activeDays14: 6, posts30: 3, referred: false }).temp).toBe("hot");
    expect(leadScore("unconnected", { ageDays: 10, activeDays14: 1, posts30: 0, referred: false }).temp).toBe("warm");
    expect(leadScore("quiet", { ageDays: 90, activeDays14: 0, posts30: 0, referred: false })).toEqual({ score: 0, temp: "cold" });
    expect(leadScore("waitlist", { ageDays: 1, activeDays14: 0, posts30: 0, referred: true }).score).toBe(65);
  });
  test("names and placeholders", () => {
    expect(firstName("Riya Sharma", "r@x.dev")).toBe("Riya");
    expect(firstName(null, "riya.s@x.dev")).toBe("riya.s");
    expect(fill("Hi {name}, {name}!", "Riya")).toBe("Hi Riya, Riya!");
  });
  test("CSV quotes and defuses formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", '=HYPERLINK("e")'], [null, 3]])).toBe('a,b\r\n"x,y","\'=HYPERLINK(""e"")"\r\n,3\r\n');
  });
});
