import "server-only";
import { db } from "../db";
import { whatsappAvailable } from "../whatsapp";
import { raiseTicket } from "../support/tickets";
import { HttpError } from "../http";
import { getPolicy, type RiskWeights } from "./policy";
import { hashKey } from "./keys";

/*
 * 1147: repeat-trial and repeat-offer scoring. Never decides on an IP alone (capped well under any threshold).
 * Every decision is written as a RiskFlag so an admin can review it; an appeal opens a support ticket.
 */

export type RiskLevel = "low" | "medium" | "high";
export type RiskAction = "none" | "verify" | "deny_offer";
export type RiskContext = "trial" | "checkout" | "signup";
export interface RiskReason {
  code: string;
  weight: number;
  detail: string;
}
export interface RiskResult {
  score: number;
  level: RiskLevel;
  action: RiskAction;
  reasons: RiskReason[];
  relatedUserIds: string[];
  flagId: string | null;
  status: "open" | "verified" | "cleared" | "confirmed";
}

/** Identity keys that prove the same person; verifying a phone does not outweigh one of these. */
const IDENTITY = new Set(["email_match", "payment_match"]);
const DAY = 864e5;

/** Pure: total, level and action. IP-only evidence is capped so it can never tip a decision by itself. */
export function scoreRisk(reasons: RiskReason[], w: Pick<RiskWeights, "ipCap" | "high" | "medium">) {
  const ip = reasons.filter((r) => r.code === "same_ip").reduce((s, r) => s + r.weight, 0);
  const rest = reasons.filter((r) => r.code !== "same_ip").reduce((s, r) => s + r.weight, 0);
  const score = Math.max(0, rest + Math.min(ip, w.ipCap));
  const level: RiskLevel = score >= w.high ? "high" : score >= w.medium ? "medium" : "low";
  const action: RiskAction = level === "high" ? "deny_offer" : level === "medium" ? "verify" : "none";
  return { score, level, action };
}

/** Of these accounts, the ones that already had the trial or a first-time price. */
async function usedOffer(ids: string[]) {
  if (!ids.length) return new Set<string>();
  const [trials, ledger] = await Promise.all([
    db.trial.findMany({ where: { userId: { in: ids } }, select: { userId: true } }),
    db.offerLedger.findMany({ where: { userId: { in: ids }, OR: [{ trialUsedAt: { not: null } }, { firstPaidAt: { not: null } }] }, select: { userId: true } }),
  ]);
  return new Set([...trials.map((t) => t.userId), ...ledger.map((l) => l.userId!).filter(Boolean)]);
}

const usedRow = { OR: [{ trialUsedAt: { not: null } }, { firstPaidAt: { not: null } }] };
/** A ledger row that already had the offer and belongs to someone else (or to a deleted account). */
const byOther = (userId: string) => ({ AND: [usedRow, { OR: [{ userId: null }, { userId: { not: userId } }] }] });

/** Is this person verified enough to pass a medium score: a WhatsApp-proven phone, or a proven inbox when WhatsApp is off. */
async function isVerified(u: { phoneVerifiedAt: Date | null; emailVerifiedAt: Date | null; emailVerifiedFor: string | null; email: string }) {
  if (u.phoneVerifiedAt) return true;
  if (await whatsappAvailable().catch(() => false)) return false;
  return !!u.emailVerifiedAt && (u.emailVerifiedFor ?? "").toLowerCase() === u.email.toLowerCase();
}

/**
 * Scores this account against everyone who already used the trial or a first-time price. Reads the latest
 * signal the account left (captureSignal runs first), plus the raw device id and payment key when the caller has them.
 */
export async function assessRisk(o: { userId: string; context: RiskContext; deviceId?: string | null; paymentKey?: string | null; now?: Date }): Promise<RiskResult> {
  const now = o.now ?? new Date();
  const policy = await getPolicy();
  const w = policy.risk;
  const u = await db.user.findUniqueOrThrow({ where: { id: o.userId }, select: { id: true, email: true, phone: true, phoneVerifiedAt: true, emailVerifiedAt: true, emailVerifiedFor: true, createdAt: true, lastActiveAt: true } });
  const sig = await db.signupSignal.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" } });
  const reasons: RiskReason[] = [];
  const related = new Set<string>();
  const others = (ids: (string | null)[]) => ids.filter((id): id is string => !!id && id !== u.id);

  // Device: another account on this device already used an offer (signals), or a deleted one did (ledger).
  let deviceHit = false;
  if (sig?.deviceHash) {
    const same = others((await db.signupSignal.findMany({ where: { deviceHash: sig.deviceHash, userId: { not: u.id } }, select: { userId: true }, distinct: ["userId"], take: 50 })).map((s) => s.userId));
    const used = await usedOffer(same);
    used.forEach((id) => related.add(id));
    deviceHit = used.size > 0;
  }
  if (!deviceHit && o.deviceId) {
    const row = await db.offerLedger.findFirst({ where: { kind: "device", keyHash: hashKey("device", o.deviceId), ...byOther(u.id) }, select: { userId: true } });
    if (row) {
      deviceHit = true;
      if (row.userId) related.add(row.userId);
    }
  }
  if (deviceHit) reasons.push({ code: "device_match", weight: w.device, detail: "This device was used by an account that already had the offer" });

  // Payment method seen on an account that already had the offer.
  if (o.paymentKey) {
    const row = await db.offerLedger.findFirst({ where: { kind: "payment", keyHash: hashKey("payment", o.paymentKey), ...byOther(u.id) }, select: { userId: true } });
    if (row) {
      reasons.push({ code: "payment_match", weight: w.payment, detail: "This payment method was used for a first-time offer before" });
      if (row.userId) related.add(row.userId);
    }
  }

  // Same inbox (Gmail dots and +tags folded) on a ledger key that already had the offer.
  const email = await db.offerLedger.findFirst({ where: { kind: "email", keyHash: hashKey("email", u.email), ...byOther(u.id) }, select: { userId: true } });
  if (email) {
    reasons.push({ code: "email_match", weight: w.email, detail: "The same inbox already had the offer" });
    if (email.userId) related.add(email.userId);
  }

  if (sig) {
    // Same network AND same browser family as an account that used the offer in the last 30 days.
    const near = others((await db.signupSignal.findMany({ where: { netHash: sig.netHash, uaHash: sig.uaHash, userId: { not: u.id }, createdAt: { gte: new Date(now.getTime() - 30 * DAY) } }, select: { userId: true }, distinct: ["userId"], take: 50 })).map((s) => s.userId));
    const nearUsed = await usedOffer(near);
    if (nearUsed.size) {
      nearUsed.forEach((id) => related.add(id));
      reasons.push({ code: "network_browser", weight: w.netUa, detail: "Same network and browser as an account that had the offer this month" });
    }
    // A burst of signups from one network in a day.
    const burst = (await db.signupSignal.findMany({ where: { netHash: sig.netHash, event: "signup", createdAt: { gte: new Date(now.getTime() - DAY) } }, select: { userId: true }, distinct: ["userId"], take: 20 })).length;
    if (burst >= 3) reasons.push({ code: "signup_burst", weight: w.burst, detail: `${burst} signups from this network in 24 hours` });
    // Same full IP as an account that had the offer: weak, capped by scoreRisk.
    const sameIp = await usedOffer(others((await db.signupSignal.findMany({ where: { ipHash: sig.ipHash, userId: { not: u.id } }, select: { userId: true }, distinct: ["userId"], take: 50 })).map((s) => s.userId)));
    if (sameIp.size) reasons.push({ code: "same_ip", weight: w.ip, detail: "Same IP address as an account that had the offer" });
  }

  // Credits.
  if (u.phone && u.phoneVerifiedAt) {
    const seen = await db.offerLedger.findFirst({ where: { kind: "phone", keyHash: hashKey("phone", u.phone), OR: [{ userId: null }, { userId: { not: u.id } }] }, select: { id: true } });
    if (!seen) reasons.push({ code: "phone_new", weight: w.phoneNew, detail: "Verified WhatsApp number not seen before" });
  }
  if (now.getTime() - u.createdAt.getTime() > 60 * DAY && u.lastActiveAt) reasons.push({ code: "tenure", weight: w.tenure, detail: "Account older than 60 days with activity" });

  let { score, level, action } = scoreRisk(reasons, w);
  let status: RiskResult["status"] = "open";
  // An admin decision on this account stands until new strong evidence: cleared means trusted, confirmed means denied.
  const reviewed = await db.riskFlag.findFirst({ where: { userId: u.id, status: { in: ["cleared", "confirmed"] } }, orderBy: { reviewedAt: "desc" }, select: { status: true } });
  const identity = reasons.some((r) => IDENTITY.has(r.code));
  if (reviewed?.status === "confirmed") {
    action = "deny_offer";
    status = "confirmed";
  } else if (reviewed?.status === "cleared" && !identity) {
    action = "none";
    status = "cleared";
  } else if (action === "verify" && !identity && (await isVerified(u))) {
    status = "verified";
  }

  // One row per decision; an identical repeat within a day reuses the last row so retries don't flood the queue.
  const last = await db.riskFlag.findFirst({ where: { userId: u.id, context: o.context, createdAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: "desc" } });
  const reasonsJson = JSON.stringify(reasons);
  const relatedJson = JSON.stringify([...related].slice(0, 20));
  let flagId: string;
  if (last && last.score === score && last.action === action && last.reasons === reasonsJson && (last.status === status || last.status === "open")) {
    if (last.status !== status) await db.riskFlag.update({ where: { id: last.id }, data: { status } });
    flagId = last.id;
  } else {
    flagId = (await db.riskFlag.create({ data: { userId: u.id, score, level, action, reasons: reasonsJson, relatedUserIds: relatedJson, status, context: o.context, createdAt: now } })).id;
  }
  return { score, level, action: status === "verified" || status === "cleared" ? "none" : action, reasons, relatedUserIds: [...related], flagId, status };
}

/** Admin: this person is genuine. Restores trial and first-time eligibility the risk check took away. */
export async function clearFlag(flagId: string, adminLogin: string, note?: string) {
  return db.riskFlag.update({ where: { id: flagId }, data: { status: "cleared", reviewedBy: adminLogin.slice(0, 120), reviewedAt: new Date(), note: note?.slice(0, 1000) ?? null } });
}

/** Admin: the flag was right. The account stays on standard pricing with no trial. */
export async function confirmFlag(flagId: string, adminLogin: string, note?: string) {
  return db.riskFlag.update({ where: { id: flagId }, data: { status: "confirmed", action: "deny_offer", reviewedBy: adminLogin.slice(0, 120), reviewedAt: new Date(), note: note?.slice(0, 1000) ?? null } });
}

/** The "Ask for a review" form: a support ticket linked to the flag (the latest open one when none is named). */
export async function appeal(o: { userId: string; flagId?: string | null; message: string }) {
  const flag = o.flagId
    ? await db.riskFlag.findFirst({ where: { id: o.flagId, userId: o.userId } })
    : await db.riskFlag.findFirst({ where: { userId: o.userId, action: { in: ["verify", "deny_offer"] }, status: { in: ["open", "confirmed"] } }, orderBy: { createdAt: "desc" } });
  if (!flag) throw new HttpError(404, "There's nothing to review on this account right now.", "NO_FLAG");
  if (flag.ticketId) {
    const open = await db.ticket.findFirst({ where: { id: flag.ticketId, status: { not: "resolved" } }, select: { id: true } });
    if (open) return { ticketId: open.id, duplicate: true };
  }
  const u = await db.user.findUniqueOrThrow({ where: { id: o.userId }, select: { email: true, name: true } });
  const text = o.message.trim().slice(0, 1500);
  const { ticket, duplicate } = await raiseTicket({
    email: u.email,
    name: u.name,
    userId: o.userId,
    reason: "form",
    transcript: [{ role: "user", text: `Offer review request (${flag.context}): ${text || "Please review my account."}` }],
  });
  await db.riskFlag.update({ where: { id: flag.id }, data: { ticketId: ticket.id } });
  return { ticketId: ticket.id, duplicate };
}
