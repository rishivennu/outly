/**
 * R1308: Admin App Analytics. The pure core (ranges, buckets, rolling windows, client placement, CSV, meta),
 * the write path (events, sessions, installs, the daily rollup), the admin read layer and the wiring pins.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLIENT_EVENTS, EVENTS, HEARTBEAT_MS, MAX_BATCH, SESSION_GAP_MS, bucketOf, bucketSum, bucketUnique, change, cleanMeta, clientInfo,
  parseGranularity, parseRange, qualifies, ratio, returningIn, rolling, sectionOf, toCsv, uaInfo,
} from "../lib/analytics/activity-core";

let db: typeof import("../lib/db").db;
let act: typeof import("../lib/analytics/activity");
let roll: typeof import("../lib/analytics/rollup");
let adm: typeof import("../lib/admin/app-analytics");
const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const tag = `r1308a${Date.now().toString(36)}`;
let n = 0;

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  act = await import("../lib/analytics/activity");
  roll = await import("../lib/analytics/rollup");
  adm = await import("../lib/admin/app-analytics");
});

const mkUser = async (createdAt?: Date) => {
  n += 1;
  return db.user.create({ data: { name: `Person ${n}`, email: `${tag}-u${n}@test.dev`, passwordHash: "x", ...(createdAt ? { createdAt } : {}) } });
};
const WEB = { platform: "web" as const, device: "desktop" as const, os: "Windows", browser: "Chrome", version: null };
const ANDROID = { platform: "android" as const, device: "phone" as const, os: "Android", browser: "Outlly app", version: "3.4.0" };
const place = (key: string, client = WEB, installId: string | null = null) => ({ client, key, installId });
const NOW = new Date("2026-11-23T10:00:00Z");

describe("R1308 ranges and buckets", () => {
  test("presets end today and compare against the same length of days just before", () => {
    const r = parseRange({ r: "7" }, NOW);
    expect([r.from, r.to, r.days]).toEqual(["2026-11-17", "2026-11-23", 7]);
    expect(r.prev).toEqual({ from: "2026-11-10", to: "2026-11-16" });
    expect(parseRange({ r: "yesterday" }, NOW)).toMatchObject({ from: "2026-11-22", to: "2026-11-22", days: 1, prev: { from: "2026-11-21", to: "2026-11-21" } });
    expect(parseRange({ r: "nonsense" }, NOW).days).toBe(30);
  });
  test("a custom pair wins, is capped at today and at 366 days; a bad pair falls back", () => {
    expect(parseRange({ r: "7", from: "2026-11-01", to: "2026-11-10" }, NOW)).toMatchObject({ key: "custom", from: "2026-11-01", to: "2026-11-10", days: 10 });
    expect(parseRange({ from: "2026-11-20", to: "2026-12-31" }, NOW).to).toBe("2026-11-23");
    expect(parseRange({ from: "2020-01-01", to: "2026-11-23" }, NOW).days).toBe(366);
    expect(parseRange({ from: "2026-11-10", to: "2026-11-01" }, NOW).key).toBe("30");
    expect(parseRange({ from: "2026-02-30", to: "2026-03-01" }, NOW).key).toBe("30");
  });
  test("weeks start on Monday, months on the first; granularity follows the span unless asked", () => {
    expect(bucketOf("2026-11-23", "week")).toBe("2026-11-23");
    expect(bucketOf("2026-11-22", "week")).toBe("2026-11-16");
    expect(bucketOf("2026-11-22", "month")).toBe("2026-11");
    expect(parseGranularity(null, 7)).toBe("day");
    expect(parseGranularity(null, 60)).toBe("week");
    expect(parseGranularity(null, 180)).toBe("month");
    expect(parseGranularity("day", 180)).toBe("day");
  });
  test("sums add up per bucket; unique buckets take the union of ids", () => {
    const sums = bucketSum([{ day: "2026-11-16", value: 2 }, { day: "2026-11-18", value: 3 }, { day: "2026-11-23", value: 1 }], "week");
    expect(sums.map((b) => [b.key, b.value])).toEqual([["2026-11-16", 5], ["2026-11-23", 1]]);
    const uniq = bucketUnique([{ day: "2026-11-16", ids: ["a", "b"] }, { day: "2026-11-18", ids: ["b", "c"] }], "week");
    expect(uniq[0].value).toBe(3);
    expect(uniq[0].label).toMatch(/^wk /);
  });
  test("rolling windows and returning users", () => {
    const byDay = new Map<string, Set<string>>([
      ["2026-11-20", new Set(["a"])],
      ["2026-11-22", new Set(["a", "b"])],
      ["2026-11-23", new Set(["c"])],
    ]);
    expect(rolling(["2026-11-22", "2026-11-23"], byDay, 7).map((r) => r.value)).toEqual([2, 3]);
    expect(rolling(["2026-11-23"], byDay, 1)[0].value).toBe(1);
    const first = new Map([["a", "2026-11-20"], ["b", "2026-11-22"], ["c", "2026-11-23"]]);
    // a came back on the 22nd; b and c were only seen on their first day
    expect(returningIn(byDay, first, "2026-11-20", "2026-11-23")).toBe(1);
    expect(change(125, 100)).toBe(0.25);
    expect(change(5, 0)).toBeNull();
    expect(ratio(1, 3)).toBe(0.333);
  });
});

describe("R1308 placement, meta, CSV, registry", () => {
  test("user agents become coarse buckets; the native app names itself; the installed web app comes from the shell cookie", () => {
    const phone = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
    expect(uaInfo(phone)).toEqual({ device: "phone", os: "Android", browser: "Chrome" });
    expect(uaInfo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0")).toEqual({ device: "desktop", os: "Windows", browser: "Edge" });
    expect(uaInfo("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1").device).toBe("tablet");
    expect(clientInfo({ ua: phone, native: { platform: "android", version: "3.4.0" } })).toEqual(ANDROID);
    expect(clientInfo({ ua: phone, native: null, shell: "pwa" }).platform).toBe("pwa");
    expect(clientInfo({ ua: phone, native: null }).platform).toBe("web");
  });
  test("meta keeps only allow-listed flat values and stays small", () => {
    expect(cleanMeta({ platform: "instagram", count: 2.6, email: "x@y.z", nested: { a: 1 } })).toEqual({ platform: "instagram", count: 3 });
    expect(cleanMeta({ email: "x@y.z" })).toBeNull();
    expect(cleanMeta("str")).toBeNull();
    expect(cleanMeta({ reason: "x".repeat(61) })).toBeNull();
  });
  test("CSV quotes commas and neutralises formula cells", () => {
    const csv = toCsv(["name", "note"], [["Ann, Jr", "=HYPERLINK(1)"], [null, 3]]);
    expect(csv).toBe('name,note\r\n"Ann, Jr", =HYPERLINK(1)\r\n,3\r\n');
  });
  test("the registry: heartbeats, publishes and payments do not count as activity; browsers may send only their own events", () => {
    expect(qualifies("post_published")).toBe(false);
    expect(qualifies("payment_succeeded")).toBe(false);
    expect(qualifies("logout")).toBe(false);
    expect(qualifies("login")).toBe(true);
    expect(qualifies("heartbeat")).toBe(false);
    expect(CLIENT_EVENTS.sort()).toEqual(["analytics_visit", "dashboard_visit", "page_view", "pwa_installed"]);
    expect(Object.keys(EVENTS)).toContain("subscription_started");
    expect(sectionOf("/dashboard/analytics/x")).toBeString();
    expect(SESSION_GAP_MS).toBe(30 * 60_000);
    expect(HEARTBEAT_MS).toBe(120_000);
    expect(MAX_BATCH).toBe(20);
  });
});

describe("R1308 write path", () => {
  test("events land with placement, one activity day per person per day, and one session while the gap is short", async () => {
    const u = await mkUser();
    const key = `${tag}-s1`;
    const t0 = new Date();
    expect(await act.recordEvents(u.id, [{ name: "login" }, { name: "dashboard_visit", meta: { section: "dashboard", secret: "no" } }], place(key), t0)).toBe(2);
    expect(await act.recordEvents(u.id, [{ name: "content_created", meta: { platform: "instagram" } }], place(key), new Date(t0.getTime() + 5 * 60_000))).toBe(1);
    const events = await db.activityEvent.findMany({ where: { userId: u.id }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.name)).toEqual(["login", "dashboard_visit", "content_created"]);
    expect(events[1]).toMatchObject({ platform: "web", device: "desktop", os: "Windows", browser: "Chrome", meta: '{"section":"dashboard"}' });
    expect(events.every((e) => e.day === t0.toISOString().slice(0, 10))).toBe(true);
    const sessions = await db.usageSession.findMany({ where: { userId: u.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].events).toBe(3);
    expect(sessions[0].lastSeenAt.getTime() - sessions[0].startedAt.getTime()).toBe(5 * 60_000);
    expect(new Set(events.map((e) => e.sessionId)).size).toBe(1);
    expect(await db.userActivityDay.count({ where: { userId: u.id } })).toBe(1);
    const row = await db.user.findUnique({ where: { id: u.id }, select: { lastActiveAt: true } });
    expect(row?.lastActiveAt).not.toBeNull();
  });
  test("after the gap a new session opens; a heartbeat extends but never opens; sign-out closes the open one", async () => {
    const u = await mkUser();
    const key = `${tag}-s2`;
    const t0 = new Date(Date.now() - 2 * SESSION_GAP_MS);
    await act.recordEvents(u.id, [{ name: "page_view" }], place(key), t0);
    await act.recordEvents(u.id, [{ name: "page_view" }], place(key), new Date(t0.getTime() + SESSION_GAP_MS + 1000));
    expect(await db.usageSession.count({ where: { userId: u.id } })).toBe(2);
    await act.heartbeat(u.id, place(`${tag}-s2-hb`), new Date());
    expect(await db.usageSession.count({ where: { userId: u.id } })).toBe(2);
    const t2 = new Date(t0.getTime() + SESSION_GAP_MS + 60_000);
    await act.heartbeat(u.id, place(key), t2);
    const open = await db.usageSession.findFirst({ where: { userId: u.id }, orderBy: { startedAt: "desc" } });
    expect(open?.lastSeenAt.getTime()).toBe(t2.getTime());
    expect(open?.endedAt).toBeNull();
    await act.endSessions(u.id, key, new Date());
    expect(await db.usageSession.count({ where: { userId: u.id, endedAt: null } })).toBe(0);
  });
  test("an install is created once with its event; later sightings only refresh it; dead push tokens mark it uninstalled", async () => {
    const u = await mkUser();
    const id = `${tag}-inst-${"a".repeat(10)}`;
    expect(await act.registerInstall({ id, userId: u.id, platform: "android", source: "first_launch", client: ANDROID })).toBe(true);
    expect(await act.registerInstall({ id, userId: u.id, platform: "android", source: "first_launch", client: { ...ANDROID, version: "3.5.0" } })).toBe(false);
    const inst = await db.appInstall.findUnique({ where: { id } });
    expect(inst).toMatchObject({ platform: "android", version: "3.5.0", status: "active", source: "first_launch", userId: u.id });
    expect(await db.activityEvent.count({ where: { userId: u.id, name: "app_first_launch" } })).toBe(1);
    expect((await db.activityEvent.findFirst({ where: { userId: u.id, name: "app_first_launch" } }))?.installId).toBe(id);
    expect(await act.markUninstalled([id, "unknown-id"])).toBe(1);
    expect((await db.appInstall.findUnique({ where: { id } }))?.status).toBe("uninstalled");
    const pwa = `${tag}-pwa-${"b".repeat(10)}`;
    await act.registerInstall({ id: pwa, userId: u.id, platform: "pwa", source: "appinstalled", client: { ...WEB, device: "phone" } });
    expect(await db.activityEvent.count({ where: { userId: u.id, name: "pwa_installed" } })).toBe(1);
    expect(act.installIdOf("short")).toBeNull();
    expect(act.installIdOf(" abcdefgh-1234 ")).toBe("abcdefgh-1234");
    expect(act.installIdOf("bad id with spaces!")).toBeNull();
  });
  test("the daily rollup counts people once, splits by platform, and skips publish-only users", async () => {
    const day = "2026-01-15";
    const at = new Date(`${day}T09:00:00Z`);
    const older = await mkUser(new Date("2025-12-01T00:00:00Z"));
    const fresh = await mkUser(at);
    const pub = await mkUser(new Date("2025-12-01T00:00:00Z"));
    await act.recordEvents(older.id, [{ name: "login", at }, { name: "content_created", at }], place(`${tag}-r1`, ANDROID, null), at);
    await act.recordEvents(fresh.id, [{ name: "signup", at }], place(`${tag}-r2`), at);
    await act.recordEvents(pub.id, [{ name: "post_published", at, meta: { platform: "youtube" } }], null, at);
    const out = await roll.rollupDay(day);
    expect(out.all).toMatchObject({ dau: 2, returning: 1, events: 4, sessions: 3 });
    expect(out.all.newUsers).toBeGreaterThanOrEqual(1);
    expect(out.android).toMatchObject({ dau: 1, returning: 1, events: 2 });
    expect(out.web).toMatchObject({ dau: 1, returning: 0 });
    expect(out.server.dau).toBe(0);
    expect(out.all.features).toEqual({ create: 1, publish: 1 });
    const rows = await db.analyticsDaily.findMany({ where: { day } });
    expect(rows.map((r) => r.platform).sort()).toEqual(["all", "android", "server", "web"]);
    expect(JSON.parse(rows.find((r) => r.platform === "all")!.features)).toEqual({ create: 1, publish: 1 });
    // running it again is idempotent
    expect((await roll.rollupDay(day)).all.dau).toBe(2);
    expect(await db.analyticsDaily.count({ where: { day, platform: "all" } })).toBe(1);
  });
});

describe("R1308 admin read layer", () => {
  const sp = (o: Record<string, string>) => o;
  test("user table: status, platform filter, search and masking; detail for a known person, null otherwise", async () => {
    const u = await mkUser();
    const key = `${tag}-ut`;
    await act.recordEvents(u.id, [{ name: "login" }, { name: "post_scheduled", meta: { kind: "schedule" } }], place(key, ANDROID, null));
    const f = adm.parseUserFilters(sp({ q: u.email, platform: "android" }), { page: 1, limit: 20 });
    expect(f.platform).toBe("android");
    const page = await adm.usersPage(f, "super");
    expect(page.total).toBe(1);
    expect(page.rows[0]).toMatchObject({ id: u.id, status: "new", platform: "android", version: "3.4.0", sessions: 1 });
    expect(page.rows[0].lastLoginAt).not.toBeNull();
    const masked = await adm.usersPage(adm.parseUserFilters(sp({ q: u.email }), { page: 1, limit: 20 }), "support");
    expect(masked.rows[0].email).not.toBe(u.email);
    const none = await adm.usersPage(adm.parseUserFilters(sp({ q: u.email, platform: "ios" }), { page: 1, limit: 20 }), "super");
    expect(none.total).toBe(0);
    const never = await adm.usersPage(adm.parseUserFilters(sp({ q: tag, status: "never" }), { page: 1, limit: 50 }), "super");
    expect(never.rows.every((r) => r.status === "never")).toBe(true);
    const d = await adm.userDetail(u.id, "super");
    expect(d?.totals).toMatchObject({ events: 2, sessions: 1, activeDays: 1 });
    expect(d?.events.map((e) => e.name).sort()).toEqual(["login", "post_scheduled"]);
    expect(d?.features.map((x) => x.key)).toEqual(["schedule"]);
    expect(d?.platforms[0]).toMatchObject({ platform: "android", sessions: 1 });
    expect(await adm.userDetail("nope", "super")).toBeNull();
    const csv = await adm.usersCsv(adm.parseUserFilters(sp({ q: u.email }), { page: 1, limit: 20 }), "super");
    expect(csv.split("\r\n")[0]).toContain("email");
    expect(csv).toContain(u.email);
  });
  test("overview KPIs say downloads are unavailable and never invent numbers; series and live have the expected shape", async () => {
    const q = adm.parseQuery({ r: "7" }, parseRange({ r: "7" }));
    const o = await adm.overview(q);
    const dl = o.kpis.find((k) => k.key === "downloads");
    expect(dl?.unavailable).toBeTruthy();
    expect(dl?.value).toBe(0);
    for (const k of o.kpis) expect(typeof k.value).toBe("number");
    const s = await adm.activeSeries(q);
    expect(s.g).toBe("day");
    expect(s.daily).toHaveLength(7);
    const l = await adm.live("super");
    expect(l.online).toBeNumber();
    expect(Object.keys(l.lastHour).sort()).toEqual(["connected", "created", "installs", "logins", "published", "signups"]);
    expect(adm.isExportKind("users")).toBe(false);
    expect(adm.isExportKind("daily")).toBe(true);
    const csv = await adm.exportCsv("events", q);
    expect(csv.split("\r\n")[0].split(",").length).toBeGreaterThan(1);
  });
});

describe("R1308 wiring pins", () => {
  test("the admin area, nav item, tracker mount, sweep rollup, hooks and the ingest route are in place", () => {
    expect(read("lib/admin/perms.ts")).toMatch(/appAnalytics: \["super", "finance", "support", "marketing"\]/);
    const shell = read("components/admin/AdminShell.tsx");
    expect(shell).toContain('href: "/admin/app-analytics"');
    expect(shell).toContain('area: "appAnalytics"');
    expect(read("app/(studio)/layout.tsx")).toContain("<ActivityTracker />");
    expect(read("app/api/cron/sweep/route.ts")).toContain("sweepRollup");
    expect(read("app/api/track/route.ts")).toContain("CLIENT_EVENTS");
    expect(read("lib/auth.ts")).toMatch(/track\("login", /);
    expect(read("app/api/auth/signup/route.ts")).toContain('track("signup"');
    expect(read("app/api/auth/logout/route.ts")).toContain("endSessions");
    expect(read("app/api/posts/[id]/launch/route.ts")).toContain('track("post_scheduled"');
    expect(read("lib/queue/handlers.ts")).toContain('track("post_published"');
    expect(read("lib/billing/service.ts")).toContain('track("subscription_started"');
    expect(read("lib/push/fcm.ts")).toContain("markUninstalled");
    expect(read("app/api/app/bootstrap/route.ts")).toContain("registerInstall");
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = read(f);
      for (const m of ["model ActivityEvent", "model UsageSession", "model AppInstall", "model AnalyticsDaily"]) expect(s).toContain(m);
    }
  });
  test("tracking never blocks a response: track() is fire-and-forget and the client tracker skips admin pages", () => {
    const a = read("lib/analytics/activity.ts");
    expect(a).toMatch(/export function track\([^)]*\): void/);
    expect(read("components/shared/ActivityTracker.tsx")).toContain("isAdminPath");
  });
  test("the page is grouped into tabs: one group renders at a time, picked by ?tab=, with the users link landing on its tab", () => {
    const page = read("app/admin/(panel)/app-analytics/page.tsx");
    for (const k of ["overview", "installs", "active", "engagement", "retention", "platforms", "users"]) {
      expect(page).toContain(`{ key: "${k}"`);
      expect(page).toContain(`tab === "${k}" &&`);
    }
    expect(page).toContain("<TabBar tabs={TABS} current={tab} />");
    expect(page).not.toContain('href={`#${id}`}');
    // only the open group's queries run
    expect(page).toMatch(/on\("active"\) \? activeSeries\(q\) : null/);
    expect(page).toMatch(/on\("users"\) \? usersPage\(/);
    const bar = read("components/admin/app-analytics/TabBar.tsx");
    expect(bar).toContain('role="tablist"');
    expect(bar).toContain('role="tab"');
    expect(bar).toContain("ArrowRight");
    expect(bar).toContain("touch:min-h-11");
    expect(read("app/admin/(panel)/app-analytics/[id]/page.tsx")).toContain('href="/admin/app-analytics?tab=users"');
  });
  test("the range toolbar is one auto-layout block: three wrapping rows, one control height, platform on the presets row, no fixed widths", () => {
    const rc = read("components/admin/app-analytics/RangeControls.tsx");
    const page = read("app/admin/(panel)/app-analytics/page.tsx");
    // slots: the platform select sits at the right edge of the presets row, the meta line closes the block
    expect(rc).toContain("trailing?: React.ReactNode");
    expect(rc).toContain("meta?: React.ReactNode");
    expect(page).toContain("trailing={<FilterSelect inline");
    expect(page).toContain("meta={<ReportMeta");
    expect(page).not.toContain("<AdminFilterBar");
    // every row wraps; the bucket segment and the platform select are pushed right with ml-auto, never positioned
    expect(rc.match(/flex-wrap items-center/g)!.length).toBeGreaterThanOrEqual(5);
    expect(rc).toContain("sm:ml-auto");
    expect(rc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")).not.toMatch(/\b(absolute|fixed)\b|w-\[\d+px\]/);
    // one height for chips, inputs and the select (36 px, 44 px on touch); no horizontal scroller
    expect(rc).toContain("h-9 shrink-0 items-center whitespace-nowrap rounded-full");
    expect(rc).toMatch(/const input = "h-9 min-w-0 flex-1 basis-\[8\.5rem\] rounded-full/);
    expect(rc).not.toContain("ScrollX");
    // date inputs share the line on phones (flex-1) and take a natural width from sm up
    expect(rc).toContain("sm:flex-none sm:w-[9.25rem]");
    // the comparison controls are a single wrapping row with Compare + Stop comparing kept together
    expect(rc).toContain('aria-label="Compare with"');
    expect(rc).toContain('{compare ? "Stop comparing" : "Cancel"}');
    const sb = read("components/admin/SearchBox.tsx");
    expect(sb).toContain("inline = false");
    expect(sb).toContain('inline ? "h-9 rounded-full touch:h-11" : "h-11 rounded-xl"');
    expect(sb).toContain('inline && "sr-only"');
  });
  test("the live panel's relative times hydrate cleanly: the clock is seeded from the server timestamp, not Date.now()", () => {
    const lp = read("components/admin/app-analytics/LivePanel.tsx");
    expect(lp).toContain("useState(() => new Date(initial.at).getTime())");
    expect(lp).toContain("ago(e.at, now)");
    expect(lp).toContain("ago(live.at, now)");
    expect(lp).not.toMatch(/ago\([a-z.]+\)/);
    expect(read("components/admin/ui.tsx")).toContain("now: number = Date.now()");
  });
});
