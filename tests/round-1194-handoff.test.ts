/**
 * Round 1194: Pip's human-support handoff, fixed at the source.
 * - Intent: the brief's phrases (typos, other languages) are a HUMAN_SUPPORT_REQUEST; "are you a bot", pricing
 *   questions and "connect my Instagram account" are not. Routing priority: a specialist in the chat > waiting >
 *   explicit ask > general.
 * - One authoritative state on the server (AI_ASSISTED -> HUMAN_SUPPORT_REQUESTED/WAITING_FOR_AGENT -> HUMAN_ACTIVE
 *   -> RESOLVED, or CANCELLED), carried on every snapshot.
 * - The brief's exact sequence through the real chat route: "Connect me with a support specialist." starts the
 *   handoff with no further question, one row, one stored confirmation line after the customer's words, the team
 *   told. "Connect me in chat." and "Connect to live support." while waiting: saved to the same conversation, no
 *   second request, no second ticket, counted as duplicates, the widget told "already" once per state.
 * - Two specialists accept at once: one wins; the customer sees "You're now connected with <Name>."; the agent's
 *   reply lands in the same chat; refresh (?resume=1) finds the conversation; cancel, resolve, ask again after
 *   resolution starts a fresh request. Diagnostics on detail() for the console.
 * - Visitors are not promised a live chat they cannot have: Pip explains the email route, and the widget asks.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

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
const { invalidate } = await import("../lib/cache");
const live = await import("../lib/support/live");
const core = await import("../lib/support/live-core");
const intent = await import("../lib/support/intent");
const bot = await import("../lib/support/bot");
const { LIVE_EN, liveT, liveSysLine } = await import("../lib/i18n/live");
const { POST: chatPOST } = await import("../app/api/support/chat/route");
const liveRoute = await import("../app/api/support/live/route");
type AdminSession = import("../lib/admin/auth").AdminSession;

const users: string[] = [];
const admins: string[] = [];
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const mkUser = async (t: string) => {
  const email = `handoff1194-${t}-${tag()}@test.dev`;
  const u = await db.user.create({ data: { name: `Handoff ${t}`, email, passwordHash: "x", emailVerifiedAt: new Date(), emailVerifiedFor: email } });
  users.push(u.id);
  return u;
};
const mkAdmin = async (name: string, role = "support") => {
  const row = await db.adminUser.create({ data: { login: `handoff1194-${role}-${tag()}`, name, role, passwordHash: `x-${tag()}` } });
  admins.push(row.id);
  return { row, s: { id: row.id, name: row.name, login: row.login, role: row.role } as AdminSession };
};
const H = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };
type Handler = (req: NextRequest, ctx: never) => Promise<Response>;
const POST = (h: Handler, path: string, body: unknown) => h(new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: H }), {} as never);
const GET = (h: Handler, path: string) => h(new NextRequest(`http://localhost${path}`, { method: "GET", headers: H }), {} as never);
const signIn = async (id: string) => { jar.clear(); await createSession(id); };
const cid = () => `c${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
const say = async (message: string, conversationId?: string | null) => {
  const c = cid();
  const res = await POST(chatPOST as Handler, "/api/support/chat", { message, cid: c, history: [], ...(conversationId ? { conversationId } : {}) });
  return { status: res.status, cid: c, j: await res.json() };
};
const nobodyOnline = async () => {
  await db.adminUser.updateMany({ data: { liveSeenAt: null, liveAway: false } });
  invalidate("live:");
};

beforeEach(() => jar.clear());
afterAll(async () => {
  jar.clear();
  await db.adminEvent.deleteMany({ where: { href: { startsWith: "/admin/live-assist" } } });
  await db.ticket.deleteMany({ where: { userId: { in: users } } }).catch(() => {});
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.adminUser.deleteMany({ where: { id: { in: admins } } });
});

describe("intent: an explicit ask for a person is recognised, nothing else is", () => {
  const YES = [
    "Connect me with a support specialist.",
    "Connect me in chat.",
    "Connect to live support.",
    "I want to talk to a human",
    "Let me speak to an agent",
    "I need a real person",
    "Transfer me to support",
    "Can someone help me?",
    "Human assistance please",
    "conect me with a suport specialst",
    "i wanna talk to a humna",
    "talk to someone",
    "live chat please",
    "Quiero hablar con una persona",
    "Je veux parler à un humain",
    "मुझे किसी इंसान से बात करनी है",
    "Ich möchte mit einem Menschen sprechen",
    "quero falar com um atendente",
    "我想和真人聊天",
    // A strong ask wins over its topic: the plan, the account and the ticket are what they want a person FOR.
    "connect me with support about my plan",
    "connect me to support, my instagram account is broken",
    "I want to check my ticket, connect me with an agent",
    "I need a human, I was charged twice for my subscription plan",
    "send me to an agent",
    "is there a human I can talk to",
  ];
  const NO = [
    "Are you a bot or a human?",
    "How do I connect my Instagram account?",
    "Does the Pro plan include priority support?",
    "What languages do you support?",
    "I don't need a human, just tell me the price",
    "Do you have a support ticket page?",
    "How do I schedule a reel?",
    "hi",
    "thanks, that helped",
    // Words from the list in sentences about the work, not about reaching a person.
    "send it to the team",
    "how do I send this to the team for approval",
    "I like someone's reel",
    "get someone to follow me",
    "real help with captions",
    "can anyone see my private drafts?",
    "message the team about the new post",
    "the agent tab doesn't load",
    "how do I add a person to my workspace",
    "will anyone see my draft",
  ];
  test("the brief's phrases, typos and other languages", () => {
    for (const q of YES) expect({ q, human: intent.wantsHuman(q) }).toEqual({ q, human: true });
  });
  test("questions about bots, plans, socials and the help centre stay with Pip", () => {
    for (const q of NO) expect({ q, human: intent.wantsHuman(q) }).toEqual({ q, human: false });
  });
  test("routing priority: active human > waiting > explicit ask > general", () => {
    expect(intent.routeIntent("Connect me in chat.", { mode: "human" })).toEqual({ intent: "HUMAN_ACTIVE_RELAY", repeat: true });
    expect(intent.routeIntent("my export is stuck", { mode: "human" })).toEqual({ intent: "HUMAN_ACTIVE_RELAY", repeat: false });
    expect(intent.routeIntent("Connect to live support.", { mode: "waiting" })).toEqual({ intent: "QUEUE_RELAY", repeat: true });
    expect(intent.routeIntent("Connect me with a support specialist.", { mode: "ai" })).toEqual({ intent: "HUMAN_SUPPORT_REQUEST", repeat: false });
    expect(intent.routeIntent("Connect me with a support specialist.", {})).toEqual({ intent: "HUMAN_SUPPORT_REQUEST", repeat: false });
    expect(intent.routeIntent("How much is Pro?", { mode: "ai" })).toEqual({ intent: "GENERAL", repeat: false });
  });
  test("the state names come from the stored mode, one source of truth", () => {
    expect(core.conversationState("ai", null)).toBe("AI_ASSISTED");
    expect(core.conversationState("waiting", "waiting")).toBe("WAITING_FOR_AGENT");
    expect(core.conversationState("human", "active")).toBe("HUMAN_ACTIVE");
    expect(core.conversationState("resolved", "resolved")).toBe("RESOLVED");
    expect(core.conversationState("ai", "cancelled")).toBe("CANCELLED");
  });
});

describe("the words", () => {
  test("Pip's one handoff line, the queue line, the repeat line and the named connection, in every language", () => {
    // R1207: the queue confirmation, word for word from the brief.
    expect(LIVE_EN.handoff).toBe("You're in the support queue! Please wait while we connect you with a specialist. Your conversation is saved.");
    expect(LIVE_EN.already).toBe("You're already in the support queue. A specialist will join this chat as soon as one is available.");
    expect(LIVE_EN.connectedWith("Priya")).toBe("You're connected! Priya has joined the conversation. How can we help?");
    expect(LIVE_EN.leave).toBe("Leave a message");
    expect(LIVE_EN.cancel).toBe("Cancel support request");
    expect("emailWhy" in LIVE_EN).toBe(false);
    for (const l of ["hi", "es", "fr", "de", "pt", "ar", "zh", "ja", "ru", "id", "bn"] as const) {
      const t = liveT(l);
      expect({ l, ok: t.handoff !== LIVE_EN.handoff && t.already !== LIVE_EN.already && t.connectedWith("X").includes("X") }).toEqual({ l, ok: true });
    }
    const t = liveT("en");
    expect(liveSysLine(t, "live.requested")).toBe(LIVE_EN.handoff);
    expect(liveSysLine(t, "live.connected|Priya")).toBe("You're connected! Priya has joined the conversation. How can we help?");
  });
  test("the old dead-end copy is gone from the widget and the bot", () => {
    const widget = readFileSync("components/support/ChatWidget.tsx", "utf8");
    const botSrc = readFileSync("lib/support/bot.ts", "utf8");
    const supportI18n = readFileSync("lib/i18n/support.ts", "utf8");
    for (const src of [widget, botSrc, supportI18n]) {
      expect(src).not.toContain("I couldn't solve this, so I'm handing it to our team");
      expect(src).not.toContain("Where should we reply?");
      expect(src).not.toContain("Open ticket");
    }
    // R1207: both buttons are on the queue card from the first moment, so there is no "Continue waiting" step.
    expect(widget).toContain("lt.leave");
    expect(widget).toContain("lt.cancel");
    expect(widget).not.toContain("lt.continueWaiting");
    expect(widget).not.toContain("emailWhy");
    expect(widget).toMatch(/\b(lt|liveT\(lang\))\.already\b/);
    expect(widget).toContain("/api/support/live?resume=1");
    // The connect question is sent to the server for a signed-in person (the server starts the handoff, no second question).
    expect(widget).toMatch(/if \(id === "human" && i === 0 && !signedIn\)/);
  });
});

describe("the brief's sequence, through the real chat route", () => {
  let u: Awaited<ReturnType<typeof mkUser>>;
  let A: Awaited<ReturnType<typeof mkAdmin>>, B: Awaited<ReturnType<typeof mkAdmin>>;
  let conv: string, sid: string, win: AdminSession;

  test("'Connect me with a support specialist.' starts the handoff: no question back, one row, one line, team told", async () => {
    await nobodyOnline();
    u = await mkUser("seq");
    A = await mkAdmin("Priya Raman");
    B = await mkAdmin("Arjun Mehta");
    await signIn(u.id);
    const r = await say("Connect me with a support specialist.");
    expect(r.status).toBe(200);
    expect({ live: r.j.live, handoff: r.j.handoff, answer: r.j.answer, wantsHuman: r.j.wantsHuman }).toEqual({ live: true, handoff: "started", answer: "", wantsHuman: false });
    conv = r.j.conversationId;
    sid = r.j.snapshot.session.id;
    expect(r.j.snapshot.conversationState).toBe("WAITING_FOR_AGENT");
    expect(r.j.snapshot.mode).toBe("waiting");
    expect(r.j.message?.cid).toBe(r.cid);
    expect(r.j.snapshot.messages.map((m: { role: string; text: string }) => [m.role, m.text])).toEqual([["user", "Connect me with a support specialist."], ["system", "live.requested"]]);
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect({ status: row.status, source: row.source, intent: row.intentText, dups: row.duplicates, ticket: row.ticketId }).toEqual({ status: "waiting", source: "chat", intent: "Connect me with a support specialist.", dups: 0, ticket: null });
    expect(await db.supportSession.count({ where: { conversationId: conv } })).toBe(1);
    expect(await db.ticket.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.adminEvent.count({ where: { kind: { in: ["live_request", "live_urgent"] }, href: `/admin/live-assist?s=${sid}` } })).toBe(1);
    expect(await db.supportAssignment.count({ where: { sessionId: sid, action: "request", note: { contains: "via chat" } } })).toBe(1);
  });

  test("'Connect me in chat.' and 'Connect to live support.' while waiting: saved, counted, no second request or ticket", async () => {
    await signIn(u.id);
    const r2 = await say("Connect me in chat.", conv);
    expect({ live: r2.j.live, handoff: r2.j.handoff, dup: r2.j.duplicate, conv: r2.j.conversationId }).toEqual({ live: true, handoff: "already", dup: false, conv });
    expect(r2.j.snapshot.conversationState).toBe("WAITING_FOR_AGENT");
    const r3 = await say("Connect to live support.", conv);
    expect(r3.j.handoff).toBe("already");
    const plain = await say("Also my reel failed to publish yesterday", conv);
    expect({ live: plain.j.live, handoff: plain.j.handoff }).toEqual({ live: true, handoff: undefined });
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect({ dups: row.duplicates, stamped: row.lastDuplicateAt instanceof Date }).toEqual({ dups: 2, stamped: true });
    expect(await db.supportSession.count({ where: { userId: u.id } })).toBe(1);
    expect(await db.ticket.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.supportAssignment.count({ where: { sessionId: sid, action: "duplicate" } })).toBe(2);
    const texts = (await db.pipMessage.findMany({ where: { conversationId: conv }, orderBy: { seq: "asc" }, select: { role: true, text: true } })).map((m) => `${m.role}:${m.text}`);
    expect(texts).toEqual([
      "user:Connect me with a support specialist.",
      "system:live.requested",
      "user:Connect me in chat.",
      // Nobody is online, so the first words while waiting are kept as a left message: one line, once.
      "system:live.left",
      "user:Connect to live support.",
      "user:Also my reel failed to publish yesterday",
    ]);
    // Only one stored confirmation line, ever: no repeated handoff messages.
    expect(await db.pipMessage.count({ where: { conversationId: conv, text: "live.requested" } })).toBe(1);
    expect(await db.pipMessage.count({ where: { conversationId: conv, role: { notIn: ["user", "system"] } } })).toBe(0);
  });

  test("refresh: ?resume=1 finds the conversation the person is waiting in, with the state", async () => {
    await signIn(u.id);
    const j = await (await GET(liveRoute.GET as Handler, "/api/support/live?resume=1")).json();
    expect({ conv: j.conversationId, mode: j.mode, state: j.conversationState, sid: j.session.id }).toEqual({ conv, mode: "waiting", state: "WAITING_FOR_AGENT", sid });
    expect(j.messages.length).toBe(6);
    // R1207: nobody online reads as "waiting" too. The customer is never told the team is away.
    expect(j.state).toBe("waiting");
    await live.heartbeat(A.s);
    expect((await live.customerPoll(u.id, { conversationId: conv })).state).toBe("waiting");
  });

  test("two specialists accept at once: one wins; the customer sees 'You're now connected with <Name>.'", async () => {
    const res = await Promise.allSettled([live.accept(A.s, sid), live.accept(B.s, sid)]);
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(1);
    const bad = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect({ status: bad.reason.status, code: bad.reason.code }).toEqual({ status: 409, code: "TAKEN" });
    win = res[0].status === "fulfilled" ? A.s : B.s;
    const p = await live.customerPoll(u.id, { conversationId: conv });
    expect({ state: p.state, mode: p.mode, cs: p.conversationState, agent: p.session!.agent }).toEqual({ state: "connected", mode: "human", cs: "HUMAN_ACTIVE", agent: core.firstName(win.name) });
    const line = p.messages.find((m) => m.role === "system" && m.text.startsWith("live.connected"))!;
    expect(liveSysLine(liveT("en"), line.text)).toBe(`You're connected! ${core.firstName(win.name)} has joined the conversation. How can we help?`);
    expect(await db.pipMessage.count({ where: { conversationId: conv, text: { startsWith: "live.connected" } } })).toBe(1);
  });

  test("the agent's reply lands in the same Pip chat; the customer's words relay, Pip never competes", async () => {
    const sent = await live.agentSend(win, sid, { text: "Hi, Priya here. Let me look at that reel.", cid: cid() });
    expect(sent.duplicate).toBe(false);
    await signIn(u.id);
    const r = await say("Connect me in chat.", conv);
    expect({ live: r.j.live, handoff: r.j.handoff, answer: r.j.answer }).toEqual({ live: true, handoff: "already", answer: "" });
    const p = await live.customerPoll(u.id, { conversationId: conv });
    const tail = p.messages.slice(-2).map((m) => [m.role, m.text]);
    expect(tail).toEqual([["agent", "Hi, Priya here. Let me look at that reel."], ["user", "Connect me in chat."]]);
    expect(await db.pipMessage.count({ where: { conversationId: conv, role: "pip" } })).toBe(0);
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect(row.firstResponseAt).not.toBeNull();
    expect(row.duplicates).toBe(3);
  });

  test("the console's diagnostics: source, words, repeats, first response, state, notification result", async () => {
    const d = await live.detail(win, sid);
    const h = d.session.handoff;
    expect({ source: h.source, intent: h.intent, dups: h.duplicates, state: h.state, notifyFailed: h.notifyFailed }).toEqual({ source: "chat", intent: "Connect me with a support specialist.", dups: 3, state: "HUMAN_ACTIVE", notifyFailed: false });
    expect(typeof h.lastDuplicateAt).toBe("string");
    expect(h.firstResponseMs).toBeGreaterThanOrEqual(0);
    expect(d.session.waitMs).toBeGreaterThanOrEqual(0);
  });

  test("the agent resolves: RESOLVED, Pip's chat is back; asking again starts a fresh request in a new conversation", async () => {
    await live.resolve(win, sid);
    const p = await live.customerPoll(u.id, { conversationId: conv });
    expect({ mode: p.mode, cs: p.conversationState }).toEqual({ mode: "resolved", cs: "RESOLVED" });
    await signIn(u.id);
    expect(await (await GET(liveRoute.GET as Handler, "/api/support/live?resume=1")).json()).toBeNull();
    // The resolved conversation is closed to new words (the widget shows "start another conversation"): honest 409,
    // never a silent restart of the welcome flow. The next ask, in a new chat, is a fresh request.
    const stale = await say("I want to talk to a human", conv);
    expect({ status: stale.status, code: stale.j.code }).toEqual({ status: 409, code: "RESOLVED" });
    const r = await say("I want to talk to a human");
    expect({ live: r.j.live, handoff: r.j.handoff, state: r.j.snapshot.conversationState }).toEqual({ live: true, handoff: "started", state: "WAITING_FOR_AGENT" });
    expect(r.j.conversationId).not.toBe(conv);
    expect(await db.supportSession.count({ where: { userId: u.id } })).toBe(2);
    const fresh = await db.supportSession.findFirstOrThrow({ where: { userId: u.id, status: "waiting" } });
    expect({ dups: fresh.duplicates, source: fresh.source }).toEqual({ dups: 0, source: "chat" });
  });
});

describe("cancel, a ticket already open, the button, a visitor", () => {
  test("the customer cancels while waiting: CANCELLED, Pip answers again, the next ask is a new request", async () => {
    await nobodyOnline();
    const u = await mkUser("cancel");
    await signIn(u.id);
    const r = await say("Let me speak to an agent");
    expect(r.j.handoff).toBe("started");
    const conv = r.j.conversationId as string;
    const s = await live.cancelRequest(u.id, conv);
    expect({ mode: s.mode, cs: s.conversationState }).toEqual({ mode: "ai", cs: "CANCELLED" });
    expect(await db.supportSession.count({ where: { userId: u.id, status: "cancelled" } })).toBe(1);
    const again = await say("Connect me with a support specialist.", conv);
    expect({ handoff: again.j.handoff, conv: again.j.conversationId, state: again.j.snapshot.conversationState }).toEqual({ handoff: "started", conv, state: "WAITING_FOR_AGENT" });
    expect(await db.supportSession.count({ where: { userId: u.id } })).toBe(2);
    expect(await db.pipMessage.count({ where: { conversationId: conv, text: "live.requested" } })).toBe(2);
  });

  test("a second request from a fresh chat (reload, another tab) joins the one already open: one row, counted", async () => {
    const u = await mkUser("twice");
    await signIn(u.id);
    const r1 = await say("Connect me with a support specialist.");
    const conv1 = r1.j.conversationId as string;
    const sid = r1.j.snapshot.session.id as string;
    // A new conversation (no id): the words go to the open request's conversation, no second session, no second line.
    const r2 = await say("Connect me in chat.");
    expect({ handoff: r2.j.handoff, conv: r2.j.conversationId, sid: r2.j.snapshot.session.id, state: r2.j.conversationState }).toEqual({ handoff: "already", conv: conv1, sid, state: "WAITING_FOR_AGENT" });
    // The button from another tab with no conversation: the same.
    const j3 = await (await POST(liveRoute.POST as Handler, "/api/support/live", { action: "request", source: "button" })).json();
    expect({ created: j3.created, conv: j3.conversationId, sid: j3.session.id }).toEqual({ created: false, conv: conv1, sid });
    expect(await db.supportSession.count({ where: { userId: u.id } })).toBe(1);
    expect(await db.pipMessage.count({ where: { conversationId: conv1, text: "live.requested" } })).toBe(1);
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: sid } });
    expect(row.duplicates).toBe(2);
    const texts = (await db.pipMessage.findMany({ where: { conversationId: conv1 }, orderBy: { seq: "asc" }, select: { text: true } })).map((m) => m.text);
    expect(texts).toEqual(["Connect me with a support specialist.", "live.requested", "Connect me in chat.", "live.left"]);
  });

  test("'connect me to support' typed into the live route while waiting is counted too, said once by the widget", async () => {
    const u = await mkUser("liveroute");
    await signIn(u.id);
    const r1 = await say("Connect me with a support specialist.");
    const conv = r1.j.conversationId as string;
    const sid = r1.j.snapshot.session.id as string;
    const j = await (await POST(liveRoute.POST as Handler, "/api/support/live", { action: "send", conversationId: conv, text: "Connect to live support.", cid: cid() })).json();
    expect({ handoff: j.handoff, dup: j.duplicate, state: j.snapshot?.conversationState, text: j.message?.text }).toEqual({ handoff: "already", dup: false, state: "WAITING_FOR_AGENT", text: "Connect to live support." });
    const plain = await (await POST(liveRoute.POST as Handler, "/api/support/live", { action: "send", conversationId: conv, text: "it still fails", cid: cid() })).json();
    expect(plain.handoff).toBeUndefined();
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: sid } })).duplicates).toBe(1);
    expect(await db.supportSession.count({ where: { userId: u.id } })).toBe(1);
    expect(await db.pipMessage.count({ where: { conversationId: conv, role: "user" } })).toBe(3);
    // The widget says it once, on the live route's answer as well as Pip's.
    const widget = readFileSync("components/support/ChatWidget.tsx", "utf8");
    expect(widget.match(/j\.handoff === "already" && !alreadyRef\.current/g)?.length).toBe(2);
  });

  test("an open ticket is reused (linked), never duplicated", async () => {
    const u = await mkUser("ticket");
    const t = await db.ticket.create({ data: { ref: `OT-1194-${tag()}`, userId: u.id, email: u.email, subject: "Billing", status: "open" } });
    await signIn(u.id);
    const r = await say("Transfer me to support");
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: r.j.snapshot.session.id } });
    expect(row.ticketId).toBe(t.id);
    expect(await db.ticket.count({ where: { userId: u.id } })).toBe(1);
    expect(await db.supportAssignment.count({ where: { sessionId: row.id, action: "request", note: { contains: t.ref } } })).toBe(1);
  });

  test("the widget's button goes through the same path and is written down as such", async () => {
    const u = await mkUser("button");
    await signIn(u.id);
    const j = await (await POST(liveRoute.POST as Handler, "/api/support/live", { action: "request", message: "My export is stuck", cid: cid(), source: "button" })).json();
    expect({ created: j.created, state: j.conversationState }).toEqual({ created: true, state: "WAITING_FOR_AGENT" });
    const row = await db.supportSession.findUniqueOrThrow({ where: { id: j.session.id } });
    expect({ source: row.source, intent: row.intentText }).toEqual({ source: "button", intent: "My export is stuck" });
    // The button again (another tab): the same request, counted as asked again, never a second one.
    const j2 = await (await POST(liveRoute.POST as Handler, "/api/support/live", { action: "request", conversationId: j.conversationId, message: "Connect to a human", cid: cid(), source: "button" })).json();
    expect({ created: j2.created, sid: j2.session.id }).toEqual({ created: false, sid: j.session.id });
    expect((await db.supportSession.findUniqueOrThrow({ where: { id: j.session.id } })).duplicates).toBe(1);
  });

  test("a visitor asking for a person is told the email route, not promised a live chat", async () => {
    const r = await bot.answer("I want to talk to a human", [], "en");
    expect(r.wantsHuman).toBe(true);
    expect(r.answer).toContain("You're not signed in");
    // Signed in, the route has already handled a real ask; a sentence that merely contains "agent" is a question.
    const s = await bot.answer("the agent tab doesn't load", [], "en", { signedIn: true, ai: false });
    expect({ human: s.wantsHuman, visitorText: s.answer.includes("You're not signed in") }).toEqual({ human: false, visitorText: false });
    const s2 = await bot.answer("I want to talk to a human", [], "en", { signedIn: true, ai: false });
    expect(s2.answer).not.toContain("You're not signed in");
    expect(r.answer).not.toContain("I couldn't solve this");
    const res = await say("Connect me with a support specialist.");
    expect(res.status).toBe(200);
    expect({ live: res.j.live, wantsHuman: res.j.wantsHuman }).toEqual({ live: undefined, wantsHuman: true });
  });
});

describe("pricing cards scroll sideways", () => {
  test("R1196: one gallery row (HScroll), focusable, same card width, centred when it fits, arrows for the plain row only", () => {
    const src = readFileSync("components/marketing/PricingCards.tsx", "utf8");
    const css = readFileSync("app/globals.css", "utf8");
    expect(src).not.toContain("md:grid-cols-2");
    expect(src).toContain('<HScroll label="Plans" focusable list className="price-hs">');
    expect(src).toContain('className="hs-item price-item"');
    expect(src).not.toContain("pricing-row");
    expect(src).not.toContain('fx="cards"'); // the gallery moves each card; a reveal on the track would fight it
    expect(src).toContain('querySelector<HTMLElement>("[data-hs-box]")');
    expect(src).toContain('aria-label="Previous plans"');
    expect(src).toContain('aria-label="Next plans"');
    expect(src).toMatch(/\{more && \(/);
    expect(src).toContain('className="price-arrows mt-5 flex');
    expect(src).toContain('behavior: reduce ? "auto" : "smooth"');
    expect(css).toContain(".price-item { --hs-w: min(340px, 86vw); }");
    expect(css).toContain(".price-hs .hs-track { gap: 20px; margin-inline: auto; }");
    expect(css).toContain(".price-hs[data-hs-on] ~ .price-arrows { display: none; }");
    expect(css).not.toContain(".pricing-row {");
  });
});
