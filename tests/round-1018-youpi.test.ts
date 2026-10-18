/**
 * YOUPI PG (self-hosted UPI gateway): URL safety, the verdict rules, webhook signatures, and the
 * full server flow with the gateway faked at the fetch level. The rule under test throughout:
 * a plan is granted only when the GATEWAY (asked by us) reports our order, exact paise, INR, enough alerts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { safeCheckoutUrl, youpiBase, youpiReady, youpiSigHex, youpiVerdict } from "../lib/billing/youpi";

let db: typeof import("../lib/db").db;
let svc: typeof import("../lib/billing/service");
let settings: typeof import("../lib/settings");
let providers: typeof import("../lib/billing/providers");
const realFetch = globalThis.fetch;
const SECRET = "whsec-youpi-test-0123456789";

// a tiny fake gateway: payments created here, status set per test
const gw = new Map<string, { orderId: string; amountPaise: number; status: string; verificationLevel: number; currency: string }>();
const calls: { url: string; body?: any; headers: Record<string, string> }[] = [];

beforeAll(async () => {
  // live mode resolves the gateway host before every call (SSRF guard); give the fake gateway a public address
  const net = await import("../lib/net/assert-public");
  const sysLookup = net.resolver.lookup;
  net.resolver.lookup = async (h) => (h === "pay.test.dev" ? [{ address: "203.0.113.10" }] : sysLookup(h));
  db = (await import("../lib/db")).db;
  svc = await import("../lib/billing/service");
  settings = await import("../lib/settings");
  providers = await import("../lib/billing/providers");
  await (await import("../lib/billing/plans")).ensurePlans();
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    if (!url.startsWith("https://pay.test.dev/")) return realFetch(input, init);
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body, headers });
    if (url.endsWith("/api/v1/payments") && init.method === "POST") {
      const id = `yp-${body.orderId}`;
      if (!gw.has(id)) gw.set(id, { orderId: body.orderId, amountPaise: Math.round(Number(body.amount) * 100), status: "ACTIVE", verificationLevel: 0, currency: "INR" });
      return Response.json({ paymentId: id, orderId: body.orderId, amount: body.amount, status: "ACTIVE", checkoutUrl: `https://pay.test.dev/checkout/${id}` }, { status: 201 });
    }
    const m = url.match(/\/api\/v1\/payments\/([^/?]+)$/);
    if (m) {
      const s = gw.get(decodeURIComponent(m[1]));
      return s ? Response.json({ paymentId: m[1], ...s, amountPaise: String(s.amountPaise) }) : Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json({ error: "?" }, { status: 404 });
  }) as typeof fetch;
  await settings.saveConfig("payments", { provider: "youpi", mode: "live", youpi: { gatewayUrl: "https://pay.test.dev", merchantId: "m-1", webhookSecret: SECRET, minVerification: 1 } });
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await settings.saveConfig("payments", { provider: "mock", mode: "test" });
});

const mkUser = async (tag: string) => db.user.create({ data: { name: `Upi ${tag}`, email: `upi-${tag}-${Date.now()}@test.dev`, passwordHash: "x" } });
const sign = (raw: string) => "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");

describe("youpi rules", () => {
  test("gateway URL: https always, http only for a local test gateway, never credentials or other schemes", () => {
    expect(youpiBase("https://pay.example.com/", "live")).toBe("https://pay.example.com");
    expect(youpiBase("http://localhost:7000", "test")).toBe("http://localhost:7000");
    expect(youpiBase("http://localhost:7000", "live")).toBe("");
    expect(youpiBase("http://10.0.0.5:7000", "test")).toBe("");
    expect(youpiBase("https://u:p@pay.example.com", "live")).toBe("");
    expect(youpiBase("javascript:alert(1)", "test")).toBe("");
    expect(safeCheckoutUrl("http://evil.example/checkout", "live")).toBeNull();
    expect(youpiReady({ gatewayUrl: "https://pay.example.com", merchantId: "m", webhookSecret: "", minVerification: 1 }, "live")).toBe(false);
  });
  test("verdict: only exact order + exact paise + INR + enough alerts is paid", () => {
    const want = { id: "pay_1", amountMinor: 49900, currency: "INR" };
    expect(youpiVerdict({ orderId: "pay_1", status: "SUCCESS", amountPaise: "49900", verificationLevel: 1 }, want, 1)).toEqual({ state: "paid" });
    expect(youpiVerdict({ orderId: "pay_1", status: "SUCCESS", amountPaise: 100, verificationLevel: 2 }, want, 1).state).toBe("mismatch");
    expect(youpiVerdict({ orderId: "pay_2", status: "SUCCESS", amountPaise: 49900, verificationLevel: 2 }, want, 1).state).toBe("mismatch");
    expect(youpiVerdict({ orderId: "pay_1", status: "SUCCESS", amountPaise: 49900, verificationLevel: 1 }, want, 2).state).toBe("pending");
    expect(youpiVerdict({ orderId: "pay_1", status: "SUCCESS", amountPaise: 49900, currency: "USD", verificationLevel: 2 }, want, 1).state).toBe("mismatch");
    expect(youpiVerdict({ orderId: "pay_1", status: "EXPIRED" }, want, 1).state).toBe("failed");
    expect(youpiVerdict({ orderId: "pay_1", status: "QUEUED" }, want, 1).state).toBe("pending");
  });
  test("signature header parsing and constant-time verify", () => {
    expect(youpiSigHex("sha256=" + "a".repeat(64))).toBe("a".repeat(64));
    expect(youpiSigHex("sha256=xyz")).toBe("");
    expect(providers.youpi.verifyWebhook(SECRET, '{"a":1}', sign('{"a":1}'))).toBe(true);
    expect(providers.youpi.verifyWebhook(SECRET, '{"a":2}', sign('{"a":1}'))).toBe(false);
    expect(providers.youpi.verifyWebhook("", '{"a":1}', sign('{"a":1}'))).toBe(false);
  });
});

describe("youpi flow", () => {
  test("checkout sends no personal data and charges INR; the return URL alone grants nothing", async () => {
    const u = await mkUser("a");
    const start = await svc.startCheckout(u.id, "creator", "USD");
    expect(start.kind).toBe("redirect");
    const create = calls.find((c) => c.url.endsWith("/api/v1/payments"))!;
    expect(create.headers["x-merchant-id"]).toBe("m-1");
    expect(JSON.stringify(create.body)).not.toContain(u.email);
    expect(create.body.customer).toBeUndefined();
    const p = await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(p.currency).toBe("INR");
    expect(p.provider).toBe("youpi");
    // gateway still ACTIVE: landing on the return URL must not unlock the plan
    expect((await svc.confirmYoupi(p.id, u.id)).state).toBe("pending");
    expect(await db.subscription.count({ where: { userId: u.id, status: "active" } })).toBe(0);
  });

  test("someone else's payment id on the return URL is unknown", async () => {
    const a = await mkUser("b1");
    const b = await mkUser("b2");
    const start = await svc.startCheckout(a.id, "creator");
    expect((await svc.confirmYoupi(start.paymentId, b.id)).state).toBe("unknown");
  });

  test("short payment is flagged, not granted", async () => {
    const u = await mkUser("c");
    const start = await svc.startCheckout(u.id, "creator");
    const s = gw.get(`yp-${start.paymentId}`)!;
    Object.assign(s, { status: "SUCCESS", amountPaise: 100, verificationLevel: 2 });
    expect((await svc.confirmYoupi(start.paymentId, u.id)).state).toBe("mismatch");
    const p = await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(p.status).toBe("failed");
    expect(p.failureReason).toMatch(/mismatch/i);
    expect(await db.subscription.count({ where: { userId: u.id, status: "active" } })).toBe(0);
  });

  test("webhook: bad signature 401; signed event confirms with the gateway, once", async () => {
    const { POST } = await import("../app/api/billing/webhooks/youpi/route");
    const u = await mkUser("d");
    const start = await svc.startCheckout(u.id, "creator");
    const raw = JSON.stringify({ event: "SUCCESS", orderId: start.paymentId, amountPaise: 1 });
    const req = (sig: string) => new NextRequest("http://localhost/api/billing/webhooks/youpi", { method: "POST", body: raw, headers: { "x-gateway-signature": sig, "content-type": "application/json" } });
    expect((await POST(req("sha256=" + "0".repeat(64)))).status).toBe(401);
    // signed, but the gateway hasn't seen the money yet: nothing granted
    expect((await POST(req(sign(raw)))).status).toBe(200);
    expect(await db.subscription.count({ where: { userId: u.id, status: "active" } })).toBe(0);
    Object.assign(gw.get(`yp-${start.paymentId}`)!, { status: "SUCCESS", verificationLevel: 1 });
    expect((await POST(req(sign(raw)))).status).toBe(200);
    expect((await POST(req(sign(raw)))).status).toBe(200); // replay is a no-op
    expect(await db.subscription.count({ where: { userId: u.id, status: "active" } })).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).status).toBe("succeeded");
    expect(await db.invoice.count({ where: { paymentId: start.paymentId } })).toBe(1);
  });

  test("refund is refused with a clear manual-UPI message", async () => {
    const p = await db.payment.findFirstOrThrow({ where: { provider: "youpi", status: "succeeded" } });
    await expect(svc.refundPayment(p.id, "admin", "test")).rejects.toThrow(/no refund API/i);
  });
});
