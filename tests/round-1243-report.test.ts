/**
 * R1243: the Weekly Intelligence Report (lib/intelligence/report-core.ts), its block in the Monday email
 * (lib/reports/weekly-core.ts + weekly.ts + lib/email templates.weeklyReport), and agency client views: the owner-only
 * profile list, the ?client overview param and the switcher helpers in components/intelligence/view-core.ts.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import type { Signal } from "../lib/intelligence/core";
import type { ReportOverview, WeeklyIntelligence } from "../lib/intelligence/report-core";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
const g = globalThis as unknown as { __r1243User?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__r1243User !== undefined ? g.__r1243User : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let report: typeof import("../lib/intelligence/report-core");
let wcore: typeof import("../lib/reports/weekly-core");
let weekly: typeof import("../lib/reports/weekly");
let email: typeof import("../lib/email");
let memory: typeof import("../lib/intelligence/memory");
let vc: typeof import("../components/intelligence/view-core");
let profilesRoute: typeof import("../app/api/settings/brand/profiles/route");
let overviewRoute: typeof import("../app/api/intelligence/overview/route");
let n = 0;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  report = await import("../lib/intelligence/report-core");
  wcore = await import("../lib/reports/weekly-core");
  weekly = await import("../lib/reports/weekly");
  email = await import("../lib/email");
  memory = await import("../lib/intelligence/memory");
  vc = await import("../components/intelligence/view-core");
  profilesRoute = await import("../app/api/settings/brand/profiles/route");
  overviewRoute = await import("../app/api/intelligence/overview/route");
}, 60_000);
afterAll(() => {
  delete g.__r1243User;
});

const period = { from: "2026-10-23", to: "2026-11-20", label: "Last 28 days", days: 28 };
function signal(id: string, lift: number, direction: "up" | "down" = lift >= 0 ? "up" : "down"): Signal {
  return {
    id,
    kind: "format_trend",
    direction,
    title: `Signal ${id}`,
    platform: "instagram",
    format: "carousel",
    topic: null,
    evidence: { metric: "likes", value: 120, baseline: 80, unit: "count", lift, n: 6, baselineN: 5, period: "Last 28 days" },
    confidence: "medium",
    postsAnalyzed: 11,
    examples: [],
  };
}
function ov(over: Partial<ReportOverview> = {}): ReportOverview {
  return {
    period,
    objective: "engagement",
    posts: 14,
    postsAnalyzed: 25,
    formats: [],
    working: [],
    attention: [],
    recommendations: [],
    recommendationsReason: "No format is far enough ahead to act on.",
    ...over,
  } as ReportOverview;
}
const NO_SUM = "Each platform is compared only with itself: numbers are never added up across platforms.";

async function user(extra: Record<string, unknown> = {}) {
  return db.user.create({ data: { name: `R ${++n}`, email: `r1243-${n}-${Date.now()}@test.dev`, passwordHash: "x", ...extra } });
}
const req = (path: string) => new NextRequest(`http://localhost${path}`, { method: "GET", headers: { origin: "http://localhost", host: "localhost" } });
const asOwner = (u: { id: string; name: string; email: string; createdAt: Date }) => (g.__r1243User = { ...u, role: "owner", joinedAt: u.createdAt, actor: null, scope: null });

describe("R1243 report-core", () => {
  test("movers and attention are capped at 3, strongest first, deterministic", () => {
    const working = [signal("a", 20), signal("b", 90), signal("c", 45), signal("d", 60), signal("e", 45)];
    const attention = [signal("x", -10), signal("y", -70), signal("z", -30), signal("w", -50)];
    const w = report.weeklyIntelligence(ov({ working, attention }));
    expect(w.enough).toBe(true);
    expect(w.movers.map((m) => m.title)).toEqual(["Signal b", "Signal d", "Signal c"]);
    expect(w.attention.map((m) => m.title)).toEqual(["Signal y", "Signal w", "Signal z"]);
    expect(w.headline).toBe("Signal b");
    expect(w.movers[0].confidenceText).toBe("Medium confidence from 11 posts");
    expect(report.weeklyIntelligence(ov({ working: [...working].reverse(), attention: [...attention].reverse() }))).toEqual(w);
  });

  test("caveats: proxy objective named, unavailable platforms named, never a cross-platform sum", () => {
    const formats = [
      { platform: "x", format: "video", status: "unavailable" },
      { platform: "instagram", format: "story", status: "insufficient" },
    ] as unknown as ReportOverview["formats"];
    const w = report.weeklyIntelligence(ov({ objective: "sales", formats }));
    expect(w.objectiveLabel).toBe("Sales");
    expect(w.caveats[0]).toStartWith("Measured by a proxy: No platform reports sales to Outlly");
    expect(w.caveats.some((c) => c.includes("not give Outlly per-post numbers"))).toBe(true);
    expect(w.caveats.some((c) => c.includes("1 platform and format group has fewer than"))).toBe(true);
    expect(w.caveats.at(-1)).toBe(NO_SUM);
    expect(report.weeklyIntelligence(ov()).caveats.some((c) => c.startsWith("Measured by a proxy"))).toBe(false);
  });

  test("empty state under MIN_SAMPLE says how many more posts are needed and claims nothing", () => {
    const w = report.weeklyIntelligence(ov({ posts: 1, working: [signal("a", 50)], recommendations: [{ id: "r1" } as never] }));
    expect(w.enough).toBe(false);
    expect(w.headline).toBe("Not enough posts to compare yet: 1 of the 3 needed.");
    expect(w.emptyText).toContain("Publish 2 more posts");
    expect(w.movers).toEqual([]);
    expect(w.topRecommendation).toBeNull();
    expect(w.recommendationNote).toBeNull();
  });

  test("steady headline, recommendation note and the previous-period line", () => {
    const w = report.weeklyIntelligence(ov(), { posts: 9, period: { ...period, label: "the 28 days before" } });
    expect(w.headline).toBe("Steady: nothing moved far enough from the period before to call.");
    expect(w.recommendationNote).toBe("No format is far enough ahead to act on.");
    expect(w.versus).toBe("14 posts with numbers this period, 9 in the 28 days before.");
  });
});

describe("R1243 weekly email block", () => {
  const wi = (): WeeklyIntelligence =>
    report.weeklyIntelligence(
      ov({
        objective: "leads",
        working: [signal("a", 40)],
        recommendations: [{ id: "rec 1", title: "Make <more> carousels", concept: "Five slides.", why: "They lead.", confidence: "high", postsAnalyzed: 12 } as never],
      }),
    );

  test("intelligenceBlock text and html: sections, absolute create link, escaped, caveats", () => {
    const b = wcore.intelligenceBlock(wi(), "https://app.test/");
    expect(b.sections.map((s) => s.label)).toEqual(["What is working", "Make next"]);
    expect(b.sections[1].items[0].href).toBe("https://app.test/create?rec=rec%201");
    expect(b.url).toBe("https://app.test/intelligence");
    expect(b.sub).toBe("Last 28 days, judged on Leads, 25 posts analysed");
    expect(b.text).toContain("What is working:\n- Signal a: Median");
    expect(b.text).toContain(`* ${NO_SUM}`);
    const stats = wcore.summarize([], 0);
    const html = email.templates.weeklyReport({ name: "Ana", stats, url: "u", settingsUrl: "s", intel: b });
    expect(html).toContain("Content Intelligence");
    expect(html).toContain("Make &lt;more&gt; carousels");
    expect(html).not.toContain("Make <more>");
    expect(html).toContain("Measured by a proxy");
    expect(email.templates.weeklyReport({ name: "Ana", stats, url: "u", settingsUrl: "s" })).not.toContain("Content Intelligence");
  });

  test("weeklyHtml keeps the block under the budget and drops it over", () => {
    const b = wcore.intelligenceBlock(wi(), "https://app.test");
    const stats = wcore.summarize([], 0);
    const html = weekly.weeklyHtml({ name: "Ana", stats, intel: b });
    expect(wcore.withinEmailBudget(html)).toBe(true);
    expect(html).toContain("Content Intelligence");
    const huge = { ...b, caveats: [...b.caveats, "x".repeat(wcore.EMAIL_HTML_BUDGET)] };
    expect(weekly.weeklyHtml({ name: "Ana", stats, intel: huge })).not.toContain("Content Intelligence");
  });

  test("intelligenceFor never throws: a failing overview gives null", async () => {
    expect(await weekly.intelligenceFor("u1", async () => Promise.reject(new Error("db down")))).toBeNull();
    expect((await weekly.intelligenceFor("u1", async () => wi()))?.headline).toBe("Signal a");
  });

  test("sendWeeklyReports includes the block, and still sends when the overview throws", async () => {
    const good = await user({ weeklyReport: true });
    const bad = await user({ weeklyReport: true });
    for (const u of [good, bad]) {
      const media = await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `r1243/${u.id}.mp4`, mimeType: "video/mp4", size: 10 } });
      await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "scheduled", scheduledAt: new Date(Date.now() + 864e5) } });
    }
    const r = await weekly.sendWeeklyReports(new Date(), {
      force: true,
      limit: 500,
      intel: async (id) => {
        if (id === bad.id) throw new Error("overview failed");
        return wi();
      },
    });
    expect(r.sent).toBeGreaterThanOrEqual(2);
    const logs = await db.emailLog.findMany({ where: { kind: "weekly_report", to: { in: [good.email, bad.email] } } });
    const by = new Map(logs.map((l) => [l.to, l]));
    expect(by.get(good.email)?.html).toContain("Content Intelligence");
    expect(by.has(bad.email)).toBe(true);
    expect(by.get(bad.email)?.html).not.toContain("Content Intelligence");
  });
});

describe("R1243 agency client views", () => {
  test("listBrandProfiles is owner-scoped: own brand first, clients by name, never another owner's", async () => {
    const a = await user();
    const b = await user();
    await memory.upsertBrandProfile(a.id, "", { objective: "engagement" });
    await memory.upsertBrandProfile(a.id, "zeta", { objective: "sales", name: "Zeta Foods" });
    await memory.upsertBrandProfile(a.id, "acme", { objective: "awareness", name: "Acme" });
    await memory.upsertBrandProfile(b.id, "secret", { objective: "leads", name: "B's client" });
    const listed = await memory.listBrandProfiles(a.id);
    expect(listed.map((p) => p.scopeKey)).toEqual(["", "acme", "zeta"]);
    expect(listed.every((p) => p.ownerId === a.id)).toBe(true);
    asOwner(a);
    const res = await profilesRoute.GET(req("/api/settings/brand/profiles"), { params: {} } as never);
    const body = (await res.json()) as { profiles: { scopeKey: string; name: string | null }[] };
    expect(body.profiles.map((p) => p.scopeKey)).toEqual(["", "acme", "zeta"]);
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  test("overview ?client= uses the client's objective, owner only, unknown client 404", async () => {
    const a = await user();
    await memory.upsertBrandProfile(a.id, "acme", { objective: "awareness", name: "Acme" });
    asOwner(a);
    const ok = await overviewRoute.GET(req("/api/intelligence/overview?days=28&client=acme"), { params: {} } as never);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { objective: string }).objective).toBe("awareness");
    const explicit = await overviewRoute.GET(req("/api/intelligence/overview?days=28&client=acme&objective=community"), { params: {} } as never);
    expect(((await explicit.json()) as { objective: string }).objective).toBe("community");
    const gone = await overviewRoute.GET(req("/api/intelligence/overview?days=28&client=nope"), { params: {} } as never);
    expect(gone.status).toBe(404);
    g.__r1243User = { ...a, role: "manager", joinedAt: a.createdAt, actor: { id: "m", name: "M", email: "m@test.dev" }, scope: null };
    const member = await overviewRoute.GET(req("/api/intelligence/overview?days=28&client=acme"), { params: {} } as never);
    expect(member.status).toBe(403);
  });

  test("client switcher state helpers", () => {
    expect(vc.clientOptions([{ scopeKey: "", name: "Me", objective: "engagement" }])).toBeNull();
    expect(vc.clientOptions(null)).toBeNull();
    const opts = vc.clientOptions([
      { scopeKey: "", name: "Me", objective: "engagement" },
      { scopeKey: "acme", name: "Acme", objective: "awareness" },
      { scopeKey: "acme", name: "Dup", objective: "awareness" },
      { scopeKey: "bare", name: "  ", objective: "sales" },
      { scopeKey: "x".repeat(101), name: "Too long", objective: "sales" },
    ]);
    expect(opts).toEqual([
      { key: "", label: "Your brand" },
      { key: "acme", label: "Acme" },
      { key: "bare", label: "bare" },
    ]);
    expect(vc.pickClient(opts, "acme")).toBe("acme");
    expect(vc.pickClient(opts, "ghost")).toBe("");
    expect(vc.pickClient(null, "acme")).toBe("");
    expect(vc.overviewUrl(28, null, null, "acme")).toBe("/api/intelligence/overview?days=28&client=acme");
    expect(vc.overviewUrl(28, null, null, "")).toBe("/api/intelligence/overview?days=28");
    expect(vc.weeklyReportNote({ days: 28, objective: "engagement", savedObjective: "engagement", client: null })).toBe("This is what Monday's email will say, from the same numbers.");
    expect(vc.weeklyReportNote({ days: 7, objective: "engagement", savedObjective: "engagement", client: null })).toContain("last 28 days");
    expect(vc.weeklyReportNote({ days: 28, objective: "engagement", savedObjective: "engagement", client: "acme" })).toContain("own brand");
    expect(vc.CLIENT_NOTE).toContain("objective and wording only");
  });
});
