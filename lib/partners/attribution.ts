import "server-only";
import { randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { PARTNER_REF_COOKIE, codeBase, isPartnerCode, makePartnerCode, parsePartnerCookie } from "./attribution-core";

const isClash = (e: unknown) => (e as { code?: string } | null)?.code === "P2002";

/** Statuses whose link still counts visits. A completed or withdrawn partnership stops collecting. */
const TRACKING = ["offer_accepted", "active"];

export const partnerLink = (code: string) => `${env.APP_URL.replace(/\/$/, "")}/?ref=${code}`;

/**
 * The creator's referral code: a slug of the brand name (or handle) plus two digits, unique across partner codes AND
 * Refer & Earn user codes, so one ?ref= value never means two people. Made once, then stable.
 */
export async function ensurePartnerCode(app: string | { id: string }) {
  const id = typeof app === "string" ? app : app.id;
  const row = await db.partnerApplication.findUnique({ where: { id }, select: { id: true, partnerCode: true, brandName: true, primaryHandle: true, fullName: true } });
  if (!row) throw new HttpError(404, "That application no longer exists.", "NOT_FOUND");
  if (row.partnerCode) return row.partnerCode;
  const base = codeBase(row.brandName, row.primaryHandle, row.fullName);
  for (let i = 0; i < 24; i++) {
    const code = makePartnerCode(base, (n) => randomInt(n), i < 12 ? 2 : 4);
    const [partner, user] = await Promise.all([
      db.partnerApplication.findUnique({ where: { partnerCode: code }, select: { id: true } }),
      db.user.findUnique({ where: { referralCode: code }, select: { id: true } }),
    ]);
    if (partner || user) continue;
    try {
      const r = await db.partnerApplication.updateMany({ where: { id, partnerCode: null }, data: { partnerCode: code } });
      if (r.count) return code;
      const now = await db.partnerApplication.findUniqueOrThrow({ where: { id }, select: { partnerCode: true } });
      if (now.partnerCode) return now.partnerCode; // a racing call made it first
    } catch (e) {
      if (!isClash(e)) throw e;
    }
  }
  throw new HttpError(503, "Couldn't make a unique code. Try again.", "CODE_BUSY");
}

// A ?ref= value is looked up on every partner-link visit; a short memo spares the DB a burst from one post going viral.
const memo = new Map<string, { id: string | null; at: number }>();
const MEMO_MS = 60_000;

export async function partnerByCode(code: string) {
  if (!isPartnerCode(code)) return null;
  const hit = memo.get(code);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.id;
  const row = await db.partnerApplication.findUnique({ where: { partnerCode: code }, select: { id: true, status: true } });
  const id = row && TRACKING.includes(row.status) ? row.id : null;
  if (memo.size > 2000) memo.clear();
  memo.set(code, { id, at: Date.now() });
  return id;
}

/** One visit row per code and visitor (the unique index), however often the link is opened. */
export async function recordVisit(code: string, visitorKey: string, landing = "", source = "") {
  const applicationId = await partnerByCode(code);
  if (!applicationId || !visitorKey) return null;
  const data = { applicationId, kind: "visit", visitorKey: visitorKey.slice(0, 64), landing: landing.slice(0, 200), source: source.slice(0, 80) };
  // Checked first so a repeat visit doesn't log a Prisma unique error; the catch still covers the race.
  const seen = await db.partnerAttribution.findUnique({ where: { applicationId_kind_visitorKey: { applicationId, kind: "visit", visitorKey: data.visitorKey } }, select: { id: true } });
  if (seen) return { applicationId, created: false };
  try {
    await db.partnerAttribution.create({ data });
    return { applicationId, created: true };
  } catch (e) {
    if (!isClash(e)) throw e;
    return { applicationId, created: false };
  }
}

/**
 * A new account signed up with the ol_pref cookie. Counts only when that exact visitor's visit row exists, so a
 * hand-made cookie can't claim a signup. One signup per account. Never throws.
 */
export async function recordSignup(userId: string, cookieValue: string | null | undefined) {
  try {
    const c = parsePartnerCookie(cookieValue);
    if (!c) return null;
    const app = await db.partnerApplication.findUnique({ where: { partnerCode: c.code }, select: { id: true } });
    if (!app) return null;
    const visit = await db.partnerAttribution.findUnique({ where: { applicationId_kind_visitorKey: { applicationId: app.id, kind: "visit", visitorKey: c.visitorKey } }, select: { id: true } });
    if (!visit) return null;
    if (await db.partnerAttribution.findFirst({ where: { userId, kind: "signup" }, select: { id: true } })) return null;
    return await db.partnerAttribution.create({ data: { applicationId: app.id, kind: "signup", visitorKey: c.visitorKey, userId } });
  } catch (e) {
    if (!isClash(e)) console.error("[partners] signup attribution", e);
    return null;
  }
}

/** Signup hook (lib/referral.ts attachReferral): reads and clears the cookie, then records. Never throws. */
export async function attachPartnerSignup(userId: string) {
  try {
    const jar = await cookies();
    const raw = jar.get(PARTNER_REF_COOKIE)?.value;
    if (!raw) return null;
    jar.delete(PARTNER_REF_COOKIE);
    return await recordSignup(userId, raw);
  } catch (e) {
    console.error("[partners] signup hook", e);
    return null;
  }
}

/**
 * A payment succeeded (lib/billing/service.ts). Counts once per account, only for an account whose signup came
 * through a partner link, and only for a real, non-sample payment of that account. Never throws.
 */
export async function recordPaid(userId: string, paymentId: string) {
  try {
    const signup = await db.partnerAttribution.findFirst({ where: { userId, kind: "signup" }, select: { applicationId: true, visitorKey: true } });
    if (!signup) return null;
    if (await db.partnerAttribution.findFirst({ where: { userId, kind: "paid" }, select: { id: true } })) return null;
    const p = await db.payment.findUnique({ where: { id: paymentId }, select: { userId: true, status: true, sample: true, amountMinor: true } });
    if (!p || p.userId !== userId || p.status !== "succeeded" || p.sample || p.amountMinor <= 0) return null;
    return await db.partnerAttribution.create({ data: { applicationId: signup.applicationId, kind: "paid", visitorKey: signup.visitorKey, userId, paymentId } });
  } catch (e) {
    if (!isClash(e)) console.error("[partners] paid attribution", e);
    return null;
  }
}

export async function attributionSummary(applicationId: string) {
  const groups = await db.partnerAttribution.groupBy({ by: ["kind"], where: { applicationId }, _count: { _all: true } });
  const n = (k: string) => groups.find((g) => g.kind === k)?._count._all ?? 0;
  return { visits: n("visit"), signups: n("signup"), paid: n("paid") };
}
