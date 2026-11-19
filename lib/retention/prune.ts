import "server-only";
import { pruneDeletions } from "../account-cleanup";
import { db } from "../db";
import { DRAFT_TTL_DAYS } from "../domain";
import { purgeTrash, trashOrphanMedia } from "../storage/lifecycle";
import { MAX_ANALYTICS_DAYS } from "../billing/plan-rules";
import { PIP_CHAT_KEEP_DAYS } from "../support/conversations";
import { RUN_CHUNK_FEATURE, RUN_FEATURE, RUN_TTL_MS } from "../ai/transcribe";

/**
 * Housekeeping: rows nobody reads any more. Logs and admin noise go after 90 days, per-post metric
 * samples after MAX_ANALYTICS_DAYS (2 years, the longest plan history, 1096), expired sign-in codes after a day.
 * R1209: saved drafts are kept. Uploads no post or draft uses move to Trash after DRAFT_TTL_DAYS, and Trash is
 * deleted for good after TRASH_DAYS (lib/storage/lifecycle.ts), bucket first.
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

/** Direct messages (1031) are kept for this long after they were sent; a conversation quiet for longer goes with them. */
export const DM_KEEP_DAYS = 180;

export async function pruneOldData(now: Date = new Date()) {
  const before = (days: number) => new Date(now.getTime() - days * DAY);
  const [emailLogs, adminEvents, behaviorAnalyses, targetMetrics, otpCodes, invoices, dmMessages, dmThreads, pipAccess, pipChats, captionRuns] = await Promise.all([
    db.emailLog.deleteMany({ where: { createdAt: { lt: before(90) } } }),
    db.adminEvent.deleteMany({ where: { createdAt: { lt: before(90) } } }),
    db.behaviorAnalysis.deleteMany({ where: { createdAt: { lt: before(90) } } }),
    // 1096: plans can read up to 2 years of analytics, so samples stay that long (was 180 days).
    db.targetMetric.deleteMany({ where: { capturedAt: { lt: before(MAX_ANALYTICS_DAYS) } } }),
    db.otpCode.deleteMany({ where: { createdAt: { lt: before(1) } } }),
    pruneDetachedInvoices(now),
    db.dmMessage.deleteMany({ where: { sentAt: { lt: before(DM_KEEP_DAYS) } } }),
    db.dmThread.deleteMany({ where: { lastMessageAt: { lt: before(DM_KEEP_DAYS) } } }),
    // Pip's access log (1049): a year is enough to answer "who looked at my invoices?"
    db.pipAccessLog.deleteMany({ where: { createdAt: { lt: before(365) } } }),
    // Pip conversations (1126): 90 days after the last message; their messages go with them (cascade).
    // R1184: never one that had a Live Assist chat. Support chats are kept on record, never deleted.
    db.pipConversation.deleteMany({ where: { updatedAt: { lt: before(PIP_CHAT_KEEP_DAYS) }, sessions: { none: {} } } }),
    // Phase 3: transcription run claims and their chunk hashes only matter while the run can still be reused.
    db.featureUse.deleteMany({ where: { feature: { in: [RUN_FEATURE, RUN_CHUNK_FEATURE] }, period: "run", createdAt: { lt: new Date(now.getTime() - RUN_TTL_MS) } } }),
  ]);
  // Deletion status records (1053): kept 30 days after the files are gone, for the person's status link.
  const deletions = await pruneDeletions(now).catch(() => 0);
  // R1209: orphan uploads to Trash, then Trash past its 30 days deleted for good. Never fatal for the rest.
  const trashed = await trashOrphanMedia(now).catch((e) => (console.error("[prune] trash", e), 0));
  const trash = await purgeTrash(now).catch((e) => (console.error("[prune] purge", e), { purged: 0, restored: 0, queued: 0 }));
  return {
    trashed,
    trashPurged: trash.purged,
    trashQueued: trash.queued,
    emailLogs: emailLogs.count,
    adminEvents: adminEvents.count,
    behaviorAnalyses: behaviorAnalyses.count,
    targetMetrics: targetMetrics.count,
    otpCodes: otpCodes.count,
    detachedInvoices: invoices,
    dmMessages: dmMessages.count,
    dmThreads: dmThreads.count,
    pipAccess: pipAccess.count,
    pipChats: pipChats.count,
    captionRuns: captionRuns.count,
    deletions,
  };
}
