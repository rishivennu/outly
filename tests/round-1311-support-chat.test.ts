/**
 * Round 1311: the support chat, finished.
 * - After the greeting the app lands on Home: a bare /create entry goes to the dashboard, deep links stay.
 * - Resolve chat marks the conversation resolved on the server (history kept, no email); End chat ends a live
 *   session first, then resolves; both ask first with the brief's exact words; both are idempotent.
 * - Send Transcript is gone from the widget, the strings and the help centre list.
 * - One-line live status "Connected to Support · Sam joined · End chat"; typing dots follow the server's state.
 * - Pip moves: float, hello on open, think while the specialist types, one cheer when resolved; off under reduced motion.
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
const conv = await import("../lib/support/conversations");
const { POST: convPOST, GET: convGET } = await import("../app/api/support/conversation/route");
const { PIP_RESOLVE } = await import("../lib/i18n/support");
const { LIVE_EN, liveT } = await import("../lib/i18n/live");
const { welcomeLandsHome } = await import("../lib/pwa-welcome");

const users: string[] = [];
const mkUser = async (tag: string) => {
  const email = `pip1311-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  const u = await db.user.create({ data: { name: `Pip ${tag}`, email, passwordHash: "x" } });
  users.push(u.id);
  return u;
};
// Its own address: the conversation route allows 20 calls a minute per IP, and other files in the run use the default one.
const H = { "content-type": "application/json", origin: "http://localhost", host: "localhost", "x-forwarded-for": "10.131.1.1" };
const post = (path: string, body: unknown) => convPOST(new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: H }), { params: {} } as never);
const get = (path: string) => convGET(new NextRequest(`http://localhost${path}`, { headers: H }), { params: {} } as never);
const act = (action: string, conversationId: string) => post("/api/support/conversation", { action, conversationId });
const signIn = async (id: string) => { jar.clear(); await createSession(id); };
async function seed(userId: string) {
  let c: { id: string } | null = null;
  let t = Date.now() - 60_000;
  for (const [q, a] of [["How do I schedule a post?", "Open **Create**, pick a time, then tap Schedule."], ["My issue is resolved", "Glad I could help!"]]) {
    const id = await conv.recordTurn({ userId, conversation: c, question: q, answer: a, askedAt: new Date((t += 1000)), answeredAt: new Date(t + 500) });
    c = { id };
  }
  return c!.id;
}

beforeEach(() => jar.clear());
afterAll(async () => {
  jar.clear();
  await db.user.deleteMany({ where: { id: { in: users } } });
});

const widget = readFileSync("components/support/ChatWidget.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

describe("1 greeting lands on Home", () => {
  test("a bare /create entry goes Home after Let's go; deep links and other pages stay", () => {
    expect(welcomeLandsHome("/create")).toBe(true);
    expect(welcomeLandsHome("/create/bulk", "")).toBe(true);
    expect(welcomeLandsHome("/create", "?local=abc123")).toBe(true); // the autosave's own address, not a deep link
    expect(welcomeLandsHome("/create", "?post=abc")).toBe(false);
    expect(welcomeLandsHome("/create", "?local=x&post=abc")).toBe(false);
    expect(welcomeLandsHome("/create", "?idea=1")).toBe(false);
    expect(welcomeLandsHome("/home")).toBe(false);
    expect(welcomeLandsHome("/calendar")).toBe(false);
  });
  test("the welcome's primary action uses it; Skip still goes Home", () => {
    const w = readFileSync("components/shell/PwaWelcome.tsx", "utf8");
    expect(w).toContain('if (how === "start" && welcomeLandsHome(location.pathname, location.search)) router.push("/home");');
    expect(w).toContain('if (how === "skip" && location.pathname !== "/home") router.push("/home");');
    expect(w).not.toMatch(/router\.push\("\/create/);
  });
  test("the PWA opens on Home", () => {
    expect(readFileSync("app/manifest.ts", "utf8")).toContain('start_url: "/home?source=pwa"');
  });
});

describe("2 Resolve chat and End chat on the server", () => {
  test("close marks it resolved, keeps every message, and is idempotent", async () => {
    const u = await mkUser("close");
    await signIn(u.id);
    const id = await seed(u.id);
    const before = await db.pipMessage.count({ where: { conversationId: id } });
    const r = await act("close", id);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, status: "resolved", already: false });
    const c = await db.pipConversation.findUniqueOrThrow({ where: { id } });
    expect(c.status).toBe("resolved");
    expect(c.resolvedAt).not.toBeNull();
    expect(c.sentAt).toBeNull(); // nothing emailed
    expect(await db.pipMessage.count({ where: { conversationId: id } })).toBe(before);
    expect(await db.emailLog.count({ where: { to: u.email } })).toBe(0);
    const again = await (await act("close", id)).json();
    expect(again).toEqual({ ok: true, status: "resolved", already: true });
    // Reopen takes it back, and a second close works again.
    expect((await act("reopen", id)).status).toBe(200);
    expect((await db.pipConversation.findUniqueOrThrow({ where: { id } })).status).toBe("open");
    expect((await (await act("close", id)).json()).already).toBe(false);
  });
  test("someone else's conversation is not found; a live chat must be ended first", async () => {
    const owner = await mkUser("owner");
    const id = await seed(owner.id);
    const other = await mkUser("other");
    await signIn(other.id);
    expect((await act("close", id)).status).toBe(404);
    await signIn(owner.id);
    await db.pipConversation.update({ where: { id }, data: { mode: "human" } });
    const r = await act("close", id);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe(conv.LIVE_OPEN_CLOSE_TEXT);
    expect((await db.pipConversation.findUniqueOrThrow({ where: { id } })).status).toBe("open");
  });
  test("the list no longer reports transcript availability", async () => {
    const u = await mkUser("list");
    await signIn(u.id);
    await seed(u.id);
    const j = await (await get("/api/support/conversation")).json();
    expect(j.transcript).toBeUndefined();
    expect(j.items.length).toBe(1);
  });
  test("the widget resolves and ends through the server, in order", () => {
    expect(widget).toContain('JSON.stringify({ action: "close", conversationId: conv })');
    expect(widget).toMatch(/async function endNow\(\)[\s\S]*action: "cancel"[\s\S]*action: "close"[\s\S]*resetChat\(\);/);
    const at = widget.indexOf("async function resolveNow");
    expect(widget.indexOf("if (!r.ok || !j.ok) throw", at)).toBeLessThan(widget.indexOf('setResolved({ to: "" });', at));
    expect(widget).not.toContain('action: "resolve"');
  });
});

describe("3 Send Transcript is gone", () => {
  test("no transcript wording in the widget, the strings or the help centre list", () => {
    for (const f of ["components/support/ChatWidget.tsx", "components/support/PipConversations.tsx", "lib/i18n/support.ts"]) {
      const s = readFileSync(f, "utf8");
      expect({ f, hit: /Send Transcript|Sending transcript|transcript sent to|ट्रांसक्रिप्ट/.test(s) }).toEqual({ f, hit: false });
    }
    expect(widget).not.toContain("transcriptOk");
    for (const l of Object.values(PIP_RESOLVE)) {
      expect(l.resolve).not.toMatch(/transcript/i);
      expect(l.doneBody("x@y.z")).not.toContain("x@y.z");
      expect(l.announce).not.toMatch(/transcript|email/i);
    }
  });
  test("the brief's dialog words", () => {
    expect(PIP_RESOLVE.en).toMatchObject({
      resolve: "Resolve Chat", keep: "Continue Chat", end: "End Chat",
      confirmTitle: "Resolve this conversation?", confirmBody: "Are you sure your issue has been resolved?",
      endTitle: "End this conversation?", endBody: "Are you sure you want to end your current support conversation?",
    });
    expect(widget).toMatch(/role="alertdialog" aria-modal="true" aria-labelledby="pc-cf-title" aria-describedby="pc-cf-body"/);
    expect(widget).toContain('{confirm === "resolve" ? rt.confirmTitle : rt.endTitle}');
    expect(widget).toContain('onClick={confirm === "resolve" ? resolveNow : endNow}');
    // Both buttons open the confirmation; neither acts at once.
    expect(widget).toContain('onClick={() => setConfirm("resolve")}');
    expect(widget).toContain('onClick={() => setConfirm("end")}');
    expect(widget).not.toContain("onClick={resolveNow}");
    // Escape closes the confirmation first, and Tab stays inside it.
    expect(widget).toContain("if (confirmRef.current) { if (!closingRef.current) setConfirm(null); return; }");
    expect(widget).toContain("const root = cfBoxRef.current ?? sheetRef.current;");
  });
});

describe("4 one-line live status and real typing", () => {
  test("Connected to Support · Sam joined · End chat, with a green dot", () => {
    expect(LIVE_EN.connectedTo).toBe("Connected to Support");
    expect(LIVE_EN.joined("Sam")).toBe("Sam joined");
    expect(LIVE_EN.endChat).toBe("End chat");
    expect(liveT("hi").connectedTo).toBe("Connected to Support"); // falls back to English until translated
    const line = widget.slice(widget.indexOf('className="pc-status'), widget.indexOf("</span>\n                ) : signedIn"));
    expect(line).toContain("lt.connectedTo");
    expect(line).toContain("lt.joined(liveInfo.agent)");
    expect(line).toContain("lt.endChat");
    expect(line).toContain("lt.disconnected");
    expect(line.match(/pc-sep/g)?.length).toBe(2);
    expect(line).toContain('live === "connected" ? "pc-dot-ok" : live === "reconnecting" ? "pc-dot-off" : "pc-pulse"');
    expect(css).toMatch(/\.pc-dot\.pc-dot-ok \{ background: var\(--pc-ok\)/);
    expect(css).toContain(".pc-status { white-space: nowrap; }");
    // No second End chat on a card while connected.
    expect(widget).toContain('{liveOn && live !== "connected" && (');
    expect(widget.match(/lt\.endChat/g)?.length).toBe(1);
  });
  test("the dots show while the specialist types and go the moment their words arrive", () => {
    expect(widget).toContain('typing: incoming.some((m) => m.role === "agent" && !known.has(m.id)) ? null : typeof j.typing === "string" ? j.typing : null,');
    expect(widget).toContain('{!busy && live === "connected" && liveInfo.typing && (');
    expect(widget).toMatch(/\{\[0, 1, 2\]\.map\(\(i\) => <span key=\{i\} className="pc-typing h-2 w-2 rounded-full" style=\{\{ animationDelay: `\$\{i \* 140\}ms` \}\} aria-hidden \/>\)\}/);
    expect(css).toContain("@keyframes pc-typing");
    // The server clears the flag when the specialist sends.
    expect(readFileSync("lib/support/live.ts", "utf8")).toMatch(/lastMessageAt: now, agentTypingAt: null/);
  });
});

describe("5 Pip in motion", () => {
  test("float, hello, think while typing, cheer when resolved; nothing under reduced motion", () => {
    expect(widget).toContain('const mood: PipMood = hello ? "wave"');
    expect(widget).toContain('(liveInfo.typing ? "think" : "happy")');
    expect(widget).toContain('className={cn("pc-pip", hello && "pc-pip-hello", cheer && "pc-pip-cheer", pageHidden && "pc-pip-paused")}');
    expect(widget).toContain('className={cn("pc-pip pc-pip-idle", pageHidden && "pc-pip-paused")}');
    // Paused while the tab is in the background: no animation work for a page nobody sees.
    expect(widget).toContain('document.addEventListener("visibilitychange", sync)');
    expect(css).toContain(".pc-pip.pc-pip-paused { animation-play-state: paused; }");
    for (const k of ["@keyframes pc-float", "@keyframes pc-hello", "@keyframes pc-cheer", ".pc-head .pc-pip { animation: pc-float"]) expect(css).toContain(k);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s+\.pc-pip, \.pc-pip-idle, \.pc-head \.pc-pip, \.pc-head \.pc-pip-hello, \.pc-head \.pc-pip-cheer \{ animation: none; \}/);
    // Pip's own art and colours are untouched.
    expect(readFileSync("components/brand/Pip.tsx", "utf8")).toContain("pip-body");
  });
});
