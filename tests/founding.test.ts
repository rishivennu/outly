/**
 * 1036: founding members. Seats only for proven inboxes, one per real Gmail inbox, numbered in order,
 * capped at the admin's count, revocable, and the lifetime discount is what checkout really charges.
 * 1067: a seat (and the badge) needs a real paid payment; free accounts get the offer, never the seat.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { foundingPrice, inboxKey, isGmail, normalizeFounding } from "../lib/founding-config";

let db: typeof import("../lib/db").db;
let f: typeof import("../lib/founding");
let settings: typeof import("../lib/settings");
let svc: typeof import("../lib/billing/service");
let n = 0;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  f = await import("../lib/founding");
  settings = await import("../lib/settings");
  svc = await import("../lib/billing/service");
  await (await import("../lib/billing/plans")).ensurePlans();
  await settings.saveConfig("payments", { provider: "mock" });
}, 60_000);

const stamp = () => `${Date.now()}${++n}`;
const pay = (userId: string, extra: Record<string, unknown> = {}) => db.payment.create({ data: { userId, amountMinor: 49900, currency: "INR", provider: "mock", status: "succeeded", sample: false, ...extra } });
/** A user; paying (a real succeeded payment) unless `paid` is false. */
const mk = async (email: string, verified = false, paid = true) => {
  const u = await db.user.create({ data: { name: `Founder ${n}`, email, passwordHash: "x", ...(verified ? { emailVerifiedAt: new Date(), emailVerifiedFor: email } : {}) } });
  if (paid) await pay(u.id);
  return u;
};
/** What a user the program doesn't apply to is charged for Creator. */
const listPrice = async () => {
  const plain = await db.user.create({ data: { name: "List", email: `list${stamp()}@test.dev`, passwordHash: "x" } });
  const s = await svc.startCheckout(plain.id, "creator");
  return (await db.payment.findUniqueOrThrow({ where: { id: s.paymentId } })).amountMinor;
};
/** The real money path: checkout, then the gateway confirms. */
const buy = async (userId: string) => {
  const start = await svc.startCheckout(userId, "creator");
  await svc.completePayment(start.paymentId);
  return db.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
};
const open = (limit: number, extra: Record<string, unknown> = {}) => settings.saveConfig("founding", { enabled: true, limit, discountPct: 30, gmailOnly: true, ...extra });

describe("rules (pure)", () => {
  test("Gmail dots, +tags and googlemail are one inbox", () => {
    expect(inboxKey("J.o.e+promo@GoogleMail.com")).toBe("joe@gmail.com");
    expect(inboxKey("joe@gmail.com")).toBe("joe@gmail.com");
    expect(inboxKey("j.oe+x@company.in")).toBe("j.oe+x@company.in");
    expect(isGmail("a@gmail.com")).toBe(true);
    expect(isGmail("a@gmail.co")).toBe(false);
  });
  test("30% off rounds to whole units, free stays free", () => {
    expect(foundingPrice(49900, 30)).toBe(34900); // 349.30 -> 349
    expect(foundingPrice(99900, 30)).toBe(69900);
    expect(foundingPrice(0, 30)).toBe(0);
    expect(foundingPrice(49900, null)).toBe(49900);
    expect(foundingPrice(19999, 30)).toBe(13900); // 139.99 -> 139, never more than advertised
    expect(foundingPrice(150, 90)).toBe(100); // never under what a gateway can charge
    expect(foundingPrice(100, 90)).toBe(100);
  });
  test("config is clamped", () => {
    expect(normalizeFounding({ limit: -5, discountPct: 500 })).toMatchObject({ limit: 0, discountPct: 90 });
    expect(normalizeFounding(null)).toMatchObject({ enabled: false, limit: 100, discountPct: 30, gmailOnly: true });
  });
});

describe("claiming", () => {
  test("off by default: nobody gets a seat", async () => {
    await settings.saveConfig("founding", { enabled: false });
    const u = await mk(`off${stamp()}@gmail.com`, true);
    expect((await f.claimFounding(u.id)).result).toBe("off");
  });

  test("unverified waits, verifying claims the next number, aliases can't take a second seat", async () => {
    await db.user.updateMany({ where: { foundingNo: { not: null } }, data: { foundingNo: null, foundingKey: null, foundingPct: null, foundingAt: null, foundingRetiredNo: null } });
    await open(3);
    const s = stamp();
    const a = await mk(`ann${s}@gmail.com`);
    expect((await f.claimFounding(a.id)).result).toBe("unverified");
    const r = await f.markEmailVerified(a.id);
    expect(r).toMatchObject({ result: "claimed", no: 1 });
    expect((await f.claimFounding(a.id)).result).toBe("already");
    expect(await f.foundingPctFor(a.id)).toBe(30);

    const alias = await mk(`a.n.n${s}+2@googlemail.com`, true);
    expect((await f.claimFounding(alias.id)).result).toBe("taken");

    const work = await mk(`ann${s}@company.dev`, true);
    expect((await f.claimFounding(work.id)).result).toBe("not_gmail");
  });

  test("the admin's count is a hard cap, and the counter shows what's left", async () => {
    const b = await mk(`bob${stamp()}@gmail.com`, true);
    const c = await mk(`cat${stamp()}@gmail.com`, true);
    const d = await mk(`dan${stamp()}@gmail.com`, true);
    expect((await f.claimFounding(b.id)).no).toBe(2);
    expect((await f.claimFounding(c.id)).no).toBe(3);
    expect((await f.claimFounding(d.id)).result).toBe("full");
    f.clearFoundingCache();
    expect(await f.foundingPublic()).toMatchObject({ left: 0, limit: 3, pct: 30 });
    await open(4);
    f.clearFoundingCache();
    expect((await f.foundingPublic())?.left).toBe(1);
    expect((await f.claimFounding(d.id)).no).toBe(4);
  });

  test("racing claims never exceed the cap", async () => {
    await open(6);
    const us = await Promise.all(Array.from({ length: 5 }, (_, i) => mk(`race${i}${stamp()}@gmail.com`, true)));
    const rs = await Promise.all(us.map((u) => f.claimFounding(u.id)));
    expect(rs.filter((r) => r.result === "claimed").length).toBe(2);
    expect(await f.seatsUsed()).toBe(6);
  });

  test("many claims racing for ONE last seat: exactly one wins", async () => {
    await open(7);
    const us = await Promise.all(Array.from({ length: 12 }, (_, i) => mk(`last${i}${stamp()}@gmail.com`, true)));
    const rs = await Promise.all(us.map((u) => f.claimFounding(u.id)));
    expect(rs.filter((r) => r.result === "claimed").length).toBe(1);
    expect(await f.seatsUsed()).toBe(7);
  });

  test("gmailOnly off lets any proven inbox claim", async () => {
    await open(8, { gmailOnly: false });
    const w = await mk(`work${stamp()}@studio.dev`, true);
    expect((await f.claimFounding(w.id)).result).toBe("claimed");
    await open(8);
  });

  test("revoke takes the discount away and the seat doesn't come back by itself", async () => {
    const st = await f.foundingState();
    const m = st.members[0];
    await f.revokeFounding(m.id);
    expect(await f.foundingPctFor(m.id)).toBeNull();
    expect((await f.claimFounding(m.id)).result).toBe("revoked");
  });

  test("a revoked number is retired: the next member never gets it", async () => {
    const st = await f.foundingState();
    const top = st.members[st.members.length - 1];
    await f.revokeFounding(top.id);
    await open(st.counts.used + 5);
    const nx = await mk(`next${stamp()}@gmail.com`, true);
    const r = await f.claimFounding(nx.id);
    expect(r.result).toBe("claimed");
    expect(r.no!).toBeGreaterThan(top.no);
    await open(7);
  });

  test("a changed email is unproven again", async () => {
    await open(500);
    const u = await mk(`chg${stamp()}@gmail.com`, true);
    await db.user.update({ where: { id: u.id }, data: { email: `chg2${stamp()}@gmail.com` } });
    expect((await f.claimFounding(u.id)).result).toBe("unverified");
  });

  test("reading the card never claims; a proven payer gets a one-tap claim", async () => {
    await open(500);
    const u = await mk(`ready${stamp()}@gmail.com`, true);
    expect(await f.myFounding(u.id)).toMatchObject({ kind: "claim", reason: "ready" });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).foundingNo).toBeNull();
    // a payment now would seat them, so it's charged at the founding price
    expect(await f.foundingPctFor(u.id)).toBe(30);
  });
});

describe("claim link", () => {
  test("a signed link proves the inbox; a tampered or re-addressed one doesn't", async () => {
    const u = await mk(`link${stamp()}@gmail.com`);
    const t = f.claimToken(u.id, u.email);
    expect((await f.checkClaimToken(t))?.id).toBe(u.id);
    expect(await f.checkClaimToken(t.slice(0, -2) + "xx")).toBeNull();
    expect(await f.checkClaimToken(f.claimToken(u.id, u.email, 0, Date.now() - 8 * 864e5))).toBeNull();
    await db.user.update({ where: { id: u.id }, data: { email: `moved${stamp()}@gmail.com` } });
    expect(await f.checkClaimToken(t)).toBeNull();
  });

  test("a link works once: after it proves the inbox, replaying it does nothing", async () => {
    await open(500);
    const u = await mk(`once${stamp()}@gmail.com`);
    const t = f.claimToken(u.id, u.email);
    expect((await f.checkClaimToken(t))?.id).toBe(u.id);
    expect((await f.markEmailVerified(u.id)).result).toBe("claimed");
    expect(await f.checkClaimToken(t)).toBeNull();
    expect(await f.claimLinkOwnerIsMember(t)).toBe(true);
    expect(await f.claimLinkOwnerIsMember(t.slice(0, -3) + "abc")).toBe(false);
  });

  test("signup sends nothing; the first payment emails the link; the 2-minute cooldown stops repeats", async () => {
    await open(50);
    const u = await mk(`new${stamp()}@gmail.com`, false, false);
    expect(await f.onSignupFounding(u.id, false)).toBeNull();
    expect(await db.emailLog.count({ where: { to: u.email, kind: "founding" } })).toBe(0);
    expect((await f.myFounding(u.id))?.kind).toBe("offer");

    await buy(u.id);
    const mail = await db.emailLog.findFirst({ where: { to: u.email, kind: "founding" }, orderBy: { createdAt: "desc" } });
    expect(mail?.subject).toMatch(/claim your founding seat/i);
    expect(mail?.html).toContain("/api/founding/verify?t=");
    await expect(f.sendClaimLink(u.id)).rejects.toThrow(/already on its way/i);
    expect((await f.myFounding(u.id))?.kind).toBe("claim");
    // proving the inbox now seats the payer
    expect((await f.markEmailVerified(u.id)).result).toBe("claimed");
    expect((await f.myFounding(u.id))?.kind).toBe("member");
  });

  test("Google signup (verified) is NOT seated until it pays; paying seats it and sends the welcome email", async () => {
    const u = await mk(`goog${stamp()}@gmail.com`, false, false);
    expect((await f.onSignupFounding(u.id, true))?.result).toBe("unpaid");
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).foundingNo).toBeNull();
    expect(await f.myFounding(u.id)).toMatchObject({ kind: "offer", proven: true, seen: false });
    expect(await f.foundingBadgeNo(u.id)).toBeNull();

    await buy(u.id);
    const no = (await db.user.findUniqueOrThrow({ where: { id: u.id } })).foundingNo;
    expect(no).toBeGreaterThan(0);
    const mail = await db.emailLog.findFirst({ where: { to: u.email, kind: "founding" } });
    expect(mail?.subject).toMatch(/founding member #\d+/);
    expect(mail?.html).toContain("/brand/founding/01-rocket-badge.png");
    expect((await f.myFounding(u.id))?.kind).toBe("member");
    expect(await f.foundingBadgeNo(u.id)).toBe(no);
  });
});

describe("1067: paid only", () => {
  test("a free account can't claim, gets no badge, and is only offered the seat", async () => {
    await open(500);
    const u = await mk(`free${stamp()}@gmail.com`, true, false);
    expect((await f.claimFounding(u.id)).result).toBe("unpaid");
    expect(await f.markEmailVerified(u.id)).toMatchObject({ result: "unpaid" });
    expect(await f.foundingBadgeNo(u.id)).toBeNull();
    expect(await f.myFounding(u.id)).toMatchObject({ kind: "offer", limit: 500, pct: 30 });
  });

  test("sample, zero-amount, pending and failed payments don't count as paying", async () => {
    await open(500);
    const u = await mk(`fake${stamp()}@gmail.com`, true, false);
    await pay(u.id, { sample: true });
    await pay(u.id, { amountMinor: 0 });
    await pay(u.id, { status: "pending" });
    await pay(u.id, { status: "failed" });
    await pay(u.id, { status: "refunded" });
    expect(await f.hasPaid(u.id)).toBe(false);
    expect((await f.claimFounding(u.id)).result).toBe("unpaid");
  });

  test("the first checkout of an offered user charges the founding price, and paying seats them", async () => {
    await open(500);
    const u = await mk(`offer${stamp()}@gmail.com`, true, false);
    const p = await buy(u.id);
    expect(p.amountMinor).toBe(foundingPrice(await listPrice(), 30));
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).foundingNo).toBeGreaterThan(0);
  });

  test("when every seat is taken: free users see 'full', payers without a seat see nothing, members keep theirs", async () => {
    await open(500);
    const member = await mk(`keep${stamp()}@gmail.com`, true);
    expect((await f.claimFounding(member.id)).result).toBe("claimed");
    await open(await f.seatsUsed());
    f.clearFoundingCache();
    expect((await f.foundingPublic())?.left).toBe(0);

    const free = await mk(`late${stamp()}@gmail.com`, true, false);
    expect(await f.myFounding(free.id)).toMatchObject({ kind: "full" });
    expect(await f.foundingPctFor(free.id)).toBeNull();
    const payer = await mk(`latep${stamp()}@gmail.com`, true);
    expect(await f.myFounding(payer.id)).toBeNull();
    expect((await f.claimFounding(payer.id)).result).toBe("full");
    // paying after the cap gives no seat and the list price
    const p = await buy(free.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: free.id } })).foundingNo).toBeNull();
    expect(p.amountMinor).toBe(await listPrice());

    expect((await f.myFounding(member.id))?.kind).toBe("member");
    expect(await f.foundingBadgeNo(member.id)).toBeGreaterThan(0);
    await open(500);
  });

  test("a seat held from before 1067 without a payment keeps its price but hides the badge until they pay", async () => {
    await open(500);
    const u = await mk(`legacy${stamp()}@gmail.com`, true, false);
    const top = await db.user.aggregate({ _max: { foundingNo: true, foundingRetiredNo: true } });
    const no = Math.max(top._max.foundingNo ?? 0, top._max.foundingRetiredNo ?? 0) + 1;
    await db.user.update({ where: { id: u.id }, data: { foundingNo: no, foundingAt: new Date(), foundingPct: 25, foundingKey: inboxKey(u.email) } });
    expect(await f.myFounding(u.id)).toMatchObject({ kind: "reserved", no, pct: 25, seen: false });
    expect(await f.foundingBadgeNo(u.id)).toBeNull();
    expect(await f.foundingPctFor(u.id)).toBe(25);
    const st = await f.foundingState();
    expect(st.members.find((m) => m.id === u.id)?.paid).toBe(false);

    await buy(u.id);
    expect(await f.myFounding(u.id)).toMatchObject({ kind: "member", no, pct: 25 });
    expect(await f.foundingBadgeNo(u.id)).toBe(no);
  });

  test("refunding a member's only payment frees the seat and retires the number", async () => {
    await open(500);
    const u = await mk(`refund${stamp()}@gmail.com`, true, false);
    const p = await buy(u.id);
    const no = (await db.user.findUniqueOrThrow({ where: { id: u.id } })).foundingNo!;
    const used = await f.seatsUsed();
    await svc.refundPayment(p.id, "Tester", "changed mind");
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.foundingNo).toBeNull();
    expect(after.foundingRetiredNo).toBe(no);
    expect(await f.seatsUsed()).toBe(used - 1);
    expect(await f.foundingBadgeNo(u.id)).toBeNull();
    // a fresh payment can earn a seat again, with a new number
    await buy(u.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).foundingNo!).toBeGreaterThan(no);
  });

  test("a refund doesn't free the seat while another real payment still backs it", async () => {
    await open(500);
    const u = await mk(`two${stamp()}@gmail.com`, true);
    const p = await buy(u.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).foundingNo).toBeGreaterThan(0);
    await svc.refundPayment(p.id, "Tester", "duplicate");
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).foundingNo).toBeGreaterThan(0);
  });

  test("dismissing the welcome promo is remembered on the account", async () => {
    await open(500);
    const u = await mk(`promo${stamp()}@gmail.com`, true, false);
    expect(await f.myFounding(u.id)).toMatchObject({ kind: "offer", seen: false });
    await f.dismissFoundingPromo(u.id);
    expect(await f.myFounding(u.id)).toMatchObject({ kind: "offer", seen: true });
  });
});

describe("checkout", () => {
  test("a founding member is charged 30% less; everyone else pays the list price", async () => {
    const plain = await mk(`plain${stamp()}@test.dev`);
    const list = await svc.startCheckout(plain.id, "creator");
    const listed = (await db.payment.findUniqueOrThrow({ where: { id: list.paymentId } })).amountMinor;

    const fm = await mk(`fm${stamp()}@gmail.com`, true);
    expect((await f.claimFounding(fm.id)).result).toBe("claimed");
    const start = await svc.startCheckout(fm.id, "creator");
    const paid = (await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } })).amountMinor;
    expect(paid).toBe(foundingPrice(listed, 30));
    expect(paid).toBeLessThan(listed);

    // Lifetime: closing the program or changing the % later doesn't touch an existing member.
    await settings.saveConfig("founding", { enabled: false, discountPct: 10 });
    expect(await f.foundingPctFor(fm.id)).toBe(30);
  });
});
