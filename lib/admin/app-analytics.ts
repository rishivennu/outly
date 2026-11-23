import "server-only";
import { db } from "../db";
import { cached } from "../cache";
import { SAMPLE_DOMAIN } from "./sample";
import { adminEmail } from "./privacy";
import type { AdminRole } from "./perms";
import { addDays, dayKey, retentionRows, weeklyCohorts, type CohortRow, type RetentionRow } from "./activation";
import { ONLINE_WINDOW_MS } from "../presence-core";
import { trackingSince } from "../analytics/rollup";
import {
  EVENTS, EVENT_NAMES, FEATURES, PLATFORM_LABEL, QUALIFYING,
  bucketLabel, bucketOf, bucketSum, bucketUnique, change, eventLabel, featureOf, isEventName, isPlatform, parseGranularity, rangeDays, ratio, returningIn, rolling, toCsv, uniqueIn,
  type EventName, type Granularity, type Platform, type Range,
} from "../analytics/activity-core";

/**
 * R1308 App Analytics, the read side for /admin/app-analytics. Every number is computed from the rows the write side
 * keeps (ActivityEvent, UsageSession, AppInstall) plus what the product already had (User, UserActivityDay), never
 * from a guess. Each loader is cached for a minute per filter set, so the page and its CSV exports share one read.
 */

export type PlatformFilter = Platform | "all";
export const parsePlatform = (v: string | null | undefined): PlatformFilter => (isPlatform(v) && v !== "server" ? v : "all");
export type Query = { range: Range; g: Granularity; platform: PlatformFilter };
export const parseQuery = (sp: Record<string, string | string[] | undefined>, range: Range): Query => ({ range, g: parseGranularity(str(sp.g), range.days), platform: parsePlatform(str(sp.platform)) });
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const real = { NOT: { email: { endsWith: `@${SAMPLE_DOMAIN}` } } };
const CAP = 200_000;
const TTL = 60_000;
const QUAL = EVENT_NAMES.filter((n) => QUALIFYING.has(n));
const dateOf = (day: string) => new Date(day + "T00:00:00Z");
const between = (from: string, to: string) => ({ gte: dateOf(from), lt: dateOf(addDays(to, 1)) });
const round1 = (n: number) => Math.round(n * 10) / 10;

/* ---------------- shared loads ---------------- */

/** Every real account (sample accounts out), once a minute. Small for Outlly; capped so a surge cannot hurt the page. */
const people = () => cached("aa:people", TTL, () => db.user.findMany({ where: real, select: { id: true, name: true, email: true, createdAt: true, lastActiveAt: true, locCountry: true, timezone: true }, orderBy: { createdAt: "asc" }, take: 50_000 }));
const peopleMap = async () => new Map((await people()).map((p) => [p.id, p]));

type ActiveMap = Map<string, Set<string>>;
const addTo = (m: ActiveMap, day: string, id: string) => (m.get(day) ?? m.set(day, new Set()).get(day)!).add(id);

/**
 * Active people per UTC day. "all" reads UserActivityDay (one row per person per active day, kept since long before this
 * release, so history is honest); a single platform reads its own qualifying events, which exist from this release on.
 */
async function activeByDay(from: string, to: string, platform: PlatformFilter): Promise<ActiveMap> {
  return cached(`aa:active:${from}:${to}:${platform}`, TTL, async () => {
    const m: ActiveMap = new Map();
    const ids = new Set((await people()).map((p) => p.id));
    if (platform === "all") {
      const rows = await db.userActivityDay.findMany({ where: { day: { gte: from, lte: to } }, select: { userId: true, day: true }, take: CAP });
      for (const r of rows) if (ids.has(r.userId)) addTo(m, r.day, r.userId);
    } else {
      const rows = await db.activityEvent.findMany({ where: { day: { gte: from, lte: to }, platform, name: { in: QUAL }, userId: { not: null } }, distinct: ["day", "userId"], select: { userId: true, day: true }, take: CAP });
      for (const r of rows) if (r.userId && ids.has(r.userId)) addTo(m, r.day, r.userId);
    }
    return m;
  });
}

const firstDays = async () => new Map((await people()).map((p) => [p.id, dayKey(p.createdAt)]));

/* ---------------- overview ---------------- */

export type Kpi = { key: string; label: string; value: number; prev: number | null; change: number | null; spark: number[]; hint: string; unavailable?: string };
export type Overview = {
  range: Range; platform: PlatformFilter; now: string; trackingSince: string | null;
  kpis: Kpi[];
  installs: { platform: Platform; active: number; uninstalled: number; inRange: number; prev: number }[];
  downloads: { available: false; reason: string };
};

const DEF = new Map<string, string>([
  ["download", "A served app package or a recorded store download. There is no download source yet, so this stays empty rather than guessing."],
  ["install", "A confirmed signal: the Android app's first launch (its install id), the browser's appinstalled event, or the web app running installed. Download clicks never count."],
  ["registered", "One account that still exists. Sample accounts are left out."],
  ["dau", "Unique people with at least one qualifying event on the last UTC day of the range. One person with ten sessions is one."],
  ["wau", "Unique people active on at least one of the 7 UTC days ending the last day of the range."],
  ["mau", "Unique people active on at least one of the 30 UTC days ending the last day of the range."],
  ["online", `Signed in and seen (a heartbeat or an event) in the last ${ONLINE_WINDOW_MS / 60_000} minutes. An estimate, not a live connection count.`],
  ["returning", "Active in the range on a day after the day they signed up."],
]);

export const overview = (q: Query, now = new Date()): Promise<Overview> => cached(`aa:overview:${q.range.from}:${q.range.to}:${q.platform}`, TTL, async () => {
  const { range, platform } = q;
  const loadFrom = addDays(range.prev.from, -30);
  const [byDay, ppl, first, online, since, installRows] = await Promise.all([
    activeByDay(loadFrom, range.to, platform),
    people(),
    firstDays(),
    db.user.count({ where: { ...real, lastSeenAt: { gte: new Date(now.getTime() - ONLINE_WINDOW_MS) } } }),
    cached("aa:since", TTL, trackingSince),
    db.appInstall.findMany({ select: { platform: true, status: true, firstSeenAt: true }, take: CAP }),
  ]);
  const days = rangeDays(range);
  const dauSeries = rolling(days, byDay, 1).map((r) => r.value);
  const wauSeries = rolling(days, byDay, 7).map((r) => r.value);
  const mauSeries = rolling(days, byDay, 30).map((r) => r.value);
  const last = (s: number[]) => s[s.length - 1] ?? 0;
  const prevEnd = (w: number) => rolling([range.prev.to], byDay, w)[0]?.value ?? 0;
  const created = (from: string, to: string) => ppl.filter((p) => dayKey(p.createdAt) >= from && dayKey(p.createdAt) <= to).length;
  const newSeries = days.map((d) => created(d, d));
  const activeInRange = uniqueIn(byDay, range.from, range.to).size;
  const activeInPrev = uniqueIn(byDay, range.prev.from, range.prev.to).size;
  const returning = returningIn(byDay, first, range.from, range.to);
  const returningPrev = returningIn(byDay, first, range.prev.from, range.prev.to);
  const registered = ppl.length;
  const registeredBefore = ppl.filter((p) => dayKey(p.createdAt) <= range.prev.to).length;
  const kpi = (key: string, label: string, value: number, prev: number | null, spark: number[], hint: string, extra: Partial<Kpi> = {}): Kpi => ({ key, label, value, prev, change: prev === null ? null : change(value, prev), spark, hint, ...extra });
  const def = (k: string) => DEF.get(k) ?? "";
  const kpis: Kpi[] = [
    kpi("downloads", "Total downloads", 0, null, [], def("download"), { unavailable: "No download source yet: Outlly does not serve the APK and the Play listing is not live. Installs below are real signals." }),
    kpi("registered", "Registered users", registered, registeredBefore, days.map((d) => ppl.filter((p) => dayKey(p.createdAt) <= d).length), def("registered")),
    kpi("dau", "Daily active (DAU)", last(dauSeries), prevEnd(1), dauSeries, def("dau")),
    kpi("wau", "Weekly active (WAU)", last(wauSeries), prevEnd(7), wauSeries, def("wau")),
    kpi("mau", "Monthly active (MAU)", last(mauSeries), prevEnd(30), mauSeries, def("mau")),
    kpi("online", "Online now", online, null, [], def("online")),
    kpi("new", range.days === 1 ? "New users today" : "New users", created(range.from, range.to), created(range.prev.from, range.prev.to), newSeries, def("registered")),
    kpi("returning", "Returning users", returning, returningPrev, days.map((d) => returningIn(byDay, first, d, d)), def("returning")),
    kpi("active", "Active in range", activeInRange, activeInPrev, dauSeries, "Unique people active on at least one day of the range."),
  ];
  const plats: Platform[] = ["android", "ios", "pwa"];
  const installs = plats.map((p) => {
    const rows = installRows.filter((r) => r.platform === p);
    const inWin = (from: string, to: string) => rows.filter((r) => dayKey(r.firstSeenAt) >= from && dayKey(r.firstSeenAt) <= to).length;
    return { platform: p, active: rows.filter((r) => r.status === "active").length, uninstalled: rows.filter((r) => r.status === "uninstalled").length, inRange: inWin(range.from, range.to), prev: inWin(range.prev.from, range.prev.to) };
  });
  return { range, platform, now: now.toISOString(), trackingSince: since?.toISOString() ?? null, kpis, installs, downloads: { available: false, reason: "Outlly does not serve the APK itself and the Play listing is not live, so there is no download count to show. Installs are counted from real signals instead." } };
});

/* ---------------- active users ---------------- */

export type Series = { g: Granularity; rows: Record<string, string | number>[]; daily: Record<string, string | number>[] };

export const activeSeries = (q: Query): Promise<Series> => cached(`aa:series:${q.range.from}:${q.range.to}:${q.g}:${q.platform}`, TTL, async () => {
  const { range, g, platform } = q;
  const [byDay, ppl, first, sessions] = await Promise.all([
    activeByDay(addDays(range.from, -30), range.to, platform),
    people(),
    firstDays(),
    db.usageSession.findMany({ where: { startedAt: between(range.from, range.to), ...(platform === "all" ? {} : { platform }) }, select: { startedAt: true }, take: CAP }),
  ]);
  const days = rangeDays(range);
  const sessByDay = new Map<string, number>();
  for (const s of sessions) sessByDay.set(dayKey(s.startedAt), (sessByDay.get(dayKey(s.startedAt)) ?? 0) + 1);
  const newByDay = new Map<string, number>();
  for (const p of ppl) {
    const d = dayKey(p.createdAt);
    if (d >= range.from && d <= range.to) newByDay.set(d, (newByDay.get(d) ?? 0) + 1);
  }
  const dau = rolling(days, byDay, 1), wau = rolling(days, byDay, 7), mau = rolling(days, byDay, 30);
  const daily = days.map((d, i) => ({ label: bucketLabel(d, "day"), day: d, dau: dau[i].value, wau: wau[i].value, mau: mau[i].value, new: newByDay.get(d) ?? 0, returning: returningIn(byDay, first, d, d), sessions: sessByDay.get(d) ?? 0 }));
  const active = bucketUnique(days.map((d) => ({ day: d, ids: byDay.get(d) ?? [] })), g);
  const fresh = bucketSum(days.map((d) => ({ day: d, value: newByDay.get(d) ?? 0 })), g);
  const sess = bucketSum(days.map((d) => ({ day: d, value: sessByDay.get(d) ?? 0 })), g);
  const rows = active.map((b, i) => {
    const bDays = days.filter((d) => bucketOf(d, g) === b.key);
    const ret = returningIn(byDay, first, bDays[0], bDays[bDays.length - 1]);
    return { label: b.label, key: b.key, active: b.value, new: fresh[i]?.value ?? 0, returning: ret, sessions: sess[i]?.value ?? 0 };
  });
  return { g, rows, daily };
});

/* ---------------- engagement ---------------- */

export type Engagement = {
  sessions: number; users: number; perUser: number; avgDurationS: number; medianDurationS: number; eventsPerSession: number;
  events: { name: EventName; label: string; group: string; count: number; users: number }[];
  features: { key: string; label: string; users: number; events: number; adoption: number }[];
  sections: { section: string; views: number }[];
  content: Record<string, string | number>[];
  tracked: boolean;
};

const CONTENT_KEYS = ["content_created", "video_uploaded", "post_scheduled", "post_published"] as const;

export const engagement = (q: Query): Promise<Engagement> => cached(`aa:eng:${q.range.from}:${q.range.to}:${q.g}:${q.platform}`, TTL, async () => {
  const { range, g, platform } = q;
  const pf = platform === "all" ? {} : { platform };
  const ids = new Set((await people()).map((p) => p.id));
  const [sessions, events, views, active] = await Promise.all([
    db.usageSession.findMany({ where: { startedAt: between(range.from, range.to), ...pf }, select: { userId: true, startedAt: true, lastSeenAt: true, events: true }, take: CAP }),
    db.activityEvent.findMany({ where: { day: { gte: range.from, lte: range.to }, userId: { not: null }, ...pf }, select: { name: true, userId: true, day: true }, take: CAP }),
    db.activityEvent.findMany({ where: { day: { gte: range.from, lte: range.to }, name: "page_view", ...pf }, select: { meta: true }, take: CAP }),
    activeByDay(range.from, range.to, platform),
  ]);
  const mine = sessions.filter((s) => ids.has(s.userId));
  const durs = mine.map((s) => Math.max(0, (s.lastSeenAt.getTime() - s.startedAt.getTime()) / 1000)).sort((a, b) => a - b);
  const users = new Set(mine.map((s) => s.userId)).size;
  const byName = new Map<EventName, { count: number; users: Set<string> }>();
  const byFeature = new Map<string, { users: Set<string>; events: number }>();
  const content = new Map<string, Record<string, number>>();
  for (const e of events) {
    if (!e.userId || !ids.has(e.userId) || !isEventName(e.name)) continue;
    const n = byName.get(e.name) ?? byName.set(e.name, { count: 0, users: new Set() }).get(e.name)!;
    n.count++;
    n.users.add(e.userId);
    const f = featureOf(e.name);
    if (f) {
      const r = byFeature.get(f) ?? byFeature.set(f, { users: new Set(), events: 0 }).get(f)!;
      r.users.add(e.userId);
      r.events++;
    }
    if ((CONTENT_KEYS as readonly string[]).includes(e.name)) {
      const c = content.get(e.day) ?? content.set(e.day, {}).get(e.day)!;
      c[e.name] = (c[e.name] ?? 0) + 1;
    }
  }
  const sections = new Map<string, number>();
  for (const v of views) {
    try {
      const s = v.meta ? (JSON.parse(v.meta) as { section?: unknown }).section : null;
      if (typeof s === "string") sections.set(s, (sections.get(s) ?? 0) + 1);
    } catch {}
  }
  const activeUsers = uniqueIn(active, range.from, range.to).size;
  const days = rangeDays(range);
  const contentRows = bucketSum(days.map((d) => ({ day: d, value: 0 })), g).map((b) => {
    const row: Record<string, string | number> = { label: b.label, key: b.key };
    for (const k of CONTENT_KEYS) row[k] = days.filter((d) => bucketOf(d, g) === b.key).reduce((n, d) => n + (content.get(d)?.[k] ?? 0), 0);
    return row;
  });
  return {
    sessions: mine.length,
    users,
    perUser: users ? round1(mine.length / users) : 0,
    avgDurationS: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0,
    medianDurationS: durs.length ? Math.round(durs[Math.floor(durs.length / 2)]) : 0,
    eventsPerSession: mine.length ? round1(mine.reduce((a, s) => a + s.events, 0) / mine.length) : 0,
    events: [...byName].map(([name, v]) => ({ name, label: EVENTS[name].label, group: EVENTS[name].group, count: v.count, users: v.users.size })).sort((a, b) => b.count - a.count),
    features: FEATURES.map((f) => {
      const r = byFeature.get(f.key);
      return { key: f.key, label: f.label, users: r?.users.size ?? 0, events: r?.events ?? 0, adoption: ratio(r?.users.size ?? 0, activeUsers) };
    }).sort((a, b) => b.users - a.users),
    sections: [...sections].map(([section, views]) => ({ section, views })).sort((a, b) => b.views - a.views).slice(0, 12),
    content: contentRows,
    tracked: events.length > 0 || sessions.length > 0,
  };
});

/* ---------------- retention ---------------- */

export type Retention = {
  rows: RetentionRow[]; cohorts: CohortRow[];
  growth: Record<string, string | number>[];
  firstActivity: { measured: number; medianHours: number | null; within24h: number; never: number };
};

export const retention = (q: Query, now = new Date()): Promise<Retention> => cached(`aa:ret:${q.range.from}:${q.range.to}:${q.g}`, TTL, async () => {
  const today = dayKey(now);
  const ppl = await people();
  const byDay = await activeByDay(addDays(today, -160), today, "all");
  const activeIn = (id: string, from: string, to: string) => {
    for (let d = from; d <= to; d = addDays(d, 1)) if (byDay.get(d)?.has(id)) return true;
    return false;
  };
  const members = ppl.map((p) => ({ id: p.id, createdAt: p.createdAt }));
  const rows = retentionRows(members, activeIn, today);
  const cohorts = weeklyCohorts(members, activeIn, now);
  // Growth: sign-ups per bucket, with how many of them have come back on a later day (so far).
  const days = rangeDays(q.range);
  const first = await firstDays();
  const inRange = ppl.filter((p) => dayKey(p.createdAt) >= q.range.from && dayKey(p.createdAt) <= q.range.to);
  const cameBack = (id: string) => {
    const f = first.get(id) ?? "";
    for (const [d, s] of byDay) if (d > f && s.has(id)) return true;
    return false;
  };
  const growth = bucketSum(days.map((d) => ({ day: d, value: inRange.filter((p) => dayKey(p.createdAt) === d).length })), q.g).map((b) => {
    const ids = inRange.filter((p) => bucketOf(dayKey(p.createdAt), q.g) === b.key).map((p) => p.id);
    return { label: b.label, key: b.key, signups: b.value, cameBack: ids.filter(cameBack).length };
  });
  // Registration to first activity: the first qualifying event after sign-up, for people who signed up in the range.
  const cohortIds = inRange.slice(0, 5000).map((p) => p.id);
  const firstEv = cohortIds.length ? await db.activityEvent.groupBy({ by: ["userId"], where: { userId: { in: cohortIds }, name: { in: QUAL } }, _min: { at: true } }).catch(() => []) : [];
  const created = new Map(inRange.map((p) => [p.id, p.createdAt.getTime()]));
  const hours = firstEv
    .map((r) => (r._min.at && r.userId ? (r._min.at.getTime() - (created.get(r.userId) ?? 0)) / 3_600_000 : null))
    .filter((h): h is number => h !== null && h >= 0)
    .sort((a, b) => a - b);
  return {
    rows, cohorts, growth,
    firstActivity: { measured: hours.length, medianHours: hours.length ? round1(hours[Math.floor(hours.length / 2)]) : null, within24h: hours.filter((h) => h <= 24).length, never: Math.max(0, cohortIds.length - hours.length) },
  };
});

/* ---------------- platforms & devices ---------------- */

export type Breakdown = { key: string; label: string; users: number; events: number; share: number }[];
export type Platforms = { platforms: Breakdown; devices: Breakdown; os: Breakdown; browsers: Breakdown; versions: Breakdown; countries: Breakdown; installs: { platform: Platform; label: string; active: number; uninstalled: number; versions: { version: string; count: number }[] }[]; tracked: boolean };

export const platforms = (q: Query): Promise<Platforms> => cached(`aa:plat:${q.range.from}:${q.range.to}`, TTL, async () => {
  const { range } = q;
  const pm = await peopleMap();
  const [events, installs] = await Promise.all([
    db.activityEvent.findMany({ where: { day: { gte: range.from, lte: range.to }, userId: { not: null }, name: { in: QUAL } }, select: { userId: true, platform: true, device: true, os: true, browser: true, version: true }, take: CAP }),
    db.appInstall.findMany({ select: { platform: true, status: true, version: true }, take: CAP }),
  ]);
  type Ev = (typeof events)[number];
  const build = (pickKey: (e: Ev) => string | null | undefined, label: (k: string) => string): Breakdown => {
    const m = new Map<string, { users: Set<string>; events: number }>();
    let total = 0;
    for (const e of events) {
      if (!e.userId || !pm.has(e.userId)) continue;
      const k = pickKey(e) || "unknown";
      const r = m.get(k) ?? m.set(k, { users: new Set(), events: 0 }).get(k)!;
      r.users.add(e.userId);
      r.events++;
      total++;
    }
    return [...m].map(([key, r]) => ({ key, label: label(key), users: r.users.size, events: r.events, share: ratio(r.events, total) })).sort((a, b) => b.users - a.users || b.events - a.events).slice(0, 15);
  };
  const cap = (k: string) => (k === "unknown" ? "Unknown" : k.charAt(0).toUpperCase() + k.slice(1));
  const countryName = (() => {
    try {
      const dn = new Intl.DisplayNames(["en"], { type: "region" });
      return (c: string) => (c === "unknown" ? "Unknown" : dn.of(c) ?? c);
    } catch {
      return (c: string) => c;
    }
  })();
  return {
    platforms: build((e) => e.platform, (k) => (isPlatform(k) ? PLATFORM_LABEL[k] : cap(k))),
    devices: build((e) => e.device, cap),
    os: build((e) => e.os, cap),
    browsers: build((e) => e.browser, cap),
    versions: build((e) => (e.platform === "android" || e.platform === "ios" ? e.version : null), (k) => (k === "unknown" ? "Web (no version)" : k)),
    countries: build((e) => (e.userId ? pm.get(e.userId)?.locCountry : null), countryName),
    installs: (["android", "ios", "pwa"] as Platform[]).map((p) => {
      const rows = installs.filter((r) => r.platform === p);
      const v = new Map<string, number>();
      for (const r of rows) if (r.status === "active") v.set(r.version ?? "unknown", (v.get(r.version ?? "unknown") ?? 0) + 1);
      return { platform: p, label: PLATFORM_LABEL[p], active: rows.filter((r) => r.status === "active").length, uninstalled: rows.filter((r) => r.status === "uninstalled").length, versions: [...v].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count).slice(0, 10) };
    }),
    tracked: events.length > 0,
  };
});

/* ---------------- users table ---------------- */

export const USER_SORTS = [
  { value: "active", label: "Last active" },
  { value: "new", label: "Newest" },
  { value: "old", label: "Oldest" },
  { value: "name", label: "Name" },
] as const;
export const USER_STATUS = [
  { value: "", label: "Any status" },
  { value: "active", label: "Active (7 days)" },
  { value: "new", label: "New (7 days)" },
  { value: "dormant", label: "Dormant (30+ days)" },
  { value: "never", label: "Never active" },
] as const;
export const USER_JOINED = [
  { value: "", label: "Joined any time" },
  { value: "7", label: "Joined in 7 days" },
  { value: "30", label: "Joined in 30 days" },
  { value: "90", label: "Joined in 90 days" },
] as const;
export const USER_PLATFORMS = [
  { value: "", label: "Any platform" },
  { value: "web", label: PLATFORM_LABEL.web },
  { value: "pwa", label: PLATFORM_LABEL.pwa },
  { value: "android", label: PLATFORM_LABEL.android },
  { value: "ios", label: PLATFORM_LABEL.ios },
] as const;
const pick = (v: string | undefined, list: readonly { value: string }[]): string => (v && list.some((o) => o.value === v) ? v : list[0].value);

export type UserFilters = { q: string; platform: string; status: string; joined: string; sort: string; page: number; limit: number };
export const parseUserFilters = (sp: Record<string, string | string[] | undefined>, paging: { page: number; limit: number }): UserFilters => ({
  q: (str(sp.q) ?? "").trim().slice(0, 120),
  platform: pick(str(sp.platform), USER_PLATFORMS),
  status: pick(str(sp.status), USER_STATUS),
  joined: pick(str(sp.joined), USER_JOINED),
  sort: pick(str(sp.sort), USER_SORTS),
  page: paging.page,
  limit: paging.limit,
});

export type UserStatus = "active" | "new" | "dormant" | "never" | "quiet";
export type UserRow = {
  id: string; name: string; email: string; createdAt: string; lastActiveAt: string | null; lastLoginAt: string | null;
  platform: Platform | null; device: string | null; version: string | null; sessions: number; status: UserStatus;
};
export type UsersPage = { rows: UserRow[]; total: number; page: number; limit: number };

const statusOf = (createdAt: Date, lastActiveAt: Date | null, now: number): UserStatus => {
  if (!lastActiveAt) return "never";
  if (now - lastActiveAt.getTime() <= 7 * 864e5) return now - createdAt.getTime() <= 7 * 864e5 ? "new" : "active";
  if (now - lastActiveAt.getTime() > 30 * 864e5) return "dormant";
  return "quiet";
};

async function userWhere(f: UserFilters, now: Date) {
  const ci = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? { mode: "insensitive" as const } : {};
  const and: object[] = [real];
  if (f.q) and.push({ OR: [{ name: { contains: f.q, ...ci } }, { email: { contains: f.q, ...ci } }, { id: f.q }] });
  const d7 = new Date(now.getTime() - 7 * 864e5), d30 = new Date(now.getTime() - 30 * 864e5);
  if (f.status === "active") and.push({ lastActiveAt: { gte: d7 } });
  if (f.status === "new") and.push({ createdAt: { gte: d7 } });
  if (f.status === "dormant") and.push({ lastActiveAt: { lt: d30 } });
  if (f.status === "never") and.push({ lastActiveAt: null });
  if (f.joined) and.push({ createdAt: { gte: new Date(now.getTime() - Number(f.joined) * 864e5) } });
  if (f.platform) {
    const s = await db.usageSession.findMany({ where: { platform: f.platform, lastSeenAt: { gte: new Date(now.getTime() - 90 * 864e5) } }, distinct: ["userId"], select: { userId: true }, take: 20_000 });
    and.push({ id: { in: s.map((x) => x.userId) } });
  }
  return { AND: and };
}

const userOrder = (sort: string) =>
  sort === "new" ? [{ createdAt: "desc" as const }]
  : sort === "old" ? [{ createdAt: "asc" as const }]
  : sort === "name" ? [{ name: "asc" as const }]
  : [{ lastActiveAt: { sort: "desc" as const, nulls: "last" as const } }, { createdAt: "desc" as const }];

/** Per-person session facts for a short id list (one page or one export slice): count, the latest session's placement, the latest sign-in. */
async function decorate(users: { id: string; name: string; email: string; createdAt: Date; lastActiveAt: Date | null }[], role: AdminRole, now: Date): Promise<UserRow[]> {
  const ids = users.map((u) => u.id);
  if (!ids.length) return [];
  const [counts, latest, logins] = await Promise.all([
    db.usageSession.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _count: { _all: true } }),
    db.usageSession.findMany({ where: { userId: { in: ids } }, orderBy: { lastSeenAt: "desc" }, distinct: ["userId"], select: { userId: true, platform: true, device: true, version: true } }),
    db.activityEvent.findMany({ where: { userId: { in: ids }, name: { in: ["login", "signup"] } }, orderBy: { at: "desc" }, distinct: ["userId"], select: { userId: true, at: true } }),
  ]);
  const c = new Map(counts.map((r) => [r.userId, r._count._all]));
  const l = new Map(latest.map((r) => [r.userId, r]));
  const g = new Map(logins.map((r) => [r.userId ?? "", r.at]));
  return users.map((u) => {
    const s = l.get(u.id);
    return { id: u.id, name: u.name, email: adminEmail(u.email, role), createdAt: u.createdAt.toISOString(), lastActiveAt: u.lastActiveAt?.toISOString() ?? null, lastLoginAt: g.get(u.id)?.toISOString() ?? null, platform: s && isPlatform(s.platform) ? s.platform : null, device: s?.device ?? null, version: s?.version ?? null, sessions: c.get(u.id) ?? 0, status: statusOf(u.createdAt, u.lastActiveAt, now.getTime()) };
  });
}

const sel = { id: true, name: true, email: true, createdAt: true, lastActiveAt: true } as const;

export async function usersPage(f: UserFilters, role: AdminRole, now = new Date()): Promise<UsersPage> {
  const where = await userWhere(f, now);
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, orderBy: userOrder(f.sort), skip: (f.page - 1) * f.limit, take: f.limit, select: sel }),
    db.user.count({ where }),
  ]);
  return { rows: await decorate(rows, role, now), total, page: f.page, limit: f.limit };
}

export async function usersCsv(f: UserFilters, role: AdminRole, now = new Date()): Promise<string> {
  const where = await userWhere(f, now);
  const rows = await db.user.findMany({ where, orderBy: userOrder(f.sort), take: 5000, select: sel });
  const out: UserRow[] = [];
  for (let i = 0; i < rows.length; i += 500) out.push(...(await decorate(rows.slice(i, i + 500), role, now)));
  return toCsv(
    ["id", "name", "email", "registered", "last_active", "last_login", "platform", "device", "app_version", "sessions", "status"],
    out.map((r) => [r.id, r.name, r.email, r.createdAt, r.lastActiveAt, r.lastLoginAt, r.platform, r.device, r.version, r.sessions, r.status]),
  );
}

/* ---------------- one person ---------------- */

export type UserDetail = {
  user: UserRow & { timezone: string; country: string | null };
  totals: { events: number; sessions: number; activeDays: number; firstEventAt: string | null };
  events: { at: string; name: string; label: string; platform: string; device: string | null; meta: Record<string, string | number> | null }[];
  sessions: { startedAt: string; lastSeenAt: string; endedAt: string | null; durationS: number; platform: string; device: string | null; os: string | null; browser: string | null; version: string | null; events: number }[];
  platforms: { platform: string; label: string; sessions: number; durationS: number }[];
  features: { key: string; label: string; count: number; lastAt: string | null }[];
  days: string[];
};

const parseMeta = (m: string | null): Record<string, string | number> | null => {
  if (!m) return null;
  try {
    const v = JSON.parse(m) as Record<string, string | number>;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};
const durS = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));

export async function userDetail(id: string, role: AdminRole, now = new Date()): Promise<UserDetail | null> {
  const u = await db.user.findFirst({ where: { id, ...real }, select: { ...sel, timezone: true, locCountry: true } });
  if (!u) return null;
  const [row] = await decorate([u], role, now);
  const [events, sessions, allSessions, eventCount, days, firstEv, featureRows] = await Promise.all([
    db.activityEvent.findMany({ where: { userId: id }, orderBy: { at: "desc" }, take: 200, select: { at: true, name: true, platform: true, device: true, meta: true } }),
    db.usageSession.findMany({ where: { userId: id }, orderBy: { startedAt: "desc" }, take: 50 }),
    db.usageSession.findMany({ where: { userId: id }, select: { platform: true, startedAt: true, lastSeenAt: true }, take: 5000 }),
    db.activityEvent.count({ where: { userId: id } }),
    db.userActivityDay.findMany({ where: { userId: id, day: { gte: addDays(dayKey(now), -90) } }, select: { day: true }, orderBy: { day: "asc" } }),
    db.activityEvent.findFirst({ where: { userId: id }, orderBy: { at: "asc" }, select: { at: true } }),
    db.activityEvent.groupBy({ by: ["name"], where: { userId: id }, _count: { _all: true }, _max: { at: true } }),
  ]);
  const plat = new Map<string, { sessions: number; durationS: number }>();
  for (const s of allSessions) {
    const r = plat.get(s.platform) ?? plat.set(s.platform, { sessions: 0, durationS: 0 }).get(s.platform)!;
    r.sessions++;
    r.durationS += durS(s.startedAt, s.lastSeenAt);
  }
  const feat = new Map<string, { count: number; lastAt: Date | null }>();
  for (const r of featureRows) {
    const f = featureOf(r.name);
    if (!f) continue;
    const cur = feat.get(f) ?? feat.set(f, { count: 0, lastAt: null }).get(f)!;
    cur.count += r._count._all;
    if (r._max.at && (!cur.lastAt || r._max.at > cur.lastAt)) cur.lastAt = r._max.at;
  }
  return {
    user: { ...row, timezone: u.timezone, country: u.locCountry },
    totals: { events: eventCount, sessions: allSessions.length, activeDays: days.length, firstEventAt: firstEv?.at.toISOString() ?? null },
    events: events.map((e) => ({ at: e.at.toISOString(), name: e.name, label: eventLabel(e.name), platform: e.platform, device: e.device, meta: parseMeta(e.meta) })),
    sessions: sessions.map((s) => ({ startedAt: s.startedAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null, durationS: durS(s.startedAt, s.lastSeenAt), platform: s.platform, device: s.device, os: s.os, browser: s.browser, version: s.version, events: s.events })),
    platforms: [...plat].map(([platform, r]) => ({ platform, label: isPlatform(platform) ? PLATFORM_LABEL[platform] : platform, ...r })).sort((a, b) => b.sessions - a.sessions),
    features: FEATURES.map((f) => ({ key: f.key, label: f.label, count: feat.get(f.key)?.count ?? 0, lastAt: feat.get(f.key)?.lastAt?.toISOString() ?? null })).filter((f) => f.count > 0).sort((a, b) => b.count - a.count),
    days: days.map((d) => d.day),
  };
}

/* ---------------- live ---------------- */

export type Live = {
  at: string; online: number; lastHour: { logins: number; signups: number; created: number; published: number; connected: number; installs: number };
  recent: { at: string; name: string; label: string; platform: string; user: { id: string; name: string; email: string } | null }[];
};

const LIVE_NAMES: EventName[] = ["login", "signup", "content_created", "post_published", "post_scheduled", "account_connected", "pwa_installed", "app_first_launch", "video_uploaded"];

export const live = (role: AdminRole, now = new Date()): Promise<Live> => cached(`aa:live:${role}`, 10_000, async () => {
  const pm = await peopleMap();
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [online, hour, recent] = await Promise.all([
    db.user.count({ where: { ...real, lastSeenAt: { gte: new Date(now.getTime() - ONLINE_WINDOW_MS) } } }),
    db.activityEvent.groupBy({ by: ["name"], where: { at: { gte: hourAgo }, name: { in: LIVE_NAMES } }, _count: { _all: true } }),
    db.activityEvent.findMany({ where: { at: { gte: new Date(now.getTime() - 15 * 60_000) }, name: { in: LIVE_NAMES } }, orderBy: { at: "desc" }, take: 40, select: { at: true, name: true, platform: true, userId: true } }),
  ]);
  const h = new Map(hour.map((r) => [r.name, r._count._all]));
  const n = (k: EventName) => h.get(k) ?? 0;
  return {
    at: now.toISOString(),
    online,
    lastHour: { logins: n("login"), signups: n("signup"), created: n("content_created"), published: n("post_published"), connected: n("account_connected"), installs: n("pwa_installed") + n("app_first_launch") },
    recent: recent
      .filter((e) => !e.userId || pm.has(e.userId))
      .map((e) => {
        const p = e.userId ? pm.get(e.userId) : null;
        return { at: e.at.toISOString(), name: e.name, label: eventLabel(e.name), platform: e.platform, user: p ? { id: p.id, name: p.name, email: adminEmail(p.email, role) } : null };
      }),
  };
});

/* ---------------- exports ---------------- */

export const EXPORTS = ["daily", "buckets", "retention", "cohorts", "platforms", "events", "features"] as const;
export type ExportKind = (typeof EXPORTS)[number];
export const isExportKind = (v: string | null | undefined): v is ExportKind => !!v && (EXPORTS as readonly string[]).includes(v);

export async function exportCsv(kind: ExportKind, q: Query): Promise<string> {
  if (kind === "daily") {
    const s = await activeSeries(q);
    return toCsv(["day", "dau", "wau", "mau", "new_users", "returning", "sessions"], s.daily.map((r) => [r.day, r.dau, r.wau, r.mau, r.new, r.returning, r.sessions]));
  }
  if (kind === "buckets") {
    const s = await activeSeries(q);
    return toCsv([q.g, "active_users", "new_users", "returning", "sessions"], s.rows.map((r) => [r.key, r.active, r.new, r.returning, r.sessions]));
  }
  if (kind === "retention") {
    const r = await retention(q);
    return toCsv(["window", "eligible", "retained", "rate", "pending"], r.rows.map((x) => [x.label, x.eligible, x.retained, x.rate, x.pending]));
  }
  if (kind === "cohorts") {
    const r = await retention(q);
    const n = r.cohorts[0]?.weeks.length ?? 0;
    return toCsv(["cohort_week", "size", ...Array.from({ length: n }, (_, i) => `w${i}`)], r.cohorts.map((c) => [c.start, c.size, ...c.weeks.map((w) => (w === null ? "" : w))]));
  }
  if (kind === "platforms") {
    const p = await platforms(q);
    const rows: (string | number)[][] = [];
    for (const [dim, list] of Object.entries({ platform: p.platforms, device: p.devices, os: p.os, browser: p.browsers, version: p.versions, country: p.countries })) for (const r of list) rows.push([dim, r.label, r.users, r.events, r.share]);
    return toCsv(["dimension", "value", "users", "events", "share"], rows);
  }
  if (kind === "features") {
    const e = await engagement(q);
    return toCsv(["feature", "users", "events", "adoption"], e.features.map((f) => [f.label, f.users, f.events, f.adoption]));
  }
  const e = await engagement(q);
  return toCsv(["event", "group", "count", "users"], e.events.map((x) => [x.label, x.group, x.count, x.users]));
}
