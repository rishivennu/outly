/**
 * The landing time-saved calculator (1037). Pure, with every assumption named, so the section can show its
 * working: the visitor's own numbers in, an estimate out, never a claim about other people.
 */
export const TIME_DEFAULTS = { videos: 5, platforms: 3, byHand: 12 } as const;
/** Minutes per video in Outlly: one upload plus reading over the drafted captions. */
export const OUTLLY_MIN_PER_VIDEO = 4;
const WEEKS_PER_MONTH = 52 / 12;

export type TimeInput = { videos: number; platforms: number; byHand: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.round(n) : lo));

export function timeSaved(i: TimeInput) {
  const videos = clamp(i.videos, 1, 30);
  const platforms = clamp(i.platforms, 1, 3);
  const byHand = clamp(i.byHand, 3, 45);
  const manualWeek = videos * platforms * byHand;
  const outllyWeek = videos * OUTLLY_MIN_PER_VIDEO;
  const savedWeek = Math.max(0, manualWeek - outllyWeek);
  return { manualWeek, outllyWeek, savedWeek, savedMonthHours: Math.round(((savedWeek * WEEKS_PER_MONTH) / 60) * 10) / 10 };
}

/** "45 min" / "3 h 20 min". */
export function minutesLabel(m: number) {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
}
