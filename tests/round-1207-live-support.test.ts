/**
 * Round 1207: live human support that never turns a customer away, and real phone alerts for the team.
 * - Asking for a person always puts the customer in the queue. Who is online, and whether anyone is, is never
 *   shown to them and never changes their state: the "unavailable" state and its words are gone.
 * - Every request alerts the team's phones once (Web Push to AdminPushSub devices, deduped by one "alerted" row),
 *   and a later message from a waiting (or abandoned) customer alerts them again, at most once per window.
 * - A request is never dropped for want of a specialist: the queue keeps it for LEFT_KEEP_MS (7 days).
 * - Joining is atomic, reassignment keeps an audit trail, and the chat survives a specialist disconnecting.
 * - The way in from the phone: the deep link survives the admin sign-in, the sidebar says Live Support and the
 *   console's one action is Join conversation.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const { db } = await import("../lib/db");
const { invalidate } = await import("../lib/cache");
const live = await import("../lib/support/live");
const core = await import("../lib/support/live-core");
const { LIVE_EN, liveT, liveSysLine } = await import("../lib/i18n/live");
const { adminDevices } = await import("../lib/health/admin-push");

const LANGS = ["en", "hi", "es", "fr", "de", "pt", "ar", "zh", "ja", "ru", "id", "bn"] as const;
const users: string[] = [];
const admins: string[] = [];
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const mkUser = async (t: string) => {
  const email = `live1207-${t}-${tag()}@test.dev`;
  const u = await db.user.create({ data: { name: `Casey ${t}`, email, passwordHash: "x", emailVerifiedAt: new Date(), emailVerifiedFor: email } });
  users.push(u.id);
  return u;
};
const mkAdmin = async (name: string, role = "support") => {
  const row = await db.adminUser.create({ data: { login: `live1207-${role}-${tag()}`, name, role, passwordHash: `x-${tag()}` } });
  admins.push(row.id);
  return { row, s: { id: row.id, name: row.name, login: row.login, role: row.role } as import("../lib/admin/auth").AdminSession };
};
const cid = () => `c${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
/** Scenario 3 from the brief: every specialist has closed Outlly. */
const nobodyOnline = async () => {
  await db.adminUser.updateMany({ data: { liveSeenAt: null, liveAway: false } });
  invalidate("live:");
};
const alerts = (sessionId: string) => db.supportAssignment.findMany({ where: { sessionId, action: "alerted" }, select: { note: true } });
const err = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { return { status: (e as { status?: number }).status, code: (e as { code?: string }).code }; }
};

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actor: { startsWith: "live1207-" } } }).catch(() => {});
  await db.adminEvent.deleteMany({ where: { href: { startsWith: "/admin/live-assist" } } }).catch(() => {});
  await db.ticket.deleteMany({ where: { userId: { in: users } } }).catch(() => {});
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.adminUser.deleteMany({ where: { id: { in: admins } } });
});

describe("the words the customer reads", () => {
  test("the queue confirmation and the connected line are the brief's, word for word", () => {
    expect(LIVE_EN.queueTitle).toBe("You're in the support queue!");
    expect(LIVE_EN.waiting).toBe("Please wait while we connect you with an Outlly support specialist. Your conversation is saved. A specialist will join this chat as soon as they're available.");
    expect(LIVE_EN.handoff).toBe("You're in the support queue! Please wait while we connect you with a specialist. Your conversation is saved.");
    expect(LIVE_EN.connectedTitle).toBe("You're connected!");
    expect(LIVE_EN.connected).toBe("You're connected! A support specialist has joined the chat.");
    expect(LIVE_EN.connectedWith("Priya")).toBe("You're connected! Priya has joined the conversation. How can we help?");
    expect(LIVE_EN.leave).toBe("Leave a message");
    expect(LIVE_EN.cancel).toBe("Cancel support request");
    expect(LIVE_EN.queueWaiting).toBe("Queue status: Waiting for a specialist");
    // The stored status lines read the same way, so a refresh shows the same words.
    expect(liveSysLine(liveT("en"), "live.requested")).toBe(LIVE_EN.handoff);
    expect(liveSysLine(liveT("en"), "live.connected|Priya")).toBe(LIVE_EN.connectedWith("Priya"));
  });

  test("the words that expose staff availability are gone from every language", () => {
    for (const l of LANGS) {
      const t = liveT(l) as unknown as Record<string, unknown>;
      for (const k of ["unavailable", "statusUnavailable", "queueAway", "humanOnline", "humanAway", "available"])
        expect({ l, k, present: k in t }).toEqual({ l, k, present: false });
      expect({ l, label: (t.humanLabel as string).length > 0 }).toEqual({ l, label: true });
    }
    const en = Object.values(LIVE_EN).map((v) => (typeof v === "function" ? (v as (x: never) => string)("X" as never) : v)).join(" ").toLowerCase();
    for (const banned of ["team unavailable", "no specialist available", "support team offline", "open a ticket", "email us"])
      expect({ banned, said: en.includes(banned) }).toEqual({ banned, said: false });
  });
});

describe("a waiting request reads as waiting, whoever is online", () => {
  test("the state comes from the session row alone", () => {
    const now = Date.now();
    const row = { status: "waiting", requestedAt: new Date(now - 42_000) };
    for (const agentsOnline of [0, 1, 7, null]) expect({ agentsOnline, state: core.customerState(row, { agentsOnline, now }) }).toEqual({ agentsOnline, state: "waiting" });
    expect(core.customerState(row)).toBe("waiting");
    expect(core.customerState({ status: "active", requestedAt: new Date(now) }, { agentsOnline: 0 })).toBe("connected");
  });

  test("no estimate is invented: it needs a real specialist online, first place and a fresh request", () => {
    const base = { state: "waiting" as const, agentsOnline: 1, position: 1, waitedMs: 1_000 };
    expect(core.queueEta(base)).toBe("1min");
    for (const o of [{ agentsOnline: 0 }, { agentsOnline: null }, { position: 2 }, { position: null }, { waitedMs: core.ETA_MS }, { waitedMs: null }])
      expect({ o, eta: core.queueEta({ ...base, ...o }) }).toEqual({ o, eta: null });
  });

  test("nobody online: queued anyway, the team is told, and the customer is never told how we are staffed", async () => {
    await nobodyOnline();
    const u = await mkUser("queue");
    const r = await live.requestHuman(u.id, { message: "My reel failed to publish to Instagram", cid: cid() });
    expect({ created: r.created, mode: r.mode, state: r.state }).toEqual({ created: true, mode: "waiting", state: "waiting" });
    expect(r.position).toBeGreaterThanOrEqual(1);
    expect(r.messages.map((m) => m.role)).toEqual(["user", "system"]);
    const sid = r.session!.id;
    const p = await live.customerPoll(u.id, { conversationId: r.conversationId });
    expect({ state: p.state, online: p.agentsOnline, eta: p.eta }).toEqual({ state: "waiting", online: null, eta: null });
    expect(typeof p.position).toBe("number");
    // One queue entry, one bell for the dashboard, one phone alert, whatever the customer does next.
    expect(await db.supportSession.count({ where: { conversationId: r.conversationId } })).toBe(1);
    expect(await db.adminEvent.count({ where: { href: core.livePushHref(sid) } })).toBe(1);
    expect((await alerts(sid)).length).toBe(1);
    const again = await live.requestHuman(u.id, { conversationId: r.conversationId, message: "hello?" });
    expect({ created: again.created, same: again.session!.id === sid }).toEqual({ created: false, same: true });
    expect(await db.supportSession.count({ where: { conversationId: r.conversationId } })).toBe(1);
    expect((await alerts(sid)).length).toBe(1);
    await live.cancelRequest(u.id, r.conversationId);
  });

  test("a later message keeps the place in line and is noted for the team, with nobody online", async () => {
    await nobodyOnline();
    const u = await mkUser("more");
    const r = await live.requestHuman(u.id, { message: "Nothing posted at 9am" });
    await live.customerSend(u.id, { conversationId: r.conversationId, text: "It is still showing as scheduled.", cid: cid() });
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: r.session!.id } });
    expect({ status: row.status, unread: row.unreadAgent }).toEqual({ status: "waiting", unread: 2 });
    // R1207: the "we have your message" note no longer waits for someone to be online.
    expect(await db.supportAssignment.count({ where: { sessionId: r.session!.id, action: "leave_message" } })).toBe(1);
    expect((await live.customerPoll(u.id, { conversationId: r.conversationId })).state).toBe("waiting");
    await live.cancelRequest(u.id, r.conversationId);
  });
});

describe("the phone alert", () => {
  test("the request payload says who is waiting and opens their conversation", () => {
    const m = core.liveRequestPush({ sessionId: "sess_1", customer: "Casey Jones", preview: "I was charged twice", urgent: false });
    expect(m.title).toBe("Outlly — New Human Support Request");
    expect(m.body).toBe('A customer is waiting for a support specialist. Casey Jones: "I was charged twice"');
    expect({ href: m.href, tag: m.tag, kind: m.kind, keepOpen: m.keepOpen }).toEqual({ href: "/admin/live-assist?s=sess_1", tag: "live-sess_1", kind: "live_request", keepOpen: true });
    expect(core.liveRequestPush({ sessionId: "s2", customer: null, preview: null, urgent: true }).title).toBe("Outlly — New Human Support Request (urgent)");
    expect(core.liveRequestPush({ sessionId: "s2", customer: null, preview: null }).body).toBe("A customer is waiting for a support specialist. A customer");
    // Long words are clipped, never wrapped over several notifications.
    const long = core.liveRequestPush({ sessionId: "s3", customer: "C", preview: "x".repeat(400) });
    expect(long.body.length).toBeLessThan(200);
    expect(long.body.endsWith('…"')).toBe(true);
  });

  test("a later message alerts differently while waiting and once a specialist has it", () => {
    const w = core.liveMessagePush({ sessionId: "s4", customer: "Casey", text: "Are you there?", waiting: true });
    expect({ title: w.title, body: w.body, keepOpen: w.keepOpen, tag: w.tag }).toEqual({ title: "Casey is still waiting · Outlly support", body: "Are you there?", keepOpen: true, tag: "live-s4" });
    const a = core.liveMessagePush({ sessionId: "s4", customer: "Casey", text: "thanks!", waiting: false });
    expect({ title: a.title, keepOpen: a.keepOpen }).toEqual({ title: "New message from Casey · Outlly support", keepOpen: false });
  });

  test("who a later message buzzes: waiting, or active with the specialist gone; never a resolved chat", () => {
    const now = Date.now();
    const here = new Date(now - 5_000);
    const gone = new Date(now - core.AGENT_ONLINE_MS - 5_000);
    expect(core.followupTarget({ status: "waiting", agentId: null, agentSeenAt: null }, now)).toBe("waiting");
    expect(core.followupTarget({ status: "waiting", agentId: "a1", agentSeenAt: here }, now)).toBe("waiting");
    expect(core.followupTarget({ status: "active", agentId: "a1", agentSeenAt: gone }, now)).toBe("unattended");
    expect(core.followupTarget({ status: "active", agentId: null, agentSeenAt: null }, now)).toBe("unattended");
    expect(core.followupTarget({ status: "active", agentId: "a1", agentSeenAt: here }, now)).toBeNull();
    for (const status of ["resolved", "cancelled", "returned", "ticket"]) expect({ status, t: core.followupTarget({ status, agentId: "a1", agentSeenAt: gone }, now) }).toEqual({ status, t: null });
    expect(core.FOLLOWUP_PUSH_MS).toBe(3 * 60_000);
  });

  test("one alert row per request, and it records what the push service did", async () => {
    await nobodyOnline();
    const u = await mkUser("push");
    const r = await live.requestHuman(u.id, { message: "I cannot sign in" });
    const rows = await alerts(r.session!.id);
    expect(rows.length).toBe(1);
    // No team device has alerts on in the test database, and that is what the row says (never "sent").
    expect(rows[0].note).toBe("No team device has phone alerts on");
    await live.cancelRequest(u.id, r.conversationId);
  });

  test("the console enrols this admin's own devices, through the same table as System Health", async () => {
    const A = await mkAdmin("Push Admin");
    expect(await adminDevices(A.row.id)).toEqual([]);
    const route = readFileSync("app/api/admin/live-assist/route.ts", "utf8");
    expect(route).toContain("vapidPublicKey: vapid");
    expect(route).toContain("pushDevices: devices.length");
    const client = readFileSync("lib/client/admin-push.ts", "utf8");
    expect(client).toContain('export const ADMIN_DEVICES_URL = "/api/admin/health/devices"');
    for (const f of ["enableAdminPush", "disableAdminPush", "syncAdminPush"]) expect({ f, has: client.includes(`export async function ${f}`) }).toEqual({ f, has: true });
    // Permission is asked for inside the admin's tap, never on load.
    const console_ = readFileSync("components/admin/liveassist/LiveAssistConsole.tsx", "utf8");
    expect(console_).toContain("Notification.requestPermission");
    expect(console_).toContain("togglePush");
    expect(readFileSync("components/admin/health/SystemHealth.tsx", "utf8")).toContain('from "@/lib/client/admin-push"');
    // Expired and rejected devices are dropped, and a temporary failure is retried.
    const push = readFileSync("lib/health/admin-push.ts", "utf8");
    expect(push).toContain("adminPushSub.deleteMany");
    expect(push).toContain('outcome === "retry"');
  });
});

describe("joining, reassigning and never losing the chat", () => {
  test("two specialists tap Join at the same moment: one gets it, the other is told who did", async () => {
    const u = await mkUser("race");
    const A = await mkAdmin("Priya Raman");
    const B = await mkAdmin("Arjun Mehta");
    await live.heartbeat(A.s);
    await live.heartbeat(B.s);
    const r = await live.requestHuman(u.id, { message: "double charge" });
    const sid = r.session!.id;
    const res = await Promise.allSettled([live.accept(A.s, sid), live.accept(B.s, sid)]);
    expect(res.filter((x) => x.status === "fulfilled").length).toBe(1);
    const lost = res.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect({ status: lost.reason.status, code: lost.reason.code }).toEqual({ status: 409, code: "TAKEN" });
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect(row.status).toBe("active");
    const winner = row.agentId === A.row.id ? A : B;
    const loser = row.agentId === A.row.id ? B : A;
    // The customer sees who joined, in the same conversation.
    const p = await live.customerPoll(u.id, { conversationId: r.conversationId });
    expect({ state: p.state, mode: p.mode, agent: p.session!.agent }).toEqual({ state: "connected", mode: "human", agent: core.firstName(winner.row.name) });
    expect(await db.pipMessage.count({ where: { conversationId: r.conversationId, text: `live.connected|${core.firstName(winner.row.name)}` } })).toBe(1);
    // Only the specialist who joined can write in it.
    expect(await err(live.agentSend(loser.s, sid, { text: "hi" }))).toEqual({ status: 403, code: "NOT_YOURS" });

    // That specialist's laptop dies. Their console stops checking in, so a teammate can take it over.
    await db.adminUser.update({ where: { id: winner.row.id }, data: { liveSeenAt: new Date(Date.now() - core.AGENT_ONLINE_MS - 10_000) } });
    invalidate("live:");
    await live.takeover(loser.s, sid);
    const moved = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect({ status: moved.status, agent: moved.agentId }).toEqual({ status: "active", agent: loser.row.id });
    // The history is the audit trail: who had it, who has it now.
    const trail = await db.supportAssignment.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" }, select: { action: true, fromId: true, toId: true } });
    expect(trail.map((t) => t.action)).toEqual(["request", "alerted", "accept", "takeover"]);
    expect(trail[3]).toEqual({ action: "takeover", fromId: winner.row.id, toId: loser.row.id });
    // Nothing was lost: the conversation and every message are still there.
    await live.agentSend(loser.s, sid, { text: "Taking this over, let me look.", cid: cid() });
    const back = await live.customerPoll(u.id, { conversationId: r.conversationId });
    expect(back.state).toBe("connected");
    expect(back.messages.some((m) => m.text === "Taking this over, let me look.")).toBe(true);
    await live.resolve(loser.s, sid);
    expect((await live.customerPoll(u.id, { conversationId: r.conversationId })).state).toBe("resolved");
  });

  test("the queue keeps a request for seven days, so a late specialist still finds the customer", async () => {
    await nobodyOnline();
    const u = await mkUser("keep");
    const r = await live.requestHuman(u.id, { message: "nobody answered yet" });
    const sid = r.session!.id;
    // Two days with the tab closed: still in the queue (before R1207 this was closed after 30 minutes).
    await db.supportSession.update({ where: { id: sid }, data: { customerSeenAt: new Date(Date.now() - 2 * 864e5) } });
    await live.sweepAbandoned(Date.now(), true);
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: sid } })).status).toBe("waiting");
    const A = await mkAdmin("Late Specialist");
    await live.heartbeat(A.s);
    await live.accept(A.s, sid);
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: sid } })).status).toBe("active");
    await live.returnToPip(A.s, sid);

    // Past the keep window it is closed, with the customer's conversation handed back to Pip.
    const old = await mkUser("old");
    const r2 = await live.requestHuman(old.id, {});
    await db.supportSession.update({ where: { id: r2.session!.id }, data: { customerSeenAt: new Date(Date.now() - core.LEFT_KEEP_MS - 60_000) } });
    expect(await live.sweepAbandoned(Date.now(), true)).toBeGreaterThanOrEqual(1);
    const closed = await db.supportSession.findUniqueOrThrow({ where: { id: r2.session!.id } });
    expect({ status: closed.status, endedBy: closed.endedBy }).toEqual({ status: "cancelled", endedBy: "system" });
  });

  test("the console's three filters count real rows", async () => {
    const A = await mkAdmin("Filter Admin", "super");
    await live.heartbeat(A.s);
    const q = await live.queue(A.s, { filter: "waiting" });
    expect(Object.keys(q.counts)).toEqual(expect.arrayContaining(["waiting", "active", "resolvedToday"]));
    for (const f of ["waiting", "active", "resolved"] as const) {
      const rows = (await live.queue(A.s, { filter: f })).items;
      expect({ f, ok: rows.every((r) => r.status === f) }).toEqual({ f, ok: true });
    }
  });
});

describe("the way in from the phone", () => {
  test("the deep link survives the admin sign-in", () => {
    const mw = readFileSync("middleware.ts", "utf8");
    expect(mw).toContain("req.nextUrl.pathname + req.nextUrl.search");
    const page = readFileSync("app/admin/login/page.tsx", "utf8");
    expect(page).toContain("/admin");
    expect(page).toContain('"//"');
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain("notificationclick");
    expect(sw).toContain("/admin");
  });

  test("an alert reaches the admin on any page, and the bell opens the conversation", () => {
    const bell = readFileSync("components/admin/Bell.tsx", "utf8");
    expect(bell).toContain("live_request");
    expect(bell).toContain("live_urgent");
    expect(bell).toContain("new Notification");
    expect(bell).toContain("e.href");
  });

  test("the section is called Live Support and its one action is Join conversation", () => {
    const shell = readFileSync("components/admin/AdminShell.tsx", "utf8");
    expect(shell).toContain('{ href: "/admin/live-assist", label: "Live Support"');
    const page = readFileSync("app/admin/(panel)/live-assist/page.tsx", "utf8");
    expect(page).toContain("Live Support");
    const console_ = readFileSync("components/admin/liveassist/LiveAssistConsole.tsx", "utf8");
    expect(console_).toContain("Join conversation");
    expect(console_).not.toContain(">Accept<");
  });
});
