import { rangeDays, type RangeDays } from "./posthog-query";

/**
 * 1151: Admin > Analytics shows one of two sources. "outlly" (the default) is Outlly's own database: every
 * account, signup source and published post, no cookies involved. "posthog" is site traffic from PostHog,
 * which only counts visitors who accepted analytics cookies.
 */
export type AnalyticsSource = "outlly" | "posthog";
export const parseAnalyticsSource = (v: string | null | undefined): AnalyticsSource => (v === "posthog" ? "posthog" : "outlly");

/** Midnight UTC of the first day in the range, so the per-day buckets and the counts cover the same days. */
export const rangeStartUtc = (d: RangeDays, now = new Date()) => new Date(`${rangeDays(d, now)[0]}T00:00:00Z`);

/** Every day in the range with how many of the dates fell on it (UTC). Dates outside the range are ignored. */
export function perDay(dates: (Date | null | undefined)[], d: RangeDays, now = new Date()) {
  const days = rangeDays(d, now);
  const by = new Map(days.map((day) => [day, 0]));
  for (const t of dates) {
    if (!t) continue;
    const k = t.toISOString().slice(0, 10);
    const v = by.get(k);
    if (v !== undefined) by.set(k, v + 1);
  }
  return days.map((day) => ({ day, count: by.get(day) ?? 0 }));
}

let regions: Intl.DisplayNames | null = null;
/** "IN" -> "India". Unknown or missing codes read "Unknown", never a blank row. */
export function countryName(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "Unknown";
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regions.of(c) ?? c;
  } catch {
    return c;
  }
}
