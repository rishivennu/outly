/** Regressions for the 10-13 security pass: open redirects, client IP for rate limits, referral codes, refunds. */
import { beforeAll, describe, expect, test } from "bun:test";

let oauth: typeof import("../lib/oauth-state");
let http: typeof import("../lib/http");
let ref: typeof import("../lib/referral-core");

beforeAll(async () => {
  oauth = await import("../lib/oauth-state");
  http = await import("../lib/http");
  ref = await import("../lib/referral-core");
}, 60_000);

describe("safeReturnTo (server redirects after OAuth)", () => {
  test("keeps same-site paths", () => {
    expect(oauth.safeReturnTo("/home")).toBe("/home");
    expect(oauth.safeReturnTo("/accounts?x=1")).toBe("/accounts?x=1");
  });
  test("refuses every way out of the site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "/\tevil.com", "", null]) {
      const out = oauth.safeReturnTo(bad as string | null);
      expect(out).toBe("/accounts");
      expect(new URL(out, "https://outlly.com").host).toBe("outlly.com");
    }
  });
});

describe("clientIp (rate-limit key)", () => {
  const req = (xff?: string, ip?: string) => ({ ip, headers: new Headers(xff ? { "x-forwarded-for": xff } : {}) }) as never;
  test("a spoofed first X-Forwarded-For entry is ignored; the proxy's last hop wins", () => {
    expect(http.clientIp(req("1.2.3.4, 9.9.9.9"))).toBe("9.9.9.9");
    expect(http.clientIp(req("5.5.5.5, 9.9.9.9"))).toBe("9.9.9.9");
  });
  test("the platform's own req.ip beats any header", () => {
    expect(http.clientIp(req("1.2.3.4", "8.8.8.8"))).toBe("8.8.8.8");
    expect(http.clientIp(req())).toBe("local");
  });
});

describe("referral codes", () => {
  test("cryptographically random, readable, and not repeating", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = ref.makeCode();
      expect(c).toMatch(/^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(2000);
  });
});

describe("refund takes the referral month back", () => {
  test("refunding the friend's first payment cancels the gift month; the referrer keeps nothing", async () => {
    const db = (await import("../lib/db")).db;
    const svc = await import("../lib/billing/service");
    await (await import("../lib/billing/plans")).ensurePlans();
    const mk = (tag: string, extra: Record<string, unknown> = {}) =>
      db.user.create({ data: { name: `S ${tag}`, email: `s-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.dev`, passwordHash: "x", ...extra } });
    const owner = await mk("ref-owner");
    const buyer = await mk("ref-buyer", { referredById: owner.id });
    const s = await svc.startCheckout(buyer.id, "creator");
    await svc.completePayment(s.paymentId, `mock_${s.paymentId}`);
    expect(await db.subscription.count({ where: { userId: owner.id, provider: "referral", status: "active" } })).toBe(1);
    await svc.refundPayment(s.paymentId, "test", "abuse check");
    expect(await db.subscription.count({ where: { userId: owner.id, provider: "referral", status: "active" } })).toBe(0);
  }, 30_000);
});
