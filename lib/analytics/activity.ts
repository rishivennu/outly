import "server-only";
import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { db } from "../db";
import { touchActivity } from "../activity";
import { touchPresence } from "../presence";
import { currentSessionId } from "../auth";
import { dayKey } from "../admin/activation";
import { NATIVE_CLIENT_HEADER, parseNativeClient } from "../native-client";
import { cleanMeta, clientInfo, qualifies, sameSession, SHELL_COOKIE, type ClientInfo, type EventName, type Platform } from "./activity-core";

/**
 * R1308 App Analytics, the write side. Every meaningful thing a person does becomes one ActivityEvent row, attached
 * to a UsageSession (a stretch of use) and, for the apps, an AppInstall. Writes run after the response (Next's
 * after()) and never throw: analytics must not slow down or break sign-in, publishing or uploads.
 *
 * The event names and the rules (which events count as "active", how sessions are cut) live in activity-core.ts.
 */

export const INSTALL_HEADER = "x-outlly-install";
export const INSTALL_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const installIdOf = (v: string | null | undefined) => (v && INSTALL_ID_RE.test(v.trim()) ? v.trim() : null);

export type Placement = { client: ClientInfo; key: string | null; installId: string | null };

/** Where this request comes from. Null outside a request (sweeps, queue jobs). Reads start synchronously, so it may be awaited later. */
export function requestPlacement(): Promise<Placement | null> {
  let hp: Promise<Awaited<ReturnType<typeof headers>>>, cp: Promise<Awaited<ReturnType<typeof cookies>>>, sp: Promise<string | null>;
  try {
    hp = headers();
    cp = cookies();
    sp = currentSessionId().catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
  return (async () => {
    try {
      const [h, c, sid] = await Promise.all([hp, cp, sp]);
      const native = parseNativeClient(h.get(NATIVE_CLIENT_HEADER));
      const client = clientInfo({ ua: h.get("user-agent"), native: native ? { platform: native.platform, version: native.version } : null, shell: c.get(SHELL_COOKIE)?.value ?? null });
      return { client, key: sid, installId: installIdOf(h.get(INSTALL_HEADER)) };
    } catch {
      return null;
    }
  })();
}

const SERVER: ClientInfo = { platform: "server", device: "desktop", os: "Other", browser: "Other", version: null };

/** Runs `fn` once the response is out when inside a request; right away (still detached) otherwise. Never throws. */
function later(fn: () => Promise<unknown>) {
  const run = () => fn().catch((e) => console.warn("[activity]", e instanceof Error ? e.message : e));
  try {
    after(run);
  } catch {
    void run();
  }
}

/* ---------------- sessions ---------------- */

const live = ((globalThis as unknown as { __usageSessions?: Map<string, { id: string; at: number }> }).__usageSessions ??= new Map());

/** The open UsageSession for this key, extended; a new one once the gap is over SESSION_GAP_MS. `create` false = never open one (heartbeats). */
async function session(userId: string, key: string, client: ClientInfo, at: Date, add: number, create: boolean): Promise<string | null> {
  const k = `${userId}:${key}`;
  const now = at.getTime();
  const c = live.get(k);
  if (c && sameSession(c.at, now)) {
    live.set(k, { id: c.id, at: now });
    await db.usageSession.updateMany({ where: { id: c.id }, data: { lastSeenAt: at, events: { increment: add } } });
    return c.id;
  }
  const last = await db.usageSession.findFirst({ where: { userId, key, endedAt: null }, orderBy: { lastSeenAt: "desc" }, select: { id: true, lastSeenAt: true } });
  if (last && sameSession(last.lastSeenAt, now)) {
    live.set(k, { id: last.id, at: now });
    await db.usageSession.update({ where: { id: last.id }, data: { lastSeenAt: at, events: { increment: add } } });
    return last.id;
  }
  if (!create) return null;
  const s = await db.usageSession.create({
    data: { userId, key, startedAt: at, lastSeenAt: at, platform: client.platform, device: client.device, os: client.os, browser: client.browser, version: client.version, events: add },
    select: { id: true },
  });
  if (live.size > 20_000) live.clear();
  live.set(k, { id: s.id, at: now });
  return s.id;
}

/* ---------------- events ---------------- */

export type EventInput = { name: EventName; meta?: unknown; at?: Date };

/** Writes one or more events for a person, right now. Returns how many were written. Never throws. */
export async function recordEvents(userId: string, events: EventInput[], p: Placement | null, now = new Date()): Promise<number> {
  if (!events.length) return 0;
  try {
    const client = p?.client ?? SERVER;
    const key = p?.key ?? p?.installId ?? `server:${userId}`;
    const at = events[events.length - 1].at ?? now;
    const sessionId = await session(userId, key, client, at, events.length, true);
    await db.activityEvent.createMany({
      data: events.map((e) => {
        const t = e.at ?? now;
        const meta = cleanMeta(e.meta);
        return { userId, name: e.name, at: t, day: dayKey(t), platform: client.platform, device: client.device, os: client.os, browser: client.browser, version: client.version, sessionId, installId: p?.installId ?? null, meta: meta ? JSON.stringify(meta) : null };
      }),
    });
    if (events.some((e) => qualifies(e.name))) await Promise.allSettled([touchActivity(userId), touchPresence(userId, now.getTime())]);
    if (p?.installId) await db.appInstall.updateMany({ where: { id: p.installId }, data: { lastSeenAt: now, userId } }).catch(() => {});
    return events.length;
  } catch (e) {
    console.warn("[activity] record", e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * The one call the rest of the app makes: `track("post_scheduled", userId, { platform })`. Placement is read from
 * the request at once; the database work happens after the response. Outside a request (the sweep, a queue job)
 * the event lands on the "server" platform.
 */
export function track(name: EventName, userId: string, meta?: unknown, o: { key?: string | null } = {}): void {
  const placement = requestPlacement();
  later(async () => {
    const p = await placement;
    // Sign-in sets the session cookie in this very response, so the caller hands the new sid over (o.key).
    const withKey = o.key !== undefined ? { ...(p ?? { client: SERVER, installId: null }), key: o.key ?? null } : p;
    return recordEvents(userId, [{ name, meta }], withKey);
  });
}

/** A heartbeat: the person is online; an open session is extended; a known install is seen. Never opens a session, never writes an event. */
export async function heartbeat(userId: string, p: Placement | null, now = new Date()): Promise<void> {
  try {
    await touchPresence(userId, now.getTime());
    const key = p?.key ?? p?.installId;
    if (key && p) await session(userId, key, p.client, now, 0, false);
    if (p?.installId) await db.appInstall.updateMany({ where: { id: p.installId }, data: { lastSeenAt: now, userId } });
  } catch (e) {
    console.warn("[activity] heartbeat", e instanceof Error ? e.message : e);
  }
}

/** Sign-out: the open session for this sign-in ends now (the row is kept; UserSession's own row is deleted elsewhere). */
export async function endSessions(userId: string, key: string | null, now = new Date()): Promise<void> {
  if (!key) return;
  live.delete(`${userId}:${key}`);
  await db.usageSession.updateMany({ where: { userId, key, endedAt: null }, data: { endedAt: now } }).catch(() => {});
}

/* ---------------- installs ---------------- */

export type InstallSource = "first_launch" | "appinstalled" | "standalone" | "app_signin";

/**
 * A confirmed installation signal. The first time an id is seen, an install is created and its event written
 * (app_first_launch for the apps, pwa_installed for the web app); later calls only refresh lastSeenAt, the version
 * and the owner. Returns whether this was the first time. Never throws.
 */
export async function registerInstall(o: { id: string; userId: string | null; platform: Exclude<Platform, "web" | "server">; source: InstallSource; client: ClientInfo; placement?: Placement | null }, now = new Date()): Promise<boolean> {
  try {
    const existing = await db.appInstall.findUnique({ where: { id: o.id }, select: { id: true } });
    if (existing) {
      await db.appInstall.update({ where: { id: o.id }, data: { lastSeenAt: now, version: o.client.version ?? undefined, ...(o.userId ? { userId: o.userId } : {}), status: "active" } });
      return false;
    }
    await db.appInstall.create({ data: { id: o.id, userId: o.userId, platform: o.platform, version: o.client.version, device: o.client.device, os: o.client.os, source: o.source, firstSeenAt: now, lastSeenAt: now } });
    if (o.userId) await recordEvents(o.userId, [{ name: o.platform === "pwa" ? "pwa_installed" : "app_first_launch", meta: { source: o.source }, at: now }], o.placement ?? { client: o.client, key: null, installId: o.id }, now);
    return true;
  } catch (e) {
    console.warn("[activity] install", e instanceof Error ? e.message : e);
    return false;
  }
}

/** FCM said these phones' tokens are gone: the installs they belonged to are, as far as we can tell, uninstalled. */
export async function markUninstalled(installIds: string[], now = new Date()): Promise<number> {
  const ids = installIds.filter(Boolean);
  if (!ids.length) return 0;
  const r = await db.appInstall.updateMany({ where: { id: { in: ids }, status: "active" }, data: { status: "uninstalled", lastSeenAt: now } }).catch(() => ({ count: 0 }));
  return r.count;
}

/* ---------------- retention policy ---------------- */

export const EVENT_KEEP_DAYS = 400;

/** Raw events and sessions older than EVENT_KEEP_DAYS go; the daily rollups keep the history. Bounded, for the sweep. */
export async function pruneActivity(now = new Date()): Promise<{ events: number; sessions: number }> {
  const cut = new Date(now.getTime() - EVENT_KEEP_DAYS * 86_400_000);
  const [e, s] = await Promise.all([
    db.activityEvent.deleteMany({ where: { at: { lt: cut } } }).catch(() => ({ count: 0 })),
    db.usageSession.deleteMany({ where: { lastSeenAt: { lt: cut } } }).catch(() => ({ count: 0 })),
  ]);
  return { events: e.count, sessions: s.count };
}
