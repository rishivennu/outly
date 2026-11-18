/**
 * R1195 Watchdog: pure helpers (no database, no network), so the decisions can be tested on their own.
 * Redaction, scheduling, incident grouping / recovery rules and the alert wording live here.
 */
import { LEVEL_LABEL, type Level, type MonitoredService } from "./registry";

/** What one probe found. `metrics` are plain numbers for the Performance section (ms, counts, rates). */
export type CheckResult = { level: Level; detail: string; latencyMs?: number; metrics?: Record<string, number>; affected?: number; cause?: string };

export type Severity = "critical" | "warning" | "info";

/**
 * Secrets and personal data never reach an incident row or a notification. Bearer tokens, keys that look like
 * keys, connection-string passwords, emails, long hex / base64 blobs, and anything after "password" go.
 */
export function redact(input: unknown, max = 300): string {
  let s = input instanceof Error ? `${input.name}: ${input.message}` : typeof input === "string" ? input : (() => { try { return JSON.stringify(input); } catch { return String(input); } })();
  s = s
    .replace(/[a-z][a-z0-9+.-]*:\/\/([^\s/:@]+):([^\s@/]+)@/gi, (_, u) => `${_.split("://")[0]}://${u}:***@`)
    .replace(/\b(bearer|token|key|secret|password|passwd|pwd|authorization|api[-_]?key|cookie|set-cookie)\b(\s*[:=]\s*|\s+)("?)[^\s"',;]{4,}/gi, (_, k, sep, q) => `${k}${sep}${q}***`)
    .replace(/\b(sk|rk|pk|whsec|AKIA|AIza|ghp|xox[abp])[-_a-z0-9]{8,}/gi, "***")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]{10,})?/g, "***jwt***")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\b[a-f0-9]{32,}\b/gi, "<hex>")
    .replace(/\b(\d{1,3}\.){3}\d{1,3}\b/g, "<ip>")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Due when never checked, or when the last check is at least one interval old (with 5 s of slack for a pinger that runs a touch early). */
export const isDue = (svc: MonitoredService, lastAt: number | null, now: number, intervalSec = svc.intervalSec) => lastAt === null || now - lastAt >= intervalSec * 1000 - 5_000;

/** Severity of a fresh incident for a level, by how important the service is: a warning on a critical service stays a warning; critical is critical. */
export function severityFor(level: Level, svc: MonitoredService): Severity | null {
  if (level === "critical") return svc.criticality === "normal" ? "warning" : "critical";
  if (level === "warning") return "warning";
  return null;
}

/** Recovery needs this many passing checks in a row, so one lucky probe does not close a flapping incident (and reopen it a minute later). */
export const RECOVERY_OK_STREAK = 2;
/** A warning this old with no recovery becomes critical. */
export const WARNING_PERSIST_MS = 30 * 60_000;
/** Or this many repeats. */
export const WARNING_REPEATS_TO_CRITICAL = 10;
/** Admins are reminded about an unresolved critical this often. */
export const REMINDER_MS = 30 * 60_000;
/** The same service cannot open a new alert for the same severity within this window after one was sent. */
export const COOLDOWN_MS = 10 * 60_000;
/** Checks and resolved incidents older than this are pruned. */
export const RETENTION_DAYS = 30;

/** Should a persisting / repeating warning escalate? Pure, so the tests can pin the rule. */
export const shouldEscalate = (inc: { severity: string; firstDetectedAt: Date; occurrences: number; status: string }, now: number) =>
  inc.severity === "warning" && inc.status !== "resolved" && (now - inc.firstDetectedAt.getTime() >= WARNING_PERSIST_MS || inc.occurrences >= WARNING_REPEATS_TO_CRITICAL);

export const reminderDue = (inc: { severity: string; status: string; notifiedAt: Date | null; lastReminderAt: Date | null }, now: number) =>
  inc.severity === "critical" && inc.status !== "resolved" && !!inc.notifiedAt && now - (inc.lastReminderAt ?? inc.notifiedAt).getTime() >= REMINDER_MS;

const fmtTime = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
const fmtDur = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);
export { fmtDur, fmtTime };

export type AlertKind = "critical" | "warning" | "escalation" | "reminder" | "recovery" | "watchdog";

/**
 * The words every channel uses (bell, push, email), in the brief's shape:
 * "Outlly Watchdog, Critical / Database connectivity has failed / Affected service / Detected time / Action: Open System Health".
 */
export function alertText(kind: AlertKind, inc: { id: string; service: string; severity: string; title: string; description: string; firstDetectedAt: Date; occurrences: number; resolvedAt?: Date | null }, serviceName: string) {
  const sev = kind === "recovery" ? "Recovered" : kind === "reminder" ? "Still critical" : kind === "escalation" ? "Escalated to critical" : kind === "watchdog" ? "Watchdog" : inc.severity === "critical" ? "Critical" : "Warning";
  const title = `Outlly Watchdog, ${sev}`;
  const lines = [
    kind === "recovery" ? `${inc.title} has recovered` : kind === "reminder" ? `${inc.title} (unresolved for ${fmtDur(Date.now() - inc.firstDetectedAt.getTime())})` : inc.title,
    `Affected service: ${serviceName}`,
    kind === "recovery" && inc.resolvedAt ? `Recovered: ${fmtTime(inc.resolvedAt)}, after ${fmtDur(inc.resolvedAt.getTime() - inc.firstDetectedAt.getTime())}` : `Detected: ${fmtTime(inc.firstDetectedAt)}${inc.occurrences > 1 ? ` (${inc.occurrences} failed checks grouped)` : ""}`,
    inc.description ? inc.description : "",
    "Action: Open System Health",
  ].filter(Boolean);
  return { title, body: lines.join("\n"), short: lines[0], href: `/admin/health?incident=${inc.id}`, tag: `watchdog:${inc.id}` };
}

/** The headline level of a service from its latest check (none = unknown). */
export const levelLabel = (l: Level) => LEVEL_LABEL[l];

/** One-line status summary for the top of the page. */
export function summarize(levels: Level[], openCritical: number, openWarnings: number) {
  const n = { ok: 0, warning: 0, critical: 0, unknown: 0 };
  for (const l of levels) n[l]++;
  const overall: Level = n.critical ? "critical" : n.warning ? "warning" : n.ok ? "ok" : "unknown";
  return { overall, counts: n, openCritical, openWarnings };
}
