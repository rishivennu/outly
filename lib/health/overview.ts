import "server-only";
import { db } from "../db";
import { env } from "../env";
import { expectedSource, sweeperHealth } from "../queue/health";
import { HEARTBEAT_KEY, lastCycle } from "./engine";
import { summarize } from "./core";
import { SERVICES, type Level, type MonitoredService } from "./registry";
import { watchdogConfig } from "./config";

/*
 * R1195: everything the System Health page shows, from real rows only. A service with no check row is "unknown"
 * (never a green dot it has not earned); unmonitored services carry their reason. Error rate = failing checks /
 * checks in the window, per service, so a service probed every 5 minutes is judged on the same footing as one
 * probed every minute.
 */

export type ServiceRow = {
  id: string;
  name: string;
  group: string;
  monitored: boolean;
  why?: string;
  covers?: string;
  criticality?: string;
  intervalSec?: number;
  level: Level;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  detail: string;
  errorRatePct: number | null;
  checks: number;
  openIncidents: number;
  openSeverity: string | null;
};

const RANGE_MS: Record<string, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };
export const rangeMs = (r: string | null | undefined) => RANGE_MS[r ?? ""] ?? RANGE_MS["24h"];

export async function healthOverview(now = new Date(), range = "24h") {
  const since = new Date(now.getTime() - rangeMs(range));
  const hour = new Date(now.getTime() - 3_600_000);
  const [latest, hourRows, open, cycle, sweep, cfg, hbRow, deliveries24, failedChecks24, recent] = await Promise.all([
    db.healthCheck.findMany({ distinct: ["service"], orderBy: { checkedAt: "desc" }, where: { checkedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } }),
    db.healthCheck.groupBy({ by: ["service", "status"], where: { checkedAt: { gte: hour } }, _count: { _all: true } }),
    db.healthIncident.findMany({ where: { status: { not: "resolved" } }, orderBy: { firstDetectedAt: "desc" } }),
    lastCycle(),
    sweeperHealth(now.getTime()),
    watchdogConfig(),
    db.setting.findUnique({ where: { key: HEARTBEAT_KEY } }),
    db.healthAlertDelivery.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    db.healthCheck.count({ where: { checkedAt: { gte: since }, status: { in: ["warning", "critical"] } } }),
    db.healthIncident.findMany({ where: { OR: [{ firstDetectedAt: { gte: since } }, { resolvedAt: { gte: since } }] }, orderBy: { firstDetectedAt: "desc" }, take: 200 }),
  ]);

  const byService = new Map(latest.map((c) => [c.service, c]));
  const rate = new Map<string, { bad: number; all: number }>();
  for (const r of hourRows) {
    const e = rate.get(r.service) ?? { bad: 0, all: 0 };
    e.all += r._count._all;
    if (r.status === "warning" || r.status === "critical") e.bad += r._count._all;
    rate.set(r.service, e);
  }
  const openBy = new Map<string, { n: number; sev: string }>();
  for (const i of open) {
    const e = openBy.get(i.service) ?? { n: 0, sev: i.severity };
    e.n++;
    if (i.severity === "critical") e.sev = "critical";
    openBy.set(i.service, e);
  }

  const services: ServiceRow[] = SERVICES.map((s) => {
    const c = byService.get(s.id);
    const r = rate.get(s.id);
    const o = openBy.get(s.id);
    const base = { id: s.id, name: s.name, group: s.group, openIncidents: o?.n ?? 0, openSeverity: o?.sev ?? null };
    if (!s.monitored) return { ...base, monitored: false, why: s.why, level: "unknown", lastCheckedAt: null, latencyMs: null, detail: "Not monitored", errorRatePct: null, checks: 0 };
    const m = s as MonitoredService;
    return {
      ...base,
      monitored: true,
      covers: m.covers,
      criticality: m.criticality,
      intervalSec: cfg.intervals[m.id] ?? m.intervalSec,
      level: (c?.status as Level) ?? "unknown",
      lastCheckedAt: c?.checkedAt.toISOString() ?? null,
      latencyMs: c?.latencyMs ?? null,
      detail: c?.detail ?? "Not checked yet",
      errorRatePct: r && r.all ? Math.round((r.bad / r.all) * 100) : r ? 0 : null,
      checks: r?.all ?? 0,
    };
  });

  const levels = services.filter((s) => s.monitored && s.lastCheckedAt).map((s) => s.level);
  const summary = summarize(levels, open.filter((i) => i.severity === "critical").length, open.filter((i) => i.severity === "warning").length);
  const hbAt = hbRow && /^\d+$/.test(hbRow.value) ? Number(hbRow.value) : null;

  const worker = {
    model: process.env.VERCEL
      ? "cron-driven (serverless, no always-on worker)"
      : process.env.RENDER
        ? "cron-driven (always-on container, scripts/cron-scheduler.mjs replays vercel.json)"
        : env.REDIS_URL
          ? "Redis worker + in-process timers"
          : "in-process timers (dev) + cron route",
    sweep: { source: expectedSource(), lastAt: sweep.lastAt ? new Date(sweep.lastAt).toISOString() : null, stale: sweep.stale },
    lastCycle: cycle ? { at: new Date(cycle.at).toISOString(), ms: cycle.ms, ran: cycle.ran, threw: cycle.threw, source: cycle.source, ageSec: Math.round((now.getTime() - cycle.at) / 1000) } : null,
    heartbeat: { configured: hbAt !== null, lastAt: hbAt ? new Date(hbAt).toISOString() : null, stale: hbAt === null || now.getTime() - hbAt > 3 * 60_000 },
    enabled: cfg.enabled,
    alertEmail: cfg.alertEmail ? maskEmail(cfg.alertEmail) : "",
    muted: cfg.muted,
  };

  const perf = perfFrom(latest);
  const alerts: Record<string, Record<string, number>> = {};
  for (const d of deliveries24) (alerts[d.channel] ??= {})[d.status] = d._count._all;

  return {
    now: now.toISOString(),
    range,
    summary,
    services,
    incidents: open.map(incidentRow),
    history: { incidents: recent.map(incidentRow), failedChecks: failedChecks24, alerts },
    perf,
    worker,
    unmonitored: services.filter((s) => !s.monitored).length,
  };
}

export function incidentRow(i: { id: string; service: string; severity: string; title: string; description: string; status: string; firstDetectedAt: Date; lastObservedAt: Date; resolvedAt: Date | null; occurrences: number; affectedCount: number; assigneeName: string | null; ackAt: Date | null; escalatedAt: Date | null; likelyCause: string; resolvedBy?: string | null }) {
  return {
    id: i.id,
    service: i.service,
    serviceName: SERVICES.find((s) => s.id === i.service)?.name ?? i.service,
    severity: i.severity,
    title: i.title,
    description: i.description,
    status: i.status,
    firstDetectedAt: i.firstDetectedAt.toISOString(),
    lastObservedAt: i.lastObservedAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    resolvedBy: i.resolvedBy ?? null,
    durationMs: (i.resolvedAt ?? new Date()).getTime() - i.firstDetectedAt.getTime(),
    occurrences: i.occurrences,
    affectedCount: i.affectedCount,
    assigneeName: i.assigneeName,
    acknowledged: !!i.ackAt,
    escalated: !!i.escalatedAt,
    likelyCause: i.likelyCause,
  };
}

const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, "$1***$2");

/** The Performance section: the latest numbers each probe reported, by topic. Only what exists; no invented series. */
function perfFrom(latest: { service: string; metrics: string; latencyMs: number | null; checkedAt: Date }[]) {
  const m = new Map<string, Record<string, number | string>>(latest.map((c) => [c.service, { ...(safeJson(c.metrics) as Record<string, number>), _ms: c.latencyMs ?? 0, _at: c.checkedAt.toISOString() }]));
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const pick = (svc: string, key: string) => num(m.get(svc)?.[key]);
  const at = (svc: string) => (typeof m.get(svc)?._at === "string" ? (m.get(svc)!._at as string) : null);
  const platformApi = m.get("platform-api");
  const publish = Object.fromEntries([...m.entries()].filter(([k]) => k.startsWith("publish:")).map(([k, v]) => [k.slice(8), { failed24h: num(v.failed24h) ?? 0, published24h: num(v.published24h) ?? 0, failRatePct: num(v.failRatePct) ?? 0, delayed: num(v.delayedQueued) ?? 0 }]));
  return {
    api: { healthMs: pick("app", "apiMs"), homeMs: pick("app", "homeMs"), authMs: pick("auth", "meMs"), adminLoginMs: pick("admin-auth", "loginPageMs"), at: at("app") },
    db: { ms: pick("db", "dbMs"), at: at("db") },
    jobs: { overduePosts: pick("queue", "overduePosts"), stuckTargets: pick("queue", "stuckTargets"), sweepAgeSec: pick("sweeper", "lastSweepAgeSec"), oldestNotifyMin: pick("notify", "oldestPendingMin"), at: at("queue") },
    ai: { avgModelMs: pick("ai-text", "avgModelMs"), models: pick("ai-text", "models"), benched: pick("ai-text", "benched"), captionsAvgMs: pick("captions", "avgModelMs"), whisperBenched: pick("captions", "whisperBenched"), at: at("ai-text") },
    upload: { completedLastHour: pick("upload", "completedLastHour"), failedLastHour: pick("upload", "failedLastHour"), failRatePct: pick("upload", "failRatePct"), storageMs: pick("storage", "statMs"), processingFailRatePct: pick("processing", "failRatePct"), at: at("upload") },
    notifications: { pushSent: pick("push", "sentLastHour"), pushFailed: pick("push", "failedLastHour"), pushOutbox: pick("push", "outbox"), emailSent: pick("email", "sentLastHour"), emailFailed: pick("email", "failedLastHour"), deadLetters: pick("notify", "deadLettersLastHour"), at: at("push") },
    external: { unreachable: num(platformApi?.unreachable), hosts: platformApi ? Object.fromEntries(Object.entries(platformApi).filter(([k]) => k.startsWith("ms:")).map(([k, v]) => [k.slice(3), num(v)])) : {}, publish, at: at("platform-api") },
  };
}

const safeJson = (s: string) => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return {};
  }
};

/** Series for the sparkline cards: one probe's metric over the range, newest last, downsampled to at most `max` points. */
export async function metricSeries(service: string, key: string, now = new Date(), range = "24h", max = 120) {
  const rows = await db.healthCheck.findMany({ where: { service, checkedAt: { gte: new Date(now.getTime() - rangeMs(range)) } }, orderBy: { checkedAt: "asc" }, select: { checkedAt: true, metrics: true, status: true } });
  const pts = rows.map((r) => ({ t: r.checkedAt.getTime(), v: (safeJson(r.metrics) as Record<string, number>)[key] ?? null, s: r.status })).filter((p) => p.v !== null);
  if (pts.length <= max) return pts;
  const step = pts.length / max;
  return Array.from({ length: max }, (_, i) => pts[Math.floor(i * step)]);
}
