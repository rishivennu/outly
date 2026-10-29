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
 * an emailed sign-in code, or the claim link we email. Password signups get the link straight away.
 * Seats are numbered 1, 2, 3... and the discount is copied onto the member, so it really is for life.
 */
export const foundingConfig = async () => normalizeFounding(await getConfig("founding"));

export const STAMP_PATH = "/brand/founding/01-rocket-badge.png";
const LINK_TTL_MS = 7 * 24 * 60 * 60_000;

export const seatsUsed = () => db.user.count({ where: { foundingNo: { not: null } } });

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

export type ClaimResult = "claimed" | "already" | "off" | "full" | "busy" | "unverified" | "not_gmail" | "taken" | "revoked";

/** Gives the next seat to this member if every rule passes. Safe to call any number of times. */
export async function claimFounding(userId: string): Promise<{ result: ClaimResult; no?: number }> {
  const cfg = await foundingConfig();
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, emailVerifiedAt: true, emailVerifiedFor: true, foundingNo: true, foundingKey: true } });
  if (!u) return { result: "off" };
  if (u.foundingNo) return { result: "already", no: u.foundingNo };
  if (u.foundingKey) return { result: "revoked" }; // the admin took this seat back; it doesn't come back by itself
  if (!cfg.enabled || cfg.limit <= 0) return { result: "off" };
  if (!eligibleEmail(cfg, u.email)) return { result: "not_gmail" };
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

/** After every signup. Proven inboxes claim now; others get the claim link if a seat could be theirs. Never throws. */
export async function onSignupFounding(userId: string, verified: boolean) {
  try {
    if (verified) return await markEmailVerified(userId);
    const cfg = await foundingConfig();
    const u = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!u || !cfg.enabled || !eligibleEmail(cfg, u.email) || seatsLeft(cfg, await seatsUsed()) <= 0) return null;
    await sendClaimLink(userId);
    return { result: "unverified" as ClaimResult };
  } catch (e) {
    console.error("[founding] signup", e);
    return null;
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

/** The member's founding discount at checkout: locked in when they claimed, whatever the program does later. */
export async function foundingPctFor(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { foundingNo: true, foundingPct: true } });
  return u?.foundingNo ? u.foundingPct ?? FALLBACK_PCT : null;
}

export type FoundingMine =
  | { kind: "member"; no: number; pct: number; at: string }
  // unverified: we email a link to prove the inbox. ready: already proven, one tap claims (never claimed on a GET).
  | { kind: "claim"; left: number; limit: number; pct: number; email: string; reason: "unverified" | "ready" }
  | null;

/** What Home and Billing show this member. */
export async function myFounding(userId: string): Promise<FoundingMine> {
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, emailVerifiedFor: true, foundingNo: true, foundingPct: true, foundingAt: true, foundingKey: true } });
    if (!u) return null;
    if (u.foundingNo) return { kind: "member", no: u.foundingNo, pct: u.foundingPct ?? FALLBACK_PCT, at: (u.foundingAt ?? new Date()).toISOString() };
    if (u.foundingKey) return null;
    const cfg = await foundingConfig();
    if (!cfg.enabled || !eligibleEmail(cfg, u.email)) return null;
    const left = seatsLeft(cfg, await seatsUsed());
    if (left <= 0) return null;
    // Proven but missed the moment (program switched on later): offer a one-tap claim. Reading never claims.
    return { kind: "claim", left, limit: cfg.limit, pct: cfg.discountPct, email: u.email, reason: isProven(u) ? "ready" : "unverified" };
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
  const [used, members, verified, waiting] = await Promise.all([
    seatsUsed(),
    db.user.findMany({ where: { foundingNo: { not: null } }, orderBy: { foundingNo: "asc" }, take: 500, select: { id: true, name: true, email: true, foundingNo: true, foundingAt: true, foundingPct: true } }),
    db.user.count({ where: { emailVerifiedAt: { not: null } } }),
    db.user.count({ where: { foundingKey: null, emailVerifiedAt: null } }),
  ]);
  return {
    config: cfg,
    counts: { used, left: seatsLeft(cfg, used), verified, waiting },
    members: members.map((m) => ({ id: m.id, name: m.name, email: m.email, no: m.foundingNo!, pct: m.foundingPct ?? cfg.discountPct, at: (m.foundingAt ?? new Date()).toISOString() })),
  };
}
export type FoundingState = Awaited<ReturnType<typeof foundingState>>;

/**
 * Admin: offer the open seats to the earliest members who don't have one. Proven inboxes get their seat at
 * once; the rest get the claim link (at most once every 3 days each), so a seat still needs a real inbox.
 */
export async function backfillFounding() {
  const cfg = await foundingConfig();
  if (!cfg.enabled) throw new HttpError(409, "Turn the founding program on first.", "FOUNDING_OFF");
  let room = seatsLeft(cfg, await seatsUsed());
  if (room <= 0) return { claimed: 0, invited: 0 };
  const users = await db.user.findMany({ where: { foundingKey: null }, orderBy: { createdAt: "asc" }, take: 2000, select: { id: true, email: true, emailVerifiedAt: true, emailVerifiedFor: true } });
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
