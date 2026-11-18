import "server-only";
import { db } from "../db";
import { env } from "../env";
import { runCheck, type CheckCtx } from "./checks";
import { watchdogConfig } from "./config";
import { isDue, RECOVERY_OK_STREAK, RETENTION_DAYS, reminderDue, severityFor, shouldEscalate, type CheckResult, type Severity } from "./core";
import { MONITORED, serviceById, type MonitoredService } from "./registry";
import { notifyIncident } from "./alerts";

/*
 * R1195 Watchdog engine. Cron-driven: the minute sweep (/api/cron/sweep) calls runHealthCycle with what is left
 * of its budget, and /api/cron/health (a second, independent pinger) does the same when the sweep has gone quiet.
 * There is no always-on process on Vercel Hobby, so "continuous" here means every minute, and the heartbeat
 * written at the end of each cycle is how the independent route (and the Watchdog's own probe) knows it ran.
 *
 * Per service: run the probe when due, keep the result (HealthCheck), then move the incident state machine:
 * warning / critical open or extend ONE incident per service (repeats grouped), passing checks build an
 * okStreak and after RECOVERY_OK_STREAK the incident resolves itself and admins hear exactly once. Warnings that
 * persist or repeat escalate to critical. Unresolved criticals get a reminder. Admin actions (acknowledge,
 * investigate, assign) never change this: a resolve by hand is the only other way out.
 */

export const LAST_CYCLE_KEY = "health:last-cycle";
export const HEARTBEAT_KEY = "health:last-heartbeat";
export type CycleRecord = { at: number; ms: number; ran: number; threw: number; source: string };

export type CycleSummary = {
  skipped?: "disabled" | "locked";
  ran: string[];
  deferred: string[];
  threw: number;
  opened: string[];
  updated: string[];
  resolved: string[];
  escalated: string[];
  ms: number;
};

export type CycleOpts = {
  origin: string;
  now?: Date;
  /** Wall-clock budget for the whole cycle. Services that do not fit stay due and run next minute. */
  budgetMs?: number;
  fetch?: typeof fetch;
  /** Only these services (the "Run now" button, tests). */
  only?: string[];
  /** Ignore intervals. */
  force?: boolean;
  source?: "sweep" | "heartbeat" | "manual" | "test";
  /** Tests: skip the alert fan-out. */
  quiet?: boolean;
};

export async function lastCycle(): Promise<CycleRecord | null> {
  const row = await db.setting.findUnique({ where: { key: LAST_CYCLE_KEY } }).catch(() => null);
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as CycleRecord;
    return typeof v.at === "number" ? v : null;
  } catch {
    return null;
  }
}

async function recordCycle(rec: CycleRecord) {
  const value = JSON.stringify(rec);
  await db.setting.upsert({ where: { key: LAST_CYCLE_KEY }, create: { key: LAST_CYCLE_KEY, value }, update: { value } }).catch((e) => console.error("[watchdog] heartbeat", e));
}

/** Latest check time per service, one query. */
async function lastCheckedAt(): Promise<Map<string, number>> {
  const rows = await db.healthCheck.groupBy({ by: ["service"], _max: { checkedAt: true } });
  const m = new Map<string, number>();
  for (const r of rows) if (r._max.checkedAt) m.set(r.service, r._max.checkedAt.getTime());
  return m;
}

const CONCURRENCY = 6;
const PROBE_DEADLINE_MS = 9_000;

export async function runHealthCycle(opts: CycleOpts): Promise<CycleSummary> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const budget = opts.budgetMs ?? 25_000;
  const sum: CycleSummary = { ran: [], deferred: [], threw: 0, opened: [], updated: [], resolved: [], escalated: [], ms: 0 };
  const cfg = await watchdogConfig();
  if (!cfg.enabled && !opts.only) return { ...sum, skipped: "disabled" };

  const last = await lastCheckedAt();
  const pool = (opts.only ? MONITORED.filter((s) => opts.only!.includes(s.id)) : MONITORED)
    .filter((s) => opts.force || opts.only || isDue(s, last.get(s.id) ?? null, now.getTime(), cfg.intervals[s.id] ?? s.intervalSec))
    .sort((a, b) => rank(a) - rank(b));

  const ctxBase: Omit<CheckCtx, "arg"> = { now, origin: opts.origin, fetch: opts.fetch ?? fetch, deadlineMs: PROBE_DEADLINE_MS };
  let i = 0;
  const worker = async () => {
    while (i < pool.length) {
      // Not enough budget for another probe: leave the rest for the next minute (they stay due).
      if (Date.now() - started > budget - PROBE_DEADLINE_MS / 3) return;
      const svc = pool[i++];
      const r = await runCheck(svc.check, { ...ctxBase, arg: svc.arg });
      if (r.threw) sum.threw++;
      sum.ran.push(svc.id);
      await settle(svc, r, now, sum, cfg.muted.includes(svc.id) || !!opts.quiet).catch((e) => console.error("[watchdog] settle", svc.id, e));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pool.length) }, worker));
  sum.deferred = pool.slice(i).map((s) => s.id);
  sum.ms = Date.now() - started;
  // Heartbeat after the work: a cycle that throws every minute still trips the independent monitor.
  if (!opts.only) await recordCycle({ at: now.getTime(), ms: sum.ms, ran: sum.ran.length, threw: sum.threw, source: opts.source ?? "sweep" });
  if (!opts.only && now.getMinutes() === 11) await prune(now).catch(() => null);
  return sum;
}

const rank = (s: MonitoredService) => (s.criticality === "critical" ? 0 : s.criticality === "high" ? 1 : 2);

const openWhere = (service: string) => ({ service, status: { not: "resolved" } });

/** Records the check and moves the service's incident, if any. */
async function settle(svc: MonitoredService, r: CheckResult, now: Date, sum: CycleSummary, mute: boolean) {
  await db.healthCheck.create({ data: { service: svc.id, status: r.level, latencyMs: r.latencyMs ?? null, detail: r.detail.slice(0, 300), metrics: JSON.stringify(r.metrics ?? {}), checkedAt: now } });
  const open = await db.healthIncident.findFirst({ where: openWhere(svc.id), orderBy: { firstDetectedAt: "desc" } });

  if (r.level === "ok") {
    if (!open) return;
    const streak = open.okStreak + 1;
    if (streak < RECOVERY_OK_STREAK) {
      await db.healthIncident.update({ where: { id: open.id }, data: { okStreak: streak } });
      return;
    }
    // Verified recovery: RECOVERY_OK_STREAK passing checks in a row.
    const res = await db.healthIncident.updateMany({ where: { id: open.id, status: { not: "resolved" } }, data: { status: "resolved", resolvedAt: now, resolvedBy: "watchdog", okStreak: streak } });
    if (!res.count) return;
    await note(open.id, "system", `Recovered: ${streak} passing checks in a row (${r.detail})`);
    sum.resolved.push(svc.id);
    if (!mute) await notifyIncident("recovery", { ...open, resolvedAt: now }, now);
    return;
  }

  if (r.level === "unknown") return; // the probe could not run; that is the Watchdog's own problem, not the service's

  const severity = severityFor(r.level, svc);
  if (!severity) return;
  if (!open) {
    const inc = await db.healthIncident.create({
      data: {
        service: svc.id,
        severity,
        title: titleFor(svc, severity),
        description: r.detail.slice(0, 500),
        errorDetail: r.detail.slice(0, 500),
        likelyCause: r.cause ?? "",
        affectedCount: r.affected ?? 0,
        firstDetectedAt: now,
        lastObservedAt: now,
      },
    });
    await note(inc.id, "system", `Opened by the ${svc.check} check: ${r.detail}`);
    sum.opened.push(svc.id);
    if (!mute && severity !== "info") await notifyIncident(severity, inc, now);
    return;
  }

  // Repeat: grouped into the open incident.
  const data: Record<string, unknown> = { occurrences: { increment: 1 }, lastObservedAt: now, okStreak: 0, description: r.detail.slice(0, 500), errorDetail: r.detail.slice(0, 500), affectedCount: Math.max(open.affectedCount, r.affected ?? 0) };
  if (r.cause && !open.likelyCause) data.likelyCause = r.cause;
  const bumped = { ...open, occurrences: open.occurrences + 1 };
  const escalate = open.severity === "warning" && (severity === "critical" || shouldEscalate(bumped, now.getTime()));
  if (escalate) Object.assign(data, { severity: "critical", escalatedAt: now, title: titleFor(svc, "critical") });
  const inc = await db.healthIncident.update({ where: { id: open.id }, data });
  sum.updated.push(svc.id);
  if (escalate) {
    await note(inc.id, "system", severity === "critical" ? `Escalated: the check is now failing outright (${r.detail})` : `Escalated: warning persisted (${inc.occurrences} checks since ${inc.firstDetectedAt.toISOString()})`);
    sum.escalated.push(svc.id);
    if (!mute) await notifyIncident("escalation", inc, now);
    return;
  }
  if (!mute && reminderDue(inc, now.getTime())) await notifyIncident("reminder", inc, now);
}

const titleFor = (svc: MonitoredService, severity: Severity) => (severity === "critical" ? `${svc.name} has failed` : `${svc.name} is degraded`);

export async function note(incidentId: string, kind: "note" | "status" | "assign" | "ack" | "system", text: string, admin?: { id: string; name: string } | null) {
  await db.healthIncidentNote.create({ data: { incidentId, kind, text: text.slice(0, 2000), adminId: admin?.id ?? null, adminName: admin?.name ?? "Watchdog" } }).catch(() => null);
}

/** Retention: checks, resolved incidents and delivery records older than RETENTION_DAYS go. */
export async function prune(now = new Date(), days = RETENTION_DAYS) {
  const cut = new Date(now.getTime() - days * 86_400_000);
  const [checks, incidents, deliveries] = await Promise.all([
    db.healthCheck.deleteMany({ where: { checkedAt: { lt: cut } } }),
    db.healthIncident.deleteMany({ where: { status: "resolved", resolvedAt: { lt: cut } } }),
    db.healthAlertDelivery.deleteMany({ where: { createdAt: { lt: cut }, incidentId: null } }),
  ]);
  return { checks: checks.count, incidents: incidents.count, deliveries: deliveries.count };
}

/**
 * The independent heartbeat monitor (/api/cron/health). Reads the sweep heartbeat and the Watchdog's own cycle
 * record without running the engine, and opens / resolves the "watchdog" incident itself, so it still works when
 * the sweep route is broken. Returns what it saw; the caller decides whether to run a cycle of its own.
 */
export async function heartbeatCheck(origin: string, now = new Date(), opts: { quiet?: boolean } = {}) {
  const cycle = await lastCycle();
  const ageMs = cycle ? now.getTime() - cycle.at : null;
  const stale = ageMs === null || ageMs > 3 * 60_000;
  const svc = serviceById("watchdog") as MonitoredService;
  const r: CheckResult = stale
    ? {
        level: "critical",
        detail: ageMs === null ? "The watchdog has never completed a cycle" : `No health cycle for ${Math.round(ageMs / 60_000)} min (the sweep that drives it has stopped)`,
        metrics: { lastCycleAgeSec: ageMs === null ? -1 : Math.round(ageMs / 1000) },
        cause: "The minute pinger for /api/cron/sweep stopped, CRON_SECRET changed, or every sweep is failing before the health step (estimated)",
      }
    : { level: "ok", detail: `Last cycle ${Math.round((ageMs ?? 0) / 1000)} s ago (${cycle!.ran} checks, ${cycle!.ms} ms)`, metrics: { lastCycleAgeSec: Math.round((ageMs ?? 0) / 1000), lastCycleMs: cycle!.ms } };
  const sum: CycleSummary = { ran: ["watchdog"], deferred: [], threw: 0, opened: [], updated: [], resolved: [], escalated: [], ms: 0 };
  await settle(svc, r, now, sum, !!opts.quiet);
  // The page's "independent heartbeat" status: when this route was last called at all.
  await db.setting.upsert({ where: { key: HEARTBEAT_KEY }, create: { key: HEARTBEAT_KEY, value: String(now.getTime()) }, update: { value: String(now.getTime()) } }).catch(() => null);
  return { stale, ageMs, cycle, origin, ...sum };
}

/** The origin a cron request should use for self-probes: the request's own, else APP_URL. */
export const originOf = (reqOrigin?: string | null) => (reqOrigin && /^https?:\/\//.test(reqOrigin) ? reqOrigin : env.APP_URL);
