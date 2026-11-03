import "server-only";
import { db } from "../db";
import type { TopUpKind } from "./topups-core";

/**
 * Top-up balances (1096). Packs are spent oldest-expiring first, one unit per use, with a conditional
 * decrement so two requests racing for the last unit can't both get it.
 */
const live = (userId: string, kind: TopUpKind, now: Date) => ({ userId, kind, status: "active", expiresAt: { gt: now } });

export async function creditsLeft(userId: string, kind: TopUpKind, now = new Date()) {
  const r = await db.topUp.aggregate({ where: { ...live(userId, kind, now), remaining: { gt: 0 } }, _sum: { remaining: true } });
  return r._sum.remaining ?? 0;
}

/** Takes one unit from the oldest-expiring pack. Returns the pack id, or null when there's nothing left. */
export async function consumeCredit(userId: string, kind: TopUpKind, now = new Date()): Promise<string | null> {
  const packs = await db.topUp.findMany({ where: { ...live(userId, kind, now), remaining: { gt: 0 } }, orderBy: { expiresAt: "asc" }, select: { id: true } });
  for (const p of packs) {
    const took = await db.topUp.updateMany({ where: { id: p.id, remaining: { gt: 0 } }, data: { remaining: { decrement: 1 } } });
    if (took.count === 1) return p.id;
  }
  return null;
}

/** Gives one unit back (a failed run). Never above what the pack held, never to a refunded pack. */
export async function refundCredit(topUpId: string) {
  const t = await db.topUp.findUnique({ where: { id: topUpId }, select: { units: true, status: true } });
  if (!t || t.status !== "active") return;
  await db.topUp.updateMany({ where: { id: topUpId, remaining: { lt: t.units } }, data: { remaining: { increment: 1 } } });
}

/** Extra brands and seats from packs live right now. */
export async function activeExtras(userId: string, now = new Date()) {
  const rows = await db.topUp.groupBy({ by: ["kind"], where: { userId, status: "active", expiresAt: { gt: now }, kind: { in: ["brand", "seat"] } }, _sum: { units: true } });
  const of = (k: string) => rows.find((r) => r.kind === k)?._sum.units ?? 0;
  return { brands: of("brand"), seats: of("seat") };
}

/** Every pack this person holds, newest first, for the billing page. */
export const topUpsFor = (userId: string) => db.topUp.findMany({ where: { userId, status: "active" }, orderBy: { createdAt: "desc" }, take: 20 });

/** A refunded pack stops counting at once (what's left is gone; what was used stays used). */
export async function refundTopUp(paymentId: string) {
  await db.topUp.updateMany({ where: { paymentId, status: "active" }, data: { status: "refunded", remaining: 0 } });
}
