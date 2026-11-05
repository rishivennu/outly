import { GREET_HOUR, type GreetSlot } from "./notify-core";
import { IDLE_TIERS, type IdleStep, type IdleTier } from "./notify-config-core";

/**
 * 1141: the arithmetic behind the assistant's nudges, with no database and no clock of its own, so a test
 * can ask "what would you send a creator in Kolkata at 08:02 who was last here three days ago" and get an
 * answer. The sweep (lib/retention/assistant.ts) does the reading and sending.
 */

/**
 * A greeting slot is due in the first few minutes of its hour. The sweeper runs every minute, so a wider
 * window only means more chances to catch the slot after a missed run; the notice key still allows one a day.
 */
export const GREET_GRACE_MIN = 9;
export function dueSlot(hour: number, minute: number, grace = GREET_GRACE_MIN): GreetSlot | null {
  for (const s of Object.keys(GREET_HOUR) as GreetSlot[]) if (GREET_HOUR[s] === hour && minute <= grace) return s;
  return null;
}

/** A small stable hash: the same creator and the same day always get the same line, so a retry reads the same. */
export function seedOf(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  return h;
}

export function pickLine(lines: string[], seed: string, name: string) {
  if (!lines.length) return "";
  const line = lines[seedOf(seed) % lines.length];
  return line.replaceAll("{name}", name).trim();
}

/**
 * Which inactivity step has just come due. Only the furthest one that applies, so somebody back after two
 * weeks hears "your audience is waiting" once and not four nudges at once. Steps switched off are skipped
 * entirely rather than falling back to the step below, which would make switching one off look broken.
 */
export function dueIdleTier(minutesAway: number, idle: Record<IdleTier, IdleStep>): IdleTier | null {
  let best: IdleTier | null = null;
  let bestMin = -1;
  for (const t of IDLE_TIERS) {
    const s = idle[t];
    if (!s?.on || minutesAway < s.minutes || s.minutes <= bestMin) continue;
    best = t;
    bestMin = s.minutes;
  }
  return best;
}

export const minutesAway = (lastAt: Date | null | undefined, now: Date) => (lastAt ? Math.floor((now.getTime() - lastAt.getTime()) / 60_000) : Number.POSITIVE_INFINITY);

/** Dedupe keys. A greeting is once per slot per local day; a nudge is once per step per spell away. */
export const assistKey = {
  greet: (userId: string, day: string, slot: GreetSlot) => `greet:${userId}:${day}:${slot}`,
  idle: (userId: string, tier: IdleTier, since: Date | null | undefined) => `idle:${userId}:${tier}:${since ? since.toISOString().slice(0, 16) : "never"}`,
  summary: (userId: string, day: string, slot: string) => `summary:${userId}:${day}:${slot}`,
};
