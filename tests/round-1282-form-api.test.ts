// R1282 Creator Partnership Program (form): public API source pins plus DB checks for duplicates, files, withdraw and email dedupe.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ApplicationSchema } from "@/lib/partners/schema";
import { emailKeyOf, makeFileToken, pendingFileKey } from "@/lib/partners/core";
import { createApplication, findDuplicate, withdrawApplication } from "@/lib/partners/core-server";
import { partnerEmail, sendPartnerStatusEmail } from "@/lib/partners/email";
import { PARTNER_SUBMITTED_MESSAGE } from "@/lib/partners/types";

const read = (f: string) => readFileSync(f, "utf8");
const apply = read("app/api/partners/apply/route.ts");
const files = read("app/api/partners/files/route.ts");
const withdraw = read("app/api/partners/withdraw/route.ts");
const form = read("components/partners/ApplyForm.tsx");

describe("route source pins", () => {
  test("apply: same origin, IP and email limits, honeypot, DUPLICATE 409", () => {
    expect(apply).toContain("assertSameOrigin(req)");
    expect(apply).toContain('rateLimit("partners:apply:" + ip, 5, HOUR)');
    expect(apply).toContain('"partners:apply:email:" + emailKey, 3, 24 * HOUR');
    expect(apply).toContain("raw.website");
    expect(apply).toContain('code: "DUPLICATE"');
    expect(apply).toContain("status: 409");
    expect(apply).toContain("auth: false");
    expect(apply).toContain("notifyAdminsNewApplication");
  });
  test("files: magic bytes, size cap, rate limit, pending key", () => {
    expect(files).toContain("sniffMime(buf)");
    expect(files).toContain("PARTNER_FILE_MAX_BYTES");
    expect(files).toContain('rateLimit("partners:files:" + clientIp(req), 30, 3_600_000)');
    expect(files).toContain("pendingFileKey(token");
    expect(files).toContain("assertSameOrigin(req)");
  });
  test("withdraw: same origin, rate limit, generic not-found", () => {
    expect(withdraw).toContain("assertSameOrigin(req)");
    expect(withdraw).toContain("rateLimit(");
    expect(withdraw).toContain("NOT_FOUND");
  });
  // R1289 short form: copy pins moved to tests/round-1289-form.test.ts; the safety pins stay here.
  test("form: honeypot, autosave, duplicate copy, consent links", () => {
    expect(form).toContain("You already have an open application (ID ${ref}). We will get back to you on that one.");
    expect(form).toContain('id="pa-website"');
    expect(form).toContain("sessionStorage");
    expect(form).toContain("Never share passwords or login details.");
    expect(form).toContain("Self-reported numbers. We may ask for a screenshot later.");
    expect(form).toContain('href="/terms"');
    expect(form).toContain('href="/privacy"');
    expect(form).toContain("export default function ApplyForm({ me = null }: { me?: ApplyMe })");
    expect(form).not.toMatch(/usage rights/i);
    expect(form).not.toContain("\u2014");
  });
});

const base = {
  personal: { fullName: "Dev Rao", email: "dev.rao+apply@gmail.com", country: "India", city: "", phone: "", brandName: "" },
  socials: [{ platform: "instagram", handle: "devrao", url: "", followers: 6_200, niche: "tech", format: "reels" }],
  stats: { avgViews: 3000, avgLikes: 200, avgComments: 20, avgShares: 10, reach: 4000, engagementRate: null, audienceCountries: "", ageRange: "25-34", frequency: "weekly", niche: "tech" },
  proposal: { why: "My viewers are small creators who post everywhere by hand and need one place to do it.", how: "A screen recording Reel.", contentType: "Reel", posts: 3, preference: "either", compensation: "", pastCollabs: "", portfolio: [] },
  consent: { terms: true, accuracy: true },
};
const keys: string[] = [];

afterAll(async () => {
  for (const k of keys) await storage.remove(k).catch(() => {});
});

describe("database", () => {
  test("create, then a second attempt from the same inbox is a duplicate", async () => {
    const token = makeFileToken();
    const key = pendingFileKey(token, "png");
    keys.push(key);
    await storage.put(key, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), "image/png");
    const input = ApplicationSchema.parse({ ...base, files: [{ token, name: "insights <1>.png" }, { token: makeFileToken(), name: "missing.png" }] });
    const app = await createApplication(input, { ip: "203.0.113.9" });
    expect(app.ref).toMatch(/^OP-/);
    expect(app.emailKey).toBe("devrao@gmail.com");
    expect(app.tier).toBe("growing");
    expect(app.primaryHandle).toBe("devrao");
    expect(app.ipHash).toHaveLength(24);
    expect(app.ipHash).toMatch(/^[0-9a-f]{24}$/);
    const rows = await db.partnerFile.findMany({ where: { applicationId: app.id } });
    expect(rows.map((r) => [r.key, r.name, r.size])).toEqual([[key, "insights 1.png", 7]]);
    const ev = await db.partnerEvent.findMany({ where: { applicationId: app.id } });
    expect(ev.map((e) => [e.actor, e.action, e.to])).toEqual([["creator", "application.submit", "submitted"]]);
    const dup = await findDuplicate(emailKeyOf("DevRao@googlemail.com"));
    expect(dup?.ref).toBe(app.ref);
    expect(await findDuplicate("someone-else@gmail.com")).toBeNull();
  });

  test("withdraw needs the matching email, then closes; a recent withdrawal still blocks, an old one does not", async () => {
    const app = await db.partnerApplication.findFirstOrThrow({ where: { emailKey: "devrao@gmail.com" } });
    expect(await withdrawApplication(app.ref, "other@gmail.com")).toEqual({ ok: false, reason: "not_found" });
    const r = await withdrawApplication(app.ref, "dev.rao@gmail.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.app.status).toBe("withdrawn");
    expect(await withdrawApplication(app.ref, "dev.rao@gmail.com")).toEqual({ ok: false, reason: "closed" });
    expect((await findDuplicate("devrao@gmail.com"))?.ref).toBe(app.ref);
    await db.partnerApplication.update({ where: { id: app.id }, data: { createdAt: new Date(Date.now() - 100 * 86_400_000) } });
    expect(await findDuplicate("devrao@gmail.com")).toBeNull();
  });

  test("sendPartnerStatusEmail sends once per status", async () => {
    const app = await db.partnerApplication.findFirstOrThrow({ where: { emailKey: "devrao@gmail.com" } });
    const a = await sendPartnerStatusEmail(app, "under_review");
    expect(a.sent).toBe(true);
    expect((await db.partnerApplication.findUniqueOrThrow({ where: { id: app.id } })).lastNotified).toBe("under_review");
    const b = await sendPartnerStatusEmail(app, "under_review");
    expect(b.skipped).toBe(true);
    const c = await sendPartnerStatusEmail(app, "deliverable_reminder", { title: "Reel 1" });
    const d = await sendPartnerStatusEmail(app, "deliverable_reminder", { title: "Reel 1" });
    expect([c.sent, d.sent]).toEqual([true, true]);
  });
});

describe("partnerEmail copy", () => {
  const app = { id: "x", ref: "OP-ABC234", fullName: "Dev Rao", email: "dev@example.com" };
  test("every kind has a subject, the ID and no em-dash", () => {
    for (const k of ["received", "under_review", "more_info", "approved", "rejected", "offer_sent", "offer_accepted", "active", "benefit_activated", "deliverable_reminder", "completed", "withdrawn"] as const) {
      const m = partnerEmail(k, app, { message: "Please share a screenshot.", link: "/partners/offer/t", plan: "Creator", startsAt: new Date("2026-12-01"), endsAt: new Date("2027-03-01") });
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.text).not.toContain("\u2014");
      if (k !== "benefit_activated") expect(m.text).toContain("OP-ABC234");
    }
  });
  test("more_info carries the admin message and offer_sent the link", () => {
    expect(partnerEmail("more_info", app, { message: "Please share a screenshot." }).text).toContain("Please share a screenshot.");
    expect(partnerEmail("offer_sent", app, { link: "/partners/offer/tok" }).text).toContain("/partners/offer/tok");
    expect(partnerEmail("benefit_activated", app, { plan: "Creator", startsAt: new Date("2026-12-01T06:00:00Z"), endsAt: new Date("2027-03-01T06:00:00Z") }).text).toContain("from 1 December 2026 to 1 March 2027");
  });
  test("the received email never promises payment or a review time", () => {
    const t = partnerEmail("received", app).text;
    expect(t).not.toMatch(/within \d|days|paid|guarantee/i);
    expect(PARTNER_SUBMITTED_MESSAGE).toContain("reach out");
  });
});
