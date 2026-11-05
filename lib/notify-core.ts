/*
 * 1118: notification settings, pure so every rule is unit-tested and the Settings page shows exactly what the
 * server enforces. Stored as JSON on User.notifyPrefs; a missing or broken value means the defaults. Every
 * event here is raised by the server from something it verified (a platform answer, a webhook, a sweep); the
 * list only holds events that really exist, and the page names the ones that don't yet.
 */
import { zoneParts } from "./retention/core";

export const EVENTS = [
  "post_live",
  "post_failed",
  "remind",
  "schedule_change",
  "reconnect",
  "token_expiring",
  "account_connected",
  "new_message",
  "new_comment",
  "engagement_spike",
  "milestone",
  "payment_ok",
  "payment_failed",
  "renewal",
  "usage_limit",
  "plan_update",
] as const;
export type EventKey = (typeof EVENTS)[number];

export type CategoryId = "publishing" | "schedule" | "account" | "engagement" | "billing";

export interface EventInfo {
  label: string;
  hint: string;
  /** Can't be switched off: without it something the creator pays for or posts with silently breaks. */
  essential?: boolean;
  /** Rings through quiet hours when "Let urgent alerts through" is on. */
  urgent?: boolean;
  /** Off until the creator turns it on. */
  off?: boolean;
}

export const EVENT_INFO: Record<EventKey, EventInfo> = {
  post_live: { label: "Post published", hint: "Once a post is live on every platform you picked, after their processing finishes." },
  post_failed: { label: "Publishing failed", hint: "When a platform turns a post down for good, with what to fix. Covers scheduled posts too.", urgent: true },
  remind: { label: "Upcoming post reminders", hint: "A heads-up before a scheduled post goes out, at the time you pick below." },
  schedule_change: { label: "Schedule changes", hint: "When someone on your team moves one of your scheduled posts." },
  reconnect: { label: "Account disconnected or sign-in expired", hint: "A platform signed Outlly out, so posts to it would fail until you reconnect.", essential: true, urgent: true },
  token_expiring: { label: "Reconnection needed soon", hint: "A platform's access ends within a week. Reconnect before then and nothing fails." },
  account_connected: { label: "Account connected", hint: "Confirms a new account is ready to post to." },
  new_message: { label: "New direct messages", hint: "Instagram and Facebook messages to accounts you connected. At most one alert an hour per conversation. Reply from the notification where your device allows it." },
  new_comment: { label: "New comments", hint: "Instagram and Facebook comments on your posts, as they arrive. A busy post buzzes at most once every 2 minutes; the rest wait in Inbox." },
  engagement_spike: { label: "Engagement spikes", hint: "When an account's views in a day jump well past its usual." },
  milestone: { label: "View milestones", hint: "When a post passes 1K, 10K, 100K or 1M views on a platform." },
  payment_ok: { label: "Payment successful", hint: "When a payment or renewal goes through. The invoice is in Billing." },
  payment_failed: { label: "Payment failed", hint: "When a payment or an auto-renew charge doesn't go through, so your plan doesn't lapse unnoticed.", essential: true, urgent: true },
  renewal: { label: "Renewal reminders", hint: "A week and a day before your plan renews or ends." },
  usage_limit: { label: "Usage limit reached", hint: "When you've used this month's AI requests on your plan." },
  plan_update: { label: "Plan updates", hint: "When auto-renew is switched off by your bank or the payment gateway." },
};

export interface Category {
  id: CategoryId;
  title: string;
  blurb: string;
  events: EventKey[];
  /** Options people expect here that Outlly can't send yet, named honestly instead of shown as a dead switch. */
  notYet?: { label: string; why: string }[];
}

export const CATEGORIES: Category[] = [
  { id: "publishing", title: "Publishing updates", blurb: "Stay informed about your content publishing activity.", events: ["post_live", "post_failed"] },
  { id: "schedule", title: "Schedule reminders", blurb: "Never miss an upcoming scheduled post.", events: ["remind", "schedule_change"] },
  { id: "account", title: "Account alerts", blurb: "Keep your connected social accounts healthy.", events: ["reconnect", "token_expiring", "account_connected"] },
  {
    id: "engagement",
    title: "Engagement updates",
    blurb: "Important audience activity, never every small change.",
    events: ["new_comment", "new_message", "engagement_spike", "milestone"],
    notYet: [{ label: "YouTube comments", why: "YouTube doesn't tell apps about new comments as they happen. They show in Inbox when you open it." }],
  },
  { id: "billing", title: "Billing & subscription", blurb: "Important subscription and payment updates.", events: ["payment_ok", "payment_failed", "renewal", "usage_limit", "plan_update"] },
];

export const categoryOf = (e: string): CategoryId | null => CATEGORIES.find((c) => (c.events as string[]).includes(e))?.id ?? null;

/*
 * 1141: the assistant's own nudges. Deliberately NOT part of EVENTS: those are things that happened to the
 * creator's accounts, posts or money, and every one of them is raised from something the server verified.
 * These four are Outlly speaking up on its own, so they get their own switches and their own cooldowns, and
 * the 1118 settings page keeps meaning exactly what it meant.
 */
export const ASSIST_EVENTS = ["greet", "inactivity", "growth", "summary"] as const;
export type AssistKey = (typeof ASSIST_EVENTS)[number];

/** The greeting slots, in the creator's own time zone. Night is off until someone asks for it. */
export const GREET_SLOTS = ["morning", "afternoon", "evening", "night"] as const;
export type GreetSlot = (typeof GREET_SLOTS)[number];
/** Local hour each slot is due at. One greeting per slot per day, at the earliest sweep after that hour. */
export const GREET_HOUR: Record<GreetSlot, number> = { morning: 8, afternoon: 13, evening: 18, night: 21 };
export const GREET_LABEL: Record<GreetSlot, string> = { morning: "Morning, 8:00", afternoon: "Afternoon, 13:00", evening: "Evening, 18:00", night: "Night, 21:00" };

export const ASSIST_INFO: Record<AssistKey, EventInfo> = {
  greet: { label: "Daily greetings", hint: "A short hello at the times you pick, with what is actually on your plate that day. Nothing invented." },
  inactivity: { label: "Reminders when you have been away", hint: "A nudge after 30 minutes, a day, three days or a week away. One per step, never while you are using Outlly." },
  growth: { label: "Growth suggestions", hint: "Occasional suggestions worked out from your own numbers. Only when there is a real number behind them." },
  summary: { label: "Grouped summaries", hint: "When a lot of small things happen at once, one summary instead of a burst of notifications." },
};

/** Which assistant switch a notice kind answers to. */
export const ASSIST_KIND: Record<string, AssistKey> = { greet: "greet", inactivity: "inactivity", growth: "growth", summary: "summary" };

/**
 * How loud an event is. 1 = something is broken or costing money, 2 = needs an answer soon,
 * 3 = good news, 4 = the assistant talking. A digest keeps 1 and 2 separate and folds 3 and 4 together.
 */
export const PRIORITY: Record<string, 1 | 2 | 3 | 4> = {
  post_failed: 1,
  reconnect: 1,
  payment_failed: 1,
  new_message: 2,
  new_comment: 2,
  remind: 2,
  token_expiring: 2,
  usage_limit: 2,
  renewal: 2,
  plan_update: 2,
  schedule_change: 2,
  post_live: 3,
  account_connected: 3,
  payment_ok: 3,
  milestone: 3,
  engagement_spike: 3,
  goal_nudge: 4,
  greet: 4,
  inactivity: 4,
  growth: 4,
  summary: 4,
};
export const priorityOf = (kind: string): 1 | 2 | 3 | 4 => PRIORITY[kind] ?? 3;

/**
 * Quiet time after one notification in the same category, in minutes: enough that a busy hour doesn't
 * become a buzzing phone, never so long that the next real thing is missed. A category with 0 has its own
 * rule already (a comment's own 2-minute gap per post, a reminder's one-per-scheduled-time key).
 * The admin can raise any of these (lib/notify-config.ts); it can never silence an essential alert.
 */
export const COOLDOWN_MIN: Record<CategoryId | "assist", number> = { publishing: 0, schedule: 0, account: 30, engagement: 2, billing: 0, assist: 120 };
export const cooldownFor = (kind: string, over: Partial<Record<CategoryId | "assist", number>> = {}) => {
  const bucket = ASSIST_KIND[kind] ? "assist" : categoryOf(KIND_EVENT[kind] ?? kind);
  if (!bucket) return 0;
  const v = over[bucket];
  return typeof v === "number" && v >= 0 ? v : COOLDOWN_MIN[bucket];
};
/** Every notice kind that shares one cooldown bucket, for looking up when that bucket last spoke. */
export function kindsInBucket(bucket: CategoryId | "assist"): string[] {
  if (bucket === "assist") return [...ASSIST_EVENTS];
  const cat = CATEGORIES.find((c) => c.id === bucket);
  return cat ? Object.keys(KIND_EVENT).filter((k) => (cat.events as string[]).includes(KIND_EVENT[k])) : [];
}
export const bucketOf = (kind: string): CategoryId | "assist" | null => (ASSIST_KIND[kind] ? "assist" : categoryOf(KIND_EVENT[kind] ?? kind));

/**
 * 1141 Notification Centre. The bell and the centre page group by what the creator was doing, not by the
 * settings tree: "was someone talking to me", "did my posts go out", "how are they doing", "what should I
 * do next", "is anything wrong with my account or plan". "All" holds everything, in time order.
 */
export type CentreTab = "all" | "messages" | "publishing" | "performance" | "growth" | "account";
export const CENTRE_TABS: { id: CentreTab; title: string; kinds: string[] }[] = [
  { id: "all", title: "All", kinds: [] },
  { id: "messages", title: "Comments and Messages", kinds: ["new_comment", "new_message"] },
  { id: "publishing", title: "Publishing", kinds: ["post_live", "post_failed", "remind", "schedule_change"] },
  { id: "performance", title: "Performance", kinds: ["engagement_spike", "milestone"] },
  { id: "growth", title: "Growth", kinds: ["growth", "greet", "inactivity", "summary", "goal_nudge", "recycle"] },
  { id: "account", title: "Account Alerts", kinds: ["reconnect", "token_expiring", "account_connected", "payment_ok", "payment_failed", "renewal", "usage_limit", "plan_update"] },
];
/** Anything new, or a kind from before the centre existed, shows under All only. */
export const centreTabOf = (kind: string): CentreTab => CENTRE_TABS.find((t) => t.id !== "all" && t.kinds.includes(kind))?.id ?? "all";
export const centreKinds = (tab: CentreTab) => CENTRE_TABS.find((t) => t.id === tab)?.kinds ?? [];

/** Notice.kind -> the event that governs it. Kinds older than 1118 keep their names. */
export const KIND_EVENT: Record<string, EventKey> = {
  post_live: "post_live",
  post_failed: "post_failed",
  remind: "remind",
  schedule_change: "schedule_change",
  reconnect: "reconnect",
  token_expiring: "token_expiring",
  account_connected: "account_connected",
  new_message: "new_message",
  new_comment: "new_comment",
  engagement_spike: "engagement_spike",
  milestone: "milestone",
  payment_ok: "payment_ok",
  payment_failed: "payment_failed",
  renewal: "renewal",
  usage_limit: "usage_limit",
  plan_update: "plan_update",
};

export const LEADS = [5, 15, 30, 60] as const;
export type Lead = (typeof LEADS)[number];

export interface NotifyPrefs {
  ev: Record<EventKey, boolean>;
  /** Minutes before a scheduled post that the reminder comes. */
  lead: Lead;
  /** Where alerts go. Push = this phone or computer's notifications; inApp = the bell; email = the inbox. */
  ch: { push: boolean; inApp: boolean; email: boolean };
  /** Times are HH:MM in the creator's own time zone (Settings > Profile). */
  quiet: { on: boolean; start: string; end: string; urgent: boolean };
  /** 1141: the assistant's own nudges, separate from the account events above. */
  assist: { greet: Record<GreetSlot, boolean>; inactivity: boolean; growth: boolean; summary: boolean };
}

/** Greetings are on in the day and off at night; the rest of the assistant starts on. */
export const assistDefaults = (): NotifyPrefs["assist"] => ({ greet: { morning: true, afternoon: false, evening: true, night: false }, inactivity: true, growth: true, summary: true });

const evDefaults = () => Object.fromEntries(EVENTS.map((e) => [e, !EVENT_INFO[e].off])) as Record<EventKey, boolean>;

export const NOTIFY_DEFAULTS: NotifyPrefs = { ev: evDefaults(), lead: 15, ch: { push: true, inApp: true, email: true }, quiet: { on: false, start: "22:00", end: "07:00", urgent: true }, assist: assistDefaults() };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validTime = (s: unknown): s is string => typeof s === "string" && HHMM.test(s);

/**
 * Reads stored prefs. Before 1118 the only switches were the custom alerts (alertPrefs): their "failed" and
 * "spike" carry over, so nobody's choice changes when this page arrives.
 */
export function parseNotifyPrefs(raw: string | null | undefined, legacy?: { failed: boolean; spike: boolean }): NotifyPrefs {
  const base: NotifyPrefs = structuredClone(NOTIFY_DEFAULTS);
  if (legacy) (base.ev.post_failed = legacy.failed), (base.ev.engagement_spike = legacy.spike);
  if (!raw) return withEssentials(base);
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return withEssentials(base);
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return withEssentials(base);
  const o = v as Record<string, any>;
  if (o.ev && typeof o.ev === "object") for (const e of EVENTS) if (typeof o.ev[e] === "boolean") base.ev[e] = o.ev[e];
  if ((LEADS as readonly number[]).includes(o.lead)) base.lead = o.lead;
  if (o.ch && typeof o.ch === "object") for (const k of ["push", "inApp", "email"] as const) if (typeof o.ch[k] === "boolean") base.ch[k] = o.ch[k];
  if (o.quiet && typeof o.quiet === "object") {
    if (typeof o.quiet.on === "boolean") base.quiet.on = o.quiet.on;
    if (typeof o.quiet.urgent === "boolean") base.quiet.urgent = o.quiet.urgent;
    if (validTime(o.quiet.start)) base.quiet.start = o.quiet.start;
    if (validTime(o.quiet.end)) base.quiet.end = o.quiet.end;
  }
  // 1141: saved before the assistant existed means the assistant's own defaults, not everything off.
  if (o.assist && typeof o.assist === "object") {
    for (const k of ["inactivity", "growth", "summary"] as const) if (typeof o.assist[k] === "boolean") base.assist[k] = o.assist[k];
    if (o.assist.greet && typeof o.assist.greet === "object") for (const s of GREET_SLOTS) if (typeof o.assist.greet[s] === "boolean") base.assist.greet[s] = o.assist.greet[s];
  }
  return withEssentials(base);
}

function withEssentials(p: NotifyPrefs) {
  for (const e of EVENTS) if (EVENT_INFO[e].essential) p.ev[e] = true;
  return p;
}

export const serializeNotifyPrefs = (p: NotifyPrefs) => JSON.stringify(withEssentials(structuredClone(p)));

export type NotifyPatch = {
  ev?: Partial<Record<EventKey, boolean>>;
  /** Everything optional on or off at once ("Enable all" / "Disable all"). */
  all?: boolean;
  /** One whole category on or off. */
  category?: { id: CategoryId; on: boolean };
  lead?: Lead;
  ch?: Partial<NotifyPrefs["ch"]>;
  quiet?: Partial<NotifyPrefs["quiet"]>;
  /** 1141: one assistant switch, or one greeting slot, at a time. */
  assist?: { greet?: Partial<Record<GreetSlot, boolean>>; inactivity?: boolean; growth?: boolean; summary?: boolean };
};

export function applyPatch(p: NotifyPrefs, patch: NotifyPatch): NotifyPrefs {
  const n = structuredClone(p);
  if (typeof patch.all === "boolean") for (const e of EVENTS) n.ev[e] = patch.all;
  if (patch.category) for (const e of CATEGORIES.find((c) => c.id === patch.category!.id)?.events ?? []) n.ev[e] = patch.category.on;
  for (const [k, v] of Object.entries(patch.ev ?? {})) if ((EVENTS as readonly string[]).includes(k) && typeof v === "boolean") n.ev[k as EventKey] = v;
  if (patch.lead && (LEADS as readonly number[]).includes(patch.lead)) n.lead = patch.lead;
  Object.assign(n.ch, patch.ch ?? {});
  const q = patch.quiet ?? {};
  if (typeof q.on === "boolean") n.quiet.on = q.on;
  if (typeof q.urgent === "boolean") n.quiet.urgent = q.urgent;
  if (validTime(q.start)) n.quiet.start = q.start;
  if (validTime(q.end)) n.quiet.end = q.end;
  const a = patch.assist ?? {};
  for (const k of ["inactivity", "growth", "summary"] as const) if (typeof a[k] === "boolean") n.assist[k] = a[k]!;
  for (const s of GREET_SLOTS) if (typeof a.greet?.[s] === "boolean") n.assist.greet[s] = a.greet[s]!;
  return withEssentials(n);
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Is `now` inside the quiet window, in the creator's time zone? A window may cross midnight (22:00 to 07:00). */
export function inQuietHours(q: NotifyPrefs["quiet"], now: Date, tz: string) {
  if (!q.on) return false;
  const s = minutes(q.start);
  const e = minutes(q.end);
  if (s === e) return false;
  const { hour, minute } = zoneParts(now, tz);
  const m = hour * 60 + minute;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

export interface Delivery {
  /** The event is wanted at all. Off = no notice anywhere (as the old "failed" switch behaved). */
  wanted: boolean;
  /** Shown unread in the bell. When in-app is off the notice is still kept (history, dedupe) but filed as read. */
  bell: boolean;
  push: boolean;
  email: boolean;
  /** Push held back only because of quiet hours (it still lands in the bell). */
  quieted: boolean;
  /** 1141: push held back because this category spoke a moment ago (it still lands in the bell). */
  cooled: boolean;
  /** 1141: notifications are paused for everyone from the admin console. Essential alerts ignore it. */
  paused: boolean;
  /** 1141: why nothing (or only the bell) happened, in one word, for the delivery log. */
  reason: SkipReason;
  /** 1141: 1 urgent ... 4 the assistant talking. */
  priority: 1 | 2 | 3 | 4;
}

export type SkipReason = "event_off" | "paused" | "cooldown" | "quiet_hours" | null;

export interface DecideCtx {
  /** When this kind's cooldown bucket last sent something. */
  lastInBucketAt?: Date | null;
  /** Minutes of quiet after that. 0 or missing = no cooldown. */
  cooldownMin?: number;
  /** The admin's global pause. An essential alert goes out anyway: it is what stops a post failing silently. */
  paused?: boolean;
}

/** Is this assistant nudge switched on at all? (The exact greeting slot is checked by the job that sends it.) */
export function assistOn(p: NotifyPrefs, kind: string) {
  const a = ASSIST_KIND[kind];
  if (!a) return true;
  if (a === "greet") return GREET_SLOTS.some((s) => p.assist.greet[s]);
  return p.assist[a];
}

/**
 * The one place that decides where a notification may go. 1118 settled the switches, channels and quiet
 * hours; 1141 adds the assistant's switches, the per-category cooldown and the admin's pause. A cooldown or
 * a pause never destroys the notice: it lands in the bell, so nothing is lost, only the buzzing stops.
 */
export function decide(p: NotifyPrefs, kind: string, now: Date, tz: string, ctx: DecideCtx = {}): Delivery {
  const ev = KIND_EVENT[kind];
  const info = ev ? EVENT_INFO[ev] : ASSIST_KIND[kind] ? ASSIST_INFO[ASSIST_KIND[kind]] : undefined;
  const essential = !!info?.essential;
  const priority = priorityOf(kind);
  const none = (reason: SkipReason): Delivery => ({ wanted: false, bell: false, push: false, email: false, quieted: false, cooled: false, paused: false, reason, priority });
  if (!assistOn(p, kind)) return none("event_off");
  const wanted = !ev || p.ev[ev] || essential;
  if (!wanted) return none("event_off");
  const paused = !!ctx.paused && !essential;
  const quiet = inQuietHours(p.quiet, now, tz) && !(p.quiet.urgent && info?.urgent);
  const cooled =
    !essential &&
    !info?.urgent &&
    !!ctx.cooldownMin &&
    ctx.cooldownMin > 0 &&
    !!ctx.lastInBucketAt &&
    now.getTime() - ctx.lastInBucketAt.getTime() < ctx.cooldownMin * 60_000;
  const reason: SkipReason = paused ? "paused" : cooled ? "cooldown" : p.ch.push && quiet ? "quiet_hours" : null;
  return {
    wanted,
    bell: p.ch.inApp || essential,
    push: p.ch.push && !quiet && !cooled && !paused,
    email: p.ch.email && !paused,
    quieted: p.ch.push && quiet,
    cooled,
    paused,
    reason,
    priority,
  };
}

/** How long a push is worth delivering. A reminder after its post went out is noise, so it expires first. */
export const ttlFor = (kind: string, minutesLeft?: number) => (kind === "remind" ? Math.max(60, Math.round((minutesLeft ?? 15) * 60)) : 86_400);
export const urgencyFor = (kind: string) => (EVENT_INFO[KIND_EVENT[kind]]?.urgent ? "high" : "normal");

/** Milestones: a post's views on one platform crossing these counts. */
export const MILESTONES = [1_000, 10_000, 100_000, 1_000_000] as const;
export const crossed = (before: number, after: number) => MILESTONES.filter((m) => before < m && after >= m);
export const milestoneLabel = (m: number) => (m >= 1_000_000 ? `${m / 1_000_000}M` : `${m / 1000}K`);
