import { addDays, dayKey } from "@/lib/admin/activation";
import { ONLINE_WINDOW_MS } from "@/lib/presence-core";

/**
 * R1308 App Analytics: the pure rules. Which events exist and which of them make a person "active", how a
 * request is placed on a platform and device, how a date range and its comparison window are read, how days are
 * bucketed into weeks and months, and how a change is expressed. Everything here is tested in isolation; the
 * database work is in lib/analytics/activity.ts (writes) and lib/admin/app-analytics.ts (reads).
 *
 * Definitions (printed on the admin page as well, so they never drift):
 * - Active: at least one qualifying event on a UTC calendar day. Heartbeats, background publishing and automatic
 *   refreshes never qualify.
 * - DAU / WAU / MAU: unique people active on a day / in the last 7 days / in the last 30 days.
 * - Online: an authenticated heartbeat or event in the last ONLINE_WINDOW_MS (5 minutes). An estimate.
 * - Session: events from one sign-in (or one app install) with no gap over SESSION_GAP_MS.
 * - Install: a confirmed installation signal (first launch of the app, the browser's appinstalled event), never a
 *   download click.
 */

export type Platform = "web" | "pwa" | "android" | "ios" | "server";
export const PLATFORMS: readonly Platform[] = ["web", "pwa", "android", "ios", "server"];
export const PLATFORM_LABEL: Record<Platform | "all", string> = { all: "All platforms", web: "Web app", pwa: "Installed web app", android: "Android app", ios: "iOS app", server: "Background" };
export const isPlatform = (v: string | null | undefined): v is Platform => !!v && (PLATFORMS as readonly string[]).includes(v);

export type Device = "phone" | "tablet" | "desktop";

export type EventGroup = "auth" | "navigation" | "content" | "social" | "engagement" | "team" | "billing" | "install";

export type EventDef = {
  label: string;
  group: EventGroup;
  /** Counts the person as active that day (the DAU/WAU/MAU rule). */
  qualifies: boolean;
  /** Which product feature this shows adoption of (null = none). */
  feature: string | null;
  /** May arrive from the browser through POST /api/track (everything else is written by the server). */
  client: boolean;
};

export const EVENTS = {
  login: { label: "Signed in", group: "auth", qualifies: true, feature: null, client: false },
  logout: { label: "Signed out", group: "auth", qualifies: false, feature: null, client: false },
  signup: { label: "Registered", group: "auth", qualifies: true, feature: null, client: false },
  page_view: { label: "Opened a page", group: "navigation", qualifies: true, feature: null, client: true },
  dashboard_visit: { label: "Opened the dashboard", group: "navigation", qualifies: true, feature: "dashboard", client: true },
  analytics_visit: { label: "Opened analytics", group: "navigation", qualifies: true, feature: "analytics", client: true },
  account_connected: { label: "Connected a social account", group: "social", qualifies: true, feature: "connect", client: false },
  content_created: { label: "Created a post", group: "content", qualifies: true, feature: "create", client: false },
  draft_created: { label: "Saved a draft", group: "content", qualifies: true, feature: "create", client: false },
  video_uploaded: { label: "Uploaded media", group: "content", qualifies: true, feature: "upload", client: false },
  post_scheduled: { label: "Scheduled a post", group: "content", qualifies: true, feature: "schedule", client: false },
  post_published: { label: "Post went live", group: "content", qualifies: false, feature: "publish", client: false },
  content_deleted: { label: "Deleted content", group: "content", qualifies: true, feature: null, client: false },
  ai_reply_used: { label: "Used an AI reply", group: "engagement", qualifies: true, feature: "ai_reply", client: false },
  comment_managed: { label: "Managed a comment", group: "engagement", qualifies: true, feature: "inbox", client: false },
  team_invited: { label: "Invited a teammate", group: "team", qualifies: true, feature: "team", client: false },
  subscription_started: { label: "Started a subscription", group: "billing", qualifies: true, feature: "billing", client: false },
  subscription_canceled: { label: "Cancelled a subscription", group: "billing", qualifies: true, feature: "billing", client: false },
  payment_succeeded: { label: "Payment succeeded", group: "billing", qualifies: false, feature: "billing", client: false },
  payment_failed: { label: "Payment failed", group: "billing", qualifies: false, feature: null, client: false },
  app_open: { label: "Opened the app", group: "navigation", qualifies: true, feature: null, client: false },
  app_first_launch: { label: "First app launch", group: "install", qualifies: true, feature: null, client: false },
  pwa_installed: { label: "Installed the web app", group: "install", qualifies: true, feature: null, client: true },
} as const satisfies Record<string, EventDef>;

export type EventName = keyof typeof EVENTS;
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[];
export const isEventName = (v: string): v is EventName => Object.prototype.hasOwnProperty.call(EVENTS, v);
export const CLIENT_EVENTS = EVENT_NAMES.filter((n) => EVENTS[n].client);
export const QUALIFYING = new Set<string>(EVENT_NAMES.filter((n) => EVENTS[n].qualifies));
export const qualifies = (name: string) => QUALIFYING.has(name);
export const eventLabel = (name: string) => (isEventName(name) ? EVENTS[name].label : name);

export const FEATURES: { key: string; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "create", label: "Create" },
  { key: "upload", label: "Uploads" },
  { key: "schedule", label: "Scheduling" },
  { key: "publish", label: "Publishing" },
  { key: "connect", label: "Social accounts" },
  { key: "analytics", label: "Analytics" },
  { key: "inbox", label: "Inbox" },
  { key: "ai_reply", label: "AI replies" },
  { key: "team", label: "Team" },
  { key: "billing", label: "Billing" },
];
export const featureOf = (name: string): string | null => (isEventName(name) ? EVENTS[name].feature : null);

/** The studio sections a page_view is folded into (ids and query strings dropped; nothing personal). */
export function sectionOf(path: string): string {
  const seg = path.split("?")[0].split("/").filter(Boolean)[0] ?? "";
  return /^[a-z][a-z0-9-]{0,30}$/.test(seg) ? seg : "other";
}

/* ---------------- sessions, presence ---------------- */

export const SESSION_GAP_MS = 30 * 60_000;
export { ONLINE_WINDOW_MS };
/** A browser heartbeat every 2 minutes while the tab is visible: well inside the online window, far from a poll storm. */
export const HEARTBEAT_MS = 120_000;
export const MAX_BATCH = 20;
export const MAX_META_BYTES = 400;

/** The same stretch of use continues when the last event was under SESSION_GAP_MS ago. */
export const sameSession = (lastSeenAt: Date | number, now: Date | number) => +now - +lastSeenAt < SESSION_GAP_MS;

/* ---------------- client placement ---------------- */

export type ClientInfo = { platform: Platform; device: Device; os: string; browser: string; version: string | null };

/** Coarse buckets only: a user agent string is never stored. */
export function uaInfo(ua: string | null | undefined): { device: Device; os: string; browser: string } {
  const u = ua ?? "";
  const tablet = /iPad|Tablet|PlayBook|Silk/i.test(u) || (/Android/i.test(u) && !/Mobile/i.test(u)) || (/Macintosh/i.test(u) && /Mobile/i.test(u));
  const phone = !tablet && /Mobi|iPhone|iPod|Android|Windows Phone/i.test(u);
  const device: Device = tablet ? "tablet" : phone ? "phone" : "desktop";
  const os = /Android/i.test(u) ? "Android" : /iPhone|iPad|iPod/i.test(u) ? "iOS" : /Windows/i.test(u) ? "Windows" : /Mac OS X|Macintosh/i.test(u) ? "macOS" : /CrOS/i.test(u) ? "ChromeOS" : /Linux/i.test(u) ? "Linux" : "Other";
  const browser = /OutllyApp|; wv\)/i.test(u) ? "Outlly app" : /Edg\//i.test(u) ? "Edge" : /OPR\/|Opera/i.test(u) ? "Opera" : /SamsungBrowser/i.test(u) ? "Samsung Internet" : /Firefox\/|FxiOS/i.test(u) ? "Firefox" : /Chrome\/|CriOS/i.test(u) ? "Chrome" : /Safari\//i.test(u) ? "Safari" : "Other";
  return { device, os, browser };
}

export const SHELL_COOKIE = "outly_shell";

/**
 * Where a request comes from. The native app names itself (x-outlly-client, lib/native-client.ts); an installed web app
 * says so through the shell cookie the browser tracker keeps while it runs standalone; everything else is the web app.
 */
export function clientInfo(o: { ua: string | null | undefined; native: { platform: "android" | "ios"; version: string } | null; shell?: string | null }): ClientInfo {
  const base = uaInfo(o.ua);
  if (o.native) return { platform: o.native.platform, device: base.device === "desktop" ? "phone" : base.device, os: o.native.platform === "ios" ? "iOS" : "Android", browser: "Outlly app", version: o.native.version };
  return { ...base, platform: o.shell === "pwa" ? "pwa" : "web", version: null };
}

/* ---------------- ranges ---------------- */

export const RANGE_PRESETS = [
  { key: "today", label: "Today", days: 1 },
  { key: "yesterday", label: "Yesterday", days: 1 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "180", label: "Last 6 months", days: 182 },
  { key: "365", label: "Last 12 months", days: 365 },
] as const;
export type RangeKey = (typeof RANGE_PRESETS)[number]["key"] | "custom";
export const MAX_RANGE_DAYS = 366;
export type Range = { key: RangeKey; from: string; to: string; days: number; label: string; prev: { from: string; to: string } };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: string | null | undefined): v is string => !!v && DAY_RE.test(v) && dayKey(new Date(v + "T00:00:00Z")) === v;
export const spanDays = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;

const fmtDay = (k: string) => new Date(k + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A custom from/to pair (inclusive UTC days, `to` capped at today, at most MAX_RANGE_DAYS) wins over the preset; anything
 * malformed falls back to the preset, and an unknown preset to 30 days. The comparison window is the same number of
 * days ending the day before `from`.
 */
export function parseRange(q: { r?: string | null; from?: string | null; to?: string | null }, now = new Date()): Range {
  const today = dayKey(now);
  const finish = (key: RangeKey, from: string, to: string, label: string): Range => {
    const days = spanDays(from, to);
    return { key, from, to, days, label, prev: { from: addDays(from, -days), to: addDays(from, -1) } };
  };
  if (validDay(q.from) && validDay(q.to) && q.from <= q.to && q.from <= today) {
    const to = q.to > today ? today : q.to;
    const from = spanDays(q.from, to) > MAX_RANGE_DAYS ? addDays(to, -(MAX_RANGE_DAYS - 1)) : q.from;
    return finish("custom", from, to, `${fmtDay(from)} to ${fmtDay(to)}`);
  }
  const p = RANGE_PRESETS.find((x) => x.key === q.r) ?? RANGE_PRESETS[3];
  if (p.key === "yesterday") return finish("yesterday", addDays(today, -1), addDays(today, -1), p.label);
  return finish(p.key, addDays(today, -(p.days - 1)), today, p.label);
}

export const rangeDays = (r: { from: string; to: string }) => Array.from({ length: spanDays(r.from, r.to) }, (_, i) => addDays(r.from, i));

/* ---------------- buckets ---------------- */

export type Granularity = "day" | "week" | "month";
export const parseGranularity = (v: string | null | undefined, days: number): Granularity => (v === "week" || v === "month" ? v : v === "day" ? "day" : days > 120 ? "month" : days > 31 ? "week" : "day");

/** Monday of the ISO week (UTC), or the month, as the bucket key. */
export function bucketOf(day: string, g: Granularity): string {
  if (g === "day") return day;
  if (g === "month") return day.slice(0, 7);
  const d = new Date(day + "T00:00:00Z");
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

export function bucketLabel(key: string, g: Granularity): string {
  if (g === "month") return new Date(key + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
  const d = new Date(key + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return g === "week" ? `wk ${d}` : d;
}

/** Day values summed into buckets, in order; `unique` buckets take a set union instead (for unique users). */
export function bucketSum(rows: { day: string; value: number }[], g: Granularity): { key: string; label: string; value: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = bucketOf(r.day, g);
    m.set(k, (m.get(k) ?? 0) + r.value);
  }
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, label: bucketLabel(key, g), value }));
}

export function bucketUnique(rows: { day: string; ids: Iterable<string> }[], g: Granularity): { key: string; label: string; value: number }[] {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = bucketOf(r.day, g);
    const s = m.get(k) ?? new Set<string>();
    for (const id of r.ids) s.add(id);
    m.set(k, s);
  }
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([key, s]) => ({ key, label: bucketLabel(key, g), value: s.size }));
}

/* ---------------- active users ---------------- */

/** Per day in `days`, the unique people active in the trailing `window` days ending that day (WAU: 7, MAU: 30). */
export function rolling(days: string[], byDay: Map<string, Set<string>>, window: number): { day: string; value: number }[] {
  return days.map((day) => {
    const s = new Set<string>();
    for (let i = 0; i < window; i++) for (const id of byDay.get(addDays(day, -i)) ?? []) s.add(id);
    return { day, value: s.size };
  });
}

export const uniqueIn = (byDay: Map<string, Set<string>>, from: string, to: string) => {
  const s = new Set<string>();
  for (const [d, ids] of byDay) if (d >= from && d <= to) for (const id of ids) s.add(id);
  return s;
};

/** Returning = active in the window on a day after their first ever active day (first day from `firstDay`). */
export function returningIn(byDay: Map<string, Set<string>>, firstDay: Map<string, string>, from: string, to: string): number {
  let n = 0;
  for (const id of uniqueIn(byDay, from, to)) {
    const first = firstDay.get(id);
    if (first !== undefined && first < to) {
      // active on some window day later than the first day
      let later = false;
      for (const [d, ids] of byDay) if (d >= from && d <= to && d > first && ids.has(id)) { later = true; break; }
      if (later) n++;
    }
  }
  return n;
}

/* ---------------- change ---------------- */

/** Percent change as a ratio (0.25 = +25%); null when there is nothing to compare against. */
export const change = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 1000 : null);
export const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : 0);

/* ---------------- CSV ---------------- */

const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet: quote it with a space in front.
  const safe = /^[=+\-@]/.test(s) ? ` ${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (head: string[], rows: (string | number | null | undefined)[][]) => [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/* ---------------- meta ---------------- */

/** Small, flat, no personal data: strings and numbers only, keys from a short allow-list, under MAX_META_BYTES. */
const META_KEYS = new Set(["section", "platform", "format", "count", "plan", "reason", "source", "kind"]);
export function cleanMeta(input: unknown): Record<string, string | number> | null {
  if (!input || typeof input !== "object") return null;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!META_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v);
    else if (typeof v === "string" && v.length <= 60) out[k] = v;
  }
  if (!Object.keys(out).length) return null;
  return JSON.stringify(out).length <= MAX_META_BYTES ? out : null;
}

/* ---------------- definitions, printed on the page ---------------- */

export const DEFINITIONS: { key: string; label: string; rule: string }[] = [
  { key: "download", label: "Download", rule: "A served app package or a recorded store download. Outlly does not serve the APK itself and the Play listing is not live, so there is no download source yet; the card says so instead of guessing." },
  { key: "install", label: "Install", rule: "A confirmed signal: the Android app's first launch (its install id), the browser's appinstalled event, or the web app running installed. Download clicks never count." },
  { key: "registered", label: "Registered user", rule: "One account that still exists. Sample accounts and deleted accounts are left out." },
  { key: "dau", label: "DAU", rule: "Unique people with at least one qualifying event on a UTC calendar day. One person with ten sessions is one." },
  { key: "wau", label: "WAU", rule: "Unique people active on at least one of the last 7 UTC days." },
  { key: "mau", label: "MAU", rule: "Unique people active on at least one of the last 30 UTC days." },
  { key: "online", label: "Online now", rule: `Signed in and seen (a heartbeat or an event) in the last ${ONLINE_WINDOW_MS / 60_000} minutes. An estimate, not a live connection count.` },
  { key: "returning", label: "Returning user", rule: "Active in the range on a day after their first ever active day." },
  { key: "session", label: "Session", rule: `Events from one sign-in or install with no silence longer than ${SESSION_GAP_MS / 60_000} minutes. Duration runs from the first to the last event; the browser heartbeat extends it only while the tab is visible.` },
  { key: "retention", label: "Retention", rule: "The share of a sign-up cohort active again in the window: day 1 (the next UTC day), week one (days 1 to 7), month one (days 8 to 30). A cohort counts only once its window has fully ended." },
];
