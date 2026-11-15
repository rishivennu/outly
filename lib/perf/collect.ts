/** Pure helpers behind components/shell/PerfBeacon.tsx, kept apart so they are unit-tested without a browser. */
import { PERF_MAX_MS } from "./sample";

/** Whole ms, or null when the browser gave nothing usable (an old engine, a background tab, a clock glitch). */
export function ms(v: number | null | undefined, max = PERF_MAX_MS): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) return null;
  return Math.round(v);
}

/**
 * CLS the way Core Web Vitals defines it: shifts are grouped into session windows (a gap under 1 s, a window no
 * longer than 5 s) and the worst window counts. Shifts right after input are excluded by the caller (hadRecentInput).
 */
export function clsScore(shifts: { startTime: number; value: number }[]): number {
  let worst = 0;
  let sum = 0;
  let first = -Infinity;
  let last = -Infinity;
  for (const s of [...shifts].sort((a, b) => a.startTime - b.startTime)) {
    if (s.startTime - last < 1000 && s.startTime - first < 5000) sum += s.value;
    else {
      sum = s.value;
      first = s.startTime;
    }
    last = s.startTime;
    worst = Math.max(worst, sum);
  }
  return worst;
}

/** INP: the slowest interaction, ignoring one outlier per 50 interactions (the spec's p98 approximation). */
export function inpScore(byInteraction: Map<number, number>): number | null {
  const d = [...byInteraction.values()].sort((a, b) => b - a);
  if (!d.length) return null;
  return d[Math.min(d.length - 1, Math.floor(d.length / 50))];
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27}|(?=[a-z_-]*\d)[a-z0-9_-]{16,})$/i;
/** The page, never the query or hash (they can carry tokens), with record ids folded so pages group together. */
export function cleanPath(raw: string): string {
  const p = raw.split(/[?#]/)[0] || "/";
  const out = p
    .split("/")
    .map((s) => (ID_SEGMENT.test(s) ? ":id" : s.replace(/[^\w.-]/g, "").slice(0, 40)))
    .join("/");
  return (out.startsWith("/") ? out : `/${out}`).slice(0, 100);
}

/** `user=12;cfg=3` (the studio layout's x-timing meta) -> { user: 12, cfg: 3 }. Unknown or junk parts are skipped. */
export function parseTiming(content: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (content ?? "").split(/[;,]/).slice(0, 12)) {
    const [k, v] = part.split("=").map((s) => s.trim());
    const n = Number(v);
    if (k && /^\w{1,16}$/.test(k) && v && Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

const CORE_STEPS = [1, 2, 4, 6, 8, 12, 16];
const RTT_STEPS = [50, 100, 200, 400, 800, 1600];
const bucket = (n: number, steps: number[]) => steps.find((s) => n <= s) ?? steps[steps.length - 1];

/** A coarse device class: never precise enough to tell one phone from another. */
export function deviceClass(cores?: number, memoryGb?: number): string | undefined {
  const parts: string[] = [];
  if (typeof cores === "number" && cores > 0) parts.push(`cpu${bucket(cores, CORE_STEPS)}`);
  if (typeof memoryGb === "number" && memoryGb > 0) parts.push(`mem${memoryGb >= 8 ? 8 : memoryGb < 1 ? 0.5 : Math.floor(memoryGb)}`);
  return parts.length ? parts.join(";") : undefined;
}

export function netClass(c?: { effectiveType?: string; rtt?: number; saveData?: boolean }): string | undefined {
  if (!c) return undefined;
  const parts: string[] = [];
  if (c.effectiveType && /^[a-z0-9-]{1,8}$/.test(c.effectiveType)) parts.push(c.effectiveType);
  if (typeof c.rtt === "number" && c.rtt >= 0) parts.push(`rtt${bucket(c.rtt, RTT_STEPS)}`);
  if (c.saveData) parts.push("save");
  return parts.length ? parts.join(";") : undefined;
}

/** Analytics consent as CookieConsent stores it (key "outly-consent"); no answer yet means no. */
export function analyticsAllowed(stored: string | null): boolean {
  try {
    const c = JSON.parse(stored ?? "null");
    return c?.v === 1 && c.analytics === true;
  } catch {
    return false;
  }
}
