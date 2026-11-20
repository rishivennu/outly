/** R1282 benefits: offer -> accept -> grant -> active against the test DB, plus attribution bookkeeping. */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as realAccess from "../lib/billing/access";

// Pinned before mocking: the mock is run-wide, so it delegates to the real module unless this file sets a fake.
const realAccessByEmail = realAccess.accessByEmail;
const g = globalThis as unknown as { __r1282BenefitsAccess?: (email: string, now?: Date) => unknown };
mock.module("../lib/billing/access", () => ({
  ...realAccess,
  accessByEmail: (email: string, now?: Date) => (g.__r1282BenefitsAccess ? g.__r1282BenefitsAccess(email, now) : realAccessByEmail(email, now)),
}));

let db: typeof import("../lib/db").db;
let offers: typeof import("../lib/partners/offers");
let benefits: typeof import("../lib/partners/benefits");
let attr: typeof import("../lib/partners/attribution");
let dels: typeof import("../lib/partners/deliverables");
const admin = { login: "r1282-benefits", role: "super" };
const tag = `r1282b${Date.now().toString(36)}`;
let n = 0;

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  await (await import("../lib/billing/plans")).ensurePlans();
  offers = await import("../lib/partners/offers");
  benefits = await import("../lib/partners/benefits");
  attr = await import("../lib/partners/attribution");
  dels = await import("../lib/partners/deliverables");
});

const mkApp = (over: Record<string, unknown> = {}) => {
  n += 1;
  const email = `${tag}-${n}@test.dev`;
  return db.partnerApplication.create({
    data: { ref: `OP-${tag.toUpperCase()}${n}`, fullName: `Creator ${n}`, email, emailKey: email, country: "India", consentAt: new Date(), primaryHandle: `${tag}h${n}`, status: "approved", ...over },
  });
};
const subOffer = { type: "subscription", planSlug: "studio", subscriptionDays: 30, deliverables: 1, platforms: ["instagram"] };
async function sent(over: Record<string, unknown> = {}) {
  const app = await mkApp();
  const o = await offers.createOffer(app.id, { ...subOffer, ...over }, admin);
  const s = await offers.sendOffer(app.id, o.id, admin);
  return { app, offer: s, token: s.token! };
}
const actions = async (applicationId: string) =>
  (await db.partnerEvent.findMany({ where: { applicationId }, orderBy: { createdAt: "asc" } })).map((e) => (e.action === "status" ? `status:${e.to}` : e.action));

describe("offer lifecycle", () => {
  test("approval alone grants nothing; sending needs an approved application", async () => {
    const app = await mkApp({ status: "under_review" });
    const o = await offers.createOffer(app.id, subOffer, admin);
    await expect(offers.sendOffer(app.id, o.id, admin)).rejects.toMatchObject({ code: "NOT_APPROVED" });
    await expect(benefits.grantBenefit(o.id, admin)).rejects.toMatchObject({ code: "NOT_ACCEPTED" });
    expect(await db.planGrant.count({ where: { email: app.email } })).toBe(0);
  });

  test("send issues a 14 day token link and moves the application to offer_sent", async () => {
    const { app, offer, token } = await sent();
    expect(offers.isOfferToken(token)).toBe(true);
    expect(offer.status).toBe("sent");
    expect(offer.expiresAt!.getTime() - offer.sentAt!.getTime()).toBe(offers.OFFER_LINK_DAYS * 86_400_000);
    expect((await db.partnerApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("offer_sent");
    const pub = await offers.getOfferByToken(token);
    expect(pub).not.toBeNull();
    expect(JSON.stringify(pub)).not.toContain(app.email);
  });

  test("accept snapshots the terms, grants the plan once, then goes active", async () => {
    const { app, offer, token } = await sent();
    const r = await offers.respondToOffer(token, "accept");
    expect(r.state).toBe("accepted");
    const o = await db.partnerOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(o.status).toBe("accepted");
    expect(JSON.parse(o.accepted!)).toMatchObject({ planSlug: "studio", subscriptionDays: 30, termsVersion: expect.any(String) });
    expect(o.grantId).toBeTruthy();
    const grant = await db.planGrant.findUniqueOrThrow({ where: { id: o.grantId! } });
    expect(grant.email).toBe(app.email);
    const ev = await actions(app.id);
    const at = (a: string) => ev.indexOf(a);
    expect(at("offer.accept")).toBeGreaterThan(-1);
    expect(at("offer.accept")).toBeLessThan(at("status:offer_accepted"));
    expect(at("status:offer_accepted")).toBeLessThan(at("benefit.grant"));
    expect(at("benefit.grant")).toBeLessThan(at("status:active"));
    const after = await db.partnerApplication.findUniqueOrThrow({ where: { id: app.id } });
    expect(after.status).toBe("active");
    expect(after.partnerCode).toMatch(/^[a-z0-9]{4,20}$/);
    expect(await benefits.grantBenefit(o.id, admin)).toMatchObject({ skipped: "exists" });
    await expect(offers.respondToOffer(token, "accept")).rejects.toMatchObject({ code: "ANSWERED" });
    expect(await offers.acceptedOfferByToken(token)).not.toBeNull();
  });

  test("decline puts the application back to approved and grants nothing", async () => {
    const { app, offer, token } = await sent();
    expect(await offers.respondToOffer(token, "decline", { declineReason: "Timing" })).toEqual({ state: "declined" });
    const o = await db.partnerOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect(o).toMatchObject({ status: "declined", declineReason: "Timing", grantId: null });
    expect((await db.partnerApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("approved");
    expect(await offers.acceptedOfferByToken(token)).toBeNull();
  });

  test("an expired link cannot be accepted", async () => {
    const { offer, token } = await sent();
    const later = new Date(offer.expiresAt!.getTime() + 1000);
    await expect(offers.respondToOffer(token, "accept", {}, later)).rejects.toMatchObject({ status: 410 });
    expect((await db.partnerOffer.findUniqueOrThrow({ where: { id: offer.id } })).grantId).toBeNull();
  });

  test("unknown and malformed tokens are not found", async () => {
    expect(await offers.getOfferByToken("x".repeat(32))).toBeNull();
    expect(await offers.getOfferByToken("../etc")).toBeNull();
    await expect(offers.respondToOffer("short", "accept")).rejects.toMatchObject({ status: 404 });
  });

  test("a creator already paying for the same or a higher plan is skipped", async () => {
    const { app, offer, token } = await sent();
    g.__r1282BenefitsAccess = async () => ({ subscriptions: [{ paid: true, status: "active", endsAt: new Date(Date.now() + 86_400_000 * 20).toISOString(), plan: "pro-manager", planName: "Pro" }] });
    try {
      await offers.respondToOffer(token, "accept");
    } finally {
      g.__r1282BenefitsAccess = undefined;
    }
    expect((await db.partnerOffer.findUniqueOrThrow({ where: { id: offer.id } })).grantId).toBeNull();
    expect(await actions(app.id)).toContain("benefit.skipped");
    expect(await db.planGrant.count({ where: { email: app.email } })).toBe(0);
  });

  test("end revokes the grant", async () => {
    const { offer, token } = await sent();
    await offers.respondToOffer(token, "accept");
    await benefits.endBenefit(offer.id, "Agreed content was not published", admin);
    const o = await db.partnerOffer.findUniqueOrThrow({ where: { id: offer.id } });
    expect((await db.planGrant.findUniqueOrThrow({ where: { id: o.grantId! } })).status).toBe("revoked");
  });
});

describe("attribution", () => {
  test("partner codes are unique and well formed", async () => {
    const a = await mkApp({ status: "active", primaryHandle: "samehandle" });
    const b = await mkApp({ status: "active", primaryHandle: "samehandle" });
    const ca = await attr.ensurePartnerCode(a.id);
    const cb = await attr.ensurePartnerCode(b.id);
    expect(ca).toMatch(/^[a-z0-9]{4,20}$/);
    expect(cb).not.toBe(ca);
    expect(await attr.ensurePartnerCode(a.id)).toBe(ca);
  });

  test("visits are idempotent per visitor and signups need a recorded visit", async () => {
    const app = await mkApp({ status: "active" });
    const code = await attr.ensurePartnerCode(app.id);
    const v = crypto.randomUUID();
    expect((await attr.recordVisit(code, v))!.created).toBe(true);
    expect((await attr.recordVisit(code, v))!.created).toBe(false);
    const user = await db.user.create({ data: { email: `${tag}-u${n}@test.dev`, name: "U" } });
    expect(await attr.recordSignup(user.id, `${code}.${crypto.randomUUID()}`)).toBeNull();
    expect(await attr.recordSignup(user.id, `${code}.${v}`)).not.toBeNull();
    const s = await attr.attributionSummary(app.id);
    expect(s).toMatchObject({ visits: 1, signups: 1 });
  });

  test("an unknown or inactive code records nothing", async () => {
    const app = await mkApp({ status: "approved" });
    const code = await attr.ensurePartnerCode(app.id);
    expect(await attr.recordVisit(code, crypto.randomUUID())).toBeNull();
    expect(await attr.recordVisit("nobodyhere", crypto.randomUUID())).toBeNull();
  });
});

describe("deliverables", () => {
  test("admin adds, creator submits through the portal token, admin note stays private", async () => {
    const { app, token } = await sent();
    await offers.respondToOffer(token, "accept");
    const d = await dels.createDeliverable(app.id, { title: "Launch Reel", platform: "instagram", dueAt: "2026-12-01" }, admin);
    await dels.updateDeliverable(app.id, d.id, { adminNote: "secret" }, admin);
    const pub = await dels.submitDeliverable(token, { id: d.id, url: "https://instagram.com/p/abc", views: 1200 });
    expect(pub).toMatchObject({ status: "submitted", url: "https://instagram.com/p/abc", views: 1200 });
    expect(JSON.stringify(pub)).not.toContain("secret");
    await dels.updateDeliverable(app.id, d.id, { status: "verified" }, admin);
    await expect(dels.submitDeliverable(token, { id: d.id, url: "https://instagram.com/p/x" })).rejects.toMatchObject({ code: "CLOSED" });
    expect(await actions(app.id)).toContain("deliverable.review");
  });
});
