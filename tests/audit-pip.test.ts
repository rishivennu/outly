/**
 * Pre-launch audit (pip): Pip's data isolation and honesty, analytics truthfulness, PWA/service worker,
 * notification and account-data checks that run the real code paths instead of reading the source.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

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
const conv = await import("../lib/support/conversations");
const { runTool } = await import("../lib/pip/tools");
const { numbersBacked, plainSummary } = await import("../lib/pip/run");
const { getAnalytics } = await import("../lib/analytics");

const read = (p: string) => readFileSync(p, "utf8");

let A = "";
let B = "";
const mkUser = async (tag: string) => {
  const email = `audit-pip-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`;
  const u = await db.user.create({ data: { name: `Audit ${tag}`, email, passwordHash: "x", emailVerifiedAt: new Date(), emailVerifiedFor: email, timezone: "Asia/Kolkata" } });
  return u.id;
};

let seq = 0;
/** One published post with numbers, the way the sync job writes them (TargetMetric rows are increments). */
async function published(userId: string, title: string, views: number, platform = "instagram", opts: { practice?: boolean; daysAgo?: number } = {}) {
  seq++;
  const media = await db.media.create({ data: { userId, originalFilename: "a.mp4", storageKey: `audit/${seq}-${Date.now()}.mp4`, mimeType: "video/mp4", size: 1000, duration: 12, width: 1080, height: 1920, status: "ready" } });
  const acct = await db.socialAccount.create({ data: { userId, platform, platformUserId: `audit-${platform}-${seq}-${Date.now()}`, username: "@auditor", accessToken: "x", status: "connected" } });
  const at = new Date(Date.now() - (opts.daysAgo ?? 3) * 864e5);
  const post = await db.post.create({ data: { userId, mediaId: media.id, title, status: "published", publishedAt: at } });
  const target = await db.postTarget.create({
    data: { postId: post.id, platform, socialAccountId: acct.id, platformStatus: "published", publishedAt: at, practice: !!opts.practice, platformPostId: `p-${seq}` },
  });
  await db.targetMetric.create({ data: { targetId: target.id, capturedAt: at, views, likes: Math.round(views / 50), comments: Math.round(views / 200), shares: Math.round(views / 500) } });
  return { post, target, acct };
}

const ctxFor = (userId: string, message: string, actorId: string | null = null) => ({ ownerId: userId, actorId, scope: null, tz: "Asia/Kolkata", now: new Date(), message });

beforeAll(async () => {
  A = await mkUser("a");
  B = await mkUser("b");
});

describe("audit: Pip reads only the signed-in person's records", () => {
  test("another person's conversation id is not found, and never takes their messages", async () => {
    const id = await conv.recordTurn({ userId: A, conversation: null, question: "A secret question", answer: "A secret answer", askedAt: new Date() });
    expect(await conv.openConversation(B, id)).toBeNull();
    const mine = await conv.recordTurn({ userId: B, conversation: await conv.openConversation(B, id), question: "B question", answer: "B answer", askedAt: new Date() });
    expect(mine).not.toBe(id);
    const rows = await db.pipMessage.findMany({ where: { conversationId: id }, select: { text: true } });
    expect(rows.map((r) => r.text).join(" ")).not.toContain("B question");
    await expect(conv.resolveAndSend(B, id)).rejects.toThrow(/couldn't find that conversation/i);
    await expect(conv.reopen(B, id)).rejects.toThrow(/couldn't find that conversation/i);
  });

  test("a focused post id belonging to someone else is refused out loud", async () => {
    const { target } = await published(A, "A private post title", 5000);
    const r = await runTool("post_insight", ctxFor(B, "why did it do better?"), { focus: target.id });
    const all = JSON.stringify(r);
    expect(all).not.toContain("A private post title");
    expect(r.notes.some((n) => /couldn't find that post among yours/i.test(n.text))).toBe(true);
    expect(r.rows).toEqual([]);
  });

  test("a teammate is refused billing records with a plain no", async () => {
    for (const tool of ["invoices", "payments", "spending", "subscription", "credit_notes", "refunds_missing_credit_note"] as const) {
      const r = await runTool(tool, ctxFor(A, "show my invoices", B));
      expect(r.rows).toEqual([]);
      expect(r.found).toBe(0);
      expect(r.facts.join(" ")).toMatch(/only shown to the workspace owner/i);
    }
  });
});

describe("audit: Pip never invents a number", () => {
  test("nothing connected and nothing published: honest empty answers, no numbers made up", async () => {
    const fresh = await mkUser("empty");
    for (const tool of ["overview", "trend", "forecast", "best_times", "report", "account", "compare_platforms"] as const) {
      const r = await runTool(tool, ctxFor(fresh, "how am I doing this month?"), {});
      expect(r.found).toBe(0);
      expect(r.rows).toEqual([]);
      expect(typeof r.empty).toBe("string");
      expect(r.empty.length).toBeGreaterThan(0);
      expect(plainSummary(r).length).toBeGreaterThan(0);
      const summary = plainSummary(r);
      // Nothing on record: the answer is the fixed "no data yet" sentence, never a number worked out from nothing.
      if (!r.facts.length) expect(summary).toBe(r.empty);
      else expect(numbersBacked(summary, r.range ? [...r.facts, r.range.label] : r.facts)).toBe(true);
      // No records means no headline cards and no projection badge (the account tool still reports plan usage).
      if (tool !== "account") {
        expect(r.cards ?? []).toEqual([]);
        expect(r.estimate ?? false).toBe(false);
      }
    }
  });
});

describe("audit: analytics numbers trace to their source", () => {
  test("the day-of-week claim counts every platform, not just the first three", async () => {
    const u = await mkUser("bestday");
    await published(u, "TikTok one", 4000, "tiktok", { daysAgo: 2 });
    const s = await getAnalytics(u, 30, null);
    expect(s.totals.views).toBe(4000);
    expect(s.bestDay).not.toBeNull();
  });

  test("practice (rehearsal) numbers never count as real on the analytics page", async () => {
    const u = await mkUser("practice");
    await published(u, "Real one", 1000, "instagram", { daysAgo: 2 });
    await published(u, "Rehearsal", 9000, "instagram", { daysAgo: 2, practice: true });
    const s = await getAnalytics(u, 30, null);
    expect(s.totals.views).toBe(1000);
  });
});

describe("audit: a summary may only repeat numbers the records produced", () => {
  test("an invented number is not accepted just because its digits appear inside another", () => {
    const facts = ["3 invoices found for 1 Aug 2027 to 31 Aug 2027.", "Invoiced total 4,500.00."];
    expect(numbersBacked("You have 3 invoices, 4,500.00 in total.", facts)).toBe(true);
    expect(numbersBacked("You have 7 invoices.", facts)).toBe(false);
    expect(numbersBacked("You spent 45 this month.", facts)).toBe(false);
    expect(numbersBacked("202 views.", facts)).toBe(false);
  });
});

describe("audit: Pip past its daily AI allowance", () => {
  test("the chat keeps answering from the help centre instead of refusing every question", async () => {
    const u = await mkUser("quota");
    const { createSession } = await import("../lib/auth");
    const { POST } = await import("../app/api/support/chat/route");
    const { NextRequest } = await import("next/server");
    const { env } = await import("../lib/env");
    jar.clear();
    await createSession(u);
    // Spend the whole support allowance for today.
    const day = new Date().toISOString().slice(0, 10);
    await db.aiUsage.create({ data: { userId: u, day, kind: "support", count: env.AI_SUPPORT_DAILY_LIMIT } });
    const r = await POST(
      new NextRequest("http://localhost/api/support/chat", {
        method: "POST",
        body: JSON.stringify({ message: "how do I schedule a post?", history: [] }),
        headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
      }),
      { params: {} } as never,
    );
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(typeof body.answer).toBe("string");
    expect(body.answer.length).toBeGreaterThan(0);
  });
});

describe("audit: honest errors in the chat widget", () => {
  const src = read("components/support/ChatWidget.tsx");
  test("a refusal the server explained is shown in its own words, not a generic line", () => {
    expect(src).toContain('throw Object.assign(new Error(typeof j.error === "string" ? j.error : ""), { fromServer: true })');
    expect(src).toContain('(e as { fromServer?: boolean }).fromServer ? e.message.trim().slice(0, 300) : ""');
    // A dropped connection is not a server message: that one keeps the translated line.
    expect(src).toContain("push({ role: \"bot\", text: said || T[lang].error, kind: \"error\" })");
  });
  test("the daily allowance never turns into a refusal to answer", () => {
    const route = read("app/api/support/chat/route.ts");
    expect(route).toMatch(/if \(e instanceof HttpError && e\.status === 429\) return false;/);
  });
});

describe("audit: service worker and manifest", () => {
  const sw = read("public/sw.js");
  test("only the invoice PDF of an API is ever kept, and nothing of another person's", () => {
    const keep = sw.match(/const KEEP = \[(.+?)\];/s)![1];
    // One API, and it is a document the owner already downloaded. Any other API here would hand one
    // person's answer to whoever is on this browser next, with the network off.
    const apis = keep.match(/api\\\/[\w\\/[\]+-]*/g) ?? [];
    expect(apis).toEqual(["api\\/billing\\/invoices\\/[\\w-]+"]);
    for (const page of ["/home", "/analytics", "/inbox", "/calendar", "/settings"]) expect(keep).not.toContain(page);
  });
  test("a session ending clears the kept Billing copies, on the same paths the browser clears", () => {
    expect(sw).toContain('if (url.pathname === "/login" || url.pathname === "/api/auth/expired") e.waitUntil(forgetPrivate()');
    const inSw = sw.match(/const PRIVATE = (.+);/)![1];
    const inClient = read("lib/client/forget-billing.ts").match(/const BILLING_PATH = (.+);/)![1];
    expect(inSw).toBe(inClient);
  });
  test("a notification can only ever open a path inside Outlly", () => {
    const safePath = (h: unknown) => (typeof h === "string" && /^\/(?![/\\])/.test(h) ? h : "/home");
    expect(sw).toContain('const safePath = (h) => (typeof h === "string" && /^\\/(?![/\\\\])/.test(h) ? h : "/home");');
    expect(safePath("/analytics?account=1")).toBe("/analytics?account=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "", null, 7, "javascript:alert(1)"]) expect(safePath(bad)).toBe("/home");
  });
  test("admin windows are never reused for a creator's notification, and admin pages are never cached", () => {
    expect(sw).toContain('!new URL(c.url).pathname.startsWith("/admin")');
    expect(sw).toContain('url.pathname.startsWith("/admin")');
  });
  test("one push with the same tag replaces the older one instead of stacking", () => {
    expect(sw).toContain("if (d.g) (opts.tag = d.g), (opts.renotify = true);");
  });
  test("the manifest installs the studio, not the marketing site", async () => {
    const manifest = (await import("../app/manifest")).default();
    expect(manifest.start_url).toBe("/home?source=pwa");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons?.some((i) => i.purpose === "maskable")).toBe(true);
    expect(manifest.icons?.every((i) => i.src.startsWith("/brand/app/"))).toBe(true);
    for (const s of manifest.shortcuts ?? []) expect(s.url.startsWith("/")).toBe(true);
    expect(existsSync("public/offline.html")).toBe(true);
  });
});

describe("audit: deleting the account takes Pip, notices and devices with it", () => {
  test("conversations, messages, access log, notices, push devices and sessions all go", async () => {
    const { deleteAccount } = await import("../lib/account");
    const { createSession, readSessionUserId } = await import("../lib/auth");
    const u = await db.user.create({ data: { name: "Bye", email: `audit-del-${Date.now()}@test.dev`, passwordHash: "x" } });
    const cid = await conv.recordTurn({ userId: u.id, conversation: null, question: "my invoices", answer: "Here they are.", askedAt: new Date() });
    await db.pipAccessLog.create({ data: { userId: u.id, tool: "invoices", args: "{}", found: 1, complete: true } });
    await db.notice.create({ data: { userId: u.id, kind: "post_live", title: "Live", body: "x", key: `audit-del-${u.id}` } });
    await db.webPushSub.create({ data: { userId: u.id, endpointHash: `h-${Date.now()}`, endpoint: "e", p256dh: "p", auth: "a", vapidKey: "k", platform: "desktop", device: "Windows PC", client: "Chrome" } });
    jar.clear();
    await createSession(u.id);
    expect(await readSessionUserId()).toBe(u.id);
    await deleteAccount({ id: u.id, actor: null }, u.email);
    expect(await db.pipConversation.count({ where: { id: cid } })).toBe(0);
    expect(await db.pipMessage.count({ where: { conversationId: cid } })).toBe(0);
    expect(await db.pipAccessLog.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.notice.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.webPushSub.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.userSession.count({ where: { userId: u.id } })).toBe(0);
  });

  test("the wrong confirmation never deletes anything", async () => {
    const { deleteAccount } = await import("../lib/account");
    const u = await db.user.create({ data: { name: "Stay", email: `audit-keep-${Date.now()}@test.dev`, passwordHash: "x" } });
    await expect(deleteAccount({ id: u.id, actor: null }, "someone.else@test.dev")).rejects.toThrow(/doesn't match/i);
    expect(await db.user.count({ where: { id: u.id } })).toBe(1);
  });
});

describe("audit: the copy of your data holds everything we say it does", () => {
  test("Pip chats, support tickets, notices and notification settings are all in the export", async () => {
    const { exportUser } = await import("../lib/account");
    const u = await mkUser("exp");
    const me = await db.user.findUniqueOrThrow({ where: { id: u }, select: { email: true } });
    await db.user.update({ where: { id: u }, data: { notifyPrefs: JSON.stringify({ events: { new_message: false } }) } });
    const cid = await conv.recordTurn({ userId: u, conversation: null, question: "where are my invoices?", answer: "In Billing.", askedAt: new Date() });
    expect(cid).toBeTruthy();
    const t = await db.ticket.create({
      data: { ref: `T-AUD${Date.now().toString(36).toUpperCase()}`, userId: u, email: me.email, name: "Audit Person", subject: "Billing question", messages: { create: [{ author: "customer", authorName: "Audit Person", body: "My card failed." }] } },
    });
    await db.notice.create({ data: { userId: u, kind: "post_live", title: "It went live", body: "On Instagram.", key: `audit-exp-${u}` } });

    const out = await exportUser(u);
    expect(out.pipChats.length).toBe(1);
    expect(out.pipChats[0].messages.map((m) => m.text)).toEqual(["where are my invoices?", "In Billing."]);
    expect(out.supportTickets.map((x) => x.ref)).toContain(t.ref);
    expect(out.supportTickets[0].messages[0].body).toBe("My card failed.");
    expect(out.notices.map((n) => n.title)).toContain("It went live");
    expect(out.notificationSettings).toEqual({ events: { new_message: false } });
    // Still no secrets: the rule the export already kept.
    const text = JSON.stringify(out);
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("accessToken");
  });

  test("broken saved settings never break the export", async () => {
    const { exportUser } = await import("../lib/account");
    const u = await mkUser("expbad");
    await db.user.update({ where: { id: u }, data: { notifyPrefs: "{not json" } });
    const out = await exportUser(u);
    expect(out.notificationSettings).toBeNull();
  });
});

describe("audit: deletion leaves no name on a support ticket", () => {
  test("the thread support needs stays, the person on it does not", async () => {
    const { deleteAccount } = await import("../lib/account");
    const email = `audit-tkt-${Date.now()}@test.dev`;
    const u = await db.user.create({ data: { name: "Gone", email, passwordHash: "x" } });
    const t = await db.ticket.create({
      data: { ref: `T-DEL${Date.now().toString(36).toUpperCase()}`, userId: u.id, email, name: "Gone Person", subject: "Refund", messages: { create: [{ author: "customer", authorName: "Gone Person", body: "Please refund." }] } },
    });
    await deleteAccount({ id: u.id, actor: null }, email);
    const after = await db.ticket.findUniqueOrThrow({ where: { id: t.id }, select: { email: true, name: true, userId: true, subject: true, messages: { select: { authorName: true, body: true } } } });
    expect(after.userId).toBeNull();
    expect(after.subject).toBe("Refund");
    expect(after.messages[0].body).toBe("Please refund.");
    expect(after.email).not.toBe(email);
    expect(after.email.endsWith("@outlly.invalid")).toBe(true);
    expect(after.name).toBeNull();
    expect(after.messages[0].authorName).toBeNull();
  });
});

describe("audit: a device renewing its own push subscription", () => {
  test("the same device moves to its new endpoint, another device's endpoint is refused out loud", async () => {
    const { POST } = await import("../app/api/push/renew/route");
    const { endpointHash } = await import("../lib/push/webpush");
    const { NextRequest } = await import("next/server");
    const u = await mkUser("renew");
    const mk = async (tag: string) => {
      const endpoint = `https://fcm.googleapis.com/fcm/send/${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await db.webPushSub.create({ data: { userId: u, endpointHash: endpointHash(endpoint), endpoint: "e", p256dh: "p", auth: "a", vapidKey: "k", platform: "desktop", device: "Windows PC", client: "Chrome", failures: 3 } });
      return endpoint;
    };
    const mine = await mk("mine");
    const other = await mk("other");
    const call = (old: string, next: string) =>
      POST(
        new NextRequest("http://localhost/api/push/renew", {
          method: "POST",
          body: JSON.stringify({ old, sub: { endpoint: next, keys: { p256dh: Buffer.alloc(65, 1).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } } }),
          headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
        }),
        { params: {} } as never,
      );

    const fresh = `https://fcm.googleapis.com/fcm/send/fresh-${Date.now()}`;
    const ok = await call(mine, fresh);
    expect(ok.status).toBe(200);
    expect(await db.webPushSub.count({ where: { endpointHash: endpointHash(fresh) } })).toBe(1);
    expect((await db.webPushSub.findUniqueOrThrow({ where: { endpointHash: endpointHash(fresh) }, select: { failures: true } })).failures).toBe(0);

    // The new endpoint already belongs to another device: never a silent ok.
    const clash = await call(fresh, other);
    expect(clash.status).toBe(409);
    expect((await clash.json()).ok).toBe(false);
    expect(await db.webPushSub.count({ where: { endpointHash: endpointHash(fresh) } })).toBe(1);

    // An endpoint nobody holds is still a 404, and the same endpoint twice is still a success.
    expect((await call("https://fcm.googleapis.com/fcm/send/nobody", fresh)).status).toBe(404);
    expect((await call(fresh, fresh)).status).toBe(200);
  });
});

describe("audit: at most one new-message alert an hour", () => {
  test("two minutes later in the next clock hour does not alert again; an hour later does", async () => {
    const { noticeNewMessage } = await import("../lib/notify-events");
    const u = await mkUser("dm");
    const thread = `audit-thread-${Date.now()}`;
    const count = () => db.notice.count({ where: { userId: u, kind: "new_message" } });
    await noticeNewMessage(u, thread, "instagram", "Ada", "hello", new Date());
    expect(await count()).toBe(1);
    // 10:59 then 11:01 used to be two alerts because the key held the clock hour.
    await noticeNewMessage(u, thread, "instagram", "Ada", "again", new Date(Date.now() + 2 * 60_000));
    expect(await count()).toBe(1);
    // 59 minutes is still inside the hour, whichever clock hour it lands in.
    await noticeNewMessage(u, thread, "instagram", "Ada", "still inside", new Date(Date.now() + 59 * 60_000));
    expect(await count()).toBe(1);
    await noticeNewMessage(u, thread, "instagram", "Ada", "much later", new Date(Date.now() + 61 * 60_000));
    expect(await count()).toBe(2);
    // Another thread is its own hour.
    await noticeNewMessage(u, `${thread}-two`, "instagram", "Grace", "hi", new Date());
    expect(await count()).toBe(3);
  });
});

describe("audit: nothing connected is not the same answer as nothing published", () => {
  test("Pip says to connect an account instead of blaming an empty period", async () => {
    const u = await mkUser("noacct");
    const r = await runTool("overview", ctxFor(u, "how did I do last 30 days?"), {});
    expect(r.empty).toBeTruthy();
    expect(r.empty!.toLowerCase()).toContain("connect");
    expect(r.rows?.length ?? 0).toBe(0);
  });

  test("with an account connected and nothing published, the answer is about posts again", async () => {
    const u = await mkUser("acctnopost");
    await db.socialAccount.create({ data: { userId: u, platform: "instagram", platformUserId: `audit-np-${Date.now()}`, username: "@auditor", accessToken: "x", status: "connected" } });
    const r = await runTool("overview", ctxFor(u, "how did I do last 30 days?"), {});
    expect(r.empty).toBeTruthy();
    expect(r.empty!.toLowerCase()).toContain("published posts");
  });
});

describe("audit: the analytics page says what it measures", () => {
  const src = () => read("components/analytics/AnalyticsView.tsx");
  test("views are called views, not people reached", () => {
    const s = src();
    expect(s).not.toContain("people {range.phrase}");
    expect(s).toContain("views {range.phrase}");
  });

  test("the chart draws the platforms in the data, not only the ones switched on", () => {
    const s = src();
    const chart = s.slice(s.indexOf('<h2 id="trend"'), s.indexOf("</AreaChart>"));
    expect(chart).not.toContain("live.map(");
    expect(chart).toContain("drawn.map(");
    expect(s).toContain("const drawn = PLATFORMS.filter((p) => live.includes(p) || data.byPlatform.some((b) => b.platform === p && b.views > 0));");
  });
});
