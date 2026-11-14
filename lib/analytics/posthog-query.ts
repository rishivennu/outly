import type { FunnelStep } from "@/lib/growth/core";
import { funnel } from "@/lib/growth/core";

/** 1149: HogQL for Admin > Analytics. Only whitelisted numbers and constants reach the SQL, never request text. */
export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const parseRange = (v: string | null | undefined): RangeDays => (v === "7" ? 7 : v === "90" ? 90 : 30);

const since = (d: RangeDays) => `timestamp >= now() - INTERVAL ${RANGES.includes(d) ? d : 30} DAY`;
const PV = "event = '$pageview'";

export const FUNNEL = [
  { key: "visit", label: "Visited the home page" },
  { key: "signup", label: "Signed up", event: "signup_completed" },
  { key: "trial", label: "Started a trial", event: "trial_started" },
  { key: "paid", label: "Subscribed", event: "subscription_activated" },
] as const;

export const QUERIES = {
  daily: (d: RangeDays) => `SELECT toDate(timestamp) AS day, count() AS pageviews, count(DISTINCT person_id) AS visitors FROM events WHERE ${PV} AND ${since(d)} GROUP BY day ORDER BY day ASC`,
  pages: (d: RangeDays) => `SELECT properties.$pathname AS path, count() AS views, count(DISTINCT person_id) AS visitors FROM events WHERE ${PV} AND ${since(d)} GROUP BY path ORDER BY views DESC LIMIT 10`,
  referrers: (d: RangeDays) => `SELECT coalesce(nullIf(properties.$referring_domain, ''), '$direct') AS domain, count(DISTINCT person_id) AS visitors FROM events WHERE ${PV} AND ${since(d)} GROUP BY domain ORDER BY visitors DESC LIMIT 10`,
  signups: (d: RangeDays) => `SELECT toDate(timestamp) AS day, count() AS signups FROM events WHERE event = 'signup_completed' AND ${since(d)} GROUP BY day ORDER BY day ASC`,
  // Each step counts people who also did every step before it in the window (in any order).
  funnel: (d: RangeDays) =>
    `SELECT countIf(s1), countIf(s1 AND s2), countIf(s1 AND s2 AND s3), countIf(s1 AND s2 AND s3 AND s4) FROM (SELECT person_id, max(${PV} AND properties.$pathname = '/') AS s1, max(event = 'signup_completed') AS s2, max(event = 'trial_started') AS s3, max(event = 'subscription_activated') AS s4 FROM events WHERE event IN ('$pageview', 'signup_completed', 'trial_started', 'subscription_activated') AND ${since(d)} GROUP BY person_id)`,
  countries: (d: RangeDays) => `SELECT coalesce(nullIf(properties.$geoip_country_name, ''), 'Unknown') AS country, count(DISTINCT person_id) AS visitors FROM events WHERE ${PV} AND ${since(d)} GROUP BY country ORDER BY visitors DESC LIMIT 10`,
} satisfies Record<string, (d: RangeDays) => string>;
export type QueryName = keyof typeof QUERIES;

type Row = unknown[];
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Every day in the range, oldest first (UTC), so quiet days show as zero instead of disappearing. */
export function rangeDays(d: RangeDays, now = new Date()): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: d }, (_, i) => new Date(end - (d - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export function parseDaily(rows: Row[], d: RangeDays, now?: Date) {
  const by = new Map(rows.map((r) => [str(r[0]).slice(0, 10), { pageviews: num(r[1]), visitors: num(r[2]) }]));
  return rangeDays(d, now).map((day) => ({ day, ...(by.get(day) ?? { pageviews: 0, visitors: 0 }) }));
}
export function parseSignups(rows: Row[], d: RangeDays, now?: Date) {
  const by = new Map(rows.map((r) => [str(r[0]).slice(0, 10), num(r[1])]));
  return rangeDays(d, now).map((day) => ({ day, count: by.get(day) ?? 0 }));
}
export const parsePages = (rows: Row[]) => rows.map((r) => ({ path: str(r[0]) || "(unknown)", views: num(r[1]), visitors: num(r[2]) }));
export const parseReferrers = (rows: Row[]) => rows.map((r) => ({ domain: str(r[0]) === "$direct" ? "Direct or unknown" : str(r[0]), visitors: num(r[1]) }));
export const parseCountries = (rows: Row[]) => rows.map((r) => ({ country: str(r[0]) || "Unknown", visitors: num(r[1]) }));
export function parseFunnel(rows: Row[]): FunnelStep[] {
  const r = rows[0] ?? [];
  return funnel(FUNNEL.map((s, i) => ({ key: s.key, label: s.label, count: num(r[i]) })));
}
