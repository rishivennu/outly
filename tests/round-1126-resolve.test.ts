/**
 * Round 1126: Resolve Conversation in Pip.
 * - Resolution intent: clear "I'm done" phrases offer to resolve; a bare "thanks", or thanks plus a new question, never does.
 * - The chat route records a signed-in person's conversation and offers the resolve (visitors never are).
 * - Resolve (R1311: legacy spelling of close): owner only, idempotent, nothing emailed; the transcript mailer is gone.
 * - A resolved conversation refuses new messages until it is reopened.
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
const { getConfig } = await import("../lib/settings");
const { isResolutionIntent, wantsToResolve, isDoneReply } = await import("../lib/support/resolve");
const conv = await import("../lib/support/conversations");
const { POST: chatPOST } = await import("../app/api/support/chat/route");
const { POST: convPOST } = await import("../app/api/support/conversation/route");
const { memberBlock } = await import("../lib/team/roles");
const { PIP_RESOLVE } = await import("../lib/i18n/support");
const { pruneOldData } = await import("../lib/retention/prune");

const users: string[] = [];
const mkUser = async (tag: string, verified = true) => {
  const email = `pip1126-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  const u = await db.user.create({ data: { name: `Pip ${tag}`, email, passwordHash: "x", ...(verified ? { emailVerifiedAt: new Date(), emailVerifiedFor: email } : {}) } });
  users.push(u.id);
  return u;
};
const H = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };
const call = (h: typeof chatPOST, path: string, body: unknown) =>
  h(new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: H }), { params: {} } as never);
const chat = (message: string, extra: Record<string, unknown> = {}) =>
  call(chatPOST, "/api/support/chat", { message, history: [{ role: "user", text: "how do I schedule a post?" }, { role: "bot", text: "Open Create, pick a time, then Schedule." }], ...extra });
const act = (action: "resolve" | "reopen", conversationId: string) => call(convPOST, "/api/support/conversation", { action, conversationId });
const signIn = async (id: string) => { jar.clear(); await createSession(id); };

/** A conversation with a few real turns, written the way the chat route writes them. */
async function seed(userId: string, turns: [string, string][] = [["How do I schedule a post?", "Open **Create**, pick a time, then tap Schedule."], ["My issue is resolved", "Glad I could help!"]]) {
  let c: { id: string } | null = null;
  let t = Date.now() - 60_000;
  for (const [q, a] of turns) {
    const id = await conv.recordTurn({ userId, conversation: c, question: q, answer: a, askedAt: new Date((t += 1000)), answeredAt: new Date(t + 500) });
    c = { id };
  }
  return c!.id;
}

beforeEach(() => jar.clear());
afterAll(async () => {
  jar.clear();
  (globalThis as unknown as { __cfg?: Map<string, unknown> }).__cfg?.delete("email");
  await db.emailLog.deleteMany({ where: { to: { startsWith: "pip1126-" } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
});

describe("resolution intent", () => {
  test("the brief's phrases (and close cousins) offer to resolve", () => {
    for (const s of ["I got the answer.", "My issue is resolved.", "That's all, thank you.", "This solved my problem.", "I'm satisfied with the answer.", "You can close this conversation.", "that fixed it, thanks", "all sorted now"])
      expect({ s, yes: isResolutionIntent(s) }).toEqual({ s, yes: true });
  });
  test("plain thanks, or thanks with another question, never closes", () => {
    for (const s of ["thanks", "thank you", "ok", "great", "thanks! how do I connect YouTube?", "is it resolved?", "my issue is not resolved", "don't close this conversation", "that solved it but what about Instagram?", "resolved?"])
      expect({ s, yes: isResolutionIntent(s) }).toEqual({ s, yes: false });
  });
  test("a bare 'nothing' or 'no' after Pip asks for more is a goodbye (live report, 4 Nov)", () => {
    const greet = [{ role: "bot" as const, text: "Hi! What can I help you with today?" }];
    const letMeKnow = [{ role: "bot" as const, text: "You are on the free plan right now. If there is anything else you need help with, just let me know." }];
    for (const s of ["nothing", "Nothing.", "no", "nope", "No thanks", "nothing else", "I'm good", "all good", "kuch nahi", "कुछ नहीं", "nah thanks"]) {
      expect(wantsToResolve(s, greet)).toBe(true);
      expect(wantsToResolve(s, letMeKnow)).toBe(true);
    }
    expect(wantsToResolve("no", [{ role: "bot", text: "Glad I could help! Anything else?" }])).toBe(true);
  });
  test("a bare 'no' is still a no when Pip did not invite more", () => {
    const stated = [{ role: "bot" as const, text: "Your next post goes out at 6 pm." }];
    expect(wantsToResolve("no", stated)).toBe(false);
    expect(wantsToResolve("nothing", stated)).toBe(false);
    expect(isDoneReply("no, it still fails", "Anything else?")).toBe(false);
    expect(isDoneReply("nothing works", "Anything else?")).toBe(false);
    expect(isDoneReply("no I need to change my plan", "Anything else?")).toBe(false);
    expect(isResolutionIntent("no")).toBe(false);
  });
  test("needs something Pip actually answered first", () => {
    expect(wantsToResolve("My issue is resolved", [])).toBe(false);
    expect(wantsToResolve("My issue is resolved", [{ role: "bot", text: "Open Create." }])).toBe(true);
  });
});

describe("chat route", () => {
  test("signed in: the offer comes back with the saved conversation", async () => {
    const u = await mkUser("chat");
    await signIn(u.id);
    const r = await chat("My issue is resolved, thanks");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.resolve).toBe(true);
    expect(j.smalltalk).toBe(true);
    expect(j.answer).toBe("Glad I could help!");
    expect(typeof j.conversationId).toBe("string");
    const c = await db.pipConversation.findUnique({ where: { id: j.conversationId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    expect(c?.userId).toBe(u.id);
    expect(c?.status).toBe("open");
    expect(c?.ref).toMatch(/^C-[A-Z0-9]{6}$/);
    expect(c?.messages.map((m) => m.role)).toEqual(["user", "pip"]);
    // The transcript keeps what was really on screen: the reply and the question under it.
    expect(c?.messages[1].text).toBe(`Glad I could help!\n\n${PIP_RESOLVE.en.ask}`);
    // Nothing was closed: only an offer.
    expect(c?.resolvedAt).toBeNull();
  });
  test("visitors get a warm reply, no offer and nothing stored", async () => {
    const r = await chat("I got the answer");
    const j = await r.json();
    expect(j.resolve).toBe(false);
    expect(j.conversationId).toBeUndefined();
  });
  test("someone else's conversation id starts a new one instead", async () => {
    const a = await mkUser("own-a"), b = await mkUser("own-b");
    const theirs = await seed(a.id);
    await signIn(b.id);
    const j = await (await chat("That's all, thank you", { conversationId: theirs })).json();
    expect(j.conversationId).not.toBe(theirs);
    expect(await db.pipMessage.count({ where: { conversationId: theirs } })).toBe(4);
  });
  test("records cards never reach the stored conversation", () => {
    const src = readFileSync("app/api/support/chat/route.ts", "utf8");
    expect(src).toContain("answer: shown ?? out.answer");
    expect(src).not.toMatch(/recordTurn\([^)]*data/);
  });
});

describe("resolve (legacy spelling of close): nothing is emailed", () => {
  test("marks resolved, keeps the history, sends no transcript", async () => {
    const u = await mkUser("send");
    const id = await seed(u.id, [["How do I add <script>alert(1)</script> captions?", "Open **Create** and tap Captions."], ["This solved my problem", "Glad I could help!"]]);
    await signIn(u.id);
    const r = await act("resolve", id);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, status: "resolved", already: false });
    expect(j.to).toBeUndefined();
    const c = await db.pipConversation.findUnique({ where: { id } });
    expect(c?.status).toBe("resolved");
    expect(c?.sendingAt).toBeNull();
    expect(await db.pipMessage.count({ where: { conversationId: id } })).toBe(4);
    expect(await db.emailLog.count({ where: { to: u.email } })).toBe(0);
  });
  test("an unverified address resolves too (no email, so nothing to verify)", async () => {
    const u = await mkUser("unverified", false);
    const id = await seed(u.id);
    await signIn(u.id);
    expect((await act("resolve", id)).status).toBe(200);
    expect((await db.pipConversation.findUnique({ where: { id } }))?.status).toBe("resolved");
    expect(await db.emailLog.count({ where: { to: u.email } })).toBe(0);
  });
  test("signed out and other people's conversations are refused", async () => {
    const a = await mkUser("other-a"), b = await mkUser("other-b");
    const id = await seed(a.id);
    expect((await act("resolve", id)).status).toBe(401);
    await signIn(b.id);
    expect((await act("resolve", id)).status).toBe(404);
    expect((await act("reopen", id)).status).toBe(404);
    expect(await db.emailLog.count({ where: { to: a.email } })).toBe(0);
  });
  test("double taps are idempotent", async () => {
    const u = await mkUser("dupe");
    const id = await seed(u.id);
    await signIn(u.id);
    const rs = await Promise.all([act("resolve", id), act("resolve", id), act("resolve", id)]);
    for (const r of rs) expect(r.status).toBe(200);
    const again = await (await act("resolve", id)).json();
    expect(again).toMatchObject({ ok: true, already: true });
    expect(await db.emailLog.count({ where: { to: u.email } })).toBe(0);
  });
  test("resolveAndSend (the transcript mailer) is gone from the server", () => {
    const src = readFileSync("lib/support/conversations.ts", "utf8");
    expect(src).not.toContain("export async function resolveAndSend");
    expect(readFileSync("app/api/support/conversation/route.ts", "utf8")).not.toContain("resolveAndSend");
  });
});

describe("locked while resolved, reopen", () => {
  test("a resolved conversation refuses messages; reopening lets the chat continue", async () => {
    const u = await mkUser("lock");
    const id = await seed(u.id);
    await signIn(u.id);
    expect((await act("resolve", id)).status).toBe(200);
    const blocked = await chat("one more thing: how do I add a cover?", { conversationId: id });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe("RESOLVED");
    expect(await db.pipMessage.count({ where: { conversationId: id } })).toBe(4);

    const re = await act("reopen", id);
    expect(re.status).toBe(200);
    expect(await re.json()).toMatchObject({ ok: true, status: "open" });
    const c = await db.pipConversation.findUnique({ where: { id } });
    expect(c?.status).toBe("open");
    expect(c?.resolvedAt).toBeNull();
    const j = await (await chat("All sorted now, thanks", { conversationId: id })).json();
    expect(j.conversationId).toBe(id);
    expect(await db.pipMessage.count({ where: { conversationId: id } })).toBe(6);
    // Resolving again just closes it again; still no email.
    expect((await (await act("resolve", id)).json()).already).toBe(false);
    expect(await db.emailLog.count({ where: { to: u.email } })).toBe(0);
  });
  test("teammates can resolve their own chats", () => {
    for (const role of ["viewer", "editor", "manager"] as const) expect(memberBlock(role, "POST", "/api/support/conversation")).toBeNull();
  });
});

describe("retention and privacy", () => {
  test("conversations quiet for 90 days are deleted with their messages", async () => {
    const u = await mkUser("old");
    const id = await seed(u.id);
    await db.pipConversation.update({ where: { id }, data: { updatedAt: new Date(Date.now() - 91 * 864e5) } });
    const r = await pruneOldData();
    expect(r.pipChats).toBeGreaterThanOrEqual(1);
    expect(await db.pipConversation.count({ where: { id } })).toBe(0);
    expect(await db.pipMessage.count({ where: { conversationId: id } })).toBe(0);
  });
  test("R1311: the server no longer emails chats at all (no sendEmail import in conversations.ts)", () => {
    const src = readFileSync("lib/support/conversations.ts", "utf8");
    expect(src).not.toContain("sendEmail");
    expect(src).not.toContain("pipTranscript");
  });
  test("the privacy page mentions Pip conversations and their 90 days", () => {
    const p = readFileSync("app/(marketing)/privacy/page.tsx", "utf8");
    expect(p).toContain("Pip conversations are deleted after 90 days");
    expect(p).toContain("is never emailed");
    expect(p).not.toContain("email its transcript");
    expect(p).not.toContain("kept in this browser tab only");
  });
});

describe("chat widget", () => {
  const src = readFileSync("components/support/ChatWidget.tsx", "utf8");
  test("labels match the brief", () => {
    // R1311: Resolve Chat marks the conversation resolved and keeps its history; no transcript is emailed or mentioned.
    expect(PIP_RESOLVE.en).toMatchObject({ reply: "Glad I could help!", resolve: "Resolve Chat", keep: "Continue Chat", doneTitle: "Conversation resolved!", reopen: "Reopen Conversation" });
    expect(PIP_RESOLVE.en.doneBody("")).toContain("history stays saved");
    expect(PIP_RESOLVE.en.doneBody("")).not.toMatch(/transcript|email/i);
  });
  test("resolved locks the composer and shows the resolved panel", () => {
    expect(src).toContain("disabled={!!resolved}");
    expect(src).toContain("busy || !!resolved");
    expect(src).toContain('className="pc-resolved pc-in');
    expect(src).toContain("rt.doneBody(resolved.to)");
    expect(src).toContain("onClick={reopenNow}");
    expect(src).toContain("pc-badge-resolved");
  });
  test("one send at a time, honest errors", () => {
    expect(src).toContain("if (closingRef.current || !conv) return;");
    expect(src).toContain("disabled={closing.busy}");
    expect(src).toMatch(/role="alert" className="pc-error mt-2 text-\[13px\]">\{closing\.error\}/);
    // Success is only shown after the server says so.
    const at = src.indexOf("async function resolveNow");
    expect(src.indexOf("if (!r.ok || !j.ok) throw", at)).toBeLessThan(src.indexOf("setResolved({ to: \"\" });", at));
    // A conversation that is gone is not offered as an endless retry.
    expect(src).toMatch(/if \(r\.status === 404\) \{\s+setConv\(null\);/);
  });
  test("nothing else can send while resolved, and focus lands on Reopen", () => {
    expect(src).toContain("{waitingEmail && !signedIn && !resolved && (");
    // R1189: the welcome questions go through pick(), which refuses while resolved like send() does.
    expect(src).toContain("disabled={busy || !!resolved} onClick={() => pick(tp.id, q, i)}");
    expect(src).toMatch(/function pick\([^)]*\) \{\s+if \(busy \|\| resolved\) return;/);
    expect(src).toContain("[busy, resolved, conv, msgs,");
    expect(src).toContain("reopenRef.current?.focus()");
    // "Did that help? Yes" offers to resolve in a saved chat, instead of a dead-end line. 1151: only while not
    // resolved (the early return) and only when the transcript can really be emailed.
    expect(src).toContain("if (good && resolved) return;");
    expect(src).toMatch(/if \(good && signedIn && conv\) \{[\s\S]{0,200}kind: "resolve", offer: true/);
    expect(src).toContain("ref={reopenRef}");
  });
});
