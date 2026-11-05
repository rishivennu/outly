import { COOLDOWN_MIN, GREET_SLOTS, type CategoryId, type GreetSlot } from "./notify-core";

/**
 * 1141: the shape of the parts of the notification engine an admin can tune without a deploy: the global pause, the
 * per-category cooldowns, the inactivity steps and the greeting templates. No database here, so the admin screens and the
 * settings page can read the same defaults and the same validator as the server (lib/notify-config.ts
 * stores and caches it).
 *
 * Everything here changes *when* and *how loudly* Outlly speaks. Nothing here can invent a fact: the
 * templates hold no numbers, and whatever context a greeting carries is read from the creator's own data
 * at send time (lib/notify-assist.ts).
 */
export const NOTIFY_CONFIG_KEY = "notify";

/** How long away counts as away. The names are the four steps the spec asks for. */
export const IDLE_TIERS = ["m30", "h24", "d3", "d7"] as const;
export type IdleTier = (typeof IDLE_TIERS)[number];
export const IDLE_MINUTES: Record<IdleTier, number> = { m30: 30, h24: 24 * 60, d3: 3 * 24 * 60, d7: 7 * 24 * 60 };
export const IDLE_LABEL: Record<IdleTier, string> = { m30: "After 30 minutes", h24: "After a day", d3: "After three days", d7: "After a week" };

export interface IdleStep {
  on: boolean;
  /** Minutes away before this step is due. Steps are always sent in order, one each. */
  minutes: number;
  title: string;
  body: string;
}

export interface NotifyConfig {
  /** The emergency brake: no push and no email for anyone. Essential alerts (a sign-out, a failed payment) still go. */
  paused: boolean;
  /** Minutes of quiet after one notification in the same category. */
  cooldown: Record<CategoryId | "assist", number>;
  idle: Record<IdleTier, IdleStep>;
  /** Per slot: whether the slot exists at all for anyone, and the lines it rotates through. */
  greet: Record<GreetSlot, { on: boolean; lines: string[] }>;
  /** Grouping: when more than `min` quiet notifications land inside `windowMin`, send one summary instead. */
  digest: { on: boolean; windowMin: number; min: number };
}

export const NOTIFY_CONFIG_DEFAULT: NotifyConfig = {
  paused: false,
  cooldown: { ...COOLDOWN_MIN },
  idle: {
    m30: { on: true, minutes: IDLE_MINUTES.m30, title: "Ready to create?", body: "Your next content idea is waiting." },
    h24: { on: true, minutes: IDLE_MINUTES.h24, title: "Your calendar needs a little attention", body: "Plan tomorrow's post now and it is off your mind." },
    d3: { on: true, minutes: IDLE_MINUTES.d3, title: "Let's plan your next week", body: "It has been a few days. A plan for the week takes about five minutes." },
    d7: { on: true, minutes: IDLE_MINUTES.d7, title: "Your audience is waiting for your next post", body: "A week is long enough for people to drift. One post today starts the run again." },
  },
  greet: {
    morning: {
      on: true,
      lines: ["Good morning, {name}.", "Morning, {name}. A fresh day to post.", "Good morning, {name}. Let's get one thing out today."],
    },
    afternoon: { on: true, lines: ["Good afternoon, {name}.", "Afternoon, {name}. Still time to post today.", "Hello, {name}. How is the day going?"] },
    evening: { on: true, lines: ["Good evening, {name}.", "Evening, {name}. A good time to line up tomorrow.", "Evening, {name}. Worth a look before you stop."] },
    night: { on: true, lines: ["Winding down, {name}?", "Good night, {name}.", "One quiet look before bed, {name}?"] },
  },
  digest: { on: true, windowMin: 30, min: 4 },
};

const num = (v: unknown, fallback: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : fallback);
const str = (v: unknown, fallback: string, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback);

/** Validates whatever is stored or submitted into a usable config. Unknown or broken fields keep the default. */
export function mergeNotifyConfig(input: unknown): NotifyConfig {
  const d = structuredClone(NOTIFY_CONFIG_DEFAULT);
  if (!input || typeof input !== "object" || Array.isArray(input)) return d;
  const o = input as Record<string, any>;
  if (typeof o.paused === "boolean") d.paused = o.paused;
  if (o.cooldown && typeof o.cooldown === "object") for (const k of Object.keys(d.cooldown) as (CategoryId | "assist")[]) d.cooldown[k] = num(o.cooldown[k], d.cooldown[k], 24 * 60);
  if (o.idle && typeof o.idle === "object")
    for (const t of IDLE_TIERS) {
      const s = o.idle[t];
      if (!s || typeof s !== "object") continue;
      if (typeof s.on === "boolean") d.idle[t].on = s.on;
      // A step can be moved but never to zero: an "0 minutes away" reminder would fire at every sweep.
      d.idle[t].minutes = Math.max(5, num(s.minutes, d.idle[t].minutes, 60 * 24 * 60));
      d.idle[t].title = str(s.title, d.idle[t].title, 80);
      d.idle[t].body = str(s.body, d.idle[t].body, 200);
    }
  if (o.greet && typeof o.greet === "object")
    for (const s of GREET_SLOTS) {
      const g = o.greet[s];
      if (!g || typeof g !== "object") continue;
      if (typeof g.on === "boolean") d.greet[s].on = g.on;
      if (Array.isArray(g.lines)) {
        const lines = g.lines.filter((l: unknown) => typeof l === "string" && l.trim()).map((l: string) => l.trim().slice(0, 140)).slice(0, 12);
        if (lines.length) d.greet[s].lines = lines;
      }
    }
  if (o.digest && typeof o.digest === "object") {
    if (typeof o.digest.on === "boolean") d.digest.on = o.digest.on;
    d.digest.windowMin = Math.max(5, num(o.digest.windowMin, d.digest.windowMin, 24 * 60));
    d.digest.min = Math.max(2, num(o.digest.min, d.digest.min, 50));
  }
  return d;
}

