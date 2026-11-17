import { channelLabel, parseSource } from "@/lib/growth/core";
import { addDays, dayKey, TZ } from "./activation";

/**
 * 1166: Admin > Analytics, "Outlly data". Pure counting rules so each one is tested. Days are UTC calendar days and
 * both ends of the window are included. Outlly data and PostHog are never added together: the page shows one source.
 */

export const PRESETS = [7, 30, 90] as const;
export type Preset = (typeof PRESETS)[number];
export const MAX_CUSTOM_DAYS = 366;
export type AnalyticsWindow = { from: string; to: string; days: number; preset: Preset | null; custom: boolean };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: string | null | undefined): v is string => !!v && DAY_RE.test(v) && dayKey(new Date(v + "T00:00:00Z")) === v;
const spanDays = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000) + 1;

/**
 * A custom from/to pair wins when both are real days with from <= to. `to` is capped at today, and the span at
 * MAX_CUSTOM_DAYS (the start moves forward). Anything else falls back to the preset (30 days unless 7 or 90).
 */
export function parseWindow(q: { d?: string | null; from?: string | null; to?: string | null }, now = new Date()): AnalyticsWindow {
  const today = dayKey(now);
  if (validDay(q.from) && validDay(q.to) && q.from <= q.to && q.from <= today) {
    const to = q.to > today ? today : q.to;
    const from = spanDays(q.from, to) > MAX_CUSTOM_DAYS ? addDays(to, -(MAX_CUSTOM_DAYS - 1)) : q.from;
    return { from, to, days: spanDays(from, to), preset: null, custom: true };
  }
  const preset: Preset = q.d === "7" ? 7 : q.d === "90" ? 90 : 30;
  return { from: addDays(today, -(preset - 1)), to: today, days: preset, preset, custom: false };
}

export const windowDays = (w: AnalyticsWindow) => Array.from({ length: w.days }, (_, i) => addDays(w.from, i));
export const windowLabel = (w: AnalyticsWindow) => {
  const f = (k: string) => new Date(k + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return w.custom ? `${f(w.from)} to ${f(w.to)}` : `Last ${w.days} days`;
};

export type AnalyticsInput = {
  /** accounts created inside the window */
  users: { id: string; email: string; createdAt: Date; signupSource: string | null; locCountry: string | null }[];
  /** ids of users (any time) with a linked social account, a real published post, a live paid plan */
  connected: string[];
  publishers: string[];
  paying: string[];
  /** waitlist entries created inside the window, and every account email (lower-cased match) */
  waitlist: { email: string; createdAt: Date }[];
  accountEmails: string[];
  /** activity days inside the window, plus today's whatever the window */
  activity: { userId: string; day: string }[];
  /** real (not practice) published targets inside the window */
  published: { postId: string; platform: string; publishedAt: Date }[];
};

export type Row = { label: string; count: number };
export type OutllyAnalytics = {
  window: AnalyticsWindow;
  timezone: typeof TZ;
  totals: { signups: number; waitlist: number; active: number; activeToday: number; postsPublished: number; publishes: number };
  daily: { day: string; signups: number; waitlist: number; posts: number; publishes: number }[];
  funnel: { key: string; label: string; rule: string; count: number; pctOfStart: number; stepRate: number | null; dropped: number; skipped: number }[];
  waitlist: { joined: number; withAccount: number; inCohort: number };
  sources: { label: string; signups: number; connected: number; posted: number; paid: number }[];
  countries: Row[];
  platforms: Row[];
};

const ratio = (a: number, b: number) => (b ? a / b : 0);
const round = (n: number, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

/** Top `n` rows by count, then one "Other" row holding the rest, so the rows always add up to the total. */
export function topWithOther<T extends { label: string }>(rows: T[], n: number, count: (r: T) => number, other: (rest: T[]) => T): T[] {
  const sorted = [...rows].sort((a, b) => count(b) - count(a) || a.label.localeCompare(b.label));
  if (sorted.length <= n + 1) return sorted;
  return [...sorted.slice(0, n), other(sorted.slice(n))];
}

export const ANALYTICS_FUNNEL = [
  { key: "signup", label: "Signed up", rule: "Account created in the range." },
  { key: "connect", label: "Connected a platform", rule: "Has linked at least one social account." },
  { key: "publish", label: "Published a post", rule: "At least one post went live. Practice runs do not count." },
  { key: "paid", label: "Paying now", rule: "Has an active or past-due paid plan today." },
] as const;

export function buildAnalytics(input: AnalyticsInput, w: AnalyticsWindow, countryName: (code: string | null) => string, platformName: (p: string) => string, now = new Date()): OutllyAnalytics {
  const today = dayKey(now);
  const inWin = (k: string) => k >= w.from && k <= w.to;
  const users = input.users.filter((u) => inWin(dayKey(u.createdAt)));
  const waits = input.waitlist.filter((x) => inWin(dayKey(x.createdAt)));
  const pubs = input.published.filter((t) => inWin(dayKey(t.publishedAt)));

  // A post that went to three platforms is one post: it lands on the day of its first real publish in the window.
  const firstPub = new Map<string, string>();
  for (const t of pubs) {
    const k = dayKey(t.publishedAt);
    const cur = firstPub.get(t.postId);
    if (!cur || k < cur) firstPub.set(t.postId, k);
  }
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const sBy = count(users.map((u) => dayKey(u.createdAt)));
  const wBy = count(waits.map((x) => dayKey(x.createdAt)));
  const pBy = count([...firstPub.values()]);
  const tBy = count(pubs.map((t) => dayKey(t.publishedAt)));
  const daily = windowDays(w).map((day) => ({ day, signups: sBy.get(day) ?? 0, waitlist: wBy.get(day) ?? 0, posts: pBy.get(day) ?? 0, publishes: tBy.get(day) ?? 0 }));

  const act = input.activity.filter((a) => inWin(a.day));
  const sets = { connect: new Set(input.connected), publish: new Set(input.publishers), paid: new Set(input.paying) };
  let pool = users.map((u) => u.id);
  const funnel = ANALYTICS_FUNNEL.map((s, i) => {
    const before = pool;
    const set = i ? sets[s.key as keyof typeof sets] : null;
    if (set) pool = pool.filter((id) => set.has(id));
    const skipped = set ? users.filter((u) => set.has(u.id)).length - pool.length : 0;
    return { key: s.key, label: s.label, rule: s.rule, count: pool.length, pctOfStart: round(ratio(pool.length, users.length)), stepRate: i ? round(ratio(pool.length, before.length)) : null, dropped: before.length - pool.length, skipped };
  });

  const emails = new Set(input.accountEmails.map((e) => e.trim().toLowerCase()));
  const cohortEmails = new Set(users.map((u) => u.email.trim().toLowerCase()));
  const wl = [...new Set(waits.map((x) => x.email.trim().toLowerCase()))];

  const bySource = new Map<string, { label: string; signups: number; connected: number; posted: number; paid: number }>();
  for (const u of users) {
    const src = parseSource(u.signupSource);
    const label = [channelLabel(src.source), src.medium, src.campaign].filter(Boolean).join(" / ");
    const r = bySource.get(label) ?? { label, signups: 0, connected: 0, posted: 0, paid: 0 };
    r.signups++;
    if (sets.connect.has(u.id)) r.connected++;
    if (sets.publish.has(u.id)) r.posted++;
    if (sets.paid.has(u.id)) r.paid++;
    bySource.set(label, r);
  }
  const sum = (rs: { signups: number; connected: number; posted: number; paid: number }[]) => rs.reduce((a, r) => ({ signups: a.signups + r.signups, connected: a.connected + r.connected, posted: a.posted + r.posted, paid: a.paid + r.paid }), { signups: 0, connected: 0, posted: 0, paid: 0 });
  const sources = topWithOther([...bySource.values()], 10, (r) => r.signups, (rest) => ({ label: `Other sources (${rest.length})`, ...sum(rest) }));

  const byCountry = count(users.map((u) => countryName(u.locCountry)));
  const countries = topWithOther([...byCountry].map(([label, n]) => ({ label, count: n })), 10, (r) => r.count, (rest) => ({ label: `Other countries (${rest.length})`, count: rest.reduce((t, r) => t + r.count, 0) }));
  const platforms = [...count(pubs.map((t) => platformName(t.platform)))].map(([label, n]) => ({ label, count: n })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    window: w,
    timezone: TZ,
    totals: {
      signups: users.length,
      waitlist: waits.length,
      active: new Set(act.map((a) => a.userId)).size,
      activeToday: new Set(input.activity.filter((a) => a.day === today).map((a) => a.userId)).size,
      postsPublished: firstPub.size,
      publishes: pubs.length,
    },
    daily,
    funnel,
    waitlist: { joined: wl.length, withAccount: wl.filter((e) => emails.has(e)).length, inCohort: wl.filter((e) => cohortEmails.has(e)).length },
    sources,
    countries,
    platforms,
  };
}
