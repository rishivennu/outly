/**
 * 1172: the platform dashboard (/analytics/{platform}) redesigned as one responsive grid. One account and one
 * reporting window for every card; the header says how fresh the numbers are; a value the platform did not
 * report says so instead of showing a zero; a change is only drawn against a real previous period.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_RANGE_DAYS, pickRangeDays, rangeNote, rangeOptions } from "../lib/live/ranges";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const dash = src("components/analytics/PlatformDashboardView.tsx");
const extras = src("components/analytics/ProfileExtras.tsx");
const live = src("lib/live/index.ts");
const platformRoute = src("app/api/platforms/[platform]/route.ts");
const profileRoute = src("app/api/analytics/profile/route.ts");
const ideasRoute = src("app/api/platforms/[platform]/ideas/route.ts");

describe("1172 reporting window", () => {
  test("only windows a platform can answer are offered; Instagram stops at 30 days", () => {
    expect(rangeOptions("instagram")).toEqual([7, 28]);
    expect(rangeOptions("youtube")).toEqual([7, 28, 90]);
    expect(rangeNote("instagram")).toContain("up to 30 days");
    expect(rangeNote("youtube")).toBeNull();
  });
  test("a raw ?days= value becomes one the platform offers, else the default", () => {
    expect(pickRangeDays("instagram", "7")).toBe(7);
    expect(pickRangeDays("instagram", "90")).toBe(DEFAULT_RANGE_DAYS);
    expect(pickRangeDays("youtube", 90)).toBe(90);
    expect(pickRangeDays("x", "abc")).toBe(DEFAULT_RANGE_DAYS);
    expect(pickRangeDays("x", null)).toBe(DEFAULT_RANGE_DAYS);
  });
  test("the window reaches every reader and both caches key on it", () => {
    expect(live).toContain("const days = pickRangeDays(platform, opts.days);");
    expect(live).toContain("instagramDashboard(ctx, tz, days)");
    expect(live).toContain("youtubeDashboard(ctx, days)");
    expect(live).toContain("facebookDashboard(ctx, days)");
    expect(live).toContain("xDashboard(ctx, days)");
    expect(live).toContain("outllyDashboard(userId, platform, acct, days)");
    expect(live).toContain('["live-dash-v3", userId, platform, tz, accountId ?? "default", String(days)]');
    expect(live).toContain('${days === DEFAULT_RANGE_DAYS ? "" : `:${days}d`}');
    expect(platformRoute).toContain('days: pickRangeDays(p, req.nextUrl.searchParams.get("days"))');
    expect(profileRoute).toContain('days: pickRangeDays(platform, q.get("days"))');
  });
  test("the page has one picker and says the window every card shares", () => {
    expect(dash).toContain('aria-label="Reporting period"');
    expect(dash).toContain("rangeOptions(platform)");
    expect(dash).toContain("Last {data.rangeDays} days, straight from {name}. Changes compare with the {data.rangeDays} days before.");
  });
});

describe("1172 one account, one loader", () => {
  test("every refresh asks for the picked account in the picked window, never the default account", () => {
    expect(dash).toContain("/api/analytics/profile?");
    expect(dash).toContain('q.set("days", String(opts.days ?? current.current.days));');
    expect(dash).toContain("const load = useCallback((fresh: boolean) => loadProfile(current.current.acct, { fresh }), [loadProfile]);");
    expect(dash).not.toContain("api<PlatformDashboard>(`/api/platforms/${platform}");
    expect(dash).toContain("<ProfileAccounts");
    expect(dash).toContain("focusAccount");
  });
  test("AI ideas are asked for the account on screen", () => {
    expect(dash).toContain("/api/platforms/${platform}/ideas${acct ? `?account=${encodeURIComponent(acct)}` : \"\"}");
    expect(ideasRoute).toContain('req.nextUrl.searchParams.get("account")');
    expect(ideasRoute).toContain("dashboardAccount(user, p)");
    expect(live).toContain("export async function platformIdeas(userId: string, platform: Platform, accountId: string | null = null)");
    expect(live).toContain('["live-ideas-v2", userId, platform, accountId ?? "default", sig]');
  });
  test("the header says live, stale or needs reconnect, when it was updated, and when Outlly synced", () => {
    expect(dash).toContain("const STALE_MS = 15 * 60_000;");
    expect(dash).toContain("Needs reconnect");
    expect(dash).toContain(">Stale<");
    expect(dash).toContain("freshness(x.lastSyncAt, now).label");
    expect(dash).toContain('aria-label="Refresh now"');
    // the account switcher no longer repeats the sync time under itself
    expect(extras).toContain("lastSyncAt?: string | null");
    expect(extras).toContain("{fresh && <p");
  });
});

describe("1172 honest numbers", () => {
  test("a metric the platform did not report says so; a change needs a previous period; lifetime counts say so", () => {
    expect(dash).toContain("Not reported by {name}");
    expect(dash).toContain("No comparison from {name}");
    expect(dash).toContain("vs previous {days} days");
    expect(dash).toContain('const hasDelta = typeof h.delta === "number" && Number.isFinite(h.delta);');
    expect(dash).toContain('const LIFETIME = new Set(["followers", "subscribers", "fans"]);');
    expect(dash).toContain("Lifetime total");
    // A reply from an older request never overwrites a newer account or window.
    expect(dash).toContain("const mine = ++seq.current;");
    expect(dash).toContain("if (mine !== seq.current) return;");
    // Ideas are asked for once, after the profile reply names the account on screen.
    expect(dash).toContain("if (!enoughPosts || !resolved) return;");
    expect(dash).toContain("A lifetime count, not limited to the reporting period.");
    expect(dash).toContain("A lifetime breakdown, not limited to the reporting period.");
    expect(dash).toContain("A lifetime pattern from the platform, not limited to the reporting period.");
  });
  test("every KPI has a tooltip from the platform's own definition and keeps the count-up", () => {
    expect(dash).toContain("const METRIC_HELP: Record<string, string>");
    for (const k of ["followers", "views", "reach", "engaged", "interactions", "profile", "subscribers", "watch", "avd", "net"]) expect(dash).toMatch(new RegExp(`^  ${k}: "`, "m"));
    expect(dash).toContain('role="tooltip"');
    expect(dash).toContain("<AnimatedNumber value={h.value} format={formatOfHeadline(h)}");
    expect(dash).toContain('className="kpi-in glass');
    expect(dash).not.toContain("kpi-card");
  });
  test("follower locations: shown when the platform gave them, an honest empty card only on Instagram, nothing elsewhere", () => {
    expect(dash).toContain('const audience = data.breakdown ? "card" : platform === "instagram" ? "empty" : "none";');
    expect(dash).toContain("did not share follower locations for this account");
    expect(dash).toContain("Share of these {n(sum)} followers.");
  });
  test("posts: four sorts, a dash where the platform gave no number, each opens on the platform", () => {
    for (const l of ["Newest", "Most viewed", "Most liked", "Most engaged"]) expect(dash).toContain(`label: "${l}"`);
    expect(dash).toContain('else if (sort === "likes") s.sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1));');
    expect(dash).toContain("A dash means {name} gave no number for that post.");
    expect(dash).toContain('target="_blank" rel="noopener noreferrer" className="group grid');
  });
});

describe("1172 the grid", () => {
  test("12 columns on a desktop, two on a tablet, one on a phone; the frame is the studio frame", () => {
    expect(dash).toContain('"page-frame pb-16"');
    expect(dash).toContain('className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12"');
    expect(dash).toContain('className="md:col-span-2 xl:col-span-8"'); // trend
    expect(dash).toContain('className="md:col-span-2 xl:col-span-4"'); // coach
    expect(dash).toContain('"xl:col-span-7"'); // hours
    expect(dash).toContain('"xl:col-span-5"'); // countries
    expect(dash).toContain('<Posts posts={data.posts} platform={platform} className="md:col-span-2 xl:col-span-12" />');
    expect(dash).toContain('className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"'); // KPI row
  });
  test("format and timing tiles sit in the same grid, side by side or one across", () => {
    expect(extras).toContain('const span = both ? "xl:col-span-6" : "md:col-span-2 xl:col-span-12";');
    expect(extras).not.toContain('<div className="mt-3 grid gap-3 lg:grid-cols-2">');
    expect(extras).toContain("What you post here");
    expect(extras).toContain("When you post");
  });
  test("one card recipe and one heading size for every tile; controls are 44px tall", () => {
    expect(dash).toContain('const CARD = "glass rounded-[24px] p-5 sm:p-6";');
    expect(dash).toContain('const H2 = "text-base font-semibold sm:text-lg";');
    expect(dash).not.toMatch(/className="[^"]*\bh-9\b/);
    expect(dash).not.toContain("<PlatformTabs");
    expect(dash).toContain('import { pollable } from "@/lib/client/idle";');
  });
});
