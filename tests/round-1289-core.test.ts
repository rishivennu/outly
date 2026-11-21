/** R1289 CORE: the creator's own partnerships (ownership, more information, offers, deliverables), in-app notices and the deadline sweep, against the test DB. */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let db: typeof import("../lib/db").db;
let mine: typeof import("../lib/partners/mine");
let notices: typeof import("../lib/partners/notices");
let pa: typeof import("../lib/partners/admin");
let offers: typeof import("../lib/partners/offers");
let dels: typeof import("../lib/partners/deliverables");
let cs: typeof import("../lib/partners/core-server");
let nc: typeof import("../lib/notify-core");

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const admin = { login: "r1289-core", role: "super" };
const tag = `r1289c${Date.now().toString(36)}`;
let n = 0;

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  await (await import("../lib/billing/plans")).ensurePlans();
  mine = await import("../lib/partners/mine");
  notices = await import("../lib/partners/notices");
  pa = await import("../lib/partners/admin");
  offers = await import("../lib/partners/offers");
  dels = await import("../lib/partners/deliverables");
  cs = await import("../lib/partners/core-server");
  nc = await import("../lib/notify-core");
});

const mkUser = async (proven = true) => {
  n += 1;
  const email = `${tag}-u${n}@test.dev`;
  const u = await db.user.create({ data: { name: `Creator ${n}`, email, passwordHash: "x", ...(proven ? { emailVerifiedAt: new Date(), emailVerifiedFor: email } : {}) } });
  return { ...u, me: { id: u.id, actor: null } as const };
};
const mkApp = (over: Record<string, unknown> = {}) => {
  n += 1;
  const email = (over.email as string) ?? `${tag}-a${n}@test.dev`;
  return db.partnerApplication.create({
    data: {
      ref: `OP-${tag.toUpperCase().slice(-6)}${n}`.slice(0, 20), fullName: `Creator ${n}`, email, emailKey: email, country: "India", consentAt: new Date(), primaryHandle: `${tag}h${n}`, primaryPlatform: "instagram", followers: 1200,
      socials: JSON.stringify([{ platform: "instagram", handle: `${tag}h${n}`, url: `https://www.instagram.com/${tag}h${n}/`, followers: 1200, niche: "tech", format: "reels", primary: true }]),
      stats: JSON.stringify({ avgViews: 300 }), proposal: JSON.stringify({ form: "short", preference: "either" }),
      status: "submitted", ...over,
    },
  });
};
const noticeRows = (userId: string) => db.notifyEvent.findMany({ where: { userId, source: "partners" }, orderBy: { createdAt: "asc" } });

describe("notice copy and catalogue (pure)", () => {
  test("partnerships is its own settings category, priority 2, filed under Account Alerts", () => {
    const cat = nc.CATEGORIES.find((c) => c.id === "partnerships")!;
    expect(cat).toMatchObject({ title: "Creator partnerships", events: ["partner_update", "partner_offer", "partner_deadline"] });
    for (const k of ["partner_update", "partner_offer", "partner_deadline"]) {
      expect(nc.priorityOf(k)).toBe(2);
      expect(nc.KIND_EVENT[k]).toBe(k as never);
      expect(nc.centreTabOf(k)).toBe("account");
      expect(nc.bucketOf(k)).toBe("partnerships");
    }
  });
  test("every event has creator copy with no em-dash and no promises", () => {
    for (const e of notices.PARTNER_NOTICE_EVENTS) {
      const c = notices.partnerNoticeCopy(e, "OP-ABCDEF", { message: "Please add your YouTube link.", plan: "Studio", endsAt: "2026-12-21T00:00:00Z", title: "Launch reel", dueAt: "2026-11-23T00:00:00Z" });
      expect(c.title.length).toBeGreaterThan(3);
      expect(`${c.title} ${c.body}`).not.toContain("\u2014");
      expect(`${c.title} ${c.body}`.toLowerCase()).not.toContain("guarantee");
    }
    expect(notices.partnerNoticeCopy("more_info", "OP-X", { message: "Add your channel link" })).toMatchObject({ kind: "partner_update", tone: "warn", body: "Add your channel link", action: "Update application" });
    expect(notices.partnerNoticeCopy("more_info", "OP-X").body).toBe("Our team needs additional information.");
    expect(notices.partnerNoticeCopy("offer_sent", "OP-X").kind).toBe("partner_offer");
    expect(notices.partnerNoticeCopy("deadline", "OP-X", { title: "Reel", dueAt: "2026-11-23T00:00:00Z" }).kind).toBe("partner_deadline");
    expect(notices.partnerNoticeCopy("benefit", "OP-X", { plan: "Studio", pending: true }).body).toContain("once your email is verified");
  });
  test("next action follows the status", () => {
    expect(mine.nextActionOf("more_info", null, []).kind).toBe("respond_info");
    expect(mine.nextActionOf("offer_sent", { status: "sent" } as never, []).label).toBe("Review your offer");
    expect(mine.nextActionOf("offer_sent", null, []).kind).toBe("none");
    expect(mine.nextActionOf("active", null, [{ status: "planned" } as never]).kind).toBe("submit_deliverables");
    expect(mine.nextActionOf("active", null, [{ status: "submitted" } as never]).kind).toBe("none");
    expect(mine.nextActionOf("submitted", null, []).kind).toBe("withdraw");
    expect(mine.nextActionOf("under_review", null, []).label).toBe("Withdraw application");
    expect(mine.nextActionOf("rejected", null, []).kind).toBe("none");
  });
  test("creator history keeps only safe actions and only the message from meta", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, s));
    const ev = mine.mineEvents([
      { action: "status", from: "submitted", to: "more_info", meta: JSON.stringify({ message: "Add your link", role: "super" }), createdAt: at(1) },
      { action: "note", from: null, to: null, meta: "{}", createdAt: at(2) },
      { action: "email.sent", from: null, to: null, meta: "{}", createdAt: at(3) },
      { action: "info.provided", from: null, to: null, meta: JSON.stringify({ message: "Done", fields: ["socials"] }), createdAt: at(4) },
      { action: "status.change", from: "under_review", to: "withdrawn", meta: "{}", createdAt: at(5) },
    ]);
    expect(ev.map((e) => e.action)).toEqual(["status", "info.provided", "status"]);
    expect(JSON.stringify(ev)).not.toContain("super");
    expect(Object.keys(ev[0]).sort()).toEqual(["action", "at", "from", "message", "to"]);
    expect(mine.infoRequestOf(ev)).toEqual({ requestedAt: at(1).toISOString(), message: "Add your link", respondedAt: at(4).toISOString() });
    expect(mine.infoRequestOf([])).toBeNull();
  });
  test("summary counts are plain counts of real rows", () => {
    expect(mine.summaryOf([{ status: "submitted", offers: [] }, { status: "more_info", offers: [] }, { status: "active", offers: [{} as never, {} as never] }, { status: "rejected", offers: [] }] as never)).toEqual({ submitted: 4, underReview: 2, offers: 2, active: 1 });
  });
  test("merged accounts keep niche and format from before and exactly one primary", () => {
    const out = mine.mergeSocials([{ platform: "instagram", niche: "tech", format: "reels" }], [
      { platform: "instagram", handle: "ria", url: "https://www.instagram.com/ria/", followers: 10, primary: false },
      { platform: "youtube", handle: "riavids", url: "https://www.youtube.com/@riavids", followers: 20, primary: true },
      { platform: "youtube", handle: "RIAVIDS", url: "https://www.youtube.com/@RIAVIDS", followers: 5 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ niche: "tech", format: "reels", primary: false });
    expect(out[1]).toMatchObject({ niche: "other", primary: true });
  });
});

describe("ownership", () => {
  test("only my applications are listed; someone else's reads as missing", async () => {
    const me = await mkUser();
    const other = await mkUser();
    const app = await mkApp({ userId: me.id });
    const list = await mine.listMine(me.me);
    expect(list.apps.map((a) => a.ref)).toEqual([app.ref]);
    expect(list.summary).toEqual({ submitted: 1, underReview: 1, offers: 0, active: 0 });
    expect(list.apps[0]).toMatchObject({ form: "short", status: "submitted", statusLabel: "Submitted", followers: 1200, nextAction: { kind: "withdraw" } });
    expect((await mine.listMine(other.me)).apps).toHaveLength(0);
    expect(await mine.getMine(other.me, app.ref)).toBeNull();
    expect(await mine.getMine(me.me, app.ref.toLowerCase())).not.toBeNull();
    await expect(mine.withdrawMine(other.me, app.ref)).rejects.toMatchObject({ status: 404 });
  });

  test("an unlinked application with my PROVEN email is mine and gets linked once; an unproven email gets nothing", async () => {
    const me = await mkUser(true);
    const app = await mkApp({ email: me.email, emailKey: me.email, userId: null });
    const unproven = await mkUser(false);
    const theirs = await mkApp({ email: unproven.email, emailKey: unproven.email, userId: null });
    expect((await mine.listMine(me.me)).apps.map((a) => a.ref)).toEqual([app.ref]);
    expect((await db.partnerApplication.findUniqueOrThrow({ where: { id: app.id } })).userId).toBe(me.id);
    expect((await mine.listMine(unproven.me)).apps).toHaveLength(0);
    expect((await db.partnerApplication.findUniqueOrThrow({ where: { id: theirs.id } })).userId).toBeNull();
  });

  test("a team seat acts as the real person signed in, not the workspace owner", async () => {
    const owner = await mkUser();
    const member = await mkUser();
    const app = await mkApp({ userId: member.id });
    expect((await mine.listMine({ id: owner.id, actor: { id: member.id, name: "m", email: member.email } })).apps.map((a) => a.ref)).toEqual([app.ref]);
    expect((await mine.listMine(owner.me)).apps).toHaveLength(0);
  });

  test("createApplication links the signed-in applicant, and only a proven email otherwise", async () => {
    const signedIn = await mkUser(false);
    const unproven = await mkUser(false);
    const base = (email: string) => ({
      personal: { fullName: "Ria Creator", email, country: "India", city: "", phone: "", brandName: "" },
      socials: [{ platform: "instagram", handle: `${tag}x${n}`, url: `https://www.instagram.com/${tag}x${n}/`, followers: 900, niche: "tech", format: "reels", primary: true }],
      stats: { avgViews: 100, avgLikes: 0, avgComments: 0, avgShares: 0, reach: 0, engagementRate: null, audienceCountries: "", ageRange: "18-24", frequency: "weekly", niche: "tech" },
      proposal: { why: "x".repeat(40), how: "x".repeat(10), contentType: "Reels", posts: 1, preference: "either", compensation: "", pastCollabs: "", portfolio: [] },
      consent: { terms: true, accuracy: true }, files: [], source: "",
    });
    const a = await cs.createApplication(base(`${tag}-other${n}@test.dev`) as never, { ip: "1.2.3.4", userId: signedIn.id });
    expect(a.userId).toBe(signedIn.id);
    const b = await cs.createApplication(base(unproven.email) as never, { ip: "1.2.3.4" });
    expect(b.userId).toBeNull();
    const rows = await noticeRows(signedIn.id);
    expect(rows.map((r) => r.idemKey)).toEqual([`partner:${a.id}:received:${a.id}`]);
    expect(JSON.parse(rows[0].payload)).toMatchObject({ kind: "partner_update", href: `/dashboard/partnerships/${a.ref}`, title: "Application received" });
  });
});

describe("more information", () => {
  test("the reply merges the new details, records the event and moves back to Under Review once", async () => {
    const me = await mkUser();
    const app = await mkApp({ userId: me.id, status: "under_review" });
    await pa.changeStatus(app.id, "more_info", admin, { message: "Please add your YouTube channel." });
    const before = await mine.getMine(me.me, app.ref);
    expect(before!.infoRequest).toMatchObject({ message: "Please add your YouTube channel.", respondedAt: null });
    expect(before!.nextAction.kind).toBe("respond_info");

    const r = await mine.respondInfo(me.me, app.ref, {
      message: "Added my channel.",
      socials: [
        { platform: "instagram", handle: app.primaryHandle, url: "", followers: 1200 },
        { platform: "youtube", handle: `${tag}yt`, url: "", followers: 54_000, primary: true },
      ],
      stats: { avgViews: 9000 },
    });
    expect(r.already).toBe(false);
    expect(r.app.status).toBe("under_review");
    expect(r.app.infoRequest!.respondedAt).not.toBeNull();
    const row = await db.partnerApplication.findUniqueOrThrow({ where: { id: app.id } });
    expect(row).toMatchObject({ status: "under_review", primaryPlatform: "youtube", followers: 54_000, avgViews: 9000, tier: "established" });
    expect(JSON.parse(row.proposal)).toEqual({ form: "short", preference: "either" });
    expect(JSON.parse(row.stats)).toEqual({ avgViews: 9000 });
    const ev = await db.partnerEvent.findFirstOrThrow({ where: { applicationId: app.id, action: "info.provided" } });
    expect(ev.actor).toBe("creator");
    expect(JSON.parse(ev.meta)).toEqual({ message: "Added my channel.", fields: ["socials", "stats"] });

    const again = await mine.respondInfo(me.me, app.ref, { message: "Added my channel." });
    expect(again.already).toBe(true);
    expect(await db.partnerEvent.count({ where: { applicationId: app.id, action: "info.provided" } })).toBe(1);
    const keys = (await noticeRows(me.id)).map((x) => x.idemKey.split(":")[2]);
    expect(keys).toEqual(["more_info", "info_received"]);
  });

  test("no open request means no reply, and the message is required", async () => {
    const me = await mkUser();
    const app = await mkApp({ userId: me.id, status: "under_review" });
    await expect(mine.respondInfo(me.me, app.ref, { message: "hello" })).rejects.toMatchObject({ code: "NOT_REQUESTED" });
    await pa.changeStatus(app.id, "more_info", admin, { message: "Need more." });
    await expect(mine.respondInfo(me.me, app.ref, { message: "  " })).rejects.toThrow();
    await expect(mine.respondInfo(me.me, app.ref, { message: "ok fine", socials: [{ platform: "instagram", handle: "bad handle!", url: "", followers: 1 }] })).rejects.toThrow();
    expect((await db.partnerApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("more_info");
  });
});

describe("offers, benefit and deliverables from the dashboard", () => {
  const subOffer = { type: "subscription", planSlug: "studio", subscriptionDays: 30, deliverables: 1, platforms: ["instagram"] };

  test("accept through the dashboard goes active once; a repeat answers with the state; another account gets 404", async () => {
    const me = await mkUser();
    const other = await mkUser();
    const app = await mkApp({ userId: me.id, status: "approved", email: me.email, emailKey: me.email });
    const draft = await offers.createOffer(app.id, subOffer, admin);
    expect((await mine.getMine(me.me, app.ref))!.offers).toHaveLength(0);
    await offers.sendOffer(app.id, draft.id, admin);
    const open = (await mine.getMine(me.me, app.ref))!;
    expect(open.offer).toMatchObject({ id: draft.id, status: "sent", version: 1, planSlug: "studio", durationLabel: "1 month" });
    expect(open.nextAction.kind).toBe("review_offer");
    expect(JSON.stringify(open.offer)).not.toContain(draft.token);

    await expect(mine.respondOffer(other.me, app.ref, draft.id, "accept")).rejects.toMatchObject({ status: 404 });
    const r = await mine.respondOffer(me.me, app.ref, draft.id, "accept");
    expect(r.state).toBe("accepted");
    expect(["active", "offer_accepted"]).toContain(r.app.status);
    expect(r.app.benefit).toMatchObject({ planName: expect.any(String), status: expect.any(String) });
    expect(r.app.offer!.status).toBe("accepted");
    const again = await mine.respondOffer(me.me, app.ref, draft.id, "accept");
    expect(again.state).toBe("accepted");
    await expect(mine.respondOffer(me.me, app.ref, draft.id, "decline")).rejects.toMatchObject({ code: "ANSWERED" });
    expect(await db.planGrant.count({ where: { email: me.email } })).toBe(1);

    const kinds = (await noticeRows(me.id)).map((x) => x.idemKey.split(":")[2]);
    expect(kinds).toContain("offer_sent");
    expect(kinds).toContain("offer_accepted");
    expect(kinds).toContain("benefit");
    if (r.app.status === "active") expect(kinds).toContain("active");
    expect(kinds).not.toContain("approved");
  });

  test("decline sends the application back to approved with one quiet confirmation", async () => {
    const me = await mkUser();
    const app = await mkApp({ userId: me.id, status: "approved" });
    const o = await offers.createOffer(app.id, { type: "paid", amountMinor: 500_000, currency: "INR" }, admin);
    await offers.sendOffer(app.id, o.id, admin);
    const r = await mine.respondOffer(me.me, app.ref, o.id, "decline", "Timing");
    expect(r.state).toBe("declined");
    expect(r.app.status).toBe("approved");
    expect(r.app.offers[0]).toMatchObject({ status: "declined", declineReason: "Timing", amountLabel: expect.stringContaining("5,000") });
    const kinds = (await noticeRows(me.id)).map((x) => x.idemKey.split(":")[2]);
    expect(kinds.filter((k) => k === "offer_declined")).toHaveLength(1);
    expect(kinds).not.toContain("approved");
  });

  test("a published link goes through the portal path; another application's item is not found", async () => {
    const me = await mkUser();
    const app = await mkApp({ userId: me.id, status: "approved", email: me.email, emailKey: me.email });
    const o = await offers.createOffer(app.id, { type: "paid", amountMinor: 100_000 }, admin);
    await offers.sendOffer(app.id, o.id, admin);
    await mine.respondOffer(me.me, app.ref, o.id, "accept");
    const d = await dels.createDeliverable(app.id, { title: "Launch reel", platform: "instagram", offerId: o.id }, admin);
    const mid = (await mine.getMine(me.me, app.ref))!;
    expect(mid.deliverables[0]).toMatchObject({ id: d.id, status: "planned" });
    expect(Object.keys(mid.deliverables[0])).not.toContain("views");
    const out = await mine.submitMyDeliverable(me.me, app.ref, d.id, { url: "https://www.instagram.com/p/abc123/", note: "Live now" });
    expect(out).toMatchObject({ status: "submitted", url: "https://www.instagram.com/p/abc123/", creatorNote: "Live now" });
    const stranger = await mkApp({ userId: me.id, status: "active" });
    await expect(mine.submitMyDeliverable(me.me, stranger.ref, d.id, { url: "https://x.com/a" })).rejects.toMatchObject({ status: 404 });
    await expect(mine.submitMyDeliverable(me.me, app.ref, d.id, { url: "not a link" })).rejects.toThrow();
  });
});

describe("withdraw, decision message and admin-only data", () => {
  test("withdraw closes an open application; a rejection shows the admin's message and never the note", async () => {
    const me = await mkUser();
    const a = await mkApp({ userId: me.id });
    const w = await mine.withdrawMine(me.me, a.ref);
    expect(w.app.status).toBe("withdrawn");
    expect(w.app.nextAction.kind).toBe("none");
    expect((await mine.withdrawMine(me.me, a.ref)).already).toBe(true);

    const b = await mkApp({ userId: me.id, status: "under_review" });
    await pa.addNote(b.id, "INTERNAL ONLY low engagement", admin);
    await pa.changeStatus(b.id, "rejected", admin, { message: "Your audience isn't a match for us right now." });
    const got = (await mine.getMine(me.me, b.ref))!;
    expect(got.decisionMessage).toBe("Your audience isn't a match for us right now.");
    const s = JSON.stringify(got);
    expect(s).not.toContain("INTERNAL ONLY");
    expect(s).not.toContain(admin.login);
    expect(s).not.toContain('"role"');
  });
});

describe("notices and the deadline sweep", () => {
  test("the same notice twice is one event", async () => {
    const me = await mkUser();
    const app = await mkApp({ userId: me.id });
    const one = await notices.partnerNotice(app, "approved", { stamp: "s1" });
    const two = await notices.partnerNotice(app, "approved", { stamp: "s1" });
    expect(one!.duplicate).toBe(false);
    expect(two!.duplicate).toBe(true);
    expect(await db.notifyEvent.count({ where: { idemKey: `partner:${app.id}:approved:s1` } })).toBe(1);
    expect(await notices.partnerNotice({ ...app, userId: null }, "approved", { stamp: "s2" })).toBeNull();
    expect(await notices.partnerNotice(app, "made_up", { stamp: "s3" })).toBeNull();
  });

  test("a status change raises one notice keyed by its event", async () => {
    const me = await mkUser();
    const app = await mkApp({ userId: me.id });
    await pa.changeStatus(app.id, "under_review", admin);
    const ev = await db.partnerEvent.findFirstOrThrow({ where: { applicationId: app.id, action: "status", to: "under_review" } });
    const rows = await noticeRows(me.id);
    expect(rows.map((r) => r.idemKey)).toEqual([`partner:${app.id}:under_review:${ev.id}`]);
    expect(rows[0]).toMatchObject({ kind: "partner_update", priority: 2 });
    expect(JSON.parse(rows[0].payload).email).toBeUndefined();
  });

  test("deliverables due within 48 hours are reminded once per due date", async () => {
    const me = await mkUser();
    const app = await mkApp({ userId: me.id, status: "active" });
    const now = new Date();
    const soon = await db.partnerDeliverable.create({ data: { applicationId: app.id, title: `${tag} soon`, platform: "instagram", dueAt: new Date(now.getTime() + 24 * 3_600_000) } });
    await db.partnerDeliverable.create({ data: { applicationId: app.id, title: `${tag} later`, platform: "instagram", dueAt: new Date(now.getTime() + 5 * 86_400_000) } });
    await db.partnerDeliverable.create({ data: { applicationId: app.id, title: `${tag} done`, platform: "instagram", status: "submitted", dueAt: new Date(now.getTime() + 3_600_000) } });
    await notices.partnerDeadlineSweep(now);
    await notices.partnerDeadlineSweep(new Date(now.getTime() + 60_000));
    const rows = (await noticeRows(me.id)).filter((r) => r.kind === "partner_deadline");
    expect(rows).toHaveLength(1);
    expect(rows[0].idemKey).toBe(`partner:${app.id}:deadline:${soon.id}:${soon.dueAt!.toISOString().slice(0, 10)}`);
    expect(JSON.parse(rows[0].payload).body).toContain(`${tag} soon`);
  });
});

describe("wiring pins", () => {
  test("the sweep runs the deadline check before draining the queue", () => {
    const s = read("lib/retention/sweep-notify.ts");
    expect(s.indexOf("partnerDeadlineSweep")).toBeGreaterThan(-1);
    expect(s.indexOf("partnerDeadlineSweep")).toBeLessThan(s.indexOf("drainEvents(now)"));
  });
  test("notices never ask the notice layer to email (partner email has one path)", () => {
    const s = read("lib/partners/notices.ts");
    expect(s).not.toMatch(/email:\s*true/);
    expect(s).toContain('source: "partners"');
  });
  test("every dashboard route signs in, checks the origin on writes and rate limits", () => {
    const dir = "app/api/me/partnerships";
    const routes = ["route.ts", "[ref]/route.ts", "[ref]/info/route.ts", "[ref]/offers/[offerId]/route.ts", "[ref]/deliverables/[id]/route.ts", "[ref]/withdraw/route.ts"];
    for (const r of routes) {
      const s = read(`${dir}/${r}`);
      expect(s).toMatch(/= route(<[^>]+>)?\(/);
      expect(s).not.toContain("auth: false");
      if (s.includes("export const POST")) {
        expect(s).toContain("assertSameOrigin(req)");
        expect(s).toContain("rateLimit(");
      }
    }
  });
  test("admin shows short applications and creator replies", () => {
    expect(read("components/admin/partners/PartnerDetail.tsx")).toContain("Short application");
    expect(read("components/admin/partners/PartnerDetail.tsx")).toContain('missing="Not provided"');
    expect(read("components/admin/partners/bits.tsx")).toContain('"info.provided": "Creator sent more information"');
    expect(read("components/admin/partners/HistoryList.tsx")).toContain("From the creator: ");
  });
});
