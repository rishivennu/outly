import "server-only";
import { randomInt } from "node:crypto";
import { addMonths } from "date-fns";
import { db } from "./db";
import { env } from "./env";
import { HttpError } from "./http";
import { getConfig } from "./settings";
import { sendEmail, templates } from "./email";
import { adminEvent } from "./admin/route";
import { normalizeBeta } from "./beta-config";

export { BETA_DEFAULT, normalizeBeta, type BetaConfig } from "./beta-config";

export const betaConfig = async () => normalizeBeta(await getConfig("beta"));
/** For page copy. A database hiccup (or a build without one) falls back to the default rather than failing the page. */
export const isBeta = async () => {
  try {
    return (await betaConfig()).enabled;
  } catch {
    return normalizeBeta(null).enabled;
  }
};

// No 0/O/1/I/L: codes get read out and typed from a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function makeBetaCode() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `BETA-${part()}-${part()}`;
}
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^BETA/, "").replace(/^(.{4})(.{4})$/, "BETA-$1-$2");

/** Codes already handed to members (revoked ones free their seat). */
export const issuedCount = () => db.betaCode.count({ where: { issuedToId: { not: null }, revokedAt: null } });

async function createCode(data: { planSlug: string; months: number; issuedToId?: string; note?: string }) {
  for (let i = 0; i < 5; i++) {
    try {
      return await db.betaCode.create({ data: { code: makeBetaCode(), ...data } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002" && data.issuedToId && (await db.betaCode.findUnique({ where: { issuedToId: data.issuedToId } }))) return null; // already has one
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new Error("Couldn't make a unique code");
}

/**
 * Called after every signup. Never throws: a hiccup here must not stop someone joining.
 * Two signups in the same instant can both see "one seat left"; that rare extra code is acceptable.
 */
export async function issueBetaCodeOnSignup(userId: string) {
  try {
    const cfg = await betaConfig();
    if (!cfg.enabled || cfg.limit <= 0) return null;
    if ((await issuedCount()) >= cfg.limit) return null;
    const code = await createCode({ planSlug: cfg.planSlug, months: cfg.months, issuedToId: userId, note: "first members" });
    if (!code) return null;
    await sendBetaEmail(code.id).catch((e) => console.error("[beta] email", e));
    return code;
  } catch (e) {
    console.error("[beta] issue failed", e);
    return null;
  }
}

async function sendBetaEmail(codeId: string) {
  const c = await db.betaCode.findUnique({ where: { id: codeId }, include: { issuedTo: { select: { name: true, email: true } } } });
  if (!c?.issuedTo) return;
  const plan = await db.plan.findUnique({ where: { slug: c.planSlug }, select: { name: true } });
  await sendEmail({
    to: c.issuedTo.email,
    kind: "beta",
    subject: `Your ${c.months} free months of ${plan?.name ?? "Creator"}`,
    html: templates.betaCode({ name: c.issuedTo.name.split(" ")[0] || "there", code: c.code, plan: plan?.name ?? "Creator", months: c.months, url: `${env.APP_URL}/billing#beta` }),
  });
}

/** Admin: give codes to the earliest members who don't have one yet, up to the limit. */
export async function backfillBetaCodes() {
  const cfg = await betaConfig();
  if (!cfg.enabled) throw new HttpError(409, "Turn the beta program on first.", "BETA_OFF");
  const room = cfg.limit - (await issuedCount());
  if (room <= 0) return 0;
  const users = await db.user.findMany({ where: { betaIssued: null }, orderBy: { createdAt: "asc" }, take: room, select: { id: true } });
  let n = 0;
  for (const u of users) {
    const c = await createCode({ planSlug: cfg.planSlug, months: cfg.months, issuedToId: u.id, note: "first members (backfill)" });
    if (c) {
      n++;
      await sendBetaEmail(c.id).catch((e) => console.error("[beta] email", e));
    }
  }
  return n;
}

/** Admin: a loose code for one person (a partner, a giveaway). Doesn't use a seat. */
export async function makeManualCode(note: string) {
  const cfg = await betaConfig();
  if (!cfg.enabled) throw new HttpError(409, "Turn the beta program on first.", "BETA_OFF");
  return createCode({ planSlug: cfg.planSlug, months: cfg.months, note: note.slice(0, 120) });
}

/** The code shown on this member's Billing page, if they have an unused one. */
export async function myBetaCode(userId: string) {
  const [mine, used] = await Promise.all([
    db.betaCode.findUnique({ where: { issuedToId: userId } }),
    db.betaCode.findUnique({ where: { redeemedById: userId } }),
  ]);
  return {
    code: mine && !mine.revokedAt && !mine.redeemedAt ? { code: mine.code, months: mine.months, planSlug: mine.planSlug } : null,
    redeemed: used ? { at: used.redeemedAt!.toISOString(), months: used.months, planSlug: used.planSlug } : null,
  };
}

/** Redeem a code: one use per code, one beta grant per account, atomic. */
export async function redeemBetaCode(userId: string, raw: string) {
  const code = normalizeCode(raw);
  const c = await db.betaCode.findUnique({ where: { code } });
  if (!c || c.revokedAt) throw new HttpError(404, "That code isn't valid. Check it against your email, letters and numbers only.", "BAD_CODE");
  if (c.redeemedAt) throw new HttpError(409, c.redeemedById === userId ? "You've already used this code." : "That code has already been used.", "USED");
  if (c.issuedToId && c.issuedToId !== userId) throw new HttpError(403, "That code belongs to another account. Sign in with the account it was emailed to.", "NOT_YOURS");
  if (await db.betaCode.findUnique({ where: { redeemedById: userId }, select: { id: true } })) throw new HttpError(409, "This account has already used a beta code.", "USED");
  const plan = await db.plan.findUnique({ where: { slug: c.planSlug } });
  if (!plan) throw new HttpError(409, "The plan for this code isn't available right now. Contact support and we'll sort it out.", "NO_PLAN");
  const now = new Date();
  const active = await db.subscription.findFirst({ where: { userId, status: "active", currentPeriodEnd: { gt: now }, priceMinor: { gt: 0 } }, select: { id: true } });
  if (active) throw new HttpError(409, "You already have a paid plan. Redeem this code after it ends, or cancel it first.", "HAS_PLAN");

  const until = addMonths(now, c.months);
  const sub = await db.$transaction(async (tx) => {
    // The claim: only one request can flip redeemedAt from null.
    const won = await tx.betaCode.updateMany({ where: { id: c.id, redeemedAt: null, revokedAt: null }, data: { redeemedAt: now, redeemedById: userId } });
    if (won.count !== 1) throw new HttpError(409, "That code has already been used.", "USED");
    // 1052: a free month someone earned (legacy referral gift) keeps running; access picks the best of both.
    await tx.subscription.updateMany({ where: { userId, status: "active", provider: { not: "referral" }, priceMinor: 0, sample: false }, data: { status: "canceled", canceledAt: now } });
    // Nothing to charge and nothing renews: it simply ends, then the account is back on Free.
    return tx.subscription.create({
      data: { userId, planId: plan.id, status: "active", priceMinor: 0, currency: plan.currency, interval: "month", provider: "beta", currentPeriodEnd: until, cancelAtPeriodEnd: true },
    });
  }).catch((err) => {
    // Two different codes at once on one account: redeemedById is unique, so the second loses here.
    if ((err as { code?: string } | null)?.code === "P2002") throw new HttpError(409, "This account has already used a beta code.", "USED");
    throw err;
  });
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  await adminEvent("beta", `${u?.name ?? "A member"} redeemed a beta code`, `${c.months} months of ${plan.name}`, "/admin/beta").catch(() => {});
  return { planName: plan.name, until: sub.currentPeriodEnd.toISOString() };
}

/** Everything the admin Beta page shows. */
export async function betaState() {
  const [cfg, issued, redeemed, manual, recent, plans] = await Promise.all([
    betaConfig(),
    issuedCount(),
    db.betaCode.count({ where: { redeemedAt: { not: null } } }),
    db.betaCode.count({ where: { issuedToId: null, revokedAt: null } }),
    db.betaCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { issuedTo: { select: { email: true, name: true } }, redeemedBy: { select: { email: true } } },
    }),
    db.plan.findMany({ where: { priceMinor: { gt: 0 } }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } }),
  ]);
  return {
    config: cfg,
    counts: { issued, redeemed, manual, left: Math.max(0, cfg.limit - issued) },
    plans,
    codes: recent.map((c) => ({
      id: c.id, code: c.code, planSlug: c.planSlug, months: c.months, note: c.note, createdAt: c.createdAt.toISOString(),
      issuedTo: c.issuedTo ? (c.issuedTo.name ? `${c.issuedTo.name} (${c.issuedTo.email})` : c.issuedTo.email) : null,
      redeemedAt: c.redeemedAt?.toISOString() ?? null, redeemedBy: c.redeemedBy?.email ?? null, revokedAt: c.revokedAt?.toISOString() ?? null,
    })),
  };
}
export type BetaState = Awaited<ReturnType<typeof betaState>>;

/** Admin: cancel an unused code. A revoked member code frees its seat. */
export async function revokeBetaCode(id: string) {
  const r = await db.betaCode.updateMany({ where: { id, redeemedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw new HttpError(409, "That code was already used or revoked.", "USED");
}
