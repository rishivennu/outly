/**
 * Round 1151: Pip tells the truth about analytics, sync, transcripts and past chats.
 * The 13 scenarios of the brief, against the real code (and the real test database where it matters):
 *  1-5  comparisons: both complete, Instagram missing, YouTube missing, both missing, disconnected accounts
 *  6    sync older than 30 minutes is labelled cached; a sync whose reads all failed never counts as a success
 *  7-8  Refresh data: success only when fresh data came back; failures say so per account
 *  9-11 transcript: offered and sent when available, an honest failure, never offered when unavailable
 *  12   "where are my old chats?" gets the real place in the studio, and the list/reopen API works
 *  13   conversation states: open, pending, resolved; nothing reopens on its own
 * Plus the phone notification format (handle first) and the admin analytics helpers from this round.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
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
const { getConfig } = await import("../lib/settings");
const { encrypt } = await import("../lib/crypto");
const { compareVerdict, HISTORICAL_RE } = await import("../lib/pip/compare-core");
const { verdict, refreshData } = await import("../lib/analytics/refresh");
const sync = await import("../lib/analytics/sync");
const keys = await import("../lib/social/keys");
const { addFreshness } = await import("../lib/pip/tools-analytics");
const { base } = await import("../lib/pip/tools-core");
const { plainSummary } = await import("../lib/pip/run");
const conv = await import("../lib/support/conversations");
const { asksForPastChats, asksForTranscript } = await import("../lib/support/resolve");
const { POST: chatPOST } = await import("../app/api/support/chat/route");
const { GET: convGET, POST: convPOST } = await import("../app/api/support/conversation/route");
const { commentNotice, messageNotice } = await import("../lib/notify-events");
const { parseAnalyticsSource, perDay, countryName } = await import("../lib/analytics/outlly-core");

type PD = Parameters<typeof compareVerdict>[0][number];
const ig = (o: Partial<PD> = {}): PD => ({ platform: "instagram", name: "Instagram", accounts: [{ username: "me", status: "connected" }], live: "ok", followers: 1200, postsWithMetrics: 3, ...o });
const yt = (o: Partial<PD> = {}): PD => ({ platform: "youtube", name: "YouTube", accounts: [{ username: "me", status: "connected" }], live: "ok", followers: 800, postsWithMetrics: 2, ...o });
const NAMED = { historical: false, named: true };

const users: string[] = [];
let n = 0;
const mkUser = async (tag: string, verified = true) => {
  const email = `pip1151-${tag}-${Date.now()}-${++n}@test.dev`;
  const u = await db.user.create({ data: { name: `Pip ${tag}`, email, passwordHash: "x", ...(verified ? { emailVerifiedAt: new Date(), emailVerifiedFor: email } : {}) } });
  users.push(u.id);
  return u;
};
const mkAcct = (userId: string, platform: string, status = "connected") =>
  db.socialAccount.create({ data: { userId, platform, platformUserId: `real-${platform}-${Date.now()}-${++n}`, username: `me${n}`, accessToken: encrypt("tok"), status } });
const H = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };
const post = (h: typeof chatPOST, path: string, body: unknown) => h(new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: H }), { params: {} } as never);
const get = (path: string) => convGET(new NextRequest(`http://localhost${path}`, { method: "GET", headers: H }), { params: {} } as never);
const HISTORY = [{ role: "user", text: "how do I schedule a post?" }, { role: "bot", text: "Open Create, pick a time, then Schedule." }];
const chat = (message: string, extra: Record<string, unknown> = {}) => post(chatPOST, "/api/support/chat", { message, history: HISTORY, ...extra });
const signIn = async (id: string) => { jar.clear(); await createSession(id); };
const cfgCache = () => (globalThis as unknown as { __cfg: Map<string, { at: number; v: unknown }> }).__cfg;

const realFetch = globalThis.fetch;
beforeEach(() => jar.clear());
afterEach(() => { globalThis.fetch = realFetch; keys.__setKeys(undefined); });
afterAll(async () => {
  jar.clear();
  cfgCache()?.delete("email");
  await db.user.deleteMany({ where: { id: { in: users } } });
});

describe("1-5 comparing Instagram and YouTube", () => {
  test("1 both complete: compared on the numbers both returned, no caveat", () => {
    const v = compareVerdict([ig(), yt()], NAMED);
    expect(v.ok).toBe(true);
    expect(v.compared).toEqual(["instagram", "youtube"]);
    expect(v.metrics).toEqual({ followers: true, posts: true });
    expect(v.lead).toBeNull();
  });
  test("2 Instagram unavailable: no comparison, and the answer opens with exactly why", () => {
    const v = compareVerdict([ig({ live: "failed", followers: null, postsWithMetrics: 0 }), yt()], NAMED);
    expect(v.ok).toBe(false);
    expect(v.compared).toEqual([]);
    expect(v.lead).toBe("I couldn't complete this comparison because Instagram did not return its latest account insights. YouTube data is available, but I need fresh Instagram data to provide an accurate comparison.");
  });
  test("3 YouTube unavailable: the same, the other way round", () => {
    const v = compareVerdict([ig(), yt({ live: "failed", followers: null, postsWithMetrics: 0 })], NAMED);
    expect(v.ok).toBe(false);
    expect(v.lead).toContain("because YouTube did not return its latest account insights. Instagram data is available");
  });
  test("4 both incomplete: says neither came back, picks no winner", () => {
    const v = compareVerdict([ig({ live: "failed", followers: null, postsWithMetrics: 0 }), yt({ live: "failed", followers: null, postsWithMetrics: 0 })], NAMED);
    expect(v.ok).toBe(false);
    expect(v.lead).toContain("neither Instagram nor YouTube returned its latest data");
    expect(v.lead).not.toMatch(/\b(better|ahead|won|winner|outperform)/i);
  });
  test("only some numbers came back: only those are compared, and it says which were left out", () => {
    const v = compareVerdict([ig({ live: "failed", followers: null }), yt()], NAMED);
    expect(v.ok).toBe(true);
    expect(v.metrics).toEqual({ followers: false, posts: true });
    expect(v.noInsights).toEqual(["instagram"]);
    expect(v.lead).toContain("This compares only posts published through Outlly");
  });
  test("5 disconnected account: named with its status, left out of a current comparison, history on request", () => {
    const off = ig({ accounts: [{ username: "me", status: "disconnected" }], live: "none", followers: null });
    const v = compareVerdict([off, yt()], NAMED);
    expect(v.ok).toBe(false);
    expect(v.left).toEqual([{ platform: "instagram", status: "disconnected" }]);
    expect(v.lead).toContain("Instagram is disconnected, so its numbers aren't current");
    expect(v.lead).toContain("history is kept");
    const re = compareVerdict([ig({ accounts: [{ username: "me", status: "needs_reconnect" }] }), yt()], NAMED);
    expect(re.lead).toContain("Instagram needs reconnecting");
    // Asked for history: its stored posts are compared, followers (live only) are not.
    const h = compareVerdict([{ ...off }, yt()], { historical: true, named: true });
    expect(h.ok).toBe(true);
    expect(h.compared).toEqual(["instagram", "youtube"]);
    expect(h.metrics.followers).toBe(false);
    expect(HISTORICAL_RE.test("compare my instagram and youtube history")).toBe(true);
    expect(HISTORICAL_RE.test("compare instagram and youtube")).toBe(false);
  });
  test("the summary always opens with the required sentence, word for word", () => {
    const r = base("compare_platforms", "Instagram vs YouTube", null, [], "x", null);
    r.lead = "I couldn't complete this comparison because Instagram did not return its latest account insights.";
    r.facts = [r.lead];
    expect(plainSummary(r)).toBe(r.lead);
    r.rows = [{ id: "a", cells: {} }];
    r.facts = [r.lead, "YouTube had 2 posts with numbers."];
    expect(plainSummary(r).startsWith(r.lead)).toBe(true);
    expect(plainSummary(r)).toContain("YouTube had 2 posts");
  });
});

describe("6 sync freshness", () => {
  test("a post is due again after 30 minutes in its first two days, later only every few hours", () => {
    const now = Date.now();
    expect(sync.staleAfter(now - 3600_000, now)).toBe(sync.HOT_STALE_MS);
    expect(sync.staleAfter(now - 5 * 864e5, now)).toBeGreaterThan(sync.HOT_STALE_MS);
    expect(sync.isDue(now - 31 * 60_000, now - 3600_000, now)).toBe(true);
    expect(sync.isDue(now - 10 * 60_000, now - 3600_000, now)).toBe(false);
    expect(sync.isDue(now - 31 * 60_000, now - 5 * 864e5, now)).toBe(false);
    expect(sync.isDue(now - 31 * 60_000, now - 5 * 864e5, now, true)).toBe(true);
  });
  test("numbers from a sync over 30 minutes old are labelled cached, with the real time, plus a Reconnect for a disconnected one", async () => {
    const u = await mkUser("stale");
    const a = await mkAcct(u.id, "instagram");
    await mkAcct(u.id, "youtube", "disconnected");
    const at = new Date(Date.now() - 2 * 3600_000);
    await db.accountSyncState.create({ data: { accountId: a.id, lastSyncAt: at, lastTriedAt: new Date(), lastError: "FETCH_FAILED" } });
    const r = base("overview", "Overview", null, [], "x", null);
    await addFreshness({ ownerId: u.id, actorId: null, scope: null, tz: "Asia/Kolkata", now: new Date(), message: "how am I doing" }, r, null);
    expect(r.sync?.stale).toBe(true);
    expect(r.sync?.at).toBe(at.toISOString());
    expect(r.sync?.accounts[0]).toMatchObject({ platform: "instagram", stale: true, lastSuccessAt: at.toISOString() });
    expect(r.notes.some((x) => x.level === "warn" && /cached, not live/.test(x.text) && /the last attempts to read it failed/.test(x.text))).toBe(true);
    expect(r.downloads.some((d) => d.href.startsWith("/api/accounts/youtube/connect"))).toBe(true);
    expect(r.sources?.some((s) => s.startsWith("Last successful sync:"))).toBe(true);
  });
  test("a fresh sync is not called cached", async () => {
    const u = await mkUser("fresh");
    const a = await mkAcct(u.id, "instagram");
    await db.accountSyncState.create({ data: { accountId: a.id, lastSyncAt: new Date(Date.now() - 5 * 60_000) } });
    const r = base("overview", "Overview", null, [], "x", null);
    await addFreshness({ ownerId: u.id, actorId: null, scope: null, tz: "UTC", now: new Date(), message: "x" }, r, null);
    expect(r.sync?.accounts[0].stale).toBe(false);
    expect(r.notes.some((x) => /cached/.test(x.text))).toBe(false);
  });
  test("a sync where every read failed is recorded as a failure and never moves the last success", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await mkUser("syncfail");
    const a = await mkAcct(u.id, "instagram");
    const media = await db.media.create({ data: { userId: u.id, storageKey: `sample/${n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
    const p = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published", title: "Clip" } });
    await db.postTarget.create({ data: { postId: p.id, platform: "instagram", socialAccountId: a.id, platformStatus: "published", platformPostId: `pp-${n}`, publishedAt: new Date(Date.now() - 3600_000) } });
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const rep = await sync.syncMetrics({ accountIds: [a.id] });
    expect(rep.synced).toBe(0);
    expect(rep.outcomes[0]).toMatchObject({ accountId: a.id, ok: false, code: "FETCH_FAILED" });
    const times = await sync.syncTimes([a.id]);
    expect(times[a.id].lastSyncAt).toBeNull();
    expect(times[a.id].lastError).toBe("FETCH_FAILED");
  });
});

describe("7-8 Refresh data", () => {
  const now = new Date();
  const ok = { accountId: "a", ok: true, code: "SYNCED", synced: 2, failed: 0 } as const;
  test("7 success only when both the live read and the post numbers came back", () => {
    expect(verdict({ syncable: true, outcome: ok as never, cooldownUntil: null, liveOk: true, reconnect: false, now })).toMatchObject({ ok: true, code: "FRESH" });
    expect(verdict({ syncable: false, outcome: null, cooldownUntil: null, liveOk: true, reconnect: false, now })).toMatchObject({ ok: true, code: "FRESH" });
  });
  test("8 failures are named, never shown as success", () => {
    expect(verdict({ syncable: true, outcome: { ...ok, ok: false, code: "FETCH_FAILED", synced: 0 } as never, cooldownUntil: null, liveOk: false, reconnect: false, now })).toMatchObject({ ok: false, code: "FAILED" });
    expect(verdict({ syncable: true, outcome: { ...ok, ok: false, code: "RATE_LIMITED", synced: 0 } as never, cooldownUntil: null, liveOk: false, reconnect: false, now })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(verdict({ syncable: true, outcome: null, cooldownUntil: null, liveOk: true, reconnect: true, now })).toMatchObject({ ok: false, code: "NEEDS_RECONNECT" });
    expect(verdict({ syncable: true, outcome: { ...ok, ok: false, code: "FETCH_FAILED", synced: 0 } as never, cooldownUntil: null, liveOk: true, reconnect: false, now })).toMatchObject({ ok: false, code: "PARTIAL" });
    expect(verdict({ syncable: true, outcome: { ...ok, ok: false, code: "AUTH_EXPIRED", synced: 0 } as never, cooldownUntil: null, liveOk: false, reconnect: false, now })).toMatchObject({ ok: false, code: "NEEDS_RECONNECT" });
  });
  test("8 nothing to refresh: says so, ok is false", async () => {
    const u = await mkUser("noacct");
    const r = await refreshData({ ownerId: u.id, scope: null });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("no connected account");
  });
  test("8 every platform failing: ok is false and each account says what happened", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await mkUser("refail");
    const a = await mkAcct(u.id, "instagram");
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const r = await refreshData({ ownerId: u.id, scope: null });
    expect(r.ok).toBe(false);
    const it = r.items.find((x) => x.accountId === a.id)!;
    expect(it.ok).toBe(false);
    expect(it.message.length).toBeGreaterThan(10);
  });
  test("the card only shows success when the server said ok, and offers Try again otherwise", () => {
    const src = readFileSync("components/support/PipDataCard.tsx", "utf8");
    expect(src).toContain('const ok = res.ok && j.ok === true;');
    expect(src).toContain('"Try again"');
    expect(src).toContain("if (ok) onRefreshed?.();");
    expect(src).toContain("Cached · synced");
  });
});

describe("9-11 transcript email", () => {
  test("9 enabled: a verified person is offered Resolve & Send Transcript, also when they ask for the transcript", async () => {
    const u = await mkUser("tok");
    await signIn(u.id);
    expect(await conv.transcriptAvailable(u.id)).toEqual({ available: true, reason: "OK" });
    const j = await (await chat("My issue is resolved")).json();
    expect(j.resolve).toBe(true);
    const k = await (await chat("can you email me the transcript?", { conversationId: j.conversationId })).json();
    expect(k.resolve).toBe(true);
    expect(k.answer).not.toMatch(/can'?t|unable|not available/i);
  });
  test("10 a failed send leaves it open (covered end to end in round-1126), and the offer text never contradicts itself", () => {
    expect(conv.transcriptUnavailableText("UNVERIFIED")).toContain("isn't verified");
    expect(conv.transcriptUnavailableText("EMAIL_OFF")).toContain("isn't available right now");
  });
  test("11 disabled: no offer, one plain reason, for an unverified address and for email switched off", async () => {
    const un = await mkUser("unv", false);
    await signIn(un.id);
    const j = await (await chat("My issue is resolved")).json();
    expect(j.resolve).toBe(false);
    expect(j.answer).toContain("isn't verified");
    const u = await mkUser("off");
    await signIn(u.id);
    const base0 = await getConfig("email");
    cfgCache().set("email", { at: Date.now() + 3600_000, v: { ...base0, provider: "resend", resend: { ...(base0 as { resend: object }).resend, apiKey: "" } } });
    try {
      expect((await conv.transcriptAvailable(u.id)).reason).toBe("EMAIL_OFF");
      const k = await (await chat("please send me a transcript of this chat")).json();
      expect(k.resolve).toBe(false);
      expect(k.answer).toContain("Emailing transcripts isn't available right now");
      const g = await (await get("/api/support/conversation")).json();
      expect(g.transcript).toEqual({ available: false, reason: "EMAIL_OFF" });
    } finally {
      cfgCache().delete("email");
    }
  });
  test("the widget asks the server before offering it from Did that help? Yes", () => {
    const src = readFileSync("components/support/ChatWidget.tsx", "utf8");
    expect(src).toContain("setTranscriptOk(!!j?.transcript?.available)");
    expect(src).toContain("if (good && signedIn && conv && transcriptOk) {");
  });
  test("transcript intent", () => {
    for (const s of ["email me the transcript", "can I get a transcript?", "send me a copy of this chat", "mail this conversation to me"]) expect({ s, y: asksForTranscript(s) }).toEqual({ s, y: true });
    for (const s of ["how do I add captions", "don't send the transcript", "how do I schedule"]) expect({ s, y: asksForTranscript(s) }).toEqual({ s, y: false });
  });
});

describe("12 past conversations", () => {
  test("the question gets the real path and link, never a 'Chat History' section", async () => {
    for (const s of ["where can I find my previous conversations?", "show my chat history", "how do I see old chats with Pip"]) expect({ s, y: asksForPastChats(s) }).toEqual({ s, y: true });
    for (const s of ["old conversations in my instagram DMs", "how do I post a reel"]) expect({ s, y: asksForPastChats(s) }).toEqual({ s, y: false });
    const u = await mkUser("past");
    await signIn(u.id);
    const j = await (await chat("where are my previous conversations?")).json();
    expect(j.answer).toBe(conv.PAST_CHATS_TEXT);
    expect(j.answer).toContain("(/support#pip-conversations)");
    expect(j.answer).toContain("Your Pip conversations");
    expect(j.answer).not.toMatch(/chat history/i);
    // The section really exists on that page, under that id and title.
    const page = readFileSync("components/support/PipConversations.tsx", "utf8");
    expect(page).toContain('id="pip-conversations"');
    expect(page).toContain("Your Pip conversations");
    expect(readFileSync("app/(studio)/support/page.tsx", "utf8")).toContain("<PipConversations items={chats} />");
    expect(readFileSync("components/shell/nav-items.ts", "utf8")).toContain('{ href: "/support", label: "Help centre"');
  });
  test("the list is the person's own; one opens with its messages; someone else's is not found", async () => {
    const a = await mkUser("lista");
    const b = await mkUser("listb");
    const ida = await conv.recordTurn({ userId: a.id, conversation: null, question: "How do I connect YouTube?", answer: "Open Connected accounts.", askedAt: new Date() });
    await conv.recordTurn({ userId: b.id, conversation: null, question: "B's question", answer: "B's answer", askedAt: new Date() });
    await signIn(a.id);
    const g = await (await get("/api/support/conversation")).json();
    expect(g.items.map((x: { id: string }) => x.id)).toEqual([ida]);
    expect(g.items[0]).toMatchObject({ subject: "How do I connect YouTube?", status: "open", messages: 2 });
    const one = await (await get(`/api/support/conversation?id=${ida}`)).json();
    expect(one.messages).toEqual([{ role: "user", text: "How do I connect YouTube?" }, { role: "bot", text: "Open Connected accounts." }]);
    const idb = (await db.pipConversation.findFirst({ where: { userId: b.id } }))!.id;
    expect((await get(`/api/support/conversation?id=${idb}`)).status).toBe(404);
  });
  test("Continue in Pip loads it in the widget as it is", () => {
    const src = readFileSync("components/support/ChatWidget.tsx", "utf8");
    expect(src).toContain('window.addEventListener("outly:pip-conversation", on)');
    expect(src).toContain('setResolved(j.status === "resolved"');
  });
});

describe("13 conversation states", () => {
  test("open, pending while a transcript is on its way, resolved; a resolved one stays resolved until reopened", async () => {
    const now = new Date();
    expect(conv.convStatus({ status: "open", sendingAt: null }, now)).toBe("open");
    expect(conv.convStatus({ status: "open", sendingAt: new Date(now.getTime() - 5_000) }, now)).toBe("pending");
    expect(conv.convStatus({ status: "open", sendingAt: new Date(now.getTime() - 5 * 60_000) }, now)).toBe("open");
    expect(conv.convStatus({ status: "resolved", sendingAt: null }, now)).toBe("resolved");

    const u = await mkUser("states");
    const id = await conv.recordTurn({ userId: u.id, conversation: null, question: "q", answer: "a", askedAt: new Date() });
    await signIn(u.id);
    expect((await post(convPOST, "/api/support/conversation", { action: "resolve", conversationId: id })).status).toBe(200);
    expect((await conv.listConversations(u.id))[0].status).toBe("resolved");
    // Nothing reopens by itself: a new message is refused until Reopen is pressed.
    expect((await chat("one more thing", { conversationId: id })).status).toBe(409);
    const one = await (await get(`/api/support/conversation?id=${id}`)).json();
    expect(one.status).toBe("resolved");
    expect((await post(convPOST, "/api/support/conversation", { action: "reopen", conversationId: id })).status).toBe(200);
    expect((await conv.listConversations(u.id))[0].status).toBe("open");
  });
  test("no duplicate replies: Continue Chat answers once, and Yes after resolving adds nothing", () => {
    const src = readFileSync("components/support/ChatWidget.tsx", "utf8");
    expect(src).toContain("if (!m.offer || closingRef.current) return;");
    expect(src).toContain("if (good && resolved) return;");
  });
});

describe("phone notifications and admin analytics (this round)", () => {
  test("the handle comes first, then what they wrote", () => {
    const c = commentNotice({ platform: "instagram", from: "@riya", text: "Love this!", postTitle: "Day 12" });
    expect(c.title.startsWith("@riya")).toBe(true);
    expect(c.body.startsWith("Love this!")).toBe(true);
    const m = messageNotice("instagram", "@sam", "hey, collab?");
    expect(m.title.startsWith("@sam")).toBe(true);
    expect(m.body).toBe("hey, collab?");
    expect(commentNotice({ platform: "instagram", from: "", text: "hi", postTitle: null }).title.startsWith("Someone")).toBe(true);
  });
  test("analytics source switch and helpers", () => {
    expect(parseAnalyticsSource("posthog")).toBe("posthog");
    expect(parseAnalyticsSource("x")).toBe("outlly");
    expect(parseAnalyticsSource(null)).toBe("outlly");
    const now = new Date("2026-11-14T10:00:00Z");
    const days = perDay([new Date("2026-11-14T01:00:00Z"), new Date("2026-11-14T05:00:00Z"), new Date("2020-01-01T00:00:00Z"), null], 7, now);
    expect(days.length).toBe(7);
    expect(days[days.length - 1]).toEqual({ day: "2026-11-14", count: 2 });
    expect(days.reduce((s, d) => s + d.count, 0)).toBe(2);
    expect(countryName("IN")).toBe("India");
    expect(countryName("")).toBe("Unknown");
    expect(countryName("zz1")).toBe("Unknown");
  });
});
