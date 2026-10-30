import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { getConfig } from "./settings";
import { sendEmail, templates } from "./email";
import { adminEvent } from "./admin/route";
import { FOUNDING_DEFAULT, eligibleEmail, inboxKey, normalizeFounding, seatsLeft } from "./founding-config";

export { FOUNDING_DEFAULT, normalizeFounding, foundingPrice, type FoundingConfig } from "./founding-config";

/**
 * Founding members (1036). A seat is only ever given to a PROVEN inbox: Google sign-in (Google checked it),
 * an emailed sign-in code, or the claim link we email. Seats are numbered 1, 2, 3... and the discount is
 * copied onto the member, so it really is for life.
 *
 * 1067: a seat also needs a successful payment for a paid plan. Free accounts never get one (they see a
 * one-time invitation instead), the badge only shows once that payment exists, and refunding the last
 * real payment hands the seat back. The checks live here and in billing, never only in the UI.
 */
export const foundingConfig = async () => normalizeFounding(await getConfig("founding"));

export const STAMP_PATH = "/brand/founding/01-rocket-badge.png";
const LINK_TTL_MS = 7 * 24 * 60 * 60_000;

export const seatsUsed = () => db.user.count({ where: { foundingNo: { not: null } } });

/** A real payment that went through for a paid plan. Admin sample data, free plans and gift months never count. */
const PAID = { status: "succeeded", sample: false, amountMinor: { gt: 0 } } as const;
export const hasPaid = async (userId: string) => (await db.payment.count({ where: { userId, ...PAID } })) > 0;

/** Used only if a member row somehow has no locked-in percentage. */
export const FALLBACK_PCT = FOUNDING_DEFAULT.discountPct;

type Proof = { email: string; emailVerifiedAt: Date | null; emailVerifiedFor: string | null };
/** Proven means THIS address was proven. Changing the email makes the account unproven again. */
export const isProven = (u: Proof) => !!u.emailVerifiedAt && (u.emailVerifiedFor ?? "").toLowerCase() === u.email.toLowerCase();
/** Folded into the link's signature, so the link dies the moment it is used (proving the inbox changes it). */
const proofTag = (u: Proof) => (isProven(u) ? u.emailVerifiedAt!.getTime() : 0);

// ---- the claim link: a signed (user, address, proof state, expiry), so it dies if the address changes or once used ----
const sign = (userId: string, email: string, tag: number, exp: number) =>
  createHmac("sha256", env.AUTH_SECRET).update(`founding:${userId}:${email.toLowerCase()}:${tag}:${exp}`).digest("base64url");
export const claimToken = (userId: string, email: string, tag = 0, now = Date.now()) => {
  const exp = now + LINK_TTL_MS;
  return `${userId}.${exp}.${sign(userId, email, tag, exp)}`;
};
export async function checkClaimToken(t: string): Promise<{ id: string; email: string } | null> {
  const [id, expS, sig] = String(t).split(".");
  const exp = Number(expS);
  if (!id || !sig || !Number.isFinite(exp) || exp < Date.now() || id.length > 40) return null;
  const u = await db.user.findUnique({ where: { id }, select: { id: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true } });
  if (!u) return null;
  const want = Buffer.from(sign(u.id, u.email, proofTag(u), exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? { id: u.id, email: u.email } : null;
}
/** A used link opened again (or by a mail scanner first): if its owner already holds a seat, say so. Changes nothing. */
export async function claimLinkOwnerIsMember(t: string) {
  const [id, expS, sig] = String(t).split(".");
  const exp = Number(expS);
  if (!id || !sig || !Number.isFinite(exp) || id.length > 40) return false;
  const u = await db.user.findUnique({ where: { id }, select: { email: true, foundingNo: true } });
  if (!u?.foundingNo) return false;
  // Only a genuine link we sent (signed before the inbox was proven) counts; a forged one learns nothing.
  const want = Buffer.from(sign(id, u.email, 0, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type ClaimResult = "claimed" | "already" | "off" | "full" | "busy" | "unpaid" | "unverified" | "not_gmail" | "taken" | "revoked";

/** Gives the next seat to this member if every rule passes. Safe to call any number of times. */
export async function claimFounding(userId: string): Promise<{ result: ClaimResult; no?: number }> {
  const cfg = await foundingConfig();
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, emailVerifiedAt: true, emailVerifiedFor: true, foundingNo: true, foundingKey: true } });
  if (!u) return { result: "off" };
  if (u.foundingNo) return { result: "already", no: u.foundingNo };
  if (u.foundingKey) return { result: "revoked" }; // the admin took this seat back; it doesn't come back by itself
  if (!cfg.enabled || cfg.limit <= 0) return { result: "off" };
  if (!eligibleEmail(cfg, u.email)) return { result: "not_gmail" };
  // 1067: no successful payment for a paid plan, no seat. This is the rule every path goes through.
  if (!(await hasPaid(u.id))) return { result: "unpaid" };
  if (!isProven(u)) return { result: "unverified" };
  const key = inboxKey(u.email);
  if (await db.user.findFirst({ where: { foundingKey: key, id: { not: u.id } }, select: { id: true } })) return { result: "taken" };

  for (let i = 0; i < 6; i++) {
    if ((await seatsUsed()) >= cfg.limit) return { result: "full" };
    // Retired (revoked) numbers count too, so a number is never given to two people.
    const top = await db.user.aggregate({ _max: { foundingNo: true, foundingRetiredNo: true } });
    const no = Math.max(top._max.foundingNo ?? 0, top._max.foundingRetiredNo ?? 0) + 1;
    try {
      const r = await db.user.updateMany({ where: { id: u.id, foundingNo: null, foundingKey: null }, data: { foundingNo: no, foundingAt: new Date(), foundingPct: cfg.discountPct, foundingKey: key } });
      if (r.count !== 1) return { result: "already" };
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      // Same number taken in the same instant: try the next one. Same inbox: that one is final.
      if (await db.user.findFirst({ where: { foundingKey: key, id: { not: u.id } }, select: { id: true } })) return { result: "taken" };
      continue;
    }
    // Several claims racing for the last seats can all pass the count. Each checks its own place in line
    // and gives its seat back if it landed past the cap, so however many race, the cap holds.
    const rank = await db.user.count({ where: { foundingNo: { not: null, lte: no } } });
    if (rank > cfg.limit) {
      await db.user.updateMany({ where: { id: u.id, foundingNo: no }, data: { foundingNo: null, foundingAt: null, foundingPct: null, foundingKey: null } });
      return { result: "full" };
    }
    await sendWelcome(u.id).catch((e) => console.error("[founding] email", e));
    await adminEvent("founding", `${u.name || u.email} became founding member #${no}`, `${cfg.discountPct}% off for life`, "/admin/founding").catch(() => {});
    return { result: "claimed", no };
  }
  // Lost every race for a number: seats may well remain, so don't say they're gone.
  return { result: (await seatsUsed()) >= cfg.limit ? "full" : "busy" };
}

/** The inbox is proven (Google, an emailed code, the claim link). Records it, then tries for a seat. Never throws. */
export async function markEmailVerified(userId: string) {
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, emailVerifiedFor: true } });
    if (!u) return { result: "off" as ClaimResult };
    if (!isProven(u)) await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), emailVerifiedFor: u.email.toLowerCase() } });
    // 1052: plans an admin granted to this exact address start now, and a Refer & Earn month that was
    // waiting on the verified address is issued. Both never throw.
    const [{ activatePendingGrants }, { settleReferral }] = await Promise.all([import("./billing/access"), import("./referral")]);
    await activatePendingGrants(userId);
    await settleReferral(userId);
    return await claimFounding(userId);
  } catch (e) {
    console.error("[founding] verify", e);
    return { result: "off" as ClaimResult };
  }
}

/**
 * After every signup. A proven inbox is recorded (a brand new account has never paid, so no seat yet).
 * 1067: no claim link at signup any more; it goes out after the first payment if the inbox still needs proving.
 * Never throws.
 */
export async function onSignupFounding(userId: string, verified: boolean) {
  try {
    if (verified) return await markEmailVerified(userId);
    return null;
  } catch (e) {
    console.error("[founding] signup", e);
    return null;
  }
}

/**
 * 1067: a payment for a paid plan just went through. Seats the payer if every rule passes; an unproven Gmail
 * gets the one-tap confirm link so the seat can follow. Never throws: the money is in, the plan must be on.
 */
export async function onPaidFounding(userId: string) {
  try {
    const r = await claimFounding(userId);
    if (r.result === "unverified") await sendClaimLink(userId).catch(() => {});
    if (r.result === "claimed") clearFoundingCache();
    return r;
  } catch (e) {
    console.error("[founding] paid", e);
    return { result: "off" as ClaimResult };
  }
}

/**
 * 1067: a refund took back this member's last real payment, so the seat goes back to the pool. The number is
 * retired (never reused) and the inbox may earn a seat again with a new payment. Never throws.
 */
export async function releaseUnpaidFounding(userId: string) {
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, foundingNo: true } });
    if (!u?.foundingNo || (await hasPaid(userId))) return false;
    const r = await db.user.updateMany({ where: { id: userId, foundingNo: u.foundingNo }, data: { foundingNo: null, foundingAt: null, foundingPct: null, foundingKey: null, foundingRetiredNo: u.foundingNo } });
    if (r.count !== 1) return false;
    clearFoundingCache();
    await adminEvent("founding", `${u.name || u.email} gave back founding seat #${u.foundingNo}`, "Their only payment was refunded", "/admin/founding").catch(() => {});
    return true;
  } catch (e) {
    console.error("[founding] release", e);
    return false;
  }
}

async function sendWelcome(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, foundingNo: true, foundingPct: true } });
  if (!u?.foundingNo) return;
  await sendEmail({
    to: u.email,
    kind: "founding",
    subject: `You're Outlly founding member #${u.foundingNo}`,
    html: templates.foundingWelcome({ name: u.name.split(" ")[0] || "there", no: u.foundingNo, pct: u.foundingPct ?? FALLBACK_PCT, url: `${env.APP_URL}/billing`, stamp: `${env.APP_URL}${STAMP_PATH}` }),
  });
}

/** Emails the "prove it's your Gmail" link. Throttled by the caller (route) and by the 2-minute check here. */
export async function sendClaimLink(userId: string) {
  const [cfg, u] = await Promise.all([foundingConfig(), db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true } })]);
  if (!u) return;
  const recent = await db.emailLog.findFirst({ where: { to: u.email, kind: "founding", createdAt: { gt: new Date(Date.now() - 2 * 60_000) } }, select: { id: true } });
  if (recent) throw new HttpError(429, "A link is already on its way. Check your inbox (and Promotions), or ask again in two minutes.", "FOUNDING_COOLDOWN");
  const left = seatsLeft(cfg, await seatsUsed());
  await sendEmail({
    to: u.email,
    kind: "founding",
    subject: "Confirm your Gmail to claim your founding seat",
    html: templates.foundingVerify({ name: u.name.split(" ")[0] || "there", url: `${env.APP_URL}/api/founding/verify?t=${encodeURIComponent(claimToken(u.id, u.email, proofTag(u)))}`, left, pct: cfg.discountPct, stamp: `${env.APP_URL}${STAMP_PATH}` }),
  });
}

/**
 * 1067: where this account stands. One function, so the badge, Home, Billing and checkout always agree.
 *  member    seated and has paid: the badge shows, checkout uses the locked-in discount.
 *  reserved  seated before 1067 without paying: the seat (and its price) is held, the badge waits for a payment.
 *  claim     has paid, a seat is open, but it isn't theirs yet (inbox to confirm, or the program opened later).
 *  offer     has never paid and a seat is open: paying for any plan seats them, at the founding price.
 *  full      has never paid and every seat is taken: they're told so and pointed at the paid plans.
 */
async function seatState(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true, foundingNo: true, foundingPct: true, foundingAt: true, foundingKey: true, foundingPromoAt: true } });
  if (!u) return null;
  const [paid, cfg] = await Promise.all([hasPaid(u.id), foundingConfig()]);
  if (u.foundingNo) return { u, paid, cfg, left: 0, kind: paid ? ("member" as const) : ("reserved" as const) };
  if (u.foundingKey) return null; // revoked by the admin: nothing to offer
  if (!cfg.enabled || cfg.limit <= 0 || !eligibleEmail(cfg, u.email)) return null;
  const left = seatsLeft(cfg, await seatsUsed());
  if (left <= 0) return paid ? null : { u, paid, cfg, left, kind: "full" as const };
  // Another account already holds this inbox's seat: paying here would never seat them.
  if (await db.user.findFirst({ where: { foundingKey: inboxKey(u.email), id: { not: u.id } }, select: { id: true } })) return null;
  return { u, paid, cfg, left, kind: paid ? ("claim" as const) : ("offer" as const) };
}

/**
 * The founding discount checkout charges. Members (and held seats) keep the one they claimed with, whatever
 * the program does later. Anyone a payment would seat right now pays the current founding price, so their
 * first invoice already matches. Everyone else pays the list price.
 */
export async function foundingPctFor(userId: string) {
  const s = await seatState(userId);
  if (!s) return null;
  if (s.kind === "member" || s.kind === "reserved") return s.u.foundingPct ?? FALLBACK_PCT;
  if (s.kind === "claim" || s.kind === "offer") return s.cfg.discountPct;
  return null;
}

/** 1067: the badge number to show, or null. Only a seat backed by a real payment earns it. */
export async function foundingBadgeNo(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { foundingNo: true } });
  return u?.foundingNo && (await hasPaid(userId)) ? u.foundingNo : null;
}

/** 1067: the one-time founding invitation was closed. Stored on the account, so it stays closed on every device. */
export async function dismissFoundingPromo(userId: string) {
  await db.user.updateMany({ where: { id: userId, foundingPromoAt: null }, data: { foundingPromoAt: new Date() } });
}

export type FoundingMine =
  | { kind: "member"; no: number; pct: number; at: string }
  | { kind: "reserved"; no: number; pct: number; seen: boolean }
  // unverified: we email a link to prove the inbox. ready: already proven, one tap claims (never claimed on a GET).
  | { kind: "claim"; left: number; limit: number; pct: number; email: string; reason: "unverified" | "ready" }
  | { kind: "offer"; left: number; limit: number; pct: number; proven: boolean; seen: boolean }
  | { kind: "full"; limit: number }
  | null;

/** What Home (the one-time invitation) and Billing (the seat card, the founding price) show this account. */
export async function myFounding(userId: string): Promise<FoundingMine> {
  try {
    const s = await seatState(userId);
    if (!s) return null;
    const { u } = s;
    const pct = u.foundingPct ?? FALLBACK_PCT;
    if (s.kind === "member") return { kind: "member", no: u.foundingNo!, pct, at: (u.foundingAt ?? new Date()).toISOString() };
    if (s.kind === "reserved") return { kind: "reserved", no: u.foundingNo!, pct, seen: !!u.foundingPromoAt };
    if (s.kind === "full") return { kind: "full", limit: s.cfg.limit };
    if (s.kind === "claim") return { kind: "claim", left: s.left, limit: s.cfg.limit, pct: s.cfg.discountPct, email: u.email, reason: isProven(u) ? "ready" : "unverified" };
    return { kind: "offer", left: s.left, limit: s.cfg.limit, pct: s.cfg.discountPct, proven: isProven(u), seen: !!u.foundingPromoAt };
  } catch (e) {
    console.error("[founding] mine", e);
    return null;
  }
}

// ---- public: the "N seats left" line on signup. Cached briefly, never throws. ----
const g = globalThis as unknown as { __foundingPub?: { at: number; v: FoundingPublic | null } };
export type FoundingPublic = { left: number; limit: number; pct: number; gmailOnly: boolean };
export async function foundingPublic(): Promise<FoundingPublic | null> {
  if (g.__foundingPub && Date.now() - g.__foundingPub.at < 10_000) return g.__foundingPub.v;
  let v: FoundingPublic | null = null;
  try {
    const cfg = await foundingConfig();
    if (cfg.enabled && cfg.limit > 0) v = { left: seatsLeft(cfg, await seatsUsed()), limit: cfg.limit, pct: cfg.discountPct, gmailOnly: cfg.gmailOnly };
  } catch {
    v = null;
  }
  g.__foundingPub = { at: Date.now(), v };
  return v;
}
export const clearFoundingCache = () => {
  delete g.__foundingPub;
};

// ---- admin ----
export async function foundingState() {
  const cfg = await foundingConfig();
  const [used, members, verified, unpaid, payers] = await Promise.all([
    seatsUsed(),
    db.user.findMany({ where: { foundingNo: { not: null } }, orderBy: { foundingNo: "asc" }, take: 500, select: { id: true, name: true, email: true, foundingNo: true, foundingAt: true, foundingPct: true, _count: { select: { payments: { where: PAID } } } } }),
    db.user.count({ where: { emailVerifiedAt: { not: null } } }),
    // Seats held from before 1067 by accounts that have never paid: the badge stays hidden until they do.
    db.user.count({ where: { foundingNo: { not: null }, payments: { none: PAID } } }),
    // Paying customers without a seat (yet): what "Seat paying customers" would work through.
    db.user.count({ where: { foundingKey: null, payments: { some: PAID } } }),
  ]);
  return {
    config: cfg,
    counts: { used, left: seatsLeft(cfg, used), verified, unpaid, payers },
    members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, no: m.foundingNo!, pct: m.foundingPct ?? cfg.discountPct, at: (m.foundingAt ?? new Date()).toISOString(), paid: m._count.payments > 0 })),
  };
}
export type FoundingState = Awaited<ReturnType<typeof foundingState>>;

/**
 * Admin: offer the open seats to the earliest PAYING customers who don't have one (1067: free accounts are
 * never seated). Proven inboxes get their seat at once; the rest get the claim link (at most once every
 * 3 days each), so a seat still needs a real inbox as well as a real payment.
 */
export async function backfillFounding() {
  const cfg = await foundingConfig();
  if (!cfg.enabled) throw new HttpError(409, "Turn the founding program on first.", "FOUNDING_OFF");
  let room = seatsLeft(cfg, await seatsUsed());
  if (room <= 0) return { claimed: 0, invited: 0 };
  const users = await db.user.findMany({ where: { foundingKey: null, payments: { some: PAID } }, orderBy: { createdAt: "asc" }, take: 2000, select: { id: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true } });
  let claimed = 0;
  let invited = 0;
  for (const u of users) {
    if (room <= 0) break;
    if (!eligibleEmail(cfg, u.email)) continue;
    if (isProven(u)) {
      const r = await claimFounding(u.id);
      if (r.result === "claimed") {
        claimed++;
        room--;
      } else if (r.result === "full") break;
      continue;
    }
    const sent = await db.emailLog.findFirst({ where: { to: u.email, kind: "founding", createdAt: { gt: new Date(Date.now() - 3 * 864e5) } }, select: { id: true } });
    if (sent) continue;
    await sendClaimLink(u.id).then(() => invited++).catch(() => {});
    // Invites don't hold a seat, so don't send many more than there are seats.
    if (invited >= room * 2) break;
  }
  clearFoundingCache();
  return { claimed, invited };
}

/** Admin: take a seat back (abuse, a refund). The number is retired for good, the inbox can't claim again by itself. */
export async function revokeFounding(id: string) {
  const u = await db.user.findUnique({ where: { id }, select: { foundingNo: true } });
  const r = u?.foundingNo
    ? await db.user.updateMany({ where: { id, foundingNo: u.foundingNo }, data: { foundingNo: null, foundingAt: null, foundingPct: null, foundingRetiredNo: u.foundingNo } })
    : { count: 0 };
  if (!r.count) throw new HttpError(409, "That member doesn't hold a founding seat.", "NOT_FOUNDING");
  clearFoundingCache();
}
