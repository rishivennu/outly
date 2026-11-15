import type { Platform } from "../domain";

/**
 * Best time to post. Pure (no I/O) so it is unit-tested with fixtures.
 * With enough of the creator's own published posts we rank hours (and weekdays) by the views those posts
 * earned, in the creator's timezone. Below that there is no suggestion at all (Phase 2: only real data, never
 * industry "typical" hours): source "none", no slots, and how many posts are still needed.
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
  source: "yours" | "none";
  /** Local hours (0-23), strongest first. Drives the dots in the time picker. */
  peakHours: number[];
  slots: BestSlot[];
  reason: string;
  /** The creator's published posts with views on these platforms (what the suggestion is built from). */
  samples: number;
  /** How many it takes before there is a suggestion. */
  needed: number;
}

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

export function bestTimes(input: { samples: PostedSample[]; platforms: Platform[]; tz: string; now?: Date; count?: number }): BestTimes {
  const now = input.now ?? new Date();
  const count = input.count ?? 3;
  const platforms = input.platforms.length ? input.platforms : (["instagram"] as Platform[]);
  const samples = input.samples.filter((s) => platforms.includes(s.platform) && s.views >= 0);

  const hourW = new Array(24).fill(0) as number[];
  const dayW = new Array(7).fill(0) as number[];
  let source: BestTimes["source"] = "none";
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

  if (source === "none") {
    reason =
      samples.length < MIN_SAMPLES
        ? `Not enough of your own posts yet (${samples.length} of ${MIN_SAMPLES} with views). Best times come from your audience once there are ${MIN_SAMPLES}.`
        : "Your posts so far are too spread out to show a best time yet. A few more at similar times will tell.";
    return { source, peakHours: [], slots: [], reason, samples: samples.length, needed: MIN_SAMPLES };
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
  return { source, peakHours, slots, reason, samples: samples.length, needed: MIN_SAMPLES };
}
