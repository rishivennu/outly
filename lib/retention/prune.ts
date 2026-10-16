import "server-only";
import { db } from "../db";

/**
 * Housekeeping: rows nobody reads any more. Logs and admin noise go after 90 days, per-post metric
 * samples after 180 (the charts only look back 12 weeks), expired sign-in codes after a day.
 * Run from the retention cron; every delete is a plain window on a timestamp, so it is safe to repeat.
 */
const DAY = 864e5;

export async function pruneOldData(now: Date = new Date()) {
  const before = (days: number) => new Date(now.getTime() - days * DAY);
  const [emailLogs, adminEvents, behaviorAnalyses, targetMetrics, otpCodes] = await Promise.all([
    db.emailLog.deleteMany({ where: { createdAt: { lt: before(90) } } }),
    db.adminEvent.deleteMany({ where: { createdAt: { lt: before(90) } } }),
    db.behaviorAnalysis.deleteMany({ where: { createdAt: { lt: before(90) } } }),
    db.targetMetric.deleteMany({ where: { capturedAt: { lt: before(180) } } }),
    db.otpCode.deleteMany({ where: { createdAt: { lt: before(1) } } }),
  ]);
  return {
    emailLogs: emailLogs.count,
    adminEvents: adminEvents.count,
    behaviorAnalyses: behaviorAnalyses.count,
    targetMetrics: targetMetrics.count,
    otpCodes: otpCodes.count,
  };
}
