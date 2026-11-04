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
  new_message: { label: "New direct messages", hint: "Instagram and Facebook messages to accounts you connected. At most one alert an hour per conversation." },
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
    events: ["new_message", "engagement_spike", "milestone"],
    notYet: [{ label: "New comments", why: "Outlly reads comments when you open Inbox, so it can't spot new ones in the background yet." }],
  },
  { id: "billing", title: "Billing & subscription", blurb: "Important subscription and payment updates.", events: ["payment_ok", "payment_failed", "renewal", "usage_limit", "plan_update"] },
];

export const categoryOf = (e: string): CategoryId | null => CATEGORIES.find((c) => (c.events as string[]).includes(e))?.id ?? null;

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
}

const evDefaults = () => Object.fromEntries(EVENTS.map((e) => [e, !EVENT_INFO[e].off])) as Record<EventKey, boolean>;

export const NOTIFY_DEFAULTS: NotifyPrefs = { ev: evDefaults(), lead: 15, ch: { push: true, inApp: true, email: true }, quiet: { on: false, start: "22:00", end: "07:00", urgent: true } };

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
}

export function decide(p: NotifyPrefs, kind: string, now: Date, tz: string): Delivery {
  const ev = KIND_EVENT[kind];
  const info = ev ? EVENT_INFO[ev] : undefined;
  const wanted = !ev || p.ev[ev] || !!info?.essential;
  if (!wanted) return { wanted, bell: false, push: false, email: false, quieted: false };
  const quiet = inQuietHours(p.quiet, now, tz) && !(p.quiet.urgent && info?.urgent);
  return { wanted, bell: p.ch.inApp || !!info?.essential, push: p.ch.push && !quiet, email: p.ch.email, quieted: p.ch.push && quiet };
}

/** How long a push is worth delivering. A reminder after its post went out is noise, so it expires first. */
export const ttlFor = (kind: string, minutesLeft?: number) => (kind === "remind" ? Math.max(60, Math.round((minutesLeft ?? 15) * 60)) : 86_400);
export const urgencyFor = (kind: string) => (EVENT_INFO[KIND_EVENT[kind]]?.urgent ? "high" : "normal");

/** Milestones: a post's views on one platform crossing these counts. */
export const MILESTONES = [1_000, 10_000, 100_000, 1_000_000] as const;
export const crossed = (before: number, after: number) => MILESTONES.filter((m) => before < m && after >= m);
export const milestoneLabel = (m: number) => (m >= 1_000_000 ? `${m / 1_000_000}M` : `${m / 1000}K`);
