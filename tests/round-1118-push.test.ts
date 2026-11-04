/** 1118: Web Push (RFC 8291 encryption, RFC 8292 VAPID), notification preferences, devices, and saved cards. */
import { describe, expect, test } from "bun:test";
import { createDecipheriv, createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_PLAINTEXT, allowedEndpoint, b64u, encrypt, generateVapid, hkdf, outcomeOf, retryDelayMs, validVapid, vapidHeader } from "../lib/push/webpush-core";
import { describeDevice } from "../lib/push/device-core";
import { CATEGORIES, EVENTS, NOTIFY_DEFAULTS, applyPatch, decide, inQuietHours, parseNotifyPrefs, serializeNotifyPrefs } from "../lib/notify-core";
import { reminderDue } from "../lib/retention/reminders";
import { payloadOf } from "../lib/push/webpush";
import { urlB64ToBytes } from "../lib/client/push";
import { cardOfToken, networkOf, savedCardsOf } from "../lib/billing/saved-cards-core";
import { db } from "../lib/db";
import { notify } from "../lib/retention/notices";

const src = (f: string) => readFileSync(join(import.meta.dir, "..", f), "utf8").replace(/\r\n/g, "\n");
const TZ = "Asia/Kolkata";

/** What the browser does with a push: decrypt it with its private key and auth secret (RFC 8291). */
function browserDecrypt(msg: Buffer, ua: ReturnType<typeof createECDH>, auth: Buffer) {
  const salt = msg.subarray(0, 16);
  const rs = msg.readUInt32BE(16);
  const idlen = msg.readUInt8(20);
  const asPublic = msg.subarray(21, 21 + idlen);
  const body = msg.subarray(21 + idlen);
  const uaPublic = ua.getPublicKey();
  const ikm = hkdf(auth, ua.computeSecret(asPublic), Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
  return { rs, idlen, plain };
}

describe("1118 web push encryption", () => {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  const keys = { p256dh: b64u.enc(ua.getPublicKey()), auth: b64u.enc(auth) };

  test("only the subscribed browser can read it, and it reads back exactly", () => {
    const text = JSON.stringify({ t: "Post Published", b: "Your Instagram post is live now." });
    const out = browserDecrypt(encrypt(Buffer.from(text), keys), ua, auth);
    expect(out.rs).toBe(4096);
    expect(out.idlen).toBe(65);
    expect(out.plain[out.plain.length - 1]).toBe(2); // last-record delimiter
    expect(out.plain.subarray(0, -1).toString()).toBe(text);
  });
  test("a different browser key can't decrypt it", () => {
    const other = createECDH("prime256v1");
    other.generateKeys();
    expect(() => browserDecrypt(encrypt(Buffer.from("hi"), keys), other, auth)).toThrow();
  });
  test("refuses oversize payloads and malformed keys", () => {
    expect(() => encrypt(Buffer.alloc(MAX_PLAINTEXT + 1), keys)).toThrow();
    expect(() => encrypt(Buffer.from("x"), { p256dh: b64u.enc(Buffer.alloc(65)), auth: keys.auth })).toThrow();
    expect(() => encrypt(Buffer.from("x"), { p256dh: keys.p256dh, auth: b64u.enc(Buffer.alloc(8)) })).toThrow();
  });
  test("the largest allowed payload still fits a 4096-byte push body", () => {
    expect(encrypt(Buffer.alloc(MAX_PLAINTEXT, 97), keys).length).toBeLessThanOrEqual(4096);
  });
});

describe("1118 VAPID", () => {
  const v = { ...generateVapid(), subject: "mailto:support@outlly.com" };
  test("generated pairs validate; a mismatched pair doesn't", () => {
    expect(validVapid(v.publicKey, v.privateKey)).toBe(true);
    expect(validVapid(generateVapid().publicKey, v.privateKey)).toBe(false);
    expect(validVapid("junk", "junk")).toBe(false);
  });
  test("the JWT is ES256, signed by our key, for the push service origin, under an hour", () => {
    const now = Date.UTC(2026, 10, 4, 12);
    const h = vapidHeader("https://web.push.apple.com/QWxhZGRpbg", v, now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m).toBeTruthy();
    expect(m[4]).toBe(v.publicKey);
    expect(JSON.parse(b64u.dec(m[1]).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(b64u.dec(m[2]).toString());
    expect(claims.aud).toBe("https://web.push.apple.com");
    expect(claims.sub).toBe(v.subject);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(3600);
    const pub = b64u.dec(v.publicKey);
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u.enc(pub.subarray(1, 33)), y: b64u.enc(pub.subarray(33)) }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, b64u.dec(m[3]))).toBe(true);
  });
});

describe("1118 delivery rules", () => {
  test("only real push services are allowed as endpoints", () => {
    for (const ok of ["https://web.push.apple.com/abc", "https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) expect(allowedEndpoint(ok)).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://evil.com/fcm.googleapis.com", "https://169.254.169.254/", "not a url", `https://fcm.googleapis.com/${"a".repeat(1100)}`]) expect(allowedEndpoint(bad)).toBe(false);
  });
  test("push service answers map to outcomes; retries back off then stop", () => {
    expect(outcomeOf(201)).toBe("sent");
    expect(outcomeOf(410)).toBe("gone");
    expect(outcomeOf(404)).toBe("gone");
    expect(outcomeOf(429)).toBe("retry");
    expect(outcomeOf(503)).toBe("retry");
    expect(outcomeOf(null)).toBe("retry");
    expect(outcomeOf(403)).toBe("rejected");
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([60_000, 300_000, 900_000, 3_600_000, undefined]);
  });
  test("payload is capped and links stay inside the app", () => {
    const p = JSON.parse(payloadOf({ title: "T".repeat(500), body: "B".repeat(5000), tag: "g".repeat(200), href: "//evil.com", badge: 5000 }));
    expect(p.t.length).toBe(120);
    expect(p.b.length).toBe(400);
    expect(p.g.length).toBe(64);
    expect(p.h).toBe("/home");
    expect(p.n).toBe(999);
    expect(JSON.parse(payloadOf({ title: "x", body: "y", tag: "z", href: "/compose?post=1" })).h).toBe("/compose?post=1");
  });
  test("reminders fire inside the chosen lead only", () => {
    expect(reminderDue(10, 15)).toBe(true);
    expect(reminderDue(15, 15)).toBe(true);
    expect(reminderDue(20, 15)).toBe(false);
    expect(reminderDue(0, 15)).toBe(false);
  });
});

describe("1118 preferences", () => {
  test("five categories cover every event exactly once", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(["publishing", "schedule", "account", "engagement", "billing"]);
    expect(CATEGORIES.flatMap((c) => c.events).sort()).toEqual([...EVENTS].sort());
  });
  test("Disable all leaves essential alerts on; Enable all turns everything on", () => {
    const off = applyPatch(NOTIFY_DEFAULTS, { all: false });
    expect(off.ev.post_live).toBe(false);
    expect(off.ev.reconnect).toBe(true);
    expect(off.ev.payment_failed).toBe(true);
    expect(Object.values(applyPatch(off, { all: true }).ev).every(Boolean)).toBe(true);
  });
  test("category, lead and quiet patches validate their input", () => {
    const p = applyPatch(NOTIFY_DEFAULTS, { category: { id: "schedule", on: false }, lead: 30, quiet: { on: true, start: "23:00", end: "25:99" } });
    expect(p.ev.remind).toBe(false);
    expect(p.ev.schedule_change).toBe(false);
    expect(p.lead).toBe(30);
    expect(p.quiet.start).toBe("23:00");
    expect(p.quiet.end).toBe(NOTIFY_DEFAULTS.quiet.end);
    expect(applyPatch(NOTIFY_DEFAULTS, { lead: 7 as any }).lead).toBe(15);
  });
  test("old alert switches carry over; junk falls back to defaults", () => {
    const p = parseNotifyPrefs(null, { failed: false, spike: true });
    expect(p.ev.post_failed).toBe(false);
    expect(p.ev.engagement_spike).toBe(true);
    expect(parseNotifyPrefs("{not json").lead).toBe(15);
    expect(parseNotifyPrefs(serializeNotifyPrefs(applyPatch(NOTIFY_DEFAULTS, { lead: 60 }))).lead).toBe(60);
  });
  test("quiet hours cross midnight in the creator's zone; urgent alerts ring through", () => {
    const q = { on: true, start: "22:00", end: "07:00", urgent: true };
    const night = new Date("2026-10-15T18:00:00Z"); // 23:30 IST
    const noon = new Date("2026-10-15T06:30:00Z"); // 12:00 IST
    expect(inQuietHours(q, night, TZ)).toBe(true);
    expect(inQuietHours(q, noon, TZ)).toBe(false);
    const p = applyPatch(NOTIFY_DEFAULTS, { quiet: q });
    expect(decide(p, "post_live", night, TZ)).toMatchObject({ wanted: true, bell: true, push: false, quieted: true });
    expect(decide(p, "payment_failed", night, TZ).push).toBe(true);
    expect(decide(applyPatch(p, { quiet: { urgent: false } }), "payment_failed", night, TZ).push).toBe(false);
  });
  test("channels: in-app off files the notice as read, except essentials", () => {
    const p = applyPatch(NOTIFY_DEFAULTS, { ch: { inApp: false, push: false } });
    expect(decide(p, "post_live", new Date(), TZ)).toMatchObject({ wanted: true, bell: false, push: false });
    expect(decide(p, "reconnect", new Date(), TZ).bell).toBe(true);
    expect(decide(applyPatch(NOTIFY_DEFAULTS, { ev: { milestone: false } }), "milestone", new Date(), TZ).wanted).toBe(false);
  });
});

describe("1118 devices", () => {
  test("names devices from the user agent", () => {
    expect(describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1", { installed: true })).toMatchObject({ platform: "ios", device: "iPhone" });
    expect(describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15", { touchMac: true })).toMatchObject({ platform: "ios", device: "iPad" });
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36")).toMatchObject({ platform: "android", device: "Android phone" });
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toMatchObject({ platform: "desktop", device: "Windows PC" });
  });
  test("applicationServerKey decodes from base64url to the 65-byte key", () => {
    const { publicKey } = generateVapid();
    const bytes = urlB64ToBytes(publicKey);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(4);
    expect(Buffer.from(bytes).toString("base64url")).toBe(publicKey);
  });
  test("the service worker shows every push, handles taps and key rotation", () => {
    const sw = src("public/sw.js");
    for (const s of ['addEventListener("push"', 'addEventListener("notificationclick"', 'addEventListener("pushsubscriptionchange"', "showNotification(", "clients.matchAll", "openWindow(", "setAppBadge"]) expect(sw).toContain(s);
  });
});

describe("1118 notify() follows the settings (database)", () => {
  const mk = async (prefs: Parameters<typeof applyPatch>[1]) =>
    db.user.create({ data: { name: "Push Test", email: `push-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`, passwordHash: "x", notifyPrefs: serializeNotifyPrefs(applyPatch(NOTIFY_DEFAULTS, prefs)) } });
  const n = (key: string) => ({ kind: "post_live" as const, tone: "info" as const, title: "Post Published", body: "Your Instagram post is live now.", key });

  test("an event switched off creates nothing", async () => {
    const u = await mk({ ev: { post_live: false } });
    const r = await notify(u.id, n(`t-off-${u.id}`));
    expect(r.created).toBe(false);
    expect(await db.notice.count({ where: { userId: u.id } })).toBe(0);
  });
  test("in-app off still keeps the notice, filed as read", async () => {
    const u = await mk({ ch: { inApp: false, push: false } });
    const r = await notify(u.id, n(`t-read-${u.id}`));
    expect(r.created).toBe(true);
    const row = await db.notice.findUniqueOrThrow({ where: { id: r.id! } });
    expect(row.readAt).not.toBeNull();
  });
  test("defaults: unread in the bell, once per key", async () => {
    const u = await mk({ ch: { push: false } });
    const a = await notify(u.id, n(`t-once-${u.id}`));
    const b = await notify(u.id, n(`t-once-${u.id}`));
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(await db.notice.count({ where: { userId: u.id, readAt: null } })).toBe(1);
  });
});

describe("1118 saved cards (Razorpay tokens -> masked cards)", () => {
  const now = new Date("2026-11-04T00:00:00Z");
  const tok = (id: string, card: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, entity: "token", method: "card", card, created_at: 1_790_000_000, ...extra });

  test("maps network, last 4, expiry and type; never more", () => {
    const c = cardOfToken(tok("token_A1", { network: "Visa", last4: "4242", expiry_month: 8, expiry_year: 2028, type: "credit", issuer: "HDFC", number: "4111111111114242" }), now)!;
    expect(c).toMatchObject({ id: "token_A1", network: "visa", networkLabel: "Visa", last4: "4242", expiry: "08/28", expired: false, type: "credit", issuer: "HDFC" });
    expect(JSON.stringify(c)).not.toContain("4111111111114242");
  });
  test("networks normalise, unknowns are just 'Card'", () => {
    expect(networkOf("American Express")[0]).toBe("amex");
    expect(networkOf("RuPay")[0]).toBe("rupay");
    expect(networkOf("MasterCard")[0]).toBe("mastercard");
    expect(networkOf("Bajaj")).toEqual(["card", "Card"]);
  });
  test("expired by date (end of month) or by token; non-card tokens dropped", () => {
    expect(cardOfToken(tok("t1", { network: "Visa", last4: "1111", expiry_month: 10, expiry_year: 2026 }), now)!.expired).toBe(true);
    expect(cardOfToken(tok("t2", { network: "Visa", last4: "1111", expiry_month: 11, expiry_year: 2026 }), now)!.expired).toBe(false);
    expect(cardOfToken(tok("t3", { network: "Visa", last4: "1111", expiry_month: 1, expiry_year: 2030 }, { expired_at: 1_700_000_000 }), now)!.expired).toBe(true);
    expect(cardOfToken({ id: "t4", method: "upi", vpa: { username: "x" } }, now)).toBeNull();
    expect(cardOfToken(tok("t5", { network: "Visa", last4: "12" }), now)).toBeNull();
  });
  test("default: the picked card if usable, else the most recently used live card", () => {
    const list = [
      tok("token_old", { network: "Visa", last4: "1111", expiry_month: 1, expiry_year: 2030 }, { used_at: 1_790_000_100, created_at: 1_780_000_000 }),
      tok("token_new", { network: "Mastercard", last4: "2222", expiry_month: 1, expiry_year: 2030 }, { used_at: 1_790_000_900, created_at: 1_790_000_000 }),
      tok("token_dead", { network: "RuPay", last4: "3333", expiry_month: 1, expiry_year: 2025 }, { created_at: 1_791_000_000 }),
    ];
    const auto = savedCardsOf(list, null, now);
    expect(auto.map((c) => c.id)).toEqual(["token_dead", "token_new", "token_old"]);
    expect(auto.find((c) => c.isDefault)?.id).toBe("token_new");
    expect(savedCardsOf(list, "token_old", now).find((c) => c.isDefault)?.id).toBe("token_old");
    expect(savedCardsOf(list, "token_dead", now).find((c) => c.isDefault)?.id).toBe("token_new");
    expect(savedCardsOf([...list, list[0]], null, now).length).toBe(3);
  });
  test("checkout asks for consent and stores no card data on our side", () => {
    const view = src("components/billing/BillingView.tsx");
    expect(view).toContain("Save this card for future transactions");
    expect(view).toContain("remember_customer: saveCard");
    expect(view).toContain("useState(false);\n");
    const schema = src("prisma/schema.prisma");
    expect(schema).toContain("rzpCustomerId");
    expect(schema).not.toMatch(/cardNumber|\bcvv\b|\bpan\b/i);
  });
});
