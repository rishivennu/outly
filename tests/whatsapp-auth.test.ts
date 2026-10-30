/**
 * 1060: Continue with WhatsApp (one flow for sign in and sign up, account linking), and Forgot password by
 * WhatsApp, against the test database. Meta's API and the email channel are stubbed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let settings: typeof import("../lib/settings");
let wa: typeof import("../lib/otp/whatsapp");
let flow: typeof import("../lib/otp/wa-auth");
let provider: typeof import("../lib/auth-provider");
let channel: typeof import("../lib/otp/channel");

const realFetch = globalThis.fetch;
const sent: { to: string; code: string }[] = [];
const mailed: { to: string; code: string; purpose?: string; link?: boolean; name: string | null }[] = [];
let realEmailSend: typeof import("../lib/otp/channel").emailChannel.send;

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  settings = await import("../lib/settings");
  wa = await import("../lib/otp/whatsapp");
  flow = await import("../lib/otp/wa-auth");
  provider = await import("../lib/auth-provider");
  channel = await import("../lib/otp/channel");
  // Only Graph calls are faked; the code is read out of the template body, like the user would read it.
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://graph.facebook.com/")) {
      const b = JSON.parse(String(init?.body ?? "{}"));
      sent.push({ to: b.to, code: b.template.components[0].parameters[0].text });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(url as never, init);
  }) as typeof fetch;
  realEmailSend = channel.emailChannel.send;
  channel.emailChannel.send = async (to, code, ctx) => {
    mailed.push({ to, code, purpose: ctx.purpose, link: ctx.link, name: ctx.name });
    return { ok: true };
  };
  await settings.saveConfig("site", { waitlist: false });
  await settings.saveConfig("whatsapp", { enabled: true, phoneNumberId: "123", token: "test-token", template: "outlly_code", lang: "en" });
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  channel.emailChannel.send = realEmailSend;
  await settings.saveConfig("whatsapp", { enabled: false });
});

const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
// A fresh, valid Indian mobile for every test, so the per-number cooldowns never collide.
const number = () => `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const lastCode = (phone: string) => [...sent].reverse().find((m) => m.to === phone.slice(1))!.code;
const lastMail = (email: string) => [...mailed].reverse().find((m) => m.to === email)!;
const proofFor = async (phone: string) => (await flow.liveProof(await flow.startProof(phone)))!;
const wrong = (c: string) => String((Number(c) + 1) % 1_000_000).padStart(6, "0");

describe("Continue with WhatsApp: the number", () => {
  test("a number with no account still gets a code, and the same answer", async () => {
    const phone = number();
    const r = await flow.sendWhatsAppCode(phone);
    expect(r.ok).toBe(true);
    expect(lastCode(phone)).toMatch(/^\d{6}$/);
    // Proving it hands back the number, not an account.
    expect(await flow.checkWhatsAppCode(phone, lastCode(phone))).toEqual({ phone });
  });

  test("a number on an account signs that account in", async () => {
    const phone = number();
    const u = await db.user.create({ data: { name: "In", email: `in-${tag()}@test.dev`, phone, phoneVerifiedAt: new Date() } });
    const before = sent.length;
    await flow.sendWhatsAppCode(phone.slice(3)); // typed without +91
    expect(sent.length).toBe(before + 1);
    expect(await flow.checkWhatsAppCode(phone, lastCode(phone))).toEqual({ userId: u.id });
  });

  test("an unproven number on an account is treated as no account", async () => {
    const phone = number();
    await db.user.create({ data: { name: "Half", email: `half-${tag()}@test.dev`, phone } });
    await flow.sendWhatsAppCode(phone);
    expect(await flow.checkWhatsAppCode(phone, lastCode(phone))).toEqual({ phone });
  });

  test("a wrong code fails, the right one works once, and resends are rate-limited", async () => {
    const phone = number();
    await flow.sendWhatsAppCode(phone);
    const code = lastCode(phone);
    await expect(flow.checkWhatsAppCode(phone, wrong(code))).rejects.toMatchObject({ status: 401 });
    await expect(flow.sendWhatsAppCode(phone)).rejects.toMatchObject({ status: 429, code: "OTP_COOLDOWN" });
    await flow.checkWhatsAppCode(phone, code);
    await expect(flow.checkWhatsAppCode(phone, code)).rejects.toMatchObject({ status: 401 });
  });

  test("a junk number gets a plain answer and no message", async () => {
    const before = sent.length;
    await expect(flow.sendWhatsAppCode("12345")).rejects.toMatchObject({ status: 400, code: "PHONE_SHAPE" });
    expect(sent.length).toBe(before);
  });

  test("off in Admin: no codes at all", async () => {
    await settings.saveConfig("whatsapp", { enabled: false });
    try {
      await expect(flow.sendWhatsAppCode(number())).rejects.toMatchObject({ status: 503, code: "WA_UNAVAILABLE" });
    } finally {
      await settings.saveConfig("whatsapp", { enabled: true, phoneNumberId: "123", token: "test-token", template: "outlly_code", lang: "en" });
    }
  });
});

describe("Continue with WhatsApp: the proof cookie", () => {
  test("round-trips, expires after 15 minutes, and can't be forged", () => {
    const now = Date.now();
    const sealed = flow.sealProof("+919876543210", "n0nce", now);
    expect(sealed).not.toContain("9876543210");
    expect(flow.openProof(sealed, now + 60_000)).toEqual({ phone: "+919876543210", nonce: "n0nce" });
    expect(flow.openProof(sealed, now + flow.PROOF_MS + 1)).toBeNull();
    expect(flow.openProof(sealed.slice(0, -4) + "AAAA", now)).toBeNull();
    expect(flow.openProof(JSON.stringify({ p: "+919876543210", e: now + 1e9 }), now)).toBeNull();
    expect(flow.openProof(undefined)).toBeNull();
  });

  test("another sealed value can't pass as a proof (it needs the wa-proof tag)", async () => {
    const { encrypt } = await import("../lib/crypto");
    expect(flow.openProof(encrypt(JSON.stringify({ p: "+919876543210", n: "x", e: Date.now() + 1e6 })))).toBeNull();
  });

  test("single use: spent once, and a replay of the same cookie is dead", async () => {
    const sealed = await flow.startProof(number());
    const p = await flow.liveProof(sealed);
    expect(p).not.toBeNull();
    expect(await flow.spendProof(p!)).toBe(true);
    expect(await flow.spendProof(p!)).toBe(false);
    expect(await flow.liveProof(sealed)).toBeNull();
  });

  test("a sealed proof with no row behind it (never issued) is dead", async () => {
    expect(await flow.liveProof(flow.sealProof(number(), "never-issued"))).toBeNull();
  });
});

describe("Continue with WhatsApp: a new account, or linking", () => {
  test("a new email: code by email, then one account with both proven and no password", async () => {
    const phone = number();
    const email = `new-${tag()}@test.dev`;
    await flow.sendEmailProof(email, "Asha Rao", { proof: await proofFor(phone) });
    const m = lastMail(email);
    expect(m.purpose).toBe("signup");
    expect(m.link).toBeFalsy();
    expect(m.name).toBe("Asha");
    await expect(flow.checkEmailProof(email, wrong(m.code))).rejects.toMatchObject({ status: 401 });
    const proven = await flow.checkEmailProof(email.toUpperCase(), m.code);
    const u = await provider.createOrLinkWithPhone("Asha Rao", proven, phone);
    expect(u).toMatchObject({ created: true, linked: false });
    const row = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row).toMatchObject({ email, phone, passwordHash: null });
    expect(row.phoneVerifiedAt).not.toBeNull();
    expect(row.emailVerifiedAt).not.toBeNull();
    // Spent: the same email code can't be used again.
    await expect(flow.checkEmailProof(email, m.code)).rejects.toMatchObject({ status: 401 });
  });

  test("any email gets a code, account or not, so the step can't be used to look emails up", async () => {
    const taken = await db.user.create({ data: { name: "Has", email: `has-${tag()}@test.dev`, passwordHash: "x" } });
    const proof = await proofFor(number());
    expect(await flow.sendEmailProof(taken.email, "Whoever", { proof })).toEqual({ ok: true });
    expect(await flow.sendEmailProof(`nobody-${tag()}@test.dev`, "Whoever", { proof })).toEqual({ ok: true });
    // The account's owner is told a number is being added, and never sees the requester's name.
    expect(lastMail(taken.email)).toMatchObject({ link: true, name: null });
  });

  test("one proven number can only mail a few addresses", async () => {
    const proof = await proofFor(number());
    for (let i = 0; i < flow.PROOF_MAILS; i++) await flow.sendEmailProof(`many-${i}-${tag()}@test.dev`, "Spam", { proof });
    await expect(flow.sendEmailProof(`many-x-${tag()}@test.dev`, "Spam", { proof })).rejects.toMatchObject({ status: 429 });
  });

  test("an email already on an account links the number to it, never a second account", async () => {
    const phone = number();
    const owner = await db.user.create({ data: { name: "Owner", email: `own-${tag()}@test.dev`, passwordHash: "x" } });
    const count = await db.user.count();
    const r = await provider.createOrLinkWithPhone("Someone", owner.email, phone);
    expect(r).toEqual({ id: owner.id, created: false, linked: true });
    expect(await db.user.count()).toBe(count);
    const row = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(row.phone).toBe(phone);
    expect(row.name).toBe("Owner"); // the typed name doesn't overwrite the account's
    expect(row.passwordHash).toBe("x"); // the password still works
  });

  test("an account with another number keeps it", async () => {
    const owner = await db.user.create({ data: { name: "O", email: `other-${tag()}@test.dev`, phone: number(), phoneVerifiedAt: new Date() } });
    await expect(provider.createOrLinkWithPhone("O", owner.email, number())).rejects.toMatchObject({ status: 409, code: "PHONE_OTHER" });
  });

  test("a number typed on another account but never proven there goes to the person who proved it", async () => {
    const phone = number();
    const squatter = await db.user.create({ data: { name: "Typed", email: `typed-${tag()}@test.dev`, phone } });
    const r = await provider.createOrLinkWithPhone("Real", `real-${tag()}@test.dev`, phone);
    expect(r.created).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { id: squatter.id } })).phone).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: r.id } })).phone).toBe(phone);
  });

  test("a number someone else just took is refused", async () => {
    const phone = number();
    await db.user.create({ data: { name: "First", email: `first-${tag()}@test.dev`, phone, phoneVerifiedAt: new Date() } });
    await expect(provider.createOrLinkWithPhone("Second", `second-${tag()}@test.dev`, phone)).rejects.toMatchObject({ status: 409, code: "PHONE_TAKEN" });
  });
});

describe("Forgot password by WhatsApp", () => {
  test("a reset code works only for resetting, and a sign-in code never resets", async () => {
    const phone = number();
    const u = await db.user.create({ data: { name: "R", email: `r-${tag()}@test.dev`, phone, phoneVerifiedAt: new Date() } });
    await wa.issuePhoneLogin(phone, "reset");
    const code = lastCode(phone);
    await expect(flow.checkWhatsAppCode(phone, code)).rejects.toMatchObject({ status: 401 }); // not a sign-in code
    await expect(wa.verifyPhoneLogin(phone, code, "login")).rejects.toMatchObject({ status: 401 });
    expect(await wa.verifyPhoneLogin(phone, code, "reset")).toEqual({ id: u.id });
    await provider.setPassword(u.id, "brand-new-pass");
    expect(await provider.signIn(u.email, "brand-new-pass")).toEqual({ id: u.id });
  });

  test("an unknown number gets the same answer and no message", async () => {
    const phone = number();
    const before = sent.length;
    expect(await wa.issuePhoneLogin(phone, "reset")).toEqual({ ok: true });
    expect(sent.length).toBe(before);
  });
});

describe("password sign-in never says whether an email has an account", () => {
  test("no password set and a wrong password read the same", async () => {
    const nopw = await db.user.create({ data: { name: "W", email: `nopw-${tag()}@test.dev` } });
    const pw = `pw-${tag()}@test.dev`;
    await provider.signUp("P", pw, "right-password-1");
    const a = await provider.signIn(nopw.email, "whatever1").catch((e) => e);
    const b = await provider.signIn(pw, "wrong-password-1").catch((e) => e);
    const c = await provider.signIn(`ghost-${tag()}@test.dev`, "whatever1").catch((e) => e);
    expect(a.status).toBe(401);
    expect(a.message).toBe(b.message);
    expect(b.message).toBe(c.message);
    expect(a.message).toContain("reset your password");
  });
});
