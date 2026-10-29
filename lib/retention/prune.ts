import "server-only";
import { db } from "../db";
import { storage } from "../storage";
import { DRAFT_TTL_DAYS } from "../domain";

/**
 * Housekeeping: rows nobody reads any more. Logs and admin noise go after 90 days, per-post metric
 * samples after 180 (the charts only look back 12 weeks), expired sign-in codes after a day.
 * Drafts nobody has touched for DRAFT_TTL_DAYS go too, with their video when no other post uses it
 * (the browser keeps its own copy, see lib/client/device-drafts.ts).
 * Run from the retention cron; every delete is a plain window on a timestamp, so it is safe to repeat.
 */
const DAY = 864e5;
export { DRAFT_TTL_DAYS };

/**
 * Invoices of deleted accounts are kept this long after they were issued, then deleted. Indian GST law
 * (CGST Act s.36) needs records for 72 months after the annual return's due date, which falls up to
 * about 21 months after an invoice, so 8 years from issue covers every case. Invoices of live
 * accounts are not touched: the owner can still see them in Billing.
 */
export const INVOICE_KEEP_YEARS = 8;

export async function pruneDetachedInvoices(now: Date = new Date()) {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - INVOICE_KEEP_YEARS);
  const { count } = await db.invoice.deleteMany({ where: { userId: null, issuedAt: { lt: cutoff } } });
  return count;
}

/**
 * Untouched drafts: status draft, not saved for DRAFT_TTL_DAYS, not booked for a future time and not
 * waiting on a reviewer. The delete repeats the conditions, so a draft saved meanwhile survives.
 */
export async function pruneStaleDrafts(now: Date = new Date(), batch = 500) {
  const cutoff = new Date(now.getTime() - DRAFT_TTL_DAYS * DAY);
  const where = {
    status: "draft",
    updatedAt: { lt: cutoff },
    OR: [{ scheduledAt: null }, { scheduledAt: { lt: now } }],
    reviews: { none: { status: "pending", expiresAt: { gt: now } } },
  };
  const stale = await db.post.findMany({ where, select: { id: true, mediaId: true }, take: batch });
  if (!stale.length) return { drafts: 0, media: 0 };
  const { count } = await db.post.deleteMany({ where: { ...where, id: { in: stale.map((p) => p.id) } } });
  const orphans = await db.media.findMany({
    where: { id: { in: Array.from(new Set(stale.map((p) => p.mediaId))) }, posts: { none: {} } },
    select: { id: true, storageKey: true, thumbnailKey: true },
  });
  if (!orphans.length) return { drafts: count, media: 0 };
  await db.media.deleteMany({ where: { id: { in: orphans.map((m) => m.id) }, posts: { none: {} } } });
  // Only files whose row is really gone: one picked up by a new post in the meantime stays.
  const kept = new Set((await db.media.findMany({ where: { id: { in: orphans.map((m) => m.id) } }, select: { id: true } })).map((m) => m.id));
  const removed = orphans.filter((m) => !kept.has(m.id));
  for (const m of removed)
    for (const key of [m.storageKey, m.thumbnailKey])
      if (key) await storage.remove(key).catch((e) => console.error("[prune:drafts] storage", key, e));
  return { drafts: count, media: removed.length };
}

/** Direct messages (1031) are kept for this long after they were sent; a conversation quiet for longer goes with them. */
export const DM_KEEP_DAYS = 180;

export async function pruneOldData(now: Date = new Date()) {
  const before = (days: number) => new Date(now.getTime() - days * DAY);
  const [emailLogs, adminEvents, behaviorAnalyses, targetMetrics, otpCodes, invoices, dmMessages, dmThreads, pipAccess] = await Promise.all([
    db.emailLog.deleteMany({ where: { createdAt: { lt: before(90) } } }),
    db.adminEvent.deleteMany({ where: { createdAt: { lt: before(90) } } }),
    db.behaviorAnalysis.deleteMany({ where: { createdAt: { lt: before(90) } } }),
    db.targetMetric.deleteMany({ where: { capturedAt: { lt: before(180) } } }),
    db.otpCode.deleteMany({ where: { createdAt: { lt: before(1) } } }),
    pruneDetachedInvoices(now),
    db.dmMessage.deleteMany({ where: { sentAt: { lt: before(DM_KEEP_DAYS) } } }),
    db.dmThread.deleteMany({ where: { lastMessageAt: { lt: before(DM_KEEP_DAYS) } } }),
    // Pip's access log (1049): a year is enough to answer "who looked at my invoices?"
    db.pipAccessLog.deleteMany({ where: { createdAt: { lt: before(365) } } }),
  ]);
  // Batches of 500, a few per run, so a backlog drains without one huge delete.
  const drafts = { drafts: 0, media: 0 };
  for (let i = 0; i < 10; i++) {
    const r = await pruneStaleDrafts(now);
    drafts.drafts += r.drafts;
    drafts.media += r.media;
    if (r.drafts < 500) break;
  }
  return {
    drafts: drafts.drafts,
    draftMedia: drafts.media,
    emailLogs: emailLogs.count,
    adminEvents: adminEvents.count,
    behaviorAnalyses: behaviorAnalyses.count,
    targetMetrics: targetMetrics.count,
    otpCodes: otpCodes.count,
    detachedInvoices: invoices,
    dmMessages: dmMessages.count,
    dmThreads: dmThreads.count,
    pipAccess: pipAccess.count,
  };
}
