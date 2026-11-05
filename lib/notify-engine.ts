import "server-only";
import { db } from "./db";
import { priorityOf } from "./notify-core";
import { logDeliveries } from "./notify-log";
import { notify, type NoticeInput } from "./retention/notices";

/**
 * 1141: the event layer in front of notify(). Anything that wants to tell a creator something records an
 * event with an idempotency key and returns; the sweeper turns events into notices.
 *
 * Why not call notify() straight away: a webhook, a queue worker and a retry can all describe the same
 * thing, and a notice is only deduped once it exists. The idempotency key lets the second and third caller
 * be a no-op before any work happens, and a handler that throws (push service down, database busy) is
 * retried with backoff instead of losing the event. Four failures and it goes to the dead letters, where
 * the admin can see what was never delivered rather than guessing.
 */
export const MAX_ATTEMPTS = 4;
/** Minutes before the next try. A notice nobody saw is worth retrying; it is not worth retrying forever. */
export const BACKOFF_MIN = [1, 5, 30];

export interface NotifyEventInput {
  userId: string;
  /** The notice kind this becomes ("new_comment"), used for priority and the settings switch. */
  kind: NoticeInput["kind"];
  /** Where it came from, for the admin log: "webhook:meta", "sweep:inactivity", "queue:publish". */
  source: string;
  /** The same key twice is the same event. Caller's job to make it describe the thing, not the moment. */
  idemKey: string;
  accountId?: string | null;
  priority?: number;
  /** What the handler needs. For the default handler this is the NoticeInput itself. */
  payload: Record<string, unknown>;
  /** Hold it back until this time (a digest for 09:00, a retry after an hour). */
  nextAt?: Date;
}

export type EventRow = { id: string; userId: string; kind: string; source: string; idemKey: string; accountId: string | null; priority: number; payload: string; attempts: number };
export type EventHandler = (ev: EventRow, payload: Record<string, any>) => Promise<{ ok: boolean; reason?: string }>;

const handlers = new Map<string, EventHandler>();
/** Lets a feature own what its event means without this file importing every feature. */
export function registerHandler(kind: string, fn: EventHandler) {
  handlers.set(kind, fn);
}

/**
 * The default: the payload IS the notice. Covers every kind that only needs a title, body and link, which
 * is most of them, so a new rule usually adds no code here at all.
 */
export const noticeHandler: EventHandler = async (ev, payload) => {
  const n = payload as Partial<NoticeInput>;
  if (!n.title || !n.body || !n.key) return { ok: false, reason: "payload missing title, body or key" };
  const r = await notify(
    ev.userId,
    { kind: ev.kind as NoticeInput["kind"], tone: n.tone ?? "info", title: n.title, body: n.body, href: n.href ?? null, action: n.action ?? null, key: n.key },
    { email: payload.email === true, push: payload.push as any, eventId: ev.id },
  );
  return { ok: true, reason: r.created ? undefined : "already recorded" };
};

export async function recordEvent(input: NotifyEventInput) {
  const data = {
    userId: input.userId,
    kind: input.kind,
    source: input.source,
    idemKey: input.idemKey,
    accountId: input.accountId ?? null,
    priority: input.priority ?? priorityOf(input.kind),
    payload: JSON.stringify(input.payload),
    nextAt: input.nextAt ?? new Date(),
  };
  try {
    const row = await db.notifyEvent.create({ data, select: { id: true } });
    return { id: row.id, duplicate: false };
  } catch {
    // The unique idemKey did its job, or the row cannot be written at all; either way the caller moves on.
    const had = await db.notifyEvent.findUnique({ where: { idemKey: input.idemKey }, select: { id: true } }).catch(() => null);
    return { id: had?.id ?? null, duplicate: !!had };
  }
}

/** Records many at once and tells you how many were new, for a webhook that arrives with a batch. */
export async function recordEvents(list: NotifyEventInput[]) {
  let fresh = 0;
  for (const e of list) if (!(await recordEvent(e)).duplicate) fresh++;
  return { total: list.length, fresh };
}

const backoff = (attempts: number, now: Date) => new Date(now.getTime() + (BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1] ?? 30) * 60_000);

async function deadLetter(ev: EventRow, error: string, now: Date) {
  await db.notifyDeadLetter.create({ data: { userId: ev.userId, kind: ev.kind, source: ev.source, idemKey: ev.idemKey, payload: ev.payload, error: error.slice(0, 500), attempts: ev.attempts + 1, createdAt: now } }).catch(() => null);
  await db.notifyEvent.update({ where: { id: ev.id }, data: { status: "dead", attempts: ev.attempts + 1, lastError: error.slice(0, 500), processedAt: now } }).catch(() => null);
  await logDeliveries(ev.userId, ev.kind, [{ channel: "inapp", status: "failed", reason: "dead_letter", detail: error }], { eventId: ev.id });
}

/** Runs one event. Exported so a test, or the admin's retry button, can drive a single row. */
export async function processEvent(ev: EventRow, now = new Date()) {
  let payload: Record<string, any> = {};
  try {
    payload = JSON.parse(ev.payload) as Record<string, any>;
  } catch {
    await deadLetter(ev, "payload is not readable", now);
    return { status: "dead" as const };
  }
  const fn = handlers.get(ev.kind) ?? noticeHandler;
  try {
    const r = await fn(ev, payload);
    if (!r.ok) {
      await deadLetter(ev, r.reason ?? "handler refused it", now);
      return { status: "dead" as const };
    }
    await db.notifyEvent.update({ where: { id: ev.id }, data: { status: "done", attempts: ev.attempts + 1, processedAt: now, lastError: null } });
    return { status: "done" as const, reason: r.reason };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (ev.attempts + 1 >= MAX_ATTEMPTS) {
      await deadLetter(ev, msg, now);
      return { status: "dead" as const };
    }
    await db.notifyEvent.update({ where: { id: ev.id }, data: { status: "pending", attempts: ev.attempts + 1, lastError: msg.slice(0, 500), nextAt: backoff(ev.attempts + 1, now) } }).catch(() => null);
    return { status: "retry" as const };
  }
}

const SELECT = { id: true, userId: true, kind: true, source: true, idemKey: true, accountId: true, priority: true, payload: true, attempts: true } as const;

/**
 * The sweeper's turn of the handle. Urgent first (priority 1 is a failed post, 4 is an assistant nudge),
 * then oldest due first, so a backlog of nudges can never delay a payment failure.
 */
export async function drainEvents(now = new Date(), limit = 80) {
  const rows = await db.notifyEvent.findMany({ where: { status: "pending", nextAt: { lte: now } }, orderBy: [{ priority: "asc" }, { nextAt: "asc" }], take: limit, select: SELECT });
  const out = { picked: rows.length, done: 0, retry: 0, dead: 0 };
  for (const ev of rows) {
    const r = await processEvent(ev, now);
    if (r.status === "done") out.done++;
    else if (r.status === "retry") out.retry++;
    else out.dead++;
  }
  return out;
}

/** Old finished events are noise; the dead letters and the delivery log are the record that stays. */
export async function pruneEvents(now = new Date(), days = 14) {
  const r = await db.notifyEvent.deleteMany({ where: { status: { in: ["done", "skipped"] }, processedAt: { lt: new Date(now.getTime() - days * 864e5) } } });
  return r.count;
}
