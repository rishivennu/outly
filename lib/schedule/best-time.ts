import { PLATFORM_META, type Platform } from "../domain";

/**
 * Best time to post. Pure (no I/O) so it is unit-tested with fixtures.
 * With enough of the creator's own published posts we rank hours (and weekdays) by the views those posts
 * earned, in the creator's timezone. Below that we fall back to typical peaks per platform and say so.
 */
export interface PostedSample {
  platform: Platform;
  publishedAt: Date | string;
  views: number;
}
export interface BestSlot {
  at: string;
  label: string;
}
export interface BestTimes {
  source: "yours" | "typical";
  /** Local hours (0-23), strongest first. Drives the dots in the time picker. */
  peakHours: number[];
  slots: BestSlot[];
  reason: string;
}

/** Typical peaks (local time). Days: 0 = Sunday. Broad industry guidance, used only until we have the creator's own data. */
export const TYPICAL: Record<Platform, { days: number[]; hours: number[] }> = {
  instagram: { days: [2, 3, 4, 5], hours: [11, 19, 12, 20] },
  youtube: { days: [5, 6, 0], hours: [18, 15, 12, 19] },
  x: { days: [1, 2, 3, 4, 5], hours: [9, 12, 10, 17] },
  tiktok: { days: [2, 4, 5], hours: [19, 20, 18, 21] },
  threads: { days: [1, 2, 3, 4, 5], hours: [9, 12, 19, 8] },
  facebook: { days: [1, 2, 3, 4, 5], hours: [12, 9, 13, 15] },
  linkedin: { days: [2, 3, 4], hours: [9, 8, 12, 10] },
};

export const MIN_SAMPLES = 6;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function parts(at: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { y: Number(g("year")), m: Number(g("month")), d: Number(g("day")), h: Number(g("hour")) % 24, min: Number(g("minute")), wd };
}

/** The instant that reads as y-m-d h:00 on a wall clock in `tz` (DST-safe to the hour). */
export function zoned(y: number, m: number, d: number, h: number, tz: string) {
  let t = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 2; i++) {
    const q = parts(new Date(t), tz);
    const wall = Date.UTC(q.y, q.m - 1, q.d, q.h, q.min);
    t += Date.UTC(y, m - 1, d, h) - wall;
  }
  return new Date(t);
}

export const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");

export function bestTimes(input: { samples: PostedSample[]; platforms: Platform[]; tz: string; now?: Date; count?: number }): BestTimes {
  const now = input.now ?? new Date();
  const count = input.count ?? 3;
  const platforms = input.platforms.length ? input.platforms : (["instagram"] as Platform[]);
  const samples = input.samples.filter((s) => platforms.includes(s.platform) && s.views >= 0);

  const hourW = new Array(24).fill(0) as number[];
  const dayW = new Array(7).fill(0) as number[];
  let source: BestTimes["source"] = "typical";
  let reason = "";

  if (samples.length >= MIN_SAMPLES) {
    const local = samples.map((s) => ({ ...parts(new Date(s.publishedAt), input.tz), views: s.views }));
    const typical = median(local.map((s) => s.views)) || 1;
    // Each hour borrows its neighbours (+-1 h) so a handful of posts still gives a usable curve.
    const scored = Array.from({ length: 24 }, (_, h) => {
      const v = local.filter((s) => Math.min(Math.abs(s.h - h), 24 - Math.abs(s.h - h)) <= 1).map((s) => s.views);
      return { h, n: v.length, exact: local.filter((s) => s.h === h).length, r: v.length >= 2 ? median(v) / typical : 0 };
    });
    // Ties (an hour and its neighbours borrowing the same posts) go to the hour the posts actually went out.
    const good = scored.filter((x) => x.r > 0).sort((a, b) => b.r - a.r || b.exact - a.exact || b.n - a.n);
    if (good.length) {
      source = "yours";
      for (const x of good) hourW[x.h] = x.r + x.exact * 1e-3;
      for (let wd = 0; wd < 7; wd++) {
        const v = local.filter((s) => s.wd === wd).map((s) => s.views);
        dayW[wd] = v.length >= 2 ? median(v) / typical : 1;
      }
      const top = good[0];
      reason = `Your posts around ${hourLabel(top.h)} earn ${top.r.toFixed(top.r >= 10 ? 0 : 1)}× your usual views (${top.n} posts nearby, ${samples.length} in total).`;
    }
  }

  if (source === "typical") {
    for (const p of platforms) {
      const t = TYPICAL[p];
      t.hours.forEach((h, i) => (hourW[h] += 4 - i));
      for (const d of t.days) dayW[d] += 1;
    }
    for (let d = 0; d < 7; d++) dayW[d] = 1 + dayW[d] / platforms.length;
    reason = `Typical peak times for ${list(platforms.map((p) => PLATFORM_META[p].name))}. After ${MIN_SAMPLES} published posts we switch to what works for your audience.`;
  }

  const peakHours = hourW.map((w, h) => ({ w, h })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w).slice(0, 3).map((x) => x.h);

  // Candidates over the next 7 days at the peak hours, at least 30 minutes out.
  const today = parts(now, input.tz);
  const base = Date.UTC(today.y, today.m - 1, today.d);
  const cands: { at: Date; score: number; wd: number; h: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const day = new Date(base + i * 864e5);
    const wd = day.getUTCDay();
    for (const h of peakHours) {
      const at = zoned(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, input.tz);
      if (at.getTime() - now.getTime() < 30 * 60_000) continue;
      cands.push({ at, score: hourW[h] * dayW[wd] - i * 0.01, wd, h });
    }
  }
  const picked = cands.sort((a, b) => b.score - a.score).slice(0, count).sort((a, b) => +a.at - +b.at);
  const slots = picked.map((c) => {
    const ahead = Math.round((Date.UTC(parts(c.at, input.tz).y, parts(c.at, input.tz).m - 1, parts(c.at, input.tz).d) - base) / 864e5);
    const day = ahead === 0 ? "Today" : ahead === 1 ? "Tomorrow" : DAY_NAME[c.wd];
    return { at: c.at.toISOString(), label: `${day} ${hourLabel(c.h)}` };
  });
  return { source, peakHours, slots, reason };
}
