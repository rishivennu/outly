/**
 * 10-31: Instagram and Facebook direct messages. Webhook parsing and signatures, Meta's signed_request,
 * the 24-hour window, the send request shape, idempotent storage (retries and echoes), backfill,
 * practice threads, editors, export and retention.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

let db: typeof import("../lib/db").db;
let meta: typeof import("../lib/messages/meta");
let wh: typeof import("../lib/messages/webhook");
let svc: typeof import("../lib/messages/service");
let settings: typeof import("../lib/settings");
let enc: (s: string) => string;
let dec: (s: string) => string;
let n = 0;

const FB_SECRET = "fb-app-secret-1031";
const IG_SECRET = "ig-app-secret-1031";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  meta = await import("../lib/messages/meta");
  wh = await import("../lib/messages/webhook");
  svc = await import("../lib/messages/service");
  settings = await import("../lib/settings");
  const c = await import("../lib/crypto");
  enc = c.encrypt;
  dec = c.decrypt;
}, 60_000);

type Calls = { url: string; method: string; body?: string; auth?: string }[];
function stubFetch(handler: (url: string, init: RequestInit) => Response): Calls {
  const calls: Calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const h = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? init.body : undefined, auth: h.authorization });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

async function setup(platform: "instagram" | "facebook", opts: { practice?: boolean; pid?: string } = {}) {
  const u = await db.user.create({ data: { name: `Dm ${++n}`, email: `dm-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const pid = opts.pid ?? (opts.practice ? `mock-${platform}-${n}` : `${platform === "instagram" ? "1784" : "1022"}${Date.now()}${n}`);
  const a = await db.socialAccount.create({ data: { userId: u.id, platform, platformUserId: pid, username: `@acct${n}`, accessToken: enc("tok-" + n) } });
  return { u, a, pid };
}

const igMessage = (entryId: string, from: string, mid: string, text: string, extra: Record<string, unknown> = {}) => ({
  object: "instagram",
  entry: [{ id: entryId, time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: from === entryId ? "person-x" : entryId }, timestamp: Date.now(), message: { mid, text, ...extra } }] }],
});

describe("parseWebhook", () => {
  test("an Instagram message from a person", () => {
    const ev = wh.parseWebhook(igMessage("me1", "p1", "m1", "hi there"));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ platform: "instagram", accountPlatformId: "me1", personId: "p1", mid: "m1", direction: "in", text: "hi there", deleted: false });
  });

  test("an echo of our own reply is outbound and filed under the person", () => {
    const body = { object: "instagram", entry: [{ id: "me1", messaging: [{ sender: { id: "me1" }, recipient: { id: "p9" }, timestamp: 1700000000000, message: { mid: "m2", text: "thanks!", is_echo: true } }] }] };
    const [e] = wh.parseWebhook(body);
    expect(e.direction).toBe("out");
    expect(e.personId).toBe("p9");
    expect(e.sentAt.getTime()).toBe(1700000000000);
  });

  test("a Page (Messenger) message, with an attachment", () => {
    const body = { object: "page", entry: [{ id: "page1", messaging: [{ sender: { id: "psid1" }, recipient: { id: "page1" }, timestamp: 1700000000000, message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://cdn.example/x.jpg" } }] } }] }] };
    const [e] = wh.parseWebhook(body);
    expect(e.platform).toBe("facebook");
    expect(e.text).toBe("");
    expect(e.attachments).toEqual([{ type: "image", url: "https://cdn.example/x.jpg" }]);
  });

  test("the dashboard Test button shape (changes[].value) is read too", () => {
    const body = { object: "instagram", entry: [{ id: "0", time: 1, changes: [{ field: "messages", value: { sender: { id: "12334" }, recipient: { id: "23245" }, timestamp: "1527459824", message: { mid: "random_mid", text: "random_text" } } }] }] };
    const [e] = wh.parseWebhook(body);
    expect(e.mid).toBe("random_mid");
    expect(e.sentAt.getTime()).toBe(1527459824000); // seconds are read as seconds
  });

  test("unsent messages are flagged; reads, reactions and other objects are ignored", () => {
    expect(wh.parseWebhook(igMessage("me1", "p1", "m4", "", { is_deleted: true }))[0].deleted).toBe(true);
    expect(wh.parseWebhook({ object: "instagram", entry: [{ id: "me1", messaging: [{ sender: { id: "p1" }, recipient: { id: "me1" }, read: { mid: "m1" } }] }] })).toEqual([]);
    expect(wh.parseWebhook({ object: "user", entry: [] })).toEqual([]);
    expect(wh.parseWebhook(null)).toEqual([]);
    expect(wh.parseWebhook({ object: "page", entry: "nope" })).toEqual([]);
  });

  test("a postback reads as a message from the person", () => {
    const body = { object: "page", entry: [{ id: "page1", messaging: [{ sender: { id: "psid1" }, recipient: { id: "page1" }, timestamp: 1, postback: { mid: "pb1", title: "Get started" } }] }] };
    expect(wh.parseWebhook(body)[0]).toMatchObject({ direction: "in", text: "Get started", mid: "pb1" });
  });
});

describe("signatures", () => {
  const raw = JSON.stringify({ object: "page", entry: [] });
  const sign = (s: string, body = raw) => `sha256=${createHmac("sha256", s).update(body).digest("hex")}`;
  test("either app secret is accepted; anything else is refused", () => {
    expect(wh.verifySignature(raw, sign(FB_SECRET), [FB_SECRET, IG_SECRET])).toBe(true);
    expect(wh.verifySignature(raw, sign(IG_SECRET), [FB_SECRET, IG_SECRET])).toBe(true);
    expect(wh.verifySignature(raw, sign("other"), [FB_SECRET, IG_SECRET])).toBe(false);
    expect(wh.verifySignature(raw + " ", sign(FB_SECRET), [FB_SECRET])).toBe(false);
    expect(wh.verifySignature(raw, null, [FB_SECRET])).toBe(false);
    expect(wh.verifySignature(raw, "sha256=zz", [FB_SECRET])).toBe(false);
    expect(wh.verifySignature(raw, sign(""), ["", ""])).toBe(false); // no secret configured: nothing passes
  });

  test("signed_request (data deletion)", () => {
    const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const payload = b64(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "12345", issued_at: 1 }));
    const sig = b64(createHmac("sha256", FB_SECRET).update(payload).digest());
    expect(wh.parseSignedRequest(`${sig}.${payload}`, [FB_SECRET])?.user_id).toBe("12345");
    expect(wh.parseSignedRequest(`${sig}.${payload}`, ["wrong"])).toBeNull();
    expect(wh.parseSignedRequest("garbage", [FB_SECRET])).toBeNull();
    expect(wh.parseSignedRequest(null, [FB_SECRET])).toBeNull();
  });

  test("the verify token is stable and not a raw secret", () => {
    expect(wh.webhookVerifyToken()).toBe(wh.webhookVerifyToken());
    expect(wh.webhookVerifyToken()).toMatch(/^outlly-[\w-]{24}$/);
  });
});

describe("Meta API calls", () => {
  const acct = { id: "a", platformUserId: "page77", username: "p", accessToken: "PAGE_TOKEN", refreshToken: null };
  test("Instagram send: /me/messages with a Bearer token and the text", async () => {
    const calls = stubFetch(() => ok({ recipient_id: "p1", message_id: "mid.ig" }));
    expect(await meta.sendText("instagram", acct, "p1", "hello")).toEqual({ mid: "mid.ig" });
    expect(calls[0].url).toBe("https://graph.instagram.com/v21.0/me/messages");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].auth).toBe("Bearer PAGE_TOKEN");
    expect(JSON.parse(calls[0].body!)).toEqual({ recipient: { id: "p1" }, message: { text: "hello" } });
    expect(calls[0].url).not.toContain("PAGE_TOKEN"); // token never in a URL that could be logged
  });

  test("Messenger send: /{page}/messages with messaging_type RESPONSE", async () => {
    const calls = stubFetch(() => ok({ message_id: "mid.fb" }));
    await meta.sendText("facebook", acct, "psid", "yo");
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/page77/messages");
    expect(JSON.parse(calls[0].body!)).toEqual({ recipient: { id: "psid" }, messaging_type: "RESPONSE", message: { text: "yo" } });
  });

  test("Meta's 'outside the window' answer becomes WindowClosedError", async () => {
    const body = { error: { message: "(#10) This message is sent outside of allowed window.", type: "OAuthException", code: 10, error_subcode: 2018278 } };
    stubFetch(() => new Response(JSON.stringify(body), { status: 400 }));
    await expect(meta.sendText("facebook", acct, "psid", "late")).rejects.toBeInstanceOf(meta.WindowClosedError);
    expect(meta.isWindowClosed('{"error":{"code":551,"message":"x"}}')).toBe(true);
    expect(meta.isWindowClosed('{"error":{"code":10,"message":"Application does not have permission"}}')).toBe(false);
  });

  test("conversations map the other participant and both directions", async () => {
    const calls = stubFetch(() =>
      ok({
        data: [
          {
            id: "conv1",
            updated_time: "2026-10-30T10:00:00+0000",
            participants: { data: [{ id: "page77", name: "My Page" }, { id: "psid5", name: "Ravi K" }] },
            messages: { data: [{ id: "mA", created_time: "2026-10-30T10:00:00+0000", message: "price?", from: { id: "psid5" }, to: { data: [{ id: "page77" }] } }] },
          },
        ],
      }),
    );
    const t = await meta.listConversations("facebook", acct);
    expect(calls[0].url).toContain("/page77/conversations?platform=messenger");
    expect(t[0]).toMatchObject({ conversationId: "conv1", participantId: "psid5", participantName: "Ravi K" });
    expect(t[0].messages[0]).toMatchObject({ mid: "mA", fromId: "psid5", text: "price?" });
  });
});

describe("storage", () => {
  test("a webhook message is stored once, encrypted, and counts as unread; its echo and a retry are not duplicated", async () => {
    const { u, a, pid } = await setup("instagram");
    stubFetch((url) => (url.includes("profile_pic") ? ok({ name: "Asha", username: "asha.cooks", profile_pic: "https://cdn/p.jpg" }) : ok({})));
    const ev = wh.parseWebhook(igMessage(pid, "person1", "mid-1", "do you ship?"));
    expect((await svc.ingestEvents(ev)).stored).toBe(1);
    expect((await svc.ingestEvents(ev)).stored).toBe(0); // Meta retried
    const t = await db.dmThread.findFirstOrThrow({ where: { accountId: a.id } });
    expect(t).toMatchObject({ userId: u.id, participantId: "person1", participantName: "Asha", participantHandle: "@asha.cooks", unread: 1 });
    const m = await db.dmMessage.findFirstOrThrow({ where: { threadId: t.id } });
    expect(m.text).not.toContain("ship");
    expect(dec(m.text)).toBe("do you ship?");
    const list = await svc.listThreads(u.id);
    expect(list.threads[0]).toMatchObject({ snippet: "do you ship?", canReply: true, unread: 1 });
    const opened = await svc.getThread(u.id, t.id);
    expect(opened.messages.map((x) => x.text)).toEqual(["do you ship?"]);
    expect((await db.dmThread.findUniqueOrThrow({ where: { id: t.id } })).unread).toBe(0);
  });

  test("a reply goes out, is stored once even when the echo arrives first, and credits the sender", async () => {
    const { u, pid } = await setup("instagram");
    stubFetch(() => ok({}));
    await svc.ingestEvents(wh.parseWebhook(igMessage(pid, "person2", "in-1", "hey")));
    const t = await db.dmThread.findFirstOrThrow({ where: { userId: u.id } });
    // The echo for mid "out-1" lands before our own write.
    await svc.ingestEvents([{ platform: "instagram", accountPlatformId: pid, personId: "person2", mid: "out-1", direction: "out", text: "hello!", attachments: [], sentAt: new Date() }]);
    const calls = stubFetch(() => ok({ message_id: "out-1" }));
    const r = await svc.replyToThread(u.id, "actor-1", t.id, "  hello!  ");
    expect(calls[0].body).toContain('"text":"hello!"');
    expect(r.practice).toBe(false);
    const rows = await db.dmMessage.findMany({ where: { threadId: t.id, direction: "out" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].sentById).toBe("actor-1");
    expect((await svc.listThreads(u.id)).threads[0].snippet).toBe("You: hello!");
  });

  test("the 24-hour window: closed threads refuse before calling Meta, and Meta's own refusal closes it", async () => {
    const { u, a, pid } = await setup("facebook");
    const old = new Date(Date.now() - 25 * 3600_000);
    const t = await db.dmThread.create({ data: { userId: u.id, accountId: a.id, platform: "facebook", participantId: "psid-old", lastMessageAt: old, lastInboundAt: old } });
    const calls = stubFetch(() => ok({}));
    await expect(svc.replyToThread(u.id, u.id, t.id, "late")).rejects.toMatchObject({ status: 409, code: "WINDOW_CLOSED" });
    expect(calls).toHaveLength(0);

    const fresh = await db.dmThread.create({ data: { userId: u.id, accountId: a.id, platform: "facebook", participantId: "psid-new", lastMessageAt: new Date(), lastInboundAt: new Date(Date.now() - 23.99 * 3600_000) } });
    stubFetch(() => new Response(JSON.stringify({ error: { code: 10, error_subcode: 2018278, message: "outside of allowed window" } }), { status: 400 }));
    await expect(svc.replyToThread(u.id, u.id, fresh.id, "just in time?")).rejects.toMatchObject({ status: 409, code: "WINDOW_CLOSED" });
    const after = (await svc.listThreads(u.id)).threads.find((x) => x.id === fresh.id)!;
    expect(after.canReply).toBe(false);
    expect(pid).toBeTruthy();
  });

  test("permission and auth failures read plainly", async () => {
    const { u, a } = await setup("instagram");
    const t = await db.dmThread.create({ data: { userId: u.id, accountId: a.id, platform: "instagram", participantId: "p", lastMessageAt: new Date(), lastInboundAt: new Date() } });
    stubFetch(() => new Response(JSON.stringify({ error: { code: 10, message: "Application does not have permission for this action" } }), { status: 400 }));
    await expect(svc.replyToThread(u.id, u.id, t.id, "hi")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    stubFetch(() => new Response(JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }), { status: 400 }));
    await expect(svc.replyToThread(u.id, u.id, t.id, "hi")).rejects.toMatchObject({ status: 409, code: "NOT_CONNECTED" });
  });

  test("another workspace can't read or answer the thread", async () => {
    const { u, pid } = await setup("instagram");
    const other = await setup("instagram");
    stubFetch(() => ok({}));
    await svc.ingestEvents(wh.parseWebhook(igMessage(pid, "pp", "mid-x", "secret")));
    const t = await db.dmThread.findFirstOrThrow({ where: { userId: u.id } });
    await expect(svc.getThread(other.u.id, t.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.replyToThread(other.u.id, other.u.id, t.id, "hi")).rejects.toMatchObject({ status: 404 });
  });

  test("an unsent message is removed; events for unknown accounts are ignored", async () => {
    const { pid, a } = await setup("instagram");
    stubFetch(() => ok({}));
    await svc.ingestEvents(wh.parseWebhook(igMessage(pid, "p3", "mid-del", "oops")));
    expect(await db.dmMessage.count({ where: { platformMessageId: "mid-del" } })).toBe(1);
    await svc.ingestEvents(wh.parseWebhook(igMessage(pid, "p3", "mid-del", "", { is_deleted: true })));
    expect(await db.dmMessage.count({ where: { platformMessageId: "mid-del" } })).toBe(0);
    expect((await svc.ingestEvents(wh.parseWebhook(igMessage("nobody-123", "p3", "mid-z", "hi")))).stored).toBe(0);
    expect(a).toBeTruthy();
  });

  test("Refresh backfills: history is not all unread, only the newest inbound one", async () => {
    const { u, a, pid } = await setup("facebook");
    stubFetch((url) =>
      url.includes("/conversations")
        ? ok({
            data: [
              {
                id: "c1",
                participants: { data: [{ id: pid }, { id: "psid9", name: "Neha" }] },
                messages: {
                  data: [
                    { id: "b3", created_time: "2026-10-30T10:02:00+0000", message: "still there?", from: { id: "psid9" } },
                    { id: "b2", created_time: "2026-10-30T10:01:00+0000", message: "yes!", from: { id: pid } },
                    { id: "b1", created_time: "2026-10-30T10:00:00+0000", message: "hello", from: { id: "psid9" } },
                  ],
                },
              },
            ],
          })
        : ok({}),
    );
    const problems = await svc.syncAll(u.id);
    expect(problems).toEqual([]);
    const t = await db.dmThread.findFirstOrThrow({ where: { accountId: a.id } });
    expect(t.participantName).toBe("Neha");
    expect(t.unread).toBe(1);
    expect(t.platformThreadId).toBe("c1");
    expect(dec(t.snippet!)).toBe("still there?");
    const msgs = await db.dmMessage.findMany({ where: { threadId: t.id }, orderBy: { sentAt: "asc" } });
    expect(msgs.map((m) => m.direction)).toEqual(["in", "out", "in"]);
    // Running it again stores nothing new.
    await svc.syncAll(u.id);
    expect(await db.dmMessage.count({ where: { threadId: t.id } })).toBe(3);
  });

  test("a Meta refusal on Refresh is reported, not thrown", async () => {
    const { u } = await setup("instagram");
    stubFetch(() => new Response(JSON.stringify({ error: { code: 10, message: "Application does not have permission" } }), { status: 400 }));
    const problems = await svc.syncAll(u.id, "instagram");
    expect(problems[0]).toMatchObject({ platform: "instagram", code: "FORBIDDEN" });
    expect(problems[0].message).toContain("messaging permission");
  });
});

describe("practice accounts", () => {
  test("get sample threads once, and replies never touch the network", async () => {
    const { u } = await setup("instagram", { practice: true });
    const calls = stubFetch(() => ok({}));
    const a = await svc.listThreads(u.id);
    const b = await svc.listThreads(u.id);
    expect(a.threads.length).toBeGreaterThanOrEqual(2);
    expect(b.threads.length).toBe(a.threads.length);
    expect(a.threads.every((t) => t.practice)).toBe(true);
    const open = a.threads.find((t) => t.canReply)!;
    const closed = a.threads.find((t) => !t.canReply)!;
    expect(open && closed).toBeTruthy(); // one inside the window, one past it, so both states can be tried
    const r = await svc.replyToThread(u.id, u.id, open.id, "thanks!");
    expect(r.practice).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("routes", () => {
  beforeAll(async () => {
    await settings.saveConfig("platforms", { facebook: { clientId: "fb-id-1031", clientSecret: FB_SECRET }, instagram: { clientId: "ig-id-1031", clientSecret: IG_SECRET } });
  });
  afterAll(async () => {
    await settings.saveConfig("platforms", { facebook: { clientId: "", clientSecret: null }, instagram: { clientId: "", clientSecret: null } });
  });

  test("GET verifies with the token and echoes the challenge as text", async () => {
    const { GET } = await import("../app/api/webhooks/meta/route");
    const url = (tok: string) => `http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(tok)}&hub.challenge=1158201444`;
    const good = await GET(new NextRequest(url(wh.webhookVerifyToken())));
    expect(good.status).toBe(200);
    expect(await good.text()).toBe("1158201444");
    expect((await GET(new NextRequest(url("wrong")))).status).toBe(403);
  });

  test("POST stores a signed event and refuses an unsigned one", async () => {
    const { POST } = await import("../app/api/webhooks/meta/route");
    const { pid, a } = await setup("instagram");
    stubFetch(() => ok({}));
    const raw = JSON.stringify(igMessage(pid, "route-person", "route-mid", "via webhook"));
    const req = (sig: string | null) => new NextRequest("http://localhost/api/webhooks/meta", { method: "POST", body: raw, headers: { "content-type": "application/json", ...(sig ? { "x-hub-signature-256": sig } : {}) } });
    expect((await POST(req(null))).status).toBe(403);
    expect((await POST(req(`sha256=${createHmac("sha256", "nope").update(raw).digest("hex")}`))).status).toBe(403);
    expect(await db.dmMessage.count({ where: { platformMessageId: "route-mid" } })).toBe(0);
    const res = await POST(req(`sha256=${createHmac("sha256", IG_SECRET).update(raw).digest("hex")}`));
    expect(res.status).toBe(200);
    expect(await db.dmMessage.count({ where: { platformMessageId: "route-mid", thread: { accountId: a.id } } })).toBe(1);
  });

  test("the data deletion callback removes the account and its messages and returns a status URL", async () => {
    const { POST } = await import("../app/api/webhooks/meta/deletion/route");
    const { a, pid } = await setup("instagram");
    const fbUser = `9${Date.now()}`;
    const fb = await setup("facebook");
    await db.socialAccount.update({ where: { id: fb.a.id }, data: { metadata: JSON.stringify({ pages: [], metaUserId: fbUser }) } });
    await db.dmThread.create({ data: { userId: a.userId, accountId: a.id, platform: "instagram", participantId: "x", lastMessageAt: new Date() } });
    const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const signed = (uid: string) => {
      const payload = b64(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: uid, issued_at: 1 }));
      return `${b64(createHmac("sha256", FB_SECRET).update(payload).digest())}.${payload}`;
    };
    const call = (s: string) => POST(new NextRequest("http://localhost/api/webhooks/meta/deletion", { method: "POST", body: new URLSearchParams({ signed_request: s }), headers: { "content-type": "application/x-www-form-urlencoded" } }));
    const res = await call(signed(pid));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { url: string; confirmation_code: string };
    expect(j.url).toContain("/privacy#data-deletion");
    expect(j.confirmation_code).toMatch(/^del-/);
    expect(await db.socialAccount.count({ where: { id: a.id } })).toBe(0);
    expect(await db.dmThread.count({ where: { accountId: a.id } })).toBe(0);
    expect((await call(signed(fbUser))).status).toBe(200);
    expect(await db.socialAccount.count({ where: { id: fb.a.id } })).toBe(0);
    expect((await call("bad.request")).status).toBe(400);
  });
});

describe("rules around it", () => {
  test("editors read messages but can't send them; managers can", async () => {
    const { memberBlock } = await import("../lib/team/roles");
    expect(memberBlock("editor", "GET", "/api/messages")).toBeNull();
    expect(memberBlock("editor", "GET", "/api/messages/abc")).toBeNull();
    expect(memberBlock("editor", "POST", "/api/messages/abc")).toContain("Editors can't send direct messages");
    expect(memberBlock("manager", "POST", "/api/messages/abc")).toBeNull();
  });

  test("the reply schema trims and caps at 1000", async () => {
    const { dmReplySchema } = await import("../lib/validation");
    expect(dmReplySchema.parse({ text: "  hi " }).text).toBe("hi");
    expect(() => dmReplySchema.parse({ text: "   " })).toThrow();
    expect(() => dmReplySchema.parse({ text: "x".repeat(1001) })).toThrow();
  });

  test("the data export includes the creator's conversations, decrypted, without platform ids", async () => {
    const { u, pid } = await setup("instagram");
    stubFetch(() => ok({}));
    await svc.ingestEvents(wh.parseWebhook(igMessage(pid, "exp-person", "exp-mid", "export me")));
    const { exportUser } = await import("../lib/account");
    const out = await exportUser(u.id);
    expect(out.directMessages).toHaveLength(1);
    expect(out.directMessages[0].messages[0]).toMatchObject({ direction: "in", text: "export me" });
    expect(JSON.stringify(out)).not.toContain("exp-person");
  });

  test("retention drops messages and quiet threads after 180 days", async () => {
    const { u, a } = await setup("facebook");
    const day = 864e5;
    const old = await db.dmThread.create({ data: { userId: u.id, accountId: a.id, platform: "facebook", participantId: "old", lastMessageAt: new Date(Date.now() - 181 * day) } });
    const live = await db.dmThread.create({ data: { userId: u.id, accountId: a.id, platform: "facebook", participantId: "live", lastMessageAt: new Date() } });
    const m1 = await db.dmMessage.create({ data: { threadId: live.id, direction: "in", text: enc("old one"), sentAt: new Date(Date.now() - 200 * day) } });
    const m2 = await db.dmMessage.create({ data: { threadId: live.id, direction: "in", text: enc("new one"), sentAt: new Date() } });
    const { pruneOldData } = await import("../lib/retention/prune");
    await pruneOldData();
    expect(await db.dmThread.count({ where: { id: old.id } })).toBe(0);
    expect(await db.dmMessage.count({ where: { id: m1.id } })).toBe(0);
    expect(await db.dmMessage.count({ where: { id: m2.id } })).toBe(1);
  });

  test("connecting asks Meta to send messages to the webhook, and a refusal doesn't stop the connection", async () => {
    const { saveConnectedAccount } = await import("../lib/accounts");
    const u = await db.user.create({ data: { name: "Conn", email: `conn-${Date.now()}@test.dev`, passwordHash: "x" } });
    const calls = stubFetch(() => new Response("{}", { status: 400 }));
    const acct = await saveConnectedAccount(u.id, "facebook", { platformUserId: `pg${Date.now()}`, username: "Page", accessToken: "PT" });
    expect(acct.status).toBe("connected");
    expect(calls[0].url).toContain(`/${acct.platformUserId}/subscribed_apps?subscribed_fields=messages,message_echoes`);
    const before = calls.length;
    await saveConnectedAccount(u.id, "youtube", { platformUserId: "yt1", username: "yt", accessToken: "t" });
    expect(calls.length).toBe(before); // other platforms: no call
  });
});
