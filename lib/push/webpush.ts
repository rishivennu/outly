import "server-only";
import { db } from "../db";
import { decrypt, sha256 } from "../crypto";
import { vapidKeys } from "./vapid";
import { MAX_PLAINTEXT, MAX_REJECTS, encrypt, outcomeOf, retryDelayMs, topicOf, vapidHeader, type Outcome } from "./webpush-core";

/*
 * 1118: sending Web Push to the browsers and Home Screen apps a person turned notifications on in.
 * One message per device. What the push service answers decides what happens to the device:
 *  - 2xx: delivered to the push service (it shows the moment the device is online);
 *  - 404/410: the subscription is gone (unsubscribed, app deleted, expired), so it is removed at once;
 *  - 429/5xx/no answer: kept in PushOutbox and retried by the minute sweeper (1, 5, 15, 60 min);
 *  - other 4xx: counted; a device that keeps refusing is dropped after MAX_REJECTS.
 * Never throws: a push problem must never hide the notice it belongs to.
 */

export interface WebPushMessage {
  title: string;
  body: string;
  href?: string | null;
  /** Same tag = the newer notification replaces the older one on the device. */
  tag: string;
  kind?: string;
  /** Notice id, so a tap can mark it read. */
  id?: string | null;
  /** Unread count for the app icon badge. */
  badge?: number;
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; vapidKey: string; failures: number };

const safeHref = (h?: string | null) => (h && /^\/(?![/\\])/.test(h) ? h : "/home");

/** The JSON the service worker reads (public/sw.js). Short keys: a push body is capped near 4 KB. */
export function payloadOf(m: WebPushMessage) {
  const base = { t: m.title.slice(0, 120), b: m.body.slice(0, 400), h: safeHref(m.href), g: m.tag.slice(0, 64), k: m.kind ?? "", i: m.id ?? "", n: Math.max(0, Math.min(999, m.badge ?? 0)), s: Date.now() };
  let s = JSON.stringify(base);
  if (Buffer.byteLength(s) > MAX_PLAINTEXT) s = JSON.stringify({ ...base, b: base.b.slice(0, 160) });
  return s;
}

/** Hash used as the unique key, so the database never needs the endpoint in the clear to find a device. */
export const endpointHash = (endpoint: string) => sha256(`webpush:${endpoint}`);

/** "local" = our side failed (e.g. payload too large): the device is fine and must not be touched. */
type SendOutcome = Outcome | "local";

async function post(sub: Sub, payload: string, ttl: number, urgency: string, tag: string): Promise<{ outcome: SendOutcome; status: number | null }> {
  const v = await vapidKeys();
  // Made with a key we no longer have: the browser can't accept pushes signed with the new one.
  if (sub.vapidKey !== v.publicKey) return { outcome: "gone", status: null };
  let endpoint: string;
  let keys: { p256dh: string; auth: string };
  try {
    endpoint = decrypt(sub.endpoint);
    keys = { p256dh: decrypt(sub.p256dh), auth: decrypt(sub.auth) };
  } catch {
    return { outcome: "gone", status: null }; // unreadable keys: the subscription can never work
  }
  let body: Buffer;
  try {
    body = encrypt(Buffer.from(payload), keys);
  } catch (e) {
    console.error("[webpush] could not encrypt payload", e instanceof Error ? e.message : e);
    return { outcome: "local", status: null }; // our bug, not the device's: keep the subscription
  }
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: vapidHeader(endpoint, v),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(Math.max(0, Math.round(ttl))),
      urgency,
      topic: topicOf(tag),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (r) await r.arrayBuffer().catch(() => null);
  return { outcome: outcomeOf(r ? r.status : null), status: r ? r.status : null };
}

/** Applies one answer to the device. Returns what happened, for counts. */
async function settle(sub: Sub, outcome: SendOutcome, retry: { tag: string; payload: string; ttl: number; urgency: string; attempts: number } | null, now = new Date()) {
  if (outcome === "sent") {
    await db.webPushSub.update({ where: { id: sub.id }, data: { failures: 0, lastPushAt: now } }).catch(() => null);
    return "sent" as const;
  }
  if (outcome === "local") return "failed" as const;
  if (outcome === "gone") {
    await db.webPushSub.deleteMany({ where: { id: sub.id } });
    return "dropped" as const;
  }
  if (outcome === "rejected") {
    if (sub.failures + 1 >= MAX_REJECTS) {
      await db.webPushSub.deleteMany({ where: { id: sub.id } });
      return "dropped" as const;
    }
    await db.webPushSub.update({ where: { id: sub.id }, data: { failures: { increment: 1 } } }).catch(() => null);
    return "failed" as const;
  }
  // retry
  const delay = retry ? retryDelayMs(retry.attempts) : undefined;
  if (!retry || delay === undefined) return "failed" as const;
  const data = { payload: retry.payload, ttl: retry.ttl, urgency: retry.urgency, attempts: retry.attempts, nextAt: new Date(now.getTime() + delay) };
  await db.pushOutbox.upsert({ where: { subId_tag: { subId: sub.id, tag: retry.tag } }, create: { subId: sub.id, tag: retry.tag, ...data }, update: data }).catch(() => null);
  return "queued" as const;
}

const SUB_SELECT = { id: true, endpoint: true, p256dh: true, auth: true, vapidKey: true, failures: true } as const;

export interface PushResult {
  sent: number;
  queued: number;
  failed: number;
  dropped: number;
  devices: number;
}

/** Sends one message to every device of a person (or just `only`, for the test button). */
export async function webPushToUser(userId: string, m: WebPushMessage, opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; only?: string } = {}): Promise<PushResult> {
  const res: PushResult = { sent: 0, queued: 0, failed: 0, dropped: 0, devices: 0 };
  try {
    const subs = await db.webPushSub.findMany({ where: { userId, ...(opts.only ? { id: opts.only } : {}) }, select: SUB_SELECT, take: 20, orderBy: { lastSeenAt: "desc" } });
    res.devices = subs.length;
    if (!subs.length) return res;
    const payload = payloadOf(m);
    const ttl = opts.ttl ?? 86_400;
    const urgency = opts.urgency ?? "normal";
    await Promise.all(
      subs.map(async (s) => {
        const { outcome } = await post(s, payload, ttl, urgency, m.tag);
        const r = await settle(s, outcome, { tag: m.tag, payload, ttl, urgency, attempts: 1 });
        res[r]++;
      }),
    );
  } catch (e) {
    console.error("[webpush]", e);
  }
  return res;
}

/** The minute sweeper: retries pushes the push service turned away for now. Expired ones are dropped unsent. */
export async function drainOutbox(now = new Date()) {
  const rows = await db.pushOutbox.findMany({ where: { nextAt: { lte: now } }, include: { sub: { select: SUB_SELECT } }, take: 100, orderBy: { nextAt: "asc" } });
  let sent = 0;
  let expired = 0;
  for (const row of rows) {
    const left = row.ttl - Math.floor((now.getTime() - row.createdAt.getTime()) / 1000);
    if (left <= 0) {
      await db.pushOutbox.deleteMany({ where: { id: row.id } });
      expired++;
      continue;
    }
    const { outcome } = await post(row.sub, row.payload, left, row.urgency, row.tag);
    if (outcome !== "retry") await db.pushOutbox.deleteMany({ where: { id: row.id } });
    const r = await settle(row.sub, outcome, outcome === "retry" ? { tag: row.tag, payload: row.payload, ttl: row.ttl, urgency: row.urgency, attempts: row.attempts + 1 } : null, now);
    if (outcome === "retry" && r === "failed") await db.pushOutbox.deleteMany({ where: { id: row.id } }); // out of retries
    if (r === "sent") sent++;
  }
  return { tried: rows.length, sent, expired };
}

/** Devices nobody has opened Outlly on for 120 days: their subscriptions have almost surely lapsed. */
export const STALE_DAYS = 120;
export async function cleanupSubs(now = new Date()) {
  const r = await db.webPushSub.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - STALE_DAYS * 864e5) } } });
  return r.count;
}
