import type { Platform } from "../domain";
import type { LivePost, Series, Suggestion } from "./types";

/**
 * Rules that turn live numbers into advice. Pure on purpose: no I/O, so it is unit-tested with fixtures.
 * Every rule needs a minimum sample and states the numbers it used; with too little data it stays silent.
 */
export interface SuggestInput {
  platform: Platform;
  posts: LivePost[];
  series: Series[];
  hours?: { startMinute: number; label: string; value: number }[];
  timezone: string;
  now?: Date;
}

const DAY = 864e5;
const NAME: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", x: "X" };
const UNIT: Record<Platform, string> = { instagram: "Reel", youtube: "video", x: "post" };

export function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);
const times = (r: number) => `${r.toFixed(r >= 10 ? 0 : 1)}×`;

function localParts(iso: string, tz: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", hour: "numeric", hourCycle: "h23" }).formatToParts(d);
  return { weekday: parts.find((p) => p.type === "weekday")?.value ?? "", hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0) };
}

const SLOTS = [
  { name: "mornings (5 AM to noon)", test: (h: number) => h >= 5 && h < 12 },
  { name: "afternoons (noon to 5 PM)", test: (h: number) => h >= 12 && h < 17 },
  { name: "evenings (5 PM to 10 PM)", test: (h: number) => h >= 17 && h < 22 },
  { name: "late nights (10 PM to 5 AM)", test: (h: number) => h >= 22 || h < 5 },
];

export function suggest(input: SuggestInput): Suggestion[] {
  const now = input.now ?? new Date();
  const out: Suggestion[] = [];
  const unit = UNIT[input.platform];
  const posts = input.posts.filter((p) => p.views !== null);
  const views = posts.map((p) => p.views!);
  const typical = median(views);

  // 1. Cadence: the lever a creator fully controls.
  const sorted = [...input.posts].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  if (sorted.length) {
    const gap = Math.floor((now.getTime() - +new Date(sorted[0].publishedAt)) / DAY);
    const last90 = sorted.filter((p) => now.getTime() - +new Date(p.publishedAt) < 90 * DAY).length;
    if (gap >= 14) {
      out.push({
        id: "cadence-gap",
        title: `It's been ${gap} days since your last ${unit}`,
        body: `Your audience hasn't heard from you on ${NAME[input.platform]} in a while. Pick a date for the next one now; a plan you can keep beats a burst you can't.`,
        evidence: `Last post ${new Date(sorted[0].publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: input.timezone })}. ${last90} post${last90 === 1 ? "" : "s"} in the last 90 days.`,
        impact: "high",
        action: { label: "Plan the next post", href: "/create" },
        source: "rules",
      });
    } else if (last90 >= 3) {
      const perWeek = last90 / (90 / 7);
      if (perWeek < 1)
        out.push({
          id: "cadence-slow",
          title: "Try a steadier rhythm",
          body: `You're posting about once every ${Math.round(7 / perWeek)} days. Lining up one ${unit} a week in the calendar gives the algorithm, and your audience, a pattern to learn.`,
          evidence: `${last90} posts in the last 90 days (${perWeek.toFixed(1)} a week).`,
          impact: "medium",
          action: { label: "Open the calendar", href: "/calendar" },
          source: "rules",
        });
    }
  }

  // 2. When followers are online (Instagram reports this directly).
  if (input.hours && input.hours.length >= 12) {
    const hs = input.hours;
    const peak = hs.reduce((a, b) => (b.value > a.value ? b : a));
    const low = hs.reduce((a, b) => (b.value < a.value ? b : a));
    if (peak.value > 0 && ratio(peak.value, low.value || 1) >= 1.5)
      out.push({
        id: "online-peak",
        title: `Post around ${peak.label}`,
        body: `That's when the most of your followers are on ${NAME[input.platform]}. Schedule the next ${unit} 30 to 60 minutes before so it's fresh when they arrive.`,
        evidence: `${fmt(peak.value)} followers online at ${peak.label}, ${fmt(low.value)} at ${low.label} (your timezone).`,
        impact: "high",
        action: { label: "Schedule for then", href: "/create" },
        source: "rules",
      });
  }

  // 3. Time of day the creator actually posted, against what those posts earned.
  if (!input.hours?.length && posts.length >= 6) {
    const bySlot = SLOTS.map((s) => ({ s, v: posts.filter((p) => s.test(localParts(p.publishedAt, input.timezone).hour)).map((p) => p.views!) })).filter((x) => x.v.length >= 2);
    if (bySlot.length >= 2) {
      const best = bySlot.reduce((a, b) => (median(b.v) > median(a.v) ? b : a));
      const r = ratio(median(best.v), typical);
      if (r >= 1.3)
        out.push({
          id: "slot",
          title: `Your ${best.s.name.split(" (")[0]} do best`,
          body: `Posts you put out in the ${best.s.name} earn more views than your usual. Try scheduling the next two there and compare.`,
          evidence: `${best.v.length} posts in that slot: median ${fmt(median(best.v))} views vs ${fmt(typical)} overall (${times(r)}).`,
          impact: "medium",
          action: { label: "Schedule a post", href: "/create" },
          source: "rules",
        });
    }
  }

  // 4. Weekday.
  if (posts.length >= 8) {
    const byDay = new Map<string, number[]>();
    for (const p of posts) {
      const d = localParts(p.publishedAt, input.timezone).weekday;
      byDay.set(d, [...(byDay.get(d) ?? []), p.views!]);
    }
    const days = [...byDay].filter(([, v]) => v.length >= 2);
    if (days.length >= 2) {
      const [day, v] = days.reduce((a, b) => (median(b[1]) > median(a[1]) ? b : a));
      const r = ratio(median(v), typical);
      if (r >= 1.3)
        out.push({
          id: "weekday",
          title: `${day}s are your strongest day`,
          body: `What you post on a ${day} tends to travel further. Save your best idea of the week for it.`,
          evidence: `${v.length} ${day} posts: median ${fmt(median(v))} views vs ${fmt(typical)} overall (${times(r)}).`,
          impact: "medium",
          source: "rules",
        });
    }
  }

  // 5. Format.
  const formats = new Map<string, number[]>();
  for (const p of posts) formats.set(p.format, [...(formats.get(p.format) ?? []), p.views!]);
  const fs = [...formats].filter(([, v]) => v.length >= 3);
  if (fs.length >= 2) {
    const best = fs.reduce((a, b) => (median(b[1]) > median(a[1]) ? b : a));
    const rest = fs.filter((f) => f !== best).flatMap(([, v]) => v);
    const r = ratio(median(best[1]), median(rest));
    if (r >= 1.3)
      out.push({
        id: "format",
        title: `${best[0]} outperform everything else`,
        body: `Lean into ${best[0].toLowerCase()} for the next few posts and keep other formats for when you have a reason.`,
        evidence: `${best[1].length} ${best[0].toLowerCase()}: median ${fmt(median(best[1]))} views vs ${fmt(median(rest))} for the rest (${times(r)}).`,
        impact: "medium",
        source: "rules",
      });
  }

  // 6. Caption length.
  if (posts.length >= 8) {
    const cut = median(posts.map((p) => p.captionLength));
    const short = posts.filter((p) => p.captionLength <= cut).map((p) => p.views!);
    const long = posts.filter((p) => p.captionLength > cut).map((p) => p.views!);
    if (short.length >= 3 && long.length >= 3) {
      const shortWins = median(short) >= median(long);
      const r = shortWins ? ratio(median(short), median(long)) : ratio(median(long), median(short));
      if (r >= 1.25) {
        const label = input.platform === "youtube" ? "titles" : "captions";
        out.push({
          id: "caption-length",
          title: shortWins ? `Shorter ${label} are working` : `Longer ${label} are working`,
          body: shortWins
            ? `Your tighter ${label} get more views. Lead with the hook and cut anything the video already says.`
            : `Your fuller ${label} get more views. Give context: who, what happened, why it matters.`,
          evidence: `Split at ${Math.round(cut)} characters: median ${fmt(median(shortWins ? short : long))} vs ${fmt(median(shortWins ? long : short))} views (${times(r)}).`,
          impact: "low",
          source: "rules",
        });
      }
    }
  }

  // 7. Hashtags (Instagram).
  if (input.platform === "instagram" && posts.length >= 8) {
    const few = posts.filter((p) => p.hashtags <= 3).map((p) => p.views!);
    const many = posts.filter((p) => p.hashtags > 3).map((p) => p.views!);
    if (few.length >= 3 && many.length >= 3) {
      const fewWins = median(few) > median(many);
      const r = fewWins ? ratio(median(few), median(many)) : ratio(median(many), median(few));
      if (r >= 1.25)
        out.push({
          id: "hashtags",
          title: fewWins ? "Fewer hashtags, more views" : "Hashtags are helping you",
          body: fewWins ? "Posts with three or fewer hashtags beat your heavily tagged ones. Keep the few that describe the topic." : "Your posts with more hashtags reach further. Keep them specific to the topic, not generic.",
          evidence: `${few.length} posts with ≤3 tags: median ${fmt(median(few))} views. ${many.length} with more: ${fmt(median(many))}.`,
          impact: "low",
          source: "rules",
        });
    }
  }

  // 8. A breakout to build on.
  if (posts.length >= 5 && typical > 0) {
    const top = posts.reduce((a, b) => (b.views! > a.views! ? b : a));
    const r = ratio(top.views!, typical);
    if (r >= 2)
      out.push({
        id: "breakout",
        title: "Make a part two of your breakout",
        body: `"${top.title.slice(0, 70)}${top.title.length > 70 ? "…" : ""}" pulled far more than usual. A follow-up on the same topic, with the same opening style, is the closest thing to a sure bet.`,
        evidence: `${fmt(top.views!)} views vs your median ${fmt(typical)} (${times(r)}), across ${posts.length} recent posts.`,
        impact: "high",
        action: { label: "Start the follow-up", href: "/create" },
        source: "rules",
      });
  }

  // 9. Retention, where the platform reports watch time.
  const ret = posts.filter((p) => p.avgWatch && p.duration).map((p) => p.avgWatch! / p.duration!);
  if (ret.length >= 4) {
    const m = median(ret);
    if (m < 0.4)
      out.push({
        id: "retention",
        title: "Viewers leave early",
        body: "On a typical video people watch less than half. Open on the payoff or the question, cut the intro, and change the shot every few seconds.",
        evidence: `Median watch ${Math.round(m * 100)}% of the video, across ${ret.length} videos.`,
        impact: "high",
        action: { label: "Write a stronger hook", href: "/create" },
        source: "rules",
      });
  }

  // 10. Conversation.
  const withC = posts.filter((p) => p.comments !== null && p.views! > 0);
  if (withC.length >= 5) {
    const perK = (withC.reduce((a, p) => a + p.comments!, 0) / withC.reduce((a, p) => a + p.views!, 0)) * 1000;
    if (perK < 1)
      out.push({
        id: "comments",
        title: "Ask for the comment",
        body: "Very few viewers comment. End with one specific question people can answer in a word, then reply to the first few from the inbox to keep it going.",
        evidence: `${perK.toFixed(2)} comments per 1,000 views across ${withC.length} posts.`,
        impact: "medium",
        action: { label: "Open the inbox", href: "/inbox" },
        source: "rules",
      });
  }

  // 11. Momentum from the daily series.
  const s = input.series[0];
  if (s && s.points.length >= 14) {
    const pts = s.points.map((p) => p.value);
    const last = pts.slice(-7).reduce((a, b) => a + b, 0);
    const prev = pts.slice(-14, -7).reduce((a, b) => a + b, 0);
    if (prev >= 20) {
      const ch = (last - prev) / prev;
      if (ch <= -0.3)
        out.push({
          id: "momentum-down",
          title: `${s.label} dipped this week`,
          body: "A quiet week usually follows a quiet calendar. One new post is usually what turns it back around; reuse a format that has worked for you before.",
          evidence: `${fmt(last)} in the last 7 days vs ${fmt(prev)} the 7 before (${Math.round(ch * 100)}%).`,
          impact: "medium",
          source: "rules",
        });
      else if (ch >= 0.3)
        out.push({
          id: "momentum-up",
          title: `${s.label} is climbing`,
          body: "You have momentum right now. Post again within the next few days while people are paying attention.",
          evidence: `${fmt(last)} in the last 7 days vs ${fmt(prev)} the 7 before (+${Math.round(ch * 100)}%).`,
          impact: "medium",
          action: { label: "Post while it's hot", href: "/create" },
          source: "rules",
        });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.impact] - rank[b.impact]).slice(0, 6);
}

/** Shift Instagram's online-followers hours (reported on Pacific time) into the creator's timezone. */
export function shiftHours(raw: Record<string, number>, timezone: string, at = new Date()) {
  const off = (tz: string) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - Math.floor(at.getTime() / 60000) * 60000) / 60000;
  };
  const shift = off(timezone) - off("America/Los_Angeles");
  return Object.entries(raw)
    .map(([h, value]) => {
      const startMinute = (((Number(h) * 60 + shift) % 1440) + 1440) % 1440;
      const hh = Math.floor(startMinute / 60);
      const mm = startMinute % 60;
      const label = `${hh % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${hh < 12 ? "AM" : "PM"}`;
      return { startMinute, label, value };
    })
    .sort((a, b) => a.startMinute - b.startMinute);
}
