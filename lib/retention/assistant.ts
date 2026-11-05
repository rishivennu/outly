import "server-only";
import { db } from "../db";
import { dayStamp } from "../alerts-core";
import { notifyConfig } from "../notify-config";
import { assistKey, dueIdleTier, dueSlot, minutesAway, pickLine } from "../notify-assist";
import { parseNotifyPrefs, GREET_LABEL, type GreetSlot } from "../notify-core";
import { recordEvent } from "../notify-engine";
import { zoneParts } from "./core";

/**
 * 1141 section 19: the assistant's own two nudges, both decided in the creator's own time zone by the
 * minute sweeper.
 *
 *   Greetings     at 08:00, 13:00, 18:00 and 21:00 local, once per slot per day, only the slots the
 *                 creator left on. The line rotates (admin templates), the second line is read from their
 *                 own calendar, so it never claims anything that is not true.
 *   Inactivity    30 minutes, a day, three days and a week away, one step each spell away.
 *
 * Both go through the event table rather than straight to notify(), so a push service having a bad minute
 * means a retry and not a missed day. Nobody is nudged who has been gone longer than AWAY_GIVE_UP: after a
 * month it is the win-back email's job, and a greeting would read as if we had not noticed.
 */
export const AWAY_GIVE_UP_MIN = 30 * 24 * 60;
/** How many creators one sweep will look at. Greetings land inside a nine-minute window, so this is plenty. */
export const SCAN = 2000;
/** And how many will actually be written in one minute, so a big slot cannot stall the sweeper. */
export const SEND_CAP = 300;

type Cand = { id: string; name: string; timezone: string; notifyPrefs: string | null; lastActiveAt: Date | null; lastSeenAt: Date | null };

/** The creators worth looking at: anyone who has used Outlly at least once and not left for good. */
export async function assistCandidates(now: Date) {
  const floor = new Date(now.getTime() - AWAY_GIVE_UP_MIN * 60_000);
  return db.user.findMany({
    where: { OR: [{ lastActiveAt: { gte: floor } }, { lastSeenAt: { gte: floor } }] },
    select: { id: true, name: true, timezone: true, notifyPrefs: true, lastActiveAt: true, lastSeenAt: true },
    take: SCAN,
  });
}

const lastHere = (u: Cand) => {
  const a = u.lastActiveAt?.getTime() ?? 0;
  const s = u.lastSeenAt?.getTime() ?? 0;
  return a || s ? new Date(Math.max(a, s)) : null;
};

/**
 * The one true line under a greeting, read from the creator's own posts. No numbers are invented: if there
 * is nothing to say, it says there is nothing scheduled yet.
 */
export async function greetBody(userId: string, now: Date) {
  const soon = new Date(now.getTime() + 864e5);
  const [due, drafts] = await Promise.all([
    db.post.count({ where: { userId, status: "scheduled", scheduledAt: { gte: now, lt: soon } } }),
    db.post.count({ where: { userId, status: "draft" } }),
  ]);
  if (due) return `You have ${due} post${due === 1 ? "" : "s"} going out in the next day.`;
  if (drafts) return `${drafts} draft${drafts === 1 ? " is" : "s are"} waiting. Pick one up when you have a minute.`;
  return "Nothing is scheduled yet. A few minutes now sets up the day.";
}

/** Records the greeting event for one creator and slot. Exported so a test, or the admin's test send, can call it. */
export async function recordGreeting(u: { id: string; name: string }, slot: GreetSlot, day: string, lines: string[], now: Date) {
  const title = pickLine(lines, `${u.id}:${day}:${slot}`, u.name.split(" ")[0] || "there");
  if (!title) return { id: null, duplicate: true };
  return recordEvent({
    userId: u.id,
    kind: "greet",
    source: `sweep:greet:${slot}`,
    idemKey: assistKey.greet(u.id, day, slot),
    payload: { title, body: await greetBody(u.id, now), href: "/home", action: "Open Outlly", tone: "info", key: assistKey.greet(u.id, day, slot) },
    nextAt: now,
  });
}

export async function sweepGreetings(now = new Date(), cand?: Cand[]) {
  const cfg = await notifyConfig();
  const users = cand ?? (await assistCandidates(now));
  const out = { looked: users.length, sent: 0 };
  for (const u of users) {
    if (out.sent >= SEND_CAP) break;
    const tz = u.timezone || "UTC";
    let hour = 0, minute = 0;
    try {
      ({ hour, minute } = zoneParts(now, tz));
    } catch {
      continue;
    }
    const slot = dueSlot(hour, minute);
    if (!slot || !cfg.greet[slot].on) continue;
    if (!parseNotifyPrefs(u.notifyPrefs).assist.greet[slot]) continue;
    // One bad row (a broken time zone, a deleted user) skips that creator, never the rest of the sweep.
    const r = await recordGreeting(u, slot, dayStamp(now, tz), cfg.greet[slot].lines, now).catch(() => null);
    if (r?.id && !r.duplicate) out.sent++;
  }
  return out;
}

export async function sweepInactivity(now = new Date(), cand?: Cand[]) {
  const cfg = await notifyConfig();
  const users = cand ?? (await assistCandidates(now));
  const out = { looked: users.length, sent: 0 };
  for (const u of users) {
    if (out.sent >= SEND_CAP) break;
    if (!parseNotifyPrefs(u.notifyPrefs).assist.inactivity) continue;
    const since = lastHere(u);
    const away = minutesAway(since, now);
    if (!Number.isFinite(away) || away > AWAY_GIVE_UP_MIN) continue;
    const tier = dueIdleTier(away, cfg.idle);
    if (!tier) continue;
    const step = cfg.idle[tier];
    const key = assistKey.idle(u.id, tier, since);
    const r = await recordEvent({
      userId: u.id,
      kind: "inactivity",
      source: `sweep:idle:${tier}`,
      idemKey: key,
      payload: { title: step.title, body: step.body, href: tier === "m30" ? "/create" : "/home", action: "Open Outlly", tone: "info", key },
      nextAt: now,
    }).catch(() => null);
    if (r?.id && !r.duplicate) out.sent++;
  }
  return out;
}

/** What the minute sweeper calls: one scan of creators, both rules, then the events are drained as usual. */
export async function sweepAssistant(now = new Date()) {
  const users = await assistCandidates(now);
  const [greet, idle] = [await sweepGreetings(now, users), await sweepInactivity(now, users)];
  return { looked: users.length, greeted: greet.sent, nudged: idle.sent };
}

/** For the settings screen: the four slots with their label and whether the admin has the slot switched on. */
export async function greetSlots() {
  const cfg = await notifyConfig();
  return (Object.keys(GREET_LABEL) as GreetSlot[]).map((s) => ({ slot: s, label: GREET_LABEL[s], available: cfg.greet[s].on }));
}
