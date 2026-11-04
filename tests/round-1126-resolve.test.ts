/**
 * Round 1126: Resolve Conversation in Pip.
 * - Resolution intent: clear "I'm done" phrases offer to resolve; a bare "thanks", or thanks plus a new question, never does.
 * - The chat route records a signed-in person's conversation and offers the resolve (visitors never are).
 * - Resolve & Send Transcript: verified email only, owner only, one email per resolve, honest failure, retry works.
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
const { isResolutionIntent, wantsToResolve } = await import("../lib/support/resolve");
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

describe("resolve & send transcript", () => {
  test("sends to the verified account email, marks resolved, and formats the transcript", async () => {
    const u = await mkUser("send");
    const id = await seed(u.id, [["How do I add <script>alert(1)</script> captions?", "Open **Create** and tap Captions."], ["This solved my problem", "Glad I could help!"]]);
    await signIn(u.id);
    const r = await act("resolve", id);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, status: "resolved", to: u.email, already: false });
    const c = await db.pipConversation.findUnique({ where: { id } });
    expect(c?.status).toBe("resolved");
    expect(c?.sentTo).toBe(u.email);
    expect(c?.sendingAt).toBeNull();
    const logs = await db.emailLog.findMany({ where: { to: u.email, kind: "pip_transcript" } });
    expect(logs.length).toBe(1);
    expect(logs[0].subject).toBe("Your Outlly Support Conversation \u2013 Transcript");
    const html = logs[0].html; // the mock outbox keeps the body outside production
    expect(html).toContain(c!.ref);
    expect(html).toContain("Conversation ID");
    expect(html).toContain("How do I add");
    expect(html).toMatch(/>You</);
    expect(html).toMatch(/>Pip</);
    expect(html).toMatch(/\d{1,2}:\d{2}/); // timestamps
    expect(html).toContain("<b>Create</b>");
    expect(html.indexOf("How do I add")).toBeLessThan(html.indexOf("Open <b>Create</b>"));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
  test("an unverified address gets nothing, and the chat stays open", async () => {
    const u = await mkUser("unverified", false);
    const id = await seed(u.id);
    await signIn(u.id);
    const r = await act("resolve", id);
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("UNVERIFIED");
    expect((await db.pipConversation.findUnique({ where: { id } }))?.status).toBe("open");
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
  test("double taps send one email", async () => {
    const u = await mkUser("dupe");
    const id = await seed(u.id);
    await signIn(u.id);
    const rs = await Promise.all([act("resolve", id), act("resolve", id), act("resolve", id)]);
    for (const r of rs) expect([200, 409]).toContain(r.status);
    expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(await db.emailLog.count({ where: { to: u.email, kind: "pip_transcript" } })).toBe(1);
    const again = await (await act("resolve", id)).json();
    expect(again).toMatchObject({ ok: true, already: true });
    expect(await db.emailLog.count({ where: { to: u.email, kind: "pip_transcript" } })).toBe(1);
  });
  test("a failed email is reported as a failure; nothing is lost and a retry works", async () => {
    const u = await mkUser("fail");
    const id = await seed(u.id);
    await signIn(u.id);
    const cache = (globalThis as unknown as { __cfg: Map<string, { at: number; v: unknown }> }).__cfg;
    const base = await getConfig("email");
    cache.set("email", { at: Date.now() + 3600_000, v: { ...base, provider: "resend", resend: { ...(base as { resend: object }).resend, apiKey: "" } } });
    try {
      const r = await act("resolve", id);
      expect(r.status).toBe(502);
      const j = await r.json();
      expect(j.code).toBe("SEND_FAILED");
      expect(j.error).toContain("still open");
    } finally {
      cache.delete("email");
    }
    const c = await db.pipConversation.findUnique({ where: { id } });
    expect(c?.status).toBe("open");
    expect(c?.sentAt).toBeNull();
    expect(c?.sendingAt).toBeNull();
    expect(await db.pipMessage.count({ where: { conversationId: id } })).toBe(4);
    expect(await db.emailLog.count({ where: { to: u.email, status: "failed" } })).toBe(1);
    const retry = await act("resolve", id);
    expect(retry.status).toBe(200);
    expect((await db.pipConversation.findUnique({ where: { id } }))?.status).toBe("resolved");
  });
  test("sent but not saved: reported as sent, and a retry never sends a second copy", async () => {
    const u = await mkUser("blip");
    const id = await seed(u.id);
    await signIn(u.id);
    const delegate = db.pipConversation as unknown as { update: (...a: unknown[]) => Promise<unknown> };
    const real = delegate.update;
    delegate.update = () => Promise.reject(new Error("db blip"));
    try {
      const r = await act("resolve", id);
      expect(r.status).toBe(200);
      expect((await r.json()).ok).toBe(true);
      const retry = await act("resolve", id);
      expect(retry.status).toBe(409); // the claim is kept, so the retry waits
    } finally {
      delegate.update = real;
    }
    expect(await db.emailLog.count({ where: { to: u.email, kind: "pip_transcript" } })).toBe(1);
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
    // Resolving again sends a fresh transcript.
    expect((await (await act("resolve", id)).json()).already).toBe(false);
    expect(await db.emailLog.count({ where: { to: u.email, kind: "pip_transcript" } })).toBe(2);
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
  test("a sent transcript keeps no copy of the chat in the email log in production", () => {
    const src = readFileSync("lib/email/index.ts", "utf8");
    expect(src).toContain('m.private ? ""');
    expect(readFileSync("lib/support/conversations.ts", "utf8")).toContain("private: true");
  });
  test("the privacy page mentions Pip conversations and their 90 days", () => {
    const p = readFileSync("app/(marketing)/privacy/page.tsx", "utf8");
    expect(p).toContain("Pip conversations are deleted after 90 days");
    expect(p).toContain("verified email address only");
    expect(p).not.toContain("kept in this browser tab only");
  });
});

describe("chat widget", () => {
  const src = readFileSync("components/support/ChatWidget.tsx", "utf8");
  test("labels match the brief", () => {
    expect(PIP_RESOLVE.en).toMatchObject({ reply: "Glad I could help!", resolve: "Resolve & Send Transcript", keep: "Continue Chat", doneTitle: "Conversation resolved!", reopen: "Reopen Conversation" });
    expect(PIP_RESOLVE.en.doneBody("")).toContain("your registered email address");
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
    expect(src.indexOf("if (!r.ok || !j.ok) throw")).toBeLessThan(src.indexOf("setResolved({ to: typeof j.to"));
    // A conversation that is gone is not offered as an endless retry.
    expect(src).toMatch(/if \(r\.status === 404\) \{\s+setConv\(null\);/);
  });
  test("nothing else can send while resolved, and focus lands on Reopen", () => {
    expect(src).toContain("{waitingEmail && !resolved && (");
    expect(src.match(/disabled=\{busy \|\| !!resolved\} onClick=\{\(\) => send\(s\)\}/g)?.length).toBe(2);
    expect(src).toContain("[busy, resolved, conv, msgs,");
    expect(src).toContain("reopenRef.current?.focus()");
    expect(src).toContain("ref={reopenRef}");
  });
});
