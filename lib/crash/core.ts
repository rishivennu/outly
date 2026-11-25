import { z } from "zod";

/**
 * R1329: crash reports from the native app. The phone writes a crash to disk as it happens and posts it on the next
 * launch (outlly-compose CrashReportWorker -> POST /api/app/crash), so every report arrives after the fact. These are the
 * pure parts: the body shape, the fingerprint that groups one bug across many phones, and the grouping the admin page
 * shows. The database side is lib/crash/server.ts.
 */
export const MAX_STACK = 16_000; // characters kept per stack trace
export const MAX_REPORTS = 10; // per POST
export const DAILY_CAP = 50; // per person per UTC day: a crash loop must not fill the table
export const RETENTION_DAYS = 90;
export const ALERT_WINDOW_MS = 24 * 3_600_000; // one admin event per fingerprint per day
export const CRASH_EVENT = "app_crash";
export const CRASHES_HREF = "/admin/app-analytics?tab=crashes";

const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const text = (max: number) => z.string().max(max).nullable().optional();

export const CrashReport = z.object({
  crashedAt: z.string().datetime({ offset: true }), // the phone's clock
  version: z.string().regex(VERSION_RE),
  build: z.number().int().min(0).max(999_999).nullable().optional(),
  sdk: z.number().int().min(1).max(99).nullable().optional(),
  device: text(80),
  exception: z.string().min(1).max(200),
  message: text(1000),
  stack: z.string().min(1).max(64_000),
  thread: text(80),
  screen: text(120),
  platform: z.enum(["android", "ios"]).optional(),
});
export type CrashReport = z.infer<typeof CrashReport>;
export const CrashBody = z.object({ reports: z.array(CrashReport).min(1).max(MAX_REPORTS) });
export type CrashPlatform = "android" | "ios";

// "\tat com.outlly.app.ui.create.CreateViewModel.pick(CreateViewModel.kt:540)" -> "com.outlly.app.ui.create.CreateViewModel.pick"
const FRAME_RE = /^\s*at\s+([\w$.<>]+)\s*\(/;

/** The frames a fingerprint is built from: the first `take` in-app frames, else the first frames of any kind. */
export function keyFrames(stack: string, pkg = "com.outlly.", take = 3): string[] {
  const frames = stack
    .split(/\r?\n/)
    .map((l) => FRAME_RE.exec(l)?.[1])
    .filter((f): f is string => !!f);
  const own = frames.filter((f) => f.startsWith(pkg));
  return (own.length ? own : frames).slice(0, take);
}

/** Numbers, hex and ids out of a message, so "Index 5 out of bounds for length 3" and "Index 9 ... 4" are one bug. */
export const normalizeMessage = (m: string | null | undefined) =>
  (m ?? "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "#")
    .replace(/\b0x[0-9a-f]+\b/gi, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

// FNV-1a, twice with different seeds, for a 16-hex grouping key (stable, dependency-free; not a security hash).
function fnv(s: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** One bug across phones and (where R8 kept the names) across versions: exception + normalised message + top frames. */
export function fingerprintOf(r: Pick<CrashReport, "exception" | "message" | "stack">) {
  const key = [r.exception.trim(), normalizeMessage(r.message), ...keyFrames(r.stack)].join("|");
  return fnv(key, 0x811c9dc5) + fnv(key, 0x050c5d1f);
}

export const capStack = (s: string) => (s.length > MAX_STACK ? `${s.slice(0, MAX_STACK)}\n... (cut at ${MAX_STACK} characters)` : s);

/** "kotlin.KotlinNullPointerException" -> "KotlinNullPointerException". */
export const shortException = (e: string) => e.trim().split(".").pop() || e.trim();

/** "com.outlly.app.ui.create.CreateViewModel.pick" -> "CreateViewModel.pick". */
export const whereOf = (stack: string) => {
  const f = keyFrames(stack, "com.outlly.", 1)[0];
  if (!f) return "";
  const parts = f.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : f;
};

export type CrashRow = {
  id: string;
  userId: string | null;
  platform: string;
  version: string;
  build: number | null;
  sdk: number | null;
  device: string | null;
  fingerprint: string;
  exception: string;
  message: string | null;
  stack: string;
  thread: string | null;
  screen: string | null;
  crashedAt: Date;
};

export type CrashGroup = {
  fingerprint: string;
  exception: string;
  message: string | null;
  where: string;
  platform: string;
  count: number;
  people: number;
  versions: { version: string; count: number }[];
  firstAt: Date;
  lastAt: Date;
  sample: CrashRow;
};

/** Rows -> groups, most frequent first, the latest sample of each kept for its stack. */
export function groupCrashes(rows: CrashRow[]): CrashGroup[] {
  const by = new Map<string, { rows: CrashRow[]; users: Set<string>; versions: Map<string, number> }>();
  for (const r of rows) {
    const g = by.get(r.fingerprint) ?? { rows: [], users: new Set<string>(), versions: new Map<string, number>() };
    g.rows.push(r);
    if (r.userId) g.users.add(r.userId);
    g.versions.set(r.version, (g.versions.get(r.version) ?? 0) + 1);
    by.set(r.fingerprint, g);
  }
  const out: CrashGroup[] = [];
  for (const [fingerprint, g] of by) {
    const sorted = [...g.rows].sort((a, b) => b.crashedAt.getTime() - a.crashedAt.getTime());
    const sample = sorted[0];
    out.push({
      fingerprint,
      exception: shortException(sample.exception),
      message: sample.message,
      where: whereOf(sample.stack),
      platform: sample.platform,
      count: g.rows.length,
      people: g.users.size,
      versions: [...g.versions].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count || b.version.localeCompare(a.version, undefined, { numeric: true })),
      firstAt: sorted[sorted.length - 1].crashedAt,
      lastAt: sample.crashedAt,
      sample,
    });
  }
  return out.sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime());
}

/** How far back a crashedAt may sit before we call the phone's clock wrong (the app keeps a crash on disk for days, not months). */
export const MAX_CRASH_AGE_MS = 90 * 86_400_000;

/** A phone's clock can be wrong: a future time, an unparsable one, or one older than MAX_CRASH_AGE_MS (a 1970 clock) becomes "now". */
export const clampCrashedAt = (iso: string, now: Date) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return now;
  if (t > now.getTime() || t < now.getTime() - MAX_CRASH_AGE_MS) return now;
  return new Date(t);
};
