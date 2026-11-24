/**
 * Round 1184: Outlly Live Assist (a person from the support team inside Pip).
 * - The six customer states are the agreed wording and come from real rows (customerState, customerPoll).
 * - Two sessions end to end: a customer asks, two specialists race to accept (one wins, atomically), they talk
 *   through the same conversation (persisted, ordered, deduped by client id, receipts, typing), transfer,
 *   take over, resolve, rate once, reopen. Pip stays silent while a person is waiting or talking.
 * - Cancel, leave a message (becomes a ticket), hand back to Pip. Notes never reach the customer.
 * - Ownership, roles, the console routes, retention (support chats are never pruned), nav order.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

// Shared with other files that mock next/headers: bun keeps the first module mock for the whole run.
const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (n: string) => jar.has(n),
  set: (n: string | { name: string; value: string }, v?: string, o?: Record<string, unknown>) => {
    if (typeof n === "object") {
      const { name, value, ...rest } = n as { name: string; value: string };
      jar.set(name, { value, opts: rest });
    } else jar.set(n, { value: v ?? "", opts: o ?? {} });
  },
  delete: (n: string | { name: string }) => jar.delete(typeof n === "object" ? n.name : n),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const { db } = await import("../lib/db");
const { createSession } = await import("../lib/auth");
// Other files mock getAdmin for the whole run (bun keeps module mocks), so the console routes here see exactly
// the admin a test sets, and everyone else keeps what they had.
const g = globalThis as unknown as { __r1184Admin?: import("../lib/admin/auth").AdminSession | null };
const realAuth = require("../lib/admin/auth");
const realGetAdmin = realAuth.getAdmin;
mock.module("../lib/admin/auth", () => ({ ...realAuth, getAdmin: async () => (g.__r1184Admin !== undefined ? g.__r1184Admin : realGetAdmin()) }));
const { invalidate } = await import("../lib/cache");
const live = await import("../lib/support/live");
const core = await import("../lib/support/live-core");
const { LIVE_EN, liveT, liveSysLine } = await import("../lib/i18n/live");
const { POST: chatPOST } = await import("../app/api/support/chat/route");
const liveRoute = await import("../app/api/support/live/route");
const queueRoute = await import("../app/api/admin/live-assist/route");
const chatRoute = await import("../app/api/admin/live-assist/[id]/route");
const { pruneOldData } = await import("../lib/retention/prune");
const { startConversation, closeConversation, recordTurn } = await import("../lib/support/conversations");
type AdminSession = import("../lib/admin/auth").AdminSession;

const users: string[] = [];
const admins: string[] = [];
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const mkUser = async (t: string) => {
  const email = `live1184-${t}-${tag()}@test.dev`;
  const u = await db.user.create({ data: { name: `Live ${t}`, email, passwordHash: "x", emailVerifiedAt: new Date(), emailVerifiedFor: email } });
  users.push(u.id);
  return u;
};
const mkAdmin = async (name: string, role = "support") => {
  const row = await db.adminUser.create({ data: { login: `live1184-${role}-${tag()}`, name, role, passwordHash: `x-${tag()}` } });
  admins.push(row.id);
  return { row, s: { id: row.id, name: row.name, login: row.login, role: row.role } as AdminSession };
};
const H = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };
type Handler = (req: NextRequest, ctx: never) => Promise<Response>;
const POST = (h: Handler, path: string, body: unknown, params: Record<string, string> = {}) =>
  h(new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: H }), { params } as never);
const GET = (h: Handler, path: string, params: Record<string, string> = {}) =>
  h(new NextRequest(`http://localhost${path}`, { method: "GET", headers: H }), { params } as never);
const signIn = async (id: string) => { jar.clear(); await createSession(id); };
const cid = () => `c${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
/** The error a call threw: status and code, or null when it worked. */
const err = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const x = e as { status?: number; code?: string };
    return { status: x.status, code: x.code };
  }
};
/** Nobody from the team is online until a test says so. */
const nobodyOnline = async () => {
  await db.adminUser.updateMany({ data: { liveSeenAt: null, liveAway: false } });
  invalidate("live:");
};

beforeEach(() => jar.clear());
afterAll(async () => {
  jar.clear();
  delete g.__r1184Admin;
  await db.adminEvent.deleteMany({ where: { href: { startsWith: "/admin/live-assist" } } });
  await db.auditLog.deleteMany({ where: { actor: { startsWith: "live1184-" } } });
  await db.ticket.deleteMany({ where: { userId: { in: users } } }).catch(() => {});
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.adminUser.deleteMany({ where: { id: { in: admins } } });
});

describe("the agreed words", () => {
  test("the offer, the two buttons and the six states are exactly the product wording", () => {
    expect(LIVE_EN.offer).toBe("I'd like a person to help you with this. Would you like me to connect you with a human support specialist?");
    expect(LIVE_EN.connect).toBe("Connect to a human");
    expect(LIVE_EN.keepPip).toBe("Continue with Pip");
    expect(LIVE_EN.connecting).toBe("Sending your request to our support team...");
    // R1207: the queue words. The customer is never told the team is unavailable, so there is no "unavailable" line to show.
    expect(LIVE_EN.queueTitle).toBe("You're in the support queue!");
    expect(LIVE_EN.waiting).toBe("Please wait while we connect you with an Outlly support specialist. Your conversation is saved. A specialist will join this chat as soon as they're available.");
    expect(LIVE_EN.connectedTitle).toBe("You're connected!");
    expect(LIVE_EN.connected).toBe("You're connected! A support specialist has joined the chat.");
    expect(LIVE_EN.reconnecting).toBe("Connection interrupted. We're trying to reconnect you...");
    expect(LIVE_EN.resolved).toBe("Your conversation with our support team has been marked as resolved. If you need anything else, you can start another conversation.");
  });
  test("every language has every key (missing ones fall back to English), and no copy uses an em dash", () => {
    for (const l of ["en", "hi", "es", "fr", "de", "pt", "ar", "zh", "ja", "ru", "id", "bn"] as const) {
      const t = liveT(l);
      for (const k of Object.keys(LIVE_EN) as (keyof typeof LIVE_EN)[]) expect({ l, k, ok: t[k] != null }).toEqual({ l, k, ok: true });
      const words = Object.values(t).map((v) => (typeof v === "function" ? (v as (x: never) => string)(3 as never) : v)).join(" ");
      expect(words.includes("\u2014")).toBe(false);
    }
    expect(liveT("hi").connected).not.toBe(LIVE_EN.connected);
  });
  test("stored status codes read in the customer's words and in the console's", () => {
    const t = liveT("en");
    expect(liveSysLine(t, "live.requested")).toBe(LIVE_EN.handoff);
    expect(liveSysLine(t, "live.connected|Priya")).toBe("You're connected! Priya has joined the conversation. How can we help?");
    expect(liveSysLine(t, "live.connected")).toBe(LIVE_EN.connected);
    expect(liveSysLine(t, "live.resolved")).toBe(LIVE_EN.resolved);
    expect(liveSysLine(t, "live.ticket|T-1234")).toContain("T-1234");
    expect(liveSysLine(t, "live.transferred|Arjun")).toContain("Arjun");
    expect(liveSysLine(t, "something else")).toBeNull();
    expect(core.staffSysLine("live.connected|Priya")).toBe("Priya joined the chat");
    expect(core.staffSysLine("live.customer_left")).toBe("The customer ended the chat");
    expect(core.staffSysLine("<b>hi</b>")).toBeNull();
    expect(core.sysText(core.SYS.connected, "A|B")).toBe("live.connected|A B");
  });
});

describe("pure rules", () => {
  const now = Date.now();
  // R1207: who is online no longer changes what the customer sees. A waiting request always reads "waiting".
  test("the customer's state comes from the session row alone", () => {
    expect(core.customerState(null, { agentsOnline: 3 })).toBe("none");
    expect(core.customerState({ status: "active", requestedAt: new Date(now) }, { agentsOnline: 0 })).toBe("connected");
    expect(core.customerState({ status: "resolved", requestedAt: new Date(now) }, { agentsOnline: 0 })).toBe("resolved");
    expect(core.customerState({ status: "waiting", requestedAt: new Date(now) }, { agentsOnline: 1, now })).toBe("waiting");
    expect(core.customerState({ status: "waiting", requestedAt: new Date(now) }, { agentsOnline: 0, now })).toBe("waiting");
    expect(core.customerState({ status: "waiting", requestedAt: new Date(now) })).toBe("waiting");
    expect(core.customerState({ status: "waiting", requestedAt: new Date(now - 11 * 60_000) }, { agentsOnline: 2, now })).toBe("waiting");
    for (const st of ["cancelled", "returned", "ticket"]) expect(core.customerState({ status: st, requestedAt: new Date(now) }, { agentsOnline: 1 })).toBe("none");
  });
  test("receipts: sending, failed, sent, delivered, read", () => {
    const r = { delivered: 5, read: 3 };
    expect(core.receipt({ failed: true, seq: 1 }, r)).toBe("failed");
    expect(core.receipt({ pending: true }, r)).toBe("sending");
    expect(core.receipt({ seq: null }, r)).toBe("sending");
    expect(core.receipt({ seq: 2 }, r)).toBe("read");
    expect(core.receipt({ seq: 5 }, r)).toBe("delivered");
    expect(core.receipt({ seq: 6 }, r)).toBe("sent");
  });
  test("merging server messages: no duplicates, own message confirmed by client id, seq order kept", () => {
    type L = { sid?: string; seq?: number; cid?: string; pending?: boolean; text: string };
    const w = (id: string, seq: number, text: string, c: string | null = null): import("../lib/support/live-core").WireMsg => ({ id, seq, role: "agent", text, cid: c, author: "Priya", at: new Date().toISOString() });
    const make = (m: import("../lib/support/live-core").WireMsg): L => ({ sid: m.id, seq: m.seq ?? undefined, text: m.text });
    let list: L[] = [{ text: "old history" }, { sid: "a", seq: 1, text: "one" }, { cid: "mine-123456", pending: true, text: "mine" }];
    list = core.mergeLive(list, [w("c", 3, "three"), w("b", 2, "two"), w("a", 1, "one again")], make);
    expect(list.map((x) => x.text)).toEqual(["old history", "one", "two", "three", "mine"]);
    list = core.mergeLive(list, [w("m", 4, "mine", "mine-123456"), w("c", 3, "three")], make);
    expect(list.map((x) => x.text)).toEqual(["old history", "one", "two", "three", "mine"]);
    expect(list[4]).toMatchObject({ sid: "m", seq: 4, pending: false });
  });
  test("topic and urgency: money leaving an account is urgent and billing comes first", () => {
    expect(core.classify(["I was charged twice for my plan"])).toEqual({ category: "billing", priority: "urgent" });
    expect(core.classify(["refund please, my instagram post failed"])).toEqual({ category: "billing", priority: "urgent" });
    expect(core.classify(["my instagram post failed to publish"])).toEqual({ category: "publishing", priority: "normal" });
    expect(core.classify(["I can't log in"])).toEqual({ category: "account", priority: "normal" });
    expect(core.classify(["hello there"])).toEqual({ category: "other", priority: "normal" });
  });
  test("plain text only: hidden and direction-flipping characters are removed, long text is capped", () => {
    expect(core.cleanText("pay\u200B here \u202Egnp.exe\u202C")).toBe("pay here gnp.exe");
    expect(core.cleanText("a\u0000b\r\nc")).toBe("ab\nc");
    expect(core.cleanText(42)).toBe("");
    expect(core.cleanText("x".repeat(5000)).length).toBe(core.LIVE_MAX_TEXT);
    expect(core.isClientId("abc12345")).toBe(true);
    expect(core.isClientId("short")).toBe(false);
    expect(core.isClientId("has space in it")).toBe(false);
  });
});

describe("two sessions end to end: a customer and the support team", () => {
  let u: { id: string; email: string };
  let A: Awaited<ReturnType<typeof mkAdmin>>, B: Awaited<ReturnType<typeof mkAdmin>>, S: Awaited<ReturnType<typeof mkAdmin>>;
  let conv = "";
  let sid = "";
  let win: AdminSession, lose: AdminSession;
  let before: Awaited<ReturnType<typeof live.analytics>>;
  const firstCid = cid();

  test("asking for a person: queued, classified, the team is told; nobody online still means waiting", async () => {
    await nobodyOnline();
    before = await live.analytics({ days: 7 });
    u = await mkUser("cust");
    A = await mkAdmin("Priya Raman");
    B = await mkAdmin("Arjun Mehta");
    S = await mkAdmin("Sam Super", "super");
    const r = await live.requestHuman(u.id, { message: "I was charged twice for my plan", cid: firstCid });
    expect(r.created).toBe(true);
    conv = r.conversationId;
    sid = r.session!.id;
    expect(r.mode).toBe("waiting");
    expect(r.state).toBe("waiting");
    expect(r.position).toBeGreaterThanOrEqual(1);
    // R1194: the customer's words first, then Pip's one confirmation line.
    expect(r.messages.map((m) => [m.role, m.text])).toEqual([["user", "I was charged twice for my plan"], ["system", "live.requested"]]);
    expect(r.messages[0].cid).toBe(firstCid);
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect({ status: row.status, category: row.category, priority: row.priority, unread: row.unreadAgent }).toEqual({ status: "waiting", category: "billing", priority: "urgent", unread: 1 });
    expect(await db.adminEvent.count({ where: { kind: "live_urgent", href: `/admin/live-assist?s=${sid}` } })).toBe(1);
  });

  test("a specialist opening the console makes the customer's state 'waiting'; asking again is the same request", async () => {
    await live.heartbeat(A.s);
    const p = await live.customerPoll(u.id, { conversationId: conv });
    expect(p.state).toBe("waiting");
    // R1207: the customer poll never reports how many specialists are online.
    expect(p.agentsOnline).toBeNull();
    const again = await live.requestHuman(u.id, { conversationId: conv, message: "hello?" });
    expect(again.created).toBe(false);
    expect(again.session!.id).toBe(sid);
    expect(await db.supportSession.count({ where: { conversationId: conv } })).toBe(1);
    // R1207: away is internal. The customer still reads "waiting", and never learns how many specialists there are.
    await live.heartbeat(A.s, { away: true });
    const away = await live.customerPoll(u.id, { conversationId: conv });
    expect({ state: away.state, online: away.agentsOnline }).toEqual({ state: "waiting", online: null });
    await live.heartbeat(A.s, { away: false });
    expect((await live.customerPoll(u.id, { conversationId: conv })).state).toBe("waiting");
  });

  test("Pip stays silent while the customer waits: the chat route hands the words to the team, once", async () => {
    await signIn(u.id);
    const c = cid();
    const j = await (await POST(chatPOST as Handler, "/api/support/chat", { message: "Are you there?", conversationId: conv, cid: c, history: [] })).json();
    expect(j.live).toBe(true);
    expect(j.answer).toBe("");
    expect(j.duplicate).toBe(false);
    const again = await (await POST(chatPOST as Handler, "/api/support/chat", { message: "Are you there?", conversationId: conv, cid: c, history: [] })).json();
    expect(again.duplicate).toBe(true);
    expect(again.message.id).toBe(j.message.id);
    expect(await db.pipMessage.count({ where: { conversationId: conv, clientId: c } })).toBe(1);
    expect(await db.pipMessage.count({ where: { conversationId: conv, role: { notIn: ["user", "system"] } } })).toBe(0);
  });

  test("two specialists accept at the same moment: exactly one wins, the other is told who has it", async () => {
    const res = await Promise.allSettled([live.accept(A.s, sid), live.accept(B.s, sid)]);
    const ok = res.filter((r) => r.status === "fulfilled");
    const bad = res.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok.length).toBe(1);
    expect(bad.length).toBe(1);
    expect({ status: bad[0].reason.status, code: bad[0].reason.code }).toEqual({ status: 409, code: "TAKEN" });
    win = res[0].status === "fulfilled" ? A.s : B.s;
    lose = win === A.s ? B.s : A.s;
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect({ status: row.status, agentId: row.agentId }).toEqual({ status: "active", agentId: win.id });
    expect(await db.pipMessage.count({ where: { conversationId: conv, text: { startsWith: "live.connected" } } })).toBe(1);
    expect((await live.accept(win, sid)).already).toBe(true);
    const p = await live.customerPoll(u.id, { conversationId: conv });
    expect({ state: p.state, mode: p.mode, agent: p.session!.agent }).toEqual({ state: "connected", mode: "human", agent: core.firstName(win.name) });
  });

  test("messages: persisted, numbered in order, deduped, first names only for the customer, receipts and typing", async () => {
    expect(await err(live.agentSend(lose, sid, { text: "me too" }))).toEqual({ status: 403, code: "NOT_YOURS" });
    const c = cid();
    const a = await live.agentSend(win, sid, { text: "Hi, I can see the double charge.", cid: c });
    expect(a.duplicate).toBe(false);
    const a2 = await live.agentSend(win, sid, { text: "Hi, I can see the double charge.", cid: c });
    expect({ dup: a2.duplicate, id: a2.message.id }).toEqual({ dup: true, id: a.message.id });
    const m = await live.customerSend(u.id, { conversationId: conv, text: "Thank you!", cid: cid() });
    expect(m.message.seq!).toBeGreaterThan(a.message.seq!);

    const rows = await db.pipMessage.findMany({ where: { conversationId: conv }, orderBy: { seq: "asc" }, select: { seq: true } });
    const seqs = rows.map((r) => r.seq!);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));

    const p = await live.customerPoll(u.id, { conversationId: conv, after: a.message.seq! - 1 });
    const fromAgent = p.messages.find((x) => x.id === a.message.id)!;
    expect(fromAgent).toMatchObject({ role: "agent", author: core.firstName(win.name), cid: null });
    expect(p.messages.at(-1)!.id).toBe(m.message.id);
    // The agent replied after everything before it, so those are read.
    expect(p.receipts.read).toBeGreaterThanOrEqual(a.message.seq!);

    // The specialist opens the chat (on screen): the customer's message is delivered and seen.
    const d = await live.detail(win, sid, { read: true });
    expect(d.mine).toBe(true);
    expect(d.messages.find((x) => x.id === a.message.id)!.author).toBe(win.name);
    const p2 = await live.customerPoll(u.id, { conversationId: conv, after: p.cursor });
    expect(p2.messages.length).toBe(0);
    expect(p2.receipts.read).toBeGreaterThanOrEqual(m.message.seq!);
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: sid } })).unreadAgent).toBe(0);

    // The customer reads it: the console sees "seen".
    await live.customerPoll(u.id, { conversationId: conv, after: p.cursor, read: p.cursor });
    expect((await live.detail(win, sid, { after: d.cursor })).receipts.read).toBeGreaterThanOrEqual(a.message.seq!);

    await live.agentTyping(win, sid);
    expect((await live.customerPoll(u.id, { conversationId: conv, after: p.cursor })).typing).toBe(core.firstName(win.name));
    await live.customerTyping(u.id, conv);
    expect((await live.detail(win, sid, { after: d.cursor })).typing).toBe(true);
  });

  test("notes and priority are staff-only; the customer never sees a note", async () => {
    const n = await live.addNote(win, sid, "Refund approved in Razorpay, ref RZP-991");
    expect(n.note.body).toContain("RZP-991");
    await live.setPriority(win, sid, "high");
    expect(await err(live.setPriority(win, sid, "whenever"))).toEqual({ status: 400, code: "BAD_PRIORITY" });
    const d = await live.detail(win, sid);
    expect(d.notes.map((x) => x.body)).toContain("Refund approved in Razorpay, ref RZP-991");
    expect(d.history.map((h) => h.action)).toContain("priority");
    const p = await live.customerPoll(u.id, { conversationId: conv });
    expect(JSON.stringify(p)).not.toContain("RZP-991");
    expect(await db.pipMessage.count({ where: { conversationId: conv, text: { contains: "RZP-991" } } })).toBe(0);
    expect(JSON.stringify(p)).not.toContain("Raman");
    expect(JSON.stringify(p)).not.toContain("Mehta");
  });

  test("transfer, then take over: only when the holder has gone quiet, a super admin always", async () => {
    await live.assign(win, sid, lose.id, "transfer");
    let row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect(row.agentId).toBe(lose.id);
    expect(await db.pipMessage.count({ where: { conversationId: conv, text: `live.transferred|${core.firstName(lose.name)}` } })).toBe(1);
    expect(await err(live.agentSend(win, sid, { text: "still me?" }))).toEqual({ status: 403, code: "NOT_YOURS" });
    expect(await err(live.returnToPip(win, sid))).toEqual({ status: 403, code: "NOT_YOURS" });

    await live.heartbeat(lose);
    expect(await err(live.takeover(win, sid))).toEqual({ status: 403, code: "HOLDER_ONLINE" });
    await db.adminUser.update({ where: { id: lose.id }, data: { liveSeenAt: new Date(Date.now() - 5 * 60_000) } });
    await live.takeover(win, sid);
    row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect(row.agentId).toBe(win.id);
    await live.heartbeat(win);
    await live.takeover(S.s, sid);
    row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect({ status: row.status, agentId: row.agentId }).toEqual({ status: "active", agentId: S.s.id });
    expect(await err(live.assign(S.s, sid, u.id, "transfer"))).toEqual({ status: 400, code: "BAD_AGENT" });
  });

  test("the queue: counters, filters, sorting", async () => {
    const q = await live.queue(S.s, { filter: "active" });
    expect(q.items.map((i) => i.id)).toContain(sid);
    expect(q.counts.active).toBeGreaterThanOrEqual(1);
    const it = q.items.find((i) => i.id === sid)!;
    expect(it).toMatchObject({ priority: "high", category: "billing", agentId: S.s.id, customer: { id: u.id } });
    expect((await live.queue(S.s, { filter: "mine" })).items.map((i) => i.id)).toContain(sid);
    expect((await live.queue(A.s, { filter: "mine" })).items.map((i) => i.id)).not.toContain(sid);
    expect((await live.queue(S.s, { filter: "waiting" })).items.map((i) => i.id)).not.toContain(sid);
    expect((await live.queue(S.s, { filter: "open", category: "account" })).items.map((i) => i.id)).not.toContain(sid);
    expect((await live.queue(S.s, { filter: "open", priority: "high" })).items.map((i) => i.id)).toContain(sid);
    const bad = await live.queue(S.s, { filter: "nonsense", sort: "nope" });
    expect({ f: bad.filter, s: bad.sort }).toEqual({ f: "open", s: "priority" });
    expect(q.agents.find((a) => a.id === S.s.id)!.me).toBe(true);
  });

  test("resolve: the customer is told, the chat stays on record, Pip's composer is closed to the team, rate once", async () => {
    const count = await db.pipMessage.count({ where: { conversationId: conv } });
    await live.resolve(S.s, sid);
    expect(await err(live.resolve(S.s, sid))).toEqual({ status: 409, code: "ENDED" });
    const p = await live.customerPoll(u.id, { conversationId: conv });
    expect({ state: p.state, mode: p.mode, canRate: p.session!.canRate }).toEqual({ state: "resolved", mode: "resolved", canRate: true });
    expect(await db.pipMessage.count({ where: { conversationId: conv } })).toBe(count + 1);
    const c = await db.pipConversation.findUniqueOrThrow({ where: { id: conv } });
    expect({ status: c.status, liveId: c.liveId }).toEqual({ status: "resolved", liveId: null });
    expect(await err(live.customerSend(u.id, { conversationId: conv, text: "one more thing" }))).toEqual({ status: 409, code: "NOT_LIVE" });
    expect(await live.rate(u.id, { conversationId: conv, helpful: true })).toEqual({ ok: true, already: false });
    expect(await live.rate(u.id, { conversationId: conv, helpful: false })).toEqual({ ok: true, already: true });
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: sid } })).csat).toBe(1);
    expect((await live.customerPoll(u.id, { conversationId: conv })).session!.rated).toBe(true);
  });

  test("reopen: a new session on the same conversation; the old one keeps its history", async () => {
    const r = await live.reopenSession(A.s, sid);
    expect(r.ok).toBe(true);
    expect(r.sessionId).not.toBe(sid);
    expect(await err(live.reopenSession(A.s, sid))).toEqual({ status: 409, code: "HAS_OPEN" });
    const c = await db.pipConversation.findUniqueOrThrow({ where: { id: conv } });
    expect({ mode: c.mode, liveId: c.liveId, status: c.status }).toEqual({ mode: "human", liveId: r.sessionId, status: "open" });
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: sid } })).status).toBe("resolved");
    expect((await live.customerPoll(u.id, { conversationId: conv })).state).toBe("connected");
    await live.agentSend(A.s, r.sessionId, { text: "Following up: the refund is on its way." });
    await live.resolve(A.s, r.sessionId);
    const h = (await live.detail(S.s, sid)).history.map((x) => x.action);
    for (const a of ["request", "accept", "transfer", "takeover", "priority", "resolve", "reopen"]) expect({ a, has: h.includes(a) }).toEqual({ a, has: true });
    expect(await db.auditLog.count({ where: { targetId: sid, action: { startsWith: "live." } } })).toBeGreaterThanOrEqual(5);
    expect(await db.auditLog.count({ where: { targetId: sid, note: { contains: "double charge" } } })).toBe(0);
  });

  test("analytics count the real rows: sessions, resolved, response times and CSAT", async () => {
    const a = await live.analytics({ days: 7 });
    expect(a.totals.total - before.totals.total).toBe(2);
    expect(a.totals.resolved - before.totals.resolved).toBe(2);
    expect(a.csat.rated - before.csat.rated).toBe(1);
    expect(a.csat.helpful - before.csat.helpful).toBe(1);
    expect(a.firstResponse.n - before.firstResponse.n).toBe(2);
    expect(a.agents.map((x) => x.agentId)).toContain(S.s.id);
    expect((await live.analytics({ days: 999 })).days).toBe(7);
  });
});

describe("cancel, leave a message, back to Pip", () => {
  test("cancelling while waiting: the request ends and Pip answers again", async () => {
    const u = await mkUser("cancel");
    const r = await live.requestHuman(u.id, {});
    expect(r.created).toBe(true);
    const s = await live.cancelRequest(u.id, r.conversationId);
    expect({ state: s.state, mode: s.mode }).toEqual({ state: "none", mode: "ai" });
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: r.session!.id } });
    expect({ status: row.status, endedBy: row.endedBy }).toEqual({ status: "cancelled", endedBy: "customer" });
    expect(await db.pipMessage.count({ where: { conversationId: r.conversationId, text: "live.cancelled" } })).toBe(1);
    expect(await err(live.customerSend(u.id, { conversationId: r.conversationId, text: "hi" }))).toEqual({ status: 409, code: "NOT_LIVE" });
    // The chat route goes to Pip again (never the team) once the request is over.
    await signIn(u.id);
    const j = await (await POST(chatPOST as Handler, "/api/support/chat", { message: "how do I schedule a post?", conversationId: r.conversationId, history: [] })).json();
    expect(j.live).toBeUndefined();
    // A new request is a new session on the same conversation.
    const again = await live.requestHuman(u.id, { conversationId: r.conversationId });
    expect(again.created).toBe(true);
    expect(again.session!.id).not.toBe(r.session!.id);
  });

  test("ending a connected chat says the customer left", async () => {
    const u = await mkUser("end");
    const a = await mkAdmin("End Agent");
    const r = await live.requestHuman(u.id, { message: "my video won't upload" });
    await live.accept(a.s, r.session!.id);
    await live.cancelRequest(u.id, r.conversationId);
    expect(await db.pipMessage.count({ where: { conversationId: r.conversationId, text: "live.customer_left" } })).toBe(1);
    expect(await err(live.agentSend(a.s, r.session!.id, { text: "hello?" }))).toEqual({ status: 409, code: "ENDED" });
  });

  // R1205: no ticket and no email. The message stays in this chat and the request stays in the queue.
  test("leave a message: the words stay in this chat and the request stays queued", async () => {
    await nobodyOnline();
    const u = await mkUser("leave");
    const r = await live.requestHuman(u.id, { message: "My Instagram post failed to publish" });
    expect(r.state).toBe("waiting");
    const left = await live.leaveMessage(u.id, { conversationId: r.conversationId, text: "It was the 9am reel.", cid: cid() });
    expect("ref" in left).toBe(false);
    expect({ state: left.state, mode: left.mode }).toEqual({ state: "waiting", mode: "waiting" });
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: r.session!.id } });
    expect({ status: row.status, ticketId: row.ticketId }).toEqual({ status: "waiting", ticketId: null });
    expect(await db.pipMessage.count({ where: { conversationId: r.conversationId, role: "user", text: "It was the 9am reel." } })).toBe(1);
    expect(await db.pipMessage.count({ where: { conversationId: r.conversationId, text: "live.left" } })).toBe(1);
    // A second leave adds the words but not a second notice.
    await live.leaveMessage(u.id, { conversationId: r.conversationId, text: "Also the 6pm one.", cid: cid() });
    expect(await db.pipMessage.count({ where: { conversationId: r.conversationId, text: "live.left" } })).toBe(1);
    expect(await db.supportAssignment.count({ where: { sessionId: r.session!.id, action: "leave_message" } })).toBe(1);
    await live.cancelRequest(u.id, r.conversationId);
  });

  test("a specialist hands the chat back to Pip", async () => {
    const u = await mkUser("pipback");
    const a = await mkAdmin("Back Agent");
    const r = await live.requestHuman(u.id, { message: "where is the calendar?" });
    await live.accept(a.s, r.session!.id);
    expect(await err(live.agentSend(a.s, r.session!.id, { text: "" }))).toEqual({ status: 400, code: "EMPTY" });
    await live.returnToPip(a.s, r.session!.id);
    const p = await live.customerPoll(u.id, { conversationId: r.conversationId });
    expect({ state: p.state, mode: p.mode, status: p.session!.status }).toEqual({ state: "none", mode: "ai", status: "returned" });
    expect(await db.pipMessage.count({ where: { conversationId: r.conversationId, text: "live.pip_back" } })).toBe(1);
  });

  test("replying before accepting is refused", async () => {
    const u = await mkUser("early");
    const a = await mkAdmin("Early Agent");
    const r = await live.requestHuman(u.id, { message: "hi" });
    expect(await err(live.agentSend(a.s, r.session!.id, { text: "hello" }))).toEqual({ status: 409, code: "NOT_ACCEPTED" });
    await live.cancelRequest(u.id, r.conversationId);
  });
});

describe("review fixes: a live chat can't be stranded", () => {
  test("Resolve chat (close) is refused while a person is waiting or talking; Pip's late answer is dropped", async () => {
    const u = await mkUser("strand");
    const r = await live.requestHuman(u.id, {});
    expect(r.mode).toBe("waiting");
    expect(await err(closeConversation(u.id, r.conversationId))).toEqual({ status: 409, code: "LIVE_OPEN" });
    const conv = await db.pipConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
    expect({ status: conv.status, mode: conv.mode, sendingAt: conv.sendingAt }).toEqual({ status: "open", mode: "waiting", sendingAt: null });
    // Pip was still answering when the customer tapped Connect: their words are kept for the team, Pip's reply is not.
    await recordTurn({ userId: u.id, conversation: { id: r.conversationId }, question: "late question 1184", answer: "late pip answer 1184", askedAt: new Date() });
    expect(await db.pipMessage.count({ where: { conversationId: r.conversationId, text: "late pip answer 1184" } })).toBe(0);
    const q = await db.pipMessage.findFirstOrThrow({ where: { conversationId: r.conversationId, text: "late question 1184" } });
    expect(q.role).toBe("user");
    // Back in Pip's hands, a turn is written whole again.
    await live.cancelRequest(u.id, r.conversationId);
    await recordTurn({ userId: u.id, conversation: { id: r.conversationId }, question: "after 1184", answer: "pip after 1184", askedAt: new Date() });
    expect(await db.pipMessage.count({ where: { conversationId: r.conversationId, text: { in: ["after 1184", "pip after 1184"] } } })).toBe(2);
  });

  test("a customer who left while waiting holds no place in line, and the sweep closes the request", async () => {
    const a = await mkUser("ghost");
    const b = await mkUser("next");
    const ra = await live.requestHuman(a.id, {});
    const rb = await live.requestHuman(b.id, {});
    const before = (await live.customerPoll(b.id, { conversationId: rb.conversationId })).position!;
    // R1207: a request is only closed once the customer has been gone for LEFT_KEEP_MS (7 days).
    const old = new Date(Date.now() - core.LEFT_KEEP_MS - 60_000);
    await db.supportSession.update({ where: { id: ra.session!.id }, data: { customerSeenAt: old, requestedAt: new Date(old.getTime() - 1000) } });
    const after = (await live.customerPoll(b.id, { conversationId: rb.conversationId })).position!;
    expect(after).toBe(before - 1);
    expect(await live.sweepAbandoned(Date.now(), true)).toBeGreaterThanOrEqual(1);
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: ra.session!.id } });
    expect({ status: row.status, endedBy: row.endedBy }).toEqual({ status: "cancelled", endedBy: "system" });
    const conv = await db.pipConversation.findUniqueOrThrow({ where: { id: ra.conversationId } });
    expect({ mode: conv.mode, liveId: conv.liveId }).toEqual({ mode: "ai", liveId: null });
    expect(await db.pipMessage.count({ where: { conversationId: ra.conversationId, text: "live.cancelled" } })).toBe(1);
    // The customer still checking in is untouched, and a second sweep finds nothing new for them.
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: rb.session!.id } })).status).toBe("waiting");
    await live.sweepAbandoned(Date.now(), true);
    expect(await db.pipMessage.count({ where: { conversationId: ra.conversationId, text: "live.cancelled" } })).toBe(1);
    await live.cancelRequest(b.id, rb.conversationId);
  });

  test("the widget keeps Pip's resolve, feedback and related questions out of a live chat", () => {
    const w = readFileSync("components/support/ChatWidget.tsx", "utf8");
    expect(w).toContain('m.kind === "resolve" && m.offer && !resolved && !liveOn');
    expect(w).toContain("{m.ask && !liveOn && (");
    expect(w).toContain("!m.ask && !liveOn && (");
    expect(w).toContain("disabled={!!liveBusy || busy}");
    expect(w).toContain("const cid = signedIn || me ? newCid() : undefined;"); // R1208: was inStudio
    expect(w).not.toMatch(/animate-spin(?! motion-reduce)/);
  });
});

describe("ownership, roles and the routes", () => {
  test("another customer can't read, write in or end someone's chat", async () => {
    await nobodyOnline();
    const owner = await mkUser("owner");
    const other = await mkUser("other");
    const r = await live.requestHuman(owner.id, { message: "private question" });
    expect(await err(live.customerPoll(other.id, { conversationId: r.conversationId }))).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(await err(live.customerSend(other.id, { conversationId: r.conversationId, text: "hi" }))).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(await err(live.cancelRequest(other.id, r.conversationId))).toEqual({ status: 404, code: "NOT_FOUND" });
    const hijack = await live.requestHuman(other.id, { conversationId: r.conversationId, message: "let me in" });
    expect(hijack.conversationId).not.toBe(r.conversationId);
    await signIn(other.id);
    expect((await GET(liveRoute.GET as Handler, `/api/support/live?conversationId=${r.conversationId}`)).status).toBe(404);
    await signIn(owner.id);
    const mine = await GET(liveRoute.GET as Handler, `/api/support/live?conversationId=${r.conversationId}`);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("cache-control")).toContain("no-store");
    expect((await mine.json()).state).toBe("waiting");
    await live.cancelRequest(owner.id, r.conversationId);
    await live.cancelRequest(other.id, hijack.conversationId);
  });

  test("the customer route needs a signed-in person and checks its input", async () => {
    jar.clear();
    expect((await GET(liveRoute.GET as Handler, "/api/support/live?conversationId=x")).status).toBe(401);
    const u = await mkUser("route");
    await signIn(u.id);
    const r = await (await POST(liveRoute.POST as Handler, "/api/support/live", { action: "request", message: "billing question", cid: cid() })).json();
    expect(r.created).toBe(true);
    expect((await POST(liveRoute.POST as Handler, "/api/support/live", { action: "nope", conversationId: r.conversationId })).status).toBe(400);
    const sent = await (await POST(liveRoute.POST as Handler, "/api/support/live", { action: "send", conversationId: r.conversationId, text: "more detail", cid: cid() })).json();
    expect(sent.message.role).toBe("user");
    const done = await (await POST(liveRoute.POST as Handler, "/api/support/live", { action: "cancel", conversationId: r.conversationId })).json();
    expect(done.state).toBe("none");
  });

  test("the console: support and super only, resolve needs a confirm", async () => {
    const u = await mkUser("console");
    const r = await live.requestHuman(u.id, { message: "help with my plan" });
    const fin = await db.adminUser.create({ data: { login: `live1184-finance-${tag()}`, name: "Fin Ance", role: "finance", passwordHash: `x-${tag()}` } });
    admins.push(fin.id);
    g.__r1184Admin = { id: fin.id, name: fin.name, login: fin.login, role: "finance" };
    expect((await GET(queueRoute.GET as Handler, "/api/admin/live-assist")).status).toBe(403);
    expect((await POST(chatRoute.POST as Handler, `/api/admin/live-assist/${r.session!.id}`, { action: "accept" }, { id: r.session!.id })).status).toBe(403);
    g.__r1184Admin = null;
    expect((await GET(queueRoute.GET as Handler, "/api/admin/live-assist")).status).toBe(401);

    const sup = await mkAdmin("Route Agent");
    g.__r1184Admin = sup.s;
    const q = await GET(queueRoute.GET as Handler, "/api/admin/live-assist?filter=waiting&analytics=7");
    expect(q.status).toBe(200);
    const qj = await q.json();
    expect(qj.items.map((i: { id: string }) => i.id)).toContain(r.session!.id);
    expect(qj.analytics.days).toBe(7);
    expect((await db.adminUser.findUniqueOrThrow({ where: { id: sup.row.id } })).liveSeenAt).not.toBeNull();
    const id = r.session!.id;
    expect((await (await POST(chatRoute.POST as Handler, `/api/admin/live-assist/${id}`, { action: "accept" }, { id })).json()).ok).toBe(true);
    expect((await POST(chatRoute.POST as Handler, `/api/admin/live-assist/${id}`, { action: "send", text: "Hello from the console", cid: cid() }, { id })).status).toBe(200);
    expect((await POST(chatRoute.POST as Handler, `/api/admin/live-assist/${id}`, { action: "resolve" }, { id })).status).toBe(400);
    expect((await (await POST(chatRoute.POST as Handler, `/api/admin/live-assist/${id}`, { action: "resolve", confirm: true }, { id })).json()).ok).toBe(true);
    const d = await (await GET(chatRoute.GET as Handler, `/api/admin/live-assist/${id}`, { id })).json();
    expect(d.session.status).toBe("resolved");
    expect(d.customer.user.email).toBe(u.email);
    expect(JSON.stringify(d.customer)).not.toContain("passwordHash");
    expect((await GET(chatRoute.GET as Handler, "/api/admin/live-assist/nope", { id: "nope" })).status).toBe(404);
  });
});

describe("retention and the rest of the product", () => {
  test("a conversation that had a support chat is never pruned; a plain old Pip chat still is", async () => {
    const u = await mkUser("prune");
    const r = await live.requestHuman(u.id, { message: "keep me" });
    await live.cancelRequest(u.id, r.conversationId);
    const plain = await startConversation(u.id, "old Pip chat");
    const old = new Date(Date.now() - 120 * 864e5);
    await db.pipConversation.updateMany({ where: { id: { in: [r.conversationId, plain.id] } }, data: { updatedAt: old } });
    await pruneOldData();
    expect(await db.pipConversation.count({ where: { id: r.conversationId } })).toBe(1);
    expect(await db.pipConversation.count({ where: { id: plain.id } })).toBe(0);
  });

  test("the sidebar lists Support as Tickets, Live Support, FAQ, Email outbox, for support and super", () => {
    const src = readFileSync("components/admin/AdminShell.tsx", "utf8");
    const at = ["/admin/tickets\"", "/admin/live-assist\"", "/admin/faq\"", "/admin/outbox\""].map((h) => src.indexOf(`href: "${h}`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);
    const lines = src.split(/\r?\n/).filter((l) => l.includes('group: "Support"'));
    expect(lines.map((l) => /label: "([^"]+)"/.exec(l)![1])).toEqual(["Tickets", "Live Support", "FAQ", "Email outbox"]);
    expect(readFileSync("lib/admin/perms.ts", "utf8")).toMatch(/live: \["super", "support"\]/);
  });

  test("the widget speaks through /api/support/live, uses the shared words and keeps the old email ticket path", () => {
    const w = readFileSync("components/support/ChatWidget.tsx", "utf8");
    expect(w).toContain("/api/support/live");
    // R1311: the connected card is gone; the header's one line (connectedTo, joined, endChat) carries that state.
    for (const k of ["connecting", "queueTitle", "waiting", "connectedTo", "joined", "endChat", "reconnecting", "resolved", "keepPip"]) expect({ k, used: w.includes(`lt.${k}`) }).toEqual({ k, used: true });
    // R1207: the customer is never shown the unavailable line.
    expect(w).not.toContain("lt.unavailable");
    expect(w).toContain("liveT(lang).offer");
    expect(w).toContain("askEmail");
    expect(w).not.toMatch(/dangerouslySetInnerHTML=\{\{ __html: m\.text/);
  });

  test("both schema files carry the Live Assist models", () => {
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = readFileSync(f, "utf8");
      for (const m of ["model SupportSession", "model SupportNote", "model SupportAssignment", "liveSeenAt", "liveAway", "sessions SupportSession[]"]) expect({ f, m, has: s.includes(m) }).toEqual({ f, m, has: true });
    }
  });
});
