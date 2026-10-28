/**
 * Retention maths with no database or clock of its own, so every rule is unit-tested:
 * the creator's local week, the goal streak, when the mid-week nudge is due, and which
 * "what to do next" step matters most.
 */

/** Weekday (0 = Sunday), hour and minute in the creator's own time zone. Falls back to UTC on a bad zone. */
export function zoneParts(now: Date, tz: string) {
  try {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });
    const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
    return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday), hour: Number(p.hour) % 24, minute: Number(p.minute) };
  } catch {
    return { day: now.getUTCDay(), hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
}

/** Monday 00:00 of the creator's current week, as an instant. Weeks start on Monday. */
export function weekStart(now: Date, tz: string) {
  const { day, hour, minute } = zoneParts(now, tz);
  const sinceMonday = (day + 6) % 7;
  const ms = now.getTime() - sinceMonday * 864e5 - hour * 36e5 - minute * 6e4;
  return new Date(Math.floor(ms / 6e4) * 6e4);
}

/** Day of the week counted from Monday = 1 ... Sunday = 7. */
export const weekDay = (now: Date, tz: string) => ((zoneParts(now, tz).day + 6) % 7) + 1;

/** How many posts went out in each of the last `weeks` weeks, newest (this week) first. */
export function weeklyCounts(published: Date[], now: Date, tz: string, weeks = 12) {
  const start = weekStart(now, tz).getTime();
  const out = new Array<number>(weeks).fill(0);
  for (const d of published) {
    const t = d.getTime();
    if (t > now.getTime()) continue;
    const back = t >= start ? 0 : Math.floor((start - t) / (7 * 864e5)) + 1;
    if (back < weeks) out[back]++;
  }
  return out;
}

export interface GoalState {
  goal: number;
  done: number;
  left: number;
  /** consecutive weeks the goal was met, counting this week only once it is met */
  streak: number;
  /** 0 to 1, for the ring */
  progress: number;
  met: boolean;
  /** days left this week including today */
  daysLeft: number;
}

export function goalState(published: Date[], goal: number, now: Date, tz: string): GoalState {
  const counts = weeklyCounts(published, now, tz);
  const done = counts[0];
  const met = goal > 0 && done >= goal;
  let streak = 0;
  if (goal > 0) {
    if (met) streak = 1;
    for (let i = 1; i < counts.length && counts[i] >= goal; i++) streak++;
  }
  return { goal, done, left: Math.max(0, goal - done), streak, progress: goal > 0 ? Math.min(1, done / goal) : 0, met, daysLeft: 8 - weekDay(now, tz) };
}

/** The "you're behind" nudge: Friday from 10 am local, goal not met, at most once a week. */
export function nudgeDue(u: { postingGoal: number; nudgeAt: Date | null; timezone: string }, done: number, now: Date) {
  if (u.postingGoal <= 0 || done >= u.postingGoal) return false;
  if (u.nudgeAt && u.nudgeAt.getTime() >= weekStart(now, u.timezone).getTime()) return false;
  return weekDay(now, u.timezone) === 5 && zoneParts(now, u.timezone).hour >= 10;
}

/** Notice keys carry the id they are about, so a notice can resolve itself once the problem is gone. */
export const noticeKey = {
  failed: (postId: string, targetId: string) => `fail:${postId}:${targetId}`,
  live: (postId: string) => `live:${postId}`,
  reconnect: (accountId: string, week: string) => `reconnect:${accountId}:${week}`,
  expiring: (accountId: string, week: string) => `expiring:${accountId}:${week}`,
  nudge: (userId: string, week: string) => `nudge:${userId}:${week}`,
  spike: (accountId: string, day: string) => `spike:${accountId}:${day}`,
};

export function parseKey(key: string) {
  const [kind, a, b] = key.split(":");
  return { kind, a, b };
}

/** A short, sortable stamp for the creator's current week (Monday's date), used to dedupe weekly notices. */
export const weekStamp = (now: Date, tz: string) => weekStart(now, tz).toISOString().slice(0, 10);

export type StepKind = "failed" | "reconnect" | "expiring" | "connect" | "first_post" | "draft" | "goal" | "schedule" | "idea" | "recycle";

export interface Step {
  kind: StepKind;
  title: string;
  body: string;
  href: string;
  action: string;
  tone: "danger" | "warn" | "info" | "good";
}

export interface StepFacts {
  failed: number;
  reconnect: { platform: string; name: string }[];
  expiring: { platform: string; name: string; days: number }[];
  connected: number;
  published: number;
  drafts: { id: string; title: string }[];
  scheduledThisWeek: number;
  goal: GoalState;
  ideas: number;
  recyclable: { id: string; title: string } | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Ranks what the creator should do next, most urgent first. Broken things beat nice-to-haves. */
export function nextSteps(f: StepFacts, max = 3): Step[] {
  const s: Step[] = [];
  if (f.failed > 0) s.push({ kind: "failed", tone: "danger", title: `${plural(f.failed, "post")} didn't go out`, body: "See what went wrong and try again in one click.", href: "/content?filter=failed", action: "Review failed posts" });
  for (const a of f.reconnect) s.push({ kind: "reconnect", tone: "danger", title: `Reconnect ${a.name}`, body: `${a.name} signed Outlly out, so posts to it will fail until you reconnect.`, href: "/accounts", action: `Reconnect ${a.name}` });
  for (const a of f.expiring) s.push({ kind: "expiring", tone: "warn", title: `${a.name} access ends ${a.days <= 1 ? "tomorrow" : `in ${a.days} days`}`, body: "Reconnect now so nothing you scheduled fails.", href: "/accounts", action: `Reconnect ${a.name}` });
  if (f.connected === 0) s.push({ kind: "connect", tone: "info", title: "Connect your first account", body: "Instagram or YouTube takes about a minute.", href: "/accounts", action: "Connect an account" });
  else if (f.published === 0) s.push({ kind: "first_post", tone: "info", title: "Send your first post", body: "Upload one video and Outlly writes the captions for each platform.", href: "/create", action: "Create a post" });
  if (f.drafts.length) s.push({ kind: "draft", tone: "info", title: f.drafts.length === 1 ? `Finish "${f.drafts[0].title}"` : `${plural(f.drafts.length, "draft")} waiting`, body: "Your draft is saved. Pick a time and it goes out on its own.", href: `/create?post=${f.drafts[0].id}`, action: "Finish the draft" });
  if (f.published > 0 && f.goal.goal > 0 && !f.goal.met && f.goal.left > f.scheduledThisWeek)
    s.push({ kind: "goal", tone: "warn", title: `${plural(f.goal.left - f.scheduledThisWeek, "more post")} to hit this week's goal`, body: `${f.goal.daysLeft <= 1 ? "Today is the last day" : `${f.goal.daysLeft} days left`} this week.${f.goal.streak ? ` Keep your ${plural(f.goal.streak, "week")} streak going.` : ""}`, href: "/create", action: "Create a post" });
  if (f.published > 0 && f.scheduledThisWeek === 0 && f.goal.goal === 0) s.push({ kind: "schedule", tone: "info", title: "Nothing is scheduled this week", body: "One post keeps your audience warm.", href: "/create", action: "Schedule a post" });
  if (f.recyclable) s.push({ kind: "recycle", tone: "good", title: `Post "${f.recyclable.title}" again`, body: "It was one of your best. A fresh caption gives it a second life.", href: `/home#recycle`, action: "See top posts" });
  if (f.ideas > 0) s.push({ kind: "idea", tone: "good", title: `${plural(f.ideas, "idea")} in your bank`, body: "Turn one into a post while it's fresh.", href: "/home#ideas", action: "Open ideas" });
  return s.slice(0, max);
}

/** Posts worth a second run: published at least `minAgeDays` ago, ranked by views, one per post. */
export function pickRecyclable<T extends { id: string; views: number; publishedAt: Date | null }>(posts: T[], now: Date, minAgeDays = 21, max = 3) {
  return posts
    .filter((p) => p.publishedAt && now.getTime() - p.publishedAt.getTime() >= minAgeDays * 864e5 && p.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, max);
}

export interface RiskFacts {
  paid: boolean;
  cancelling: boolean;
  paused: boolean;
  /** days since the last real post went out; null = never posted */
  daysSincePost: number | null;
  /** days since the creator last opened the app; null = unknown */
  daysSinceActive: number | null;
  failed7d: number;
  reconnect: number;
  postsLast30: number;
  postsPrev30: number;
}

export type RiskReason = "cancelling" | "paused" | "quiet" | "slowing" | "broken" | "never_posted";

/** How likely a creator is to leave, 0 to 100, with the reasons a person can act on. */
export function riskOf(f: RiskFacts) {
  let score = 0;
  const reasons: RiskReason[] = [];
  if (f.cancelling) (score += 45), reasons.push("cancelling");
  if (f.paused) (score += 20), reasons.push("paused");
  const quiet = Math.min(f.daysSincePost ?? Infinity, f.daysSinceActive ?? Infinity);
  if (f.daysSincePost === null) {
    if ((f.daysSinceActive ?? 0) >= 7) (score += 25), reasons.push("never_posted");
  } else if (quiet >= 14) (score += Math.min(40, 20 + Math.floor((quiet - 14) / 7) * 5)), reasons.push("quiet");
  if (f.postsPrev30 >= 3 && f.postsLast30 <= f.postsPrev30 / 2) (score += 15), reasons.push("slowing");
  if (f.failed7d > 0 || f.reconnect > 0) (score += 15), reasons.push("broken");
  if (f.paid) score = Math.round(score * 1.15); // a paying creator leaving costs more
  score = Math.min(100, score);
  return { score, level: score >= 50 ? ("high" as const) : score >= 25 ? ("medium" as const) : ("low" as const), reasons };
}

/** At most one win-back email a month per person, whoever sends it. */
export const winbackAllowed = (winbackAt: Date | null, now: Date) => !winbackAt || now.getTime() - winbackAt.getTime() >= 30 * 864e5;
