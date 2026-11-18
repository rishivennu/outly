/**
 * Round 1205: Pip live human support, direct chat only (signed-in creators).
 * - The queue estimate is honest: "about 1 minute" only while a specialist is online, this person is first in line
 *   and has waited under a minute. After that the honest update replaces it.
 * - Leave a message never makes a ticket or asks for an email: the words stay in the same chat, the request stays
 *   in the queue, and the abandoned-request sweep keeps it.
 * - Every language has the new words, and the widget shows Online / Away from the backend, never the email form.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const { db } = await import("../lib/db");
const { invalidate } = await import("../lib/cache");
const live = await import("../lib/support/live");
const core = await import("../lib/support/live-core");
const { LIVE_EN, liveT, liveSysLine } = await import("../lib/i18n/live");

const users: string[] = [];
const admins: string[] = [];
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const mkUser = async (t: string) => {
  const email = `live1205-${t}-${tag()}@test.dev`;
  const u = await db.user.create({ data: { name: `Live ${t}`, email, passwordHash: "x", emailVerifiedAt: new Date(), emailVerifiedFor: email } });
  users.push(u.id);
  return u;
};
const mkAdmin = async (name: string) => {
  const row = await db.adminUser.create({ data: { login: `live1205-support-${tag()}`, name, role: "support", passwordHash: `x-${tag()}` } });
  admins.push(row.id);
  return { row, s: { id: row.id, name: row.name, login: row.login, role: row.role } as import("../lib/admin/auth").AdminSession };
};
const cid = () => `c${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
const nobodyOnline = async () => {
  await db.adminUser.updateMany({ data: { liveSeenAt: null, liveAway: false } });
  invalidate("live:");
};

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actor: { startsWith: "live1205-" } } }).catch(() => {});
  await db.adminEvent.deleteMany({ where: { href: { startsWith: "/admin/live-assist" } } }).catch(() => {});
  await db.ticket.deleteMany({ where: { userId: { in: users } } }).catch(() => {});
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.adminUser.deleteMany({ where: { id: { in: admins } } });
});

describe("the queue estimate", () => {
  const base = { state: "waiting" as const, agentsOnline: 1, position: 1, waitedMs: 5_000 };
  test("about 1 minute only when online, first in line and under a minute", () => {
    expect(core.queueEta(base)).toBe("1min");
    expect(core.queueEta({ ...base, waitedMs: core.ETA_MS - 1 })).toBe("1min");
    expect(core.queueEta({ ...base, waitedMs: core.ETA_MS })).toBeNull();
    expect(core.queueEta({ ...base, agentsOnline: 0 })).toBeNull();
    expect(core.queueEta({ ...base, agentsOnline: null })).toBeNull();
    expect(core.queueEta({ ...base, position: 2 })).toBeNull();
    expect(core.queueEta({ ...base, position: null })).toBeNull();
    expect(core.queueEta({ ...base, waitedMs: null })).toBeNull();
    expect(core.queueEta({ ...base, state: "unavailable" })).toBeNull();
    expect(core.queueEta({ ...base, state: "connected" })).toBeNull();
  });

  test("the snapshot carries the estimate and the wait from real rows", async () => {
    const A = await mkAdmin("Eta Agent");
    await live.heartbeat(A.s);
    const u = await mkUser("eta");
    const r = await live.requestHuman(u.id, { message: "my reel is stuck" });
    const p = await live.customerPoll(u.id, { conversationId: r.conversationId });
    expect(p.state).toBe("waiting");
    expect(typeof p.waitedMs).toBe("number");
    expect(p.eta).toBe(p.position === 1 ? "1min" : null);
    // A minute later the estimate is gone: the widget shows the honest update instead.
    const later = await live.customerPoll(u.id, { conversationId: r.conversationId, now: Date.now() + core.ETA_MS + 1_000 });
    expect(later.waitedMs!).toBeGreaterThanOrEqual(core.ETA_MS);
    expect(later.eta).toBeNull();
    await live.cancelRequest(u.id, r.conversationId);
    const done = await live.customerPoll(u.id, { conversationId: r.conversationId });
    expect({ eta: done.eta, waitedMs: done.waitedMs }).toEqual({ eta: null, waitedMs: null });
  });
});

describe("leave a message stays in the chat", () => {
  test("no ticket, no email; the request stays queued and the sweep keeps it", async () => {
    await nobodyOnline();
    const u = await mkUser("left");
    const r = await live.requestHuman(u.id, { message: "Instagram says my token expired" });
    expect(r.state).toBe("unavailable");
    const left = await live.leaveMessage(u.id, { conversationId: r.conversationId, text: "I reconnected and it still fails.", cid: cid() });
    expect({ state: left.state, mode: left.mode }).toEqual({ state: "unavailable", mode: "waiting" });
    expect(await db.ticket.count({ where: { userId: u.id } })).toBe(0);
    const msgs = await db.pipMessage.findMany({ where: { conversationId: r.conversationId }, select: { role: true, text: true } });
    expect(msgs.filter((m) => m.text === "live.left").length).toBe(1);
    expect(msgs.some((m) => m.role === "user" && m.text === "I reconnected and it still fails.")).toBe(true);
    expect(msgs.some((m) => m.text.startsWith("live.ticket"))).toBe(false);
    // The tab closes for an hour: an abandoned request is swept, one with a message is kept.
    const old = new Date(Date.now() - core.ABANDON_MS - 60_000);
    await db.supportSession.update({ where: { id: r.session!.id }, data: { customerSeenAt: old } });
    await live.sweepAbandoned(Date.now(), true);
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: r.session!.id } })).status).toBe("waiting");
    await live.cancelRequest(u.id, r.conversationId);
  });

  test("a message typed while waiting counts as left too", async () => {
    await nobodyOnline();
    const u = await mkUser("typed");
    const r = await live.requestHuman(u.id, {});
    await live.customerSend(u.id, { conversationId: r.conversationId, text: "Are you there?", cid: cid() });
    expect(await db.supportAssignment.count({ where: { sessionId: r.session!.id, action: "leave_message" } })).toBe(1);
    await live.customerSend(u.id, { conversationId: r.conversationId, text: "Still here.", cid: cid() });
    expect(await db.supportAssignment.count({ where: { sessionId: r.session!.id, action: "leave_message" } })).toBe(1);
    await live.cancelRequest(u.id, r.conversationId);
  });

  test("leaving needs a request that is still waiting", async () => {
    const u = await mkUser("noreq");
    const r = await live.requestHuman(u.id, {});
    await live.cancelRequest(u.id, r.conversationId);
    let code: string | undefined;
    try { await live.leaveMessage(u.id, { conversationId: r.conversationId, text: "hi" }); } catch (e) { code = (e as { code?: string }).code; }
    expect(code).toBe("NOT_LIVE");
  });
});

describe("the words", () => {
  const LANGS = ["en", "hi", "es", "fr", "de", "pt", "ar", "zh", "ja", "ru", "id", "bn"] as const;
  const KEYS = ["handoff", "waitingEta", "waitingLong", "queueConnecting", "queueWaiting", "queueAway", "etaLine", "available", "leftHere", "leaveHint", "signedOut", "humanOnline", "humanAway", "humanLabel", "unavailable"] as const;
  test("the brief's exact English", () => {
    expect(LIVE_EN.waitingEta).toBe("You're in the queue. Please wait approximately 1 minute while we connect you to a support specialist.");
    expect(LIVE_EN.queueConnecting).toBe("Queue status: Connecting to a specialist");
    expect(LIVE_EN.etaLine).toBe("Estimated wait: Approximately 1 minute");
    expect(LIVE_EN.connectedWith("Priya")).toBe("You're now connected with Priya. They'll assist you here.");
    expect(LIVE_EN.humanOnline).toBe("Human support · Online");
    expect(liveSysLine(liveT("en"), "live.left")).toBe(LIVE_EN.leftHere);
  });
  test("every language has every new key, translated, with no em dash and no email", () => {
    for (const l of LANGS) {
      const t = liveT(l);
      for (const k of KEYS) {
        const v = t[k] as string;
        expect({ l, k, ok: typeof v === "string" && v.length > 0 && !v.includes("\u2014") }).toEqual({ l, k, ok: true });
        if (l !== "en" && k !== "humanLabel") expect({ l, k, same: v === LIVE_EN[k] }).toEqual({ l, k, same: false });
      }
      expect(t.connectedWith("Zed")).toContain("Zed");
      expect("emailWhy" in t).toBe(false);
      for (const k of ["unavailable", "leftHere", "leaveHint", "available"] as const) expect({ l, k, email: /e-?mail/i.test(t[k]) }).toEqual({ l, k, email: false });
    }
  });
});

describe("the widget", () => {
  const w = readFileSync("components/support/ChatWidget.tsx", "utf8");
  test("Online and Away come from the backend; no email form for a signed-in person", () => {
    expect(w).not.toContain("emailWhy");
    expect(w).toContain("lt.humanOnline");
    expect(w).toContain("lt.humanAway");
    expect(w).toMatch(/fetch\("\/api\/support\/live"/);
    expect(w).toContain("lt.waitingEta");
    expect(w).toContain("lt.etaLine");
    expect(w).toContain("lt.waitingLong");
    const req = w.slice(w.indexOf("async function requestLive"), w.indexOf("async function requestLive") + 4000);
    expect(req.length).toBeGreaterThan(100);
    expect(req).not.toContain("askEmail");
    // Visitors still leave an email until Phase 2; a signed-in person never reaches it from escalate.
    expect(w).toMatch(/if \(!signedIn\) return askEmail\(\);/);
  });
  test("the live dot honours reduced motion and Away is not colour alone", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain(".pc-pulse");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.pc-pulse \{ animation: none; \} \}/);
    expect(css).toMatch(/\.pc-dot\.pc-dot-away \{[^}]*box-shadow/);
  });
});
