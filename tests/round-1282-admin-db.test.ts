/** R1282 admin "Creator Partnerships": status machine, audit trail, notes, list filters and KPIs against the test DB. */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import * as realEmail from "../lib/partners/email";

// Pinned before mocking: the mock is run-wide, so other files keep the real sender unless this file is capturing.
const realSend = realEmail.sendPartnerStatusEmail;
const g = globalThis as unknown as { __r1282AdminCapture?: unknown[][]; __r1282AdminFail?: boolean };
mock.module("../lib/partners/email", () => ({
  ...realEmail,
  sendPartnerStatusEmail: (...a: Parameters<typeof realSend>) => {
    if (g.__r1282AdminCapture) {
      if (g.__r1282AdminFail) return Promise.reject(new Error("smtp down"));
      g.__r1282AdminCapture.push(a);
      return Promise.resolve();
    }
    return realSend(...a);
  },
}));

let db: typeof import("../lib/db").db;
let pa: typeof import("../lib/partners/admin");
const sent: unknown[][] = [];
const admin = { login: "r1282-admin", role: "super" };
const tag = `r1282a${Date.now().toString(36)}`;
let n = 0;

beforeAll(async () => {
  g.__r1282AdminCapture = sent;
  db = (await import("../lib/db")).db;
  pa = await import("../lib/partners/admin");
});
afterAll(() => {
  g.__r1282AdminCapture = undefined;
  g.__r1282AdminFail = false;
});

const mkApp = (over: Record<string, unknown> = {}) => {
  n += 1;
  const email = `${tag}-${n}@test.dev`;
  return db.partnerApplication.create({
    data: {
      ref: `OP-${tag.toUpperCase()}${n}`,
      fullName: `Creator ${tag} ${n}`,
      email,
      emailKey: email,
      country: "India",
      consentAt: new Date(),
      primaryPlatform: "instagram",
      primaryHandle: `${tag}_h${n}`,
      followers: 1000 * n,
      avgViews: 100 * n,
      niche: "tech",
      socials: JSON.stringify([{ platform: "instagram", handle: `${tag}_h${n}`, url: "https://instagram.com/x", followers: 1000 * n, niche: "tech", format: "reels", primary: true }]),
      ...over,
    },
  });
};

describe("changeStatus", () => {
  test("submitted -> under_review writes a PartnerEvent, an AuditLog row and emails the creator", async () => {
    const app = await mkApp();
    sent.length = 0;
    const r = await pa.changeStatus(app, "under_review", admin);
    expect(r.status).toBe("under_review");
    expect(r.reviewedAt).toBeInstanceOf(Date);
    const ev = await db.partnerEvent.findMany({ where: { applicationId: app.id } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor: admin.login, action: "status", from: "submitted", to: "under_review" });
    const log = await db.auditLog.findFirst({ where: { targetType: "partner", targetId: app.id } });
    expect(log).toMatchObject({ actor: admin.login, actorRole: "super", action: "partner.status", email: app.email });
    expect(JSON.parse(log!.before!)).toEqual({ status: "submitted" });
    expect(JSON.parse(log!.after!)).toEqual({ status: "under_review" });
    expect(sent).toHaveLength(1);
    expect((sent[0][0] as { id: string }).id).toBe(app.id);
    expect(sent[0][1]).toBe("under_review");
  });

  test("an illegal move (completed -> approved) throws and changes nothing", async () => {
    const app = await mkApp({ status: "completed" });
    await expect(pa.changeStatus(app.id, "approved", admin)).rejects.toMatchObject({ status: 409, code: "BAD_TRANSITION" });
    expect((await db.partnerApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("completed");
    expect(await db.partnerEvent.count({ where: { applicationId: app.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { targetType: "partner", targetId: app.id } })).toBe(0);
  });

  test("more_info and rejected need the admin's message; it is mailed and kept on the event", async () => {
    const app = await mkApp();
    await expect(pa.changeStatus(app.id, "more_info", admin)).rejects.toMatchObject({ status: 400, code: "MESSAGE_REQUIRED" });
    await expect(pa.changeStatus(app.id, "rejected", admin, { message: " " })).rejects.toMatchObject({ code: "MESSAGE_REQUIRED" });
    sent.length = 0;
    await pa.changeStatus(app.id, "more_info", admin, { message: "Share your last 30 days of reach." });
    expect(sent[0][2]).toEqual({ message: "Share your last 30 days of reach." });
    const ev = await db.partnerEvent.findFirstOrThrow({ where: { applicationId: app.id, to: "more_info" } });
    expect(JSON.parse(ev.meta).message).toBe("Share your last 30 days of reach.");
  });

  test("decidedAt and withdrawnAt are stamped", async () => {
    const a = await mkApp();
    expect((await pa.changeStatus(a.id, "approved", admin)).decidedAt).toBeInstanceOf(Date);
    const b = await mkApp();
    expect((await pa.changeStatus(b.id, "withdrawn", admin)).withdrawnAt).toBeInstanceOf(Date);
  });

  test("system and creator moves need no message and are attributed", async () => {
    const app = await mkApp({ status: "offer_accepted" });
    sent.length = 0;
    await pa.changeStatus(app.id, "active", { login: "system" }, { actor: "system", notify: false });
    expect(sent).toHaveLength(0);
    const ev = await db.partnerEvent.findFirstOrThrow({ where: { applicationId: app.id } });
    expect(ev.actor).toBe("system");
    const b = await mkApp({ status: "under_review" });
    await pa.changeStatus(b.id, "withdrawn", { login: "creator" }, { actor: "creator" });
    expect((await db.partnerEvent.findFirstOrThrow({ where: { applicationId: b.id } })).actor).toBe("creator");
  });

  test("a missing application is a 404, an unknown status a 400", async () => {
    await expect(pa.changeStatus("nope", "approved", admin)).rejects.toMatchObject({ status: 404 });
    const app = await mkApp();
    await expect(pa.changeStatus(app.id, "paid", admin)).rejects.toMatchObject({ status: 400 });
  });

  test("a mail failure never undoes the status change", async () => {
    const app = await mkApp();
    g.__r1282AdminFail = true;
    try {
      const r = await pa.changeStatus(app.id, "under_review", admin);
      expect(r.status).toBe("under_review");
    } finally {
      g.__r1282AdminFail = false;
    }
  });
});

describe("notes", () => {
  test("addNote stores an internal note and a history event, never an email", async () => {
    const app = await mkApp();
    sent.length = 0;
    const note = await pa.addNote(app.id, "  Check audience split  ", admin);
    expect(note).toMatchObject({ applicationId: app.id, author: admin.login, body: "Check audience split" });
    expect(sent).toHaveLength(0);
    expect(await db.partnerEvent.count({ where: { applicationId: app.id, action: "note" } })).toBe(1);
    await expect(pa.addNote(app.id, "   ", admin)).rejects.toMatchObject({ status: 400 });
  });

  test("getApplication returns notes, parsed JSON and attribution counts", async () => {
    const app = await mkApp();
    await pa.addNote(app.id, "Internal only", admin);
    await db.partnerAttribution.createMany({ data: [
      { applicationId: app.id, kind: "visit", visitorKey: "v1" },
      { applicationId: app.id, kind: "visit", visitorKey: "v2" },
      { applicationId: app.id, kind: "signup", visitorKey: "v1" },
    ] });
    const d = await pa.getApplication(app.id);
    expect(d!.notes.map((x) => x.body)).toEqual(["Internal only"]);
    expect(d!.socials[0].handle).toBe(app.primaryHandle);
    expect(d!.attribution).toEqual({ visits: 2, signups: 1, paid: 0 });
    expect(await pa.getApplication("missing")).toBeNull();
  });
});

describe("list + kpis", () => {
  test("search by handle, ref, email; filter by status; sort by followers", async () => {
    const a = await mkApp({ followers: 90_000 });
    const b = await mkApp({ followers: 50, status: "approved" });
    expect((await pa.listApplications({ q: `@${a.primaryHandle}` })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await pa.listApplications({ q: b.ref.toLowerCase() })).rows.map((r) => r.id)).toEqual([b.id]);
    expect((await pa.listApplications({ q: b.email })).rows.map((r) => r.id)).toEqual([b.id]);
    const approved = await pa.listApplications({ q: tag, status: "approved" });
    expect(approved.rows.every((r) => r.status === "approved")).toBe(true);
    expect(approved.rows.map((r) => r.id)).toContain(b.id);
    const sorted = await pa.listApplications({ q: tag, sort: "followers" });
    expect(sorted.rows[0].id).toBe(a.id);
    const junk = pa.normaliseQuery({ status: "bogus", sort: "password", page: "-3" });
    expect(junk).toMatchObject({ status: "", sort: "createdAt", page: 1 });
  });

  test("pages hold 25 rows", async () => {
    expect(pa.PARTNERS_PER_PAGE).toBe(25);
    const r = await pa.listApplications({ q: tag, page: 999 });
    expect(r.page).toBe(Math.max(1, Math.ceil(r.total / 25)));
  });

  test("date range filters by applied day", async () => {
    const old = await mkApp({ createdAt: new Date("2020-01-15T10:00:00Z") });
    const r = await pa.listApplications({ q: tag, from: "2020-01-15", to: "2020-01-15" });
    expect(r.rows.map((x) => x.id)).toEqual([old.id]);
  });

  test("kpis count each status and pending offers", async () => {
    const before = await pa.kpis();
    const s = await mkApp();
    await mkApp({ status: "under_review" });
    await mkApp({ status: "more_info" });
    await mkApp({ status: "active" });
    await mkApp({ status: "rejected" });
    const o = await mkApp({ status: "offer_sent" });
    await db.partnerOffer.create({ data: { applicationId: o.id, type: "subscription", token: `${tag}-tok`, status: "sent", createdBy: admin.login } });
    const after = await pa.kpis();
    expect(after.total - before.total).toBe(6);
    expect(after.submitted - before.submitted).toBe(1);
    expect(after.underReview - before.underReview).toBe(1);
    expect(after.moreInfo - before.moreInfo).toBe(1);
    expect(after.active - before.active).toBe(1);
    expect(after.rejected - before.rejected).toBe(1);
    expect(after.offerSent - before.offerSent).toBe(1);
    expect(s.status).toBe("submitted");
  });

  test("CSV escapes quotes and formula starts", () => {
    const csv = pa.toCsv([{ id: "x", ref: "OP-1", status: "submitted", fullName: '=HYPERLINK("x")', email: "a@b.c", country: "India", primaryPlatform: "x", primaryHandle: "h", followers: 1, avgViews: 2, engagementRate: null, niche: "tech", tier: "emerging", preference: "either", createdAt: new Date("2026-11-20T00:00:00Z"), updatedAt: new Date() }]);
    const line = csv.split("\r\n")[1];
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain("Submitted");
  });
});
