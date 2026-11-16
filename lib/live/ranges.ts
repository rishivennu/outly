import type { Platform } from "../domain";

/**
 * 1172: the reporting windows a platform dashboard can be asked for, in days. Every card on the page shares
 * one window, and only windows the platform can actually answer are offered: Instagram's account insights
 * accept at most 30 days per request, so 90 days is not on its list rather than being a quietly shorter number.
 */
export const DEFAULT_RANGE_DAYS = 28;

const RANGE_DAYS: Record<Platform, readonly number[]> = {
  instagram: [7, 28],
  youtube: [7, 28, 90],
  facebook: [7, 28, 90],
  x: [7, 28, 90],
  tiktok: [7, 28, 90],
  threads: [7, 28, 90],
  linkedin: [7, 28, 90],
};

export function rangeOptions(platform: Platform): readonly number[] {
  return RANGE_DAYS[platform] ?? [DEFAULT_RANGE_DAYS];
}

/** The window the API will use for a raw ?days= value: one the platform offers, else the default. */
export function pickRangeDays(platform: Platform, raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : raw ? Number(raw) : NaN;
  return rangeOptions(platform).includes(n) ? n : DEFAULT_RANGE_DAYS;
}

/** Why a platform offers fewer windows than the others, said once under the picker. */
export function rangeNote(platform: Platform): string | null {
  return platform === "instagram" ? "Instagram shares account insights for up to 30 days at a time, so 90 days is not available here." : null;
}
