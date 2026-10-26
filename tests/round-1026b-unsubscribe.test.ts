/** 10-26b: marketing email carries a working unsubscribe (link + RFC 8058 one-click), account email never does. */
import { beforeAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

let U: typeof import("../lib/email/unsubscribe");
let E: typeof import("../lib/email");
let db: typeof import("../lib/db").db;
let POST: typeof import("../app/api/email/unsubscribe/route").POST;

beforeAll(async () => {
  process.env.APP_URL = "https://outlly.test";
  U = await import("../lib/email/unsubscribe");
  E = await import("../lib/email");
  db = (await import("../lib/db")).db;
  POST = (await import("../app/api/email/unsubscribe/route")).POST;
}, 60_000);

const addr = (tag: string) => `Unsub-${tag}-${Date.now()}@Test.dev`;
const html = () => E.templates.invoice({ name: "Tej", number: "INV-1", amount: "$19.00", plan: "Pro", url: "https://outlly.test/billing" });
const cfg = { provider: "mock" as const, from: "Outlly <hello@mail.outlly.com>", marketingFrom: "Outlly <hi@news.outlly.com>", replyTo: "", resend: { apiKey: "" } };

describe("signed unsubscribe token", () => {
  test("round-trips, lower-cased", () => {
    const e = addr("tok");
    expect(U.readUnsubToken(U.unsubToken(e, "news"))).toEqual({ email: e.toLowerCase(), list: "news" });
  });
  test("a tampered address or list is refused", () => {
    const t = U.unsubToken("a@test.dev", "news");
    const [, sig] = t.split(".");
    expect(U.readUnsubToken(`${Buffer.from("b@test.dev|news").toString("base64url")}.${sig}`)).toBeNull();
    expect(U.readUnsubToken(`${Buffer.from("a@test.dev|weekly").toString("base64url")}.${sig}`)).toBeNull();
    expect(U.readUnsubToken("junk")).toBeNull();
    expect(U.readUnsubToken(undefined)).toBeNull();
  });
});

describe("which email is marketing", () => {
  test("nudges, win-back, growth and the weekly report can be left; account email can't", () => {
    expect(U.listFor("nudge")).toBe("news");
    expect(U.listFor("growth")).toBe("news");
    expect(U.listFor("weekly_report")).toBe("weekly");
    for (const k of ["otp", "invoice", "security", "ticket_reply", "team_invite"]) expect(U.listFor(k)).toBeNull();
  });
  test("marketing goes from the news sender, account email from the main one", () => {
    expect(E.senderFor("nudge", cfg)).toBe(cfg.marketingFrom);
    expect(E.senderFor("otp", cfg)).toBe(cfg.from);
    expect(E.senderFor("nudge", { from: cfg.from, marketingFrom: "" })).toBe(cfg.from);
  });
  test("one-click headers point at the POST endpoint", () => {
    const h = E.unsubscribeHeaders("a@test.dev", "news");
    expect(h["List-Unsubscribe"]).toMatch(/^<https:\/\/outlly\.test\/api\/email\/unsubscribe\?t=.+>$/);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
  test("footer slot: link on marketing, nothing on account email, never a leftover marker", () => {
    const m = E.withUnsubscribe(html(), "a@test.dev", "news");
    expect(m).toContain("https://outlly.test/unsubscribe?t=");
    expect(m).not.toContain("outlly:unsub");
    const a = E.withUnsubscribe(html(), "a@test.dev", null);
    expect(a).not.toContain("Unsubscribe");
    expect(a).not.toContain("outlly:unsub");
  });
});

describe("sending respects the opt-out", () => {
  test("an opted-out address is skipped for marketing but still gets account email", async () => {
    const e = addr("send");
    await U.optOut(e, "news");
    const m = await E.sendEmail({ to: e, subject: "Come back", html: html(), kind: "winback" } as any, cfg);
    expect(m.status).toBe("skipped");
    const a = await E.sendEmail({ to: e, subject: "Your code", html: html(), kind: "otp" } as any, cfg);
    expect(a.status).toBe("mocked");
    await U.optIn(e, "news");
    expect(await U.isSubscribed(e, "news")).toBe(true);
  });
  test("weekly list flips User.weeklyReport", async () => {
    const e = addr("weekly").toLowerCase();
    await db.user.create({ data: { name: "W", email: e, passwordHash: "x" } });
    await U.optOut(e, "weekly");
    expect((await db.user.findUnique({ where: { email: e } }))?.weeklyReport).toBe(false);
    expect(await U.isOptedOut(e, "weekly_report")).toBe(true);
    expect(await U.isOptedOut(e, "nudge")).toBe(false);
  });
});

describe("POST /api/email/unsubscribe", () => {
  const req = (t: string, body: string) =>
    new NextRequest(`https://outlly.test/api/email/unsubscribe?t=${encodeURIComponent(t)}`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "10.9.9.9" } });

  test("Gmail one-click: no Origin, plain 200, address removed", async () => {
    const e = addr("oneclick");
    const r = await POST(req(U.unsubToken(e, "news"), "List-Unsubscribe=One-Click"));
    expect(r.status).toBe(200);
    expect(await U.isSubscribed(e, "news")).toBe(false);
  });
  test("our page's form redirects back, and undo works", async () => {
    const e = addr("form");
    const t = U.unsubToken(e, "news");
    const out = await POST(req(t, "action=out"));
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toContain("done=out");
    const back = await POST(req(t, "action=in"));
    expect(back.headers.get("location")).toContain("done=in");
    expect(await U.isSubscribed(e, "news")).toBe(true);
  });
  test("any provider POST without our `action` field gets a 2xx, never a redirect", async () => {
    const e = addr("probe");
    const r = await POST(req(U.unsubToken(e, "news"), "x=1"));
    expect(r.status).toBe(200);
    expect(await U.isSubscribed(e, "news")).toBe(false);
  });
  test("many people unsubscribing through one Gmail IP are not rate-limited", async () => {
    for (let i = 0; i < 40; i++) expect((await POST(req(U.unsubToken(addr(`bulk${i}`), "news"), "List-Unsubscribe=One-Click"))).status).toBe(200);
  });
  test("weekly opt-out for an address with no account still sticks", async () => {
    const e = addr("gone");
    await POST(req(U.unsubToken(e, "weekly"), "List-Unsubscribe=One-Click"));
    expect(await U.isSubscribed(e, "weekly")).toBe(false);
  });
  test("a bad token is a 400 and changes nothing", async () => {
    expect((await POST(req("nope.nope", "List-Unsubscribe=One-Click"))).status).toBe(400);
  });
});
