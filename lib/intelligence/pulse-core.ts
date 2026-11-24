import { PLATFORM_META, type Platform } from "../domain";
import { type Level } from "./profile-core";

/**
 * R1325 (Phase 7): the one-glance "Intelligence pulse" that Home, Pip and the Monday email share. A pure summary of
 * numbers other modules already stand behind: per platform the honesty level and the best-read format baseline,
 * one personal recommendation, and the clipper's queue. Every line here says where its number came from and how
 * big the sample was; a missing number is said to be missing, never shown as 0.
 */

export interface PulseBaseline {
  format: string;
  predicted: number;
  low: number;
  high: number;
  /** The creator's own measured posts behind it. */
  n: number;
  /** Set when the number leans on the anonymised cohort instead (n is then 0 or small). */
  shared: { n: number; owners: number | null } | null;
}

export interface PulsePlatform {
  platform: string;
  level: Level;
  measured: number;
  /** The format with the deepest sample on this platform, or null when nothing is measured. */
  top: PulseBaseline | null;
  accuracyWords: string | null;
}

export interface PulseRecommendation {
  id: string;
  title: string;
  why: string;
  platform: string;
  confidence: string;
}

export interface ClipperPulse {
  /** Jobs transcribing or detecting right now. */
  running: number;
  /** Jobs whose candidates wait for a human. */
  review: number;
  /** Clips approved and rendered but not yet made into a post. */
  readyToPost: number;
  /** Clips that became a post. */
  published: number;
  /** Jobs that failed and want a retry. */
  failed: number;
}

export interface IntelligencePulse {
  platforms: PulsePlatform[];
  recommendation: PulseRecommendation | null;
  /** Null when the workspace never opened the clipper. */
  clipper: ClipperPulse | null;
  computedAt: string;
}

export const platformName = (p: string) => (Object.prototype.hasOwnProperty.call(PLATFORM_META, p) ? PLATFORM_META[p as Platform].name : p);
const num = (n: number) => Math.round(n).toLocaleString("en");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The format baseline worth leading with: the deepest own sample, else the first cohort-backed one. */
export function pickTop(byFormat: readonly PulseBaseline[]): PulseBaseline | null {
  if (!byFormat.length) return null;
  return [...byFormat].sort((a, b) => b.n - a.n || (b.shared?.n ?? 0) - (a.shared?.n ?? 0) || a.format.localeCompare(b.format))[0];
}

/** One honest sentence per platform baseline. */
export function baselineLine(p: PulsePlatform): string {
  const name = platformName(p.platform);
  if (!p.top) return `${name}: no measured post yet, so no number.`;
  const t = p.top;
  const range = `usually ${num(t.low)} to ${num(t.high)}`;
  if (t.n === 0 && t.shared) return `${name} ${t.format}: ~${num(t.predicted)} views (${range}), from ${plural(t.shared.n, "cohort post")}${t.shared.owners ? ` by ${t.shared.owners} creators` : ""} scaled to your size; none of your own measured yet.`;
  const own = `from ${plural(t.n, "measured post")} of yours`;
  return `${name} ${t.format}: ~${num(t.predicted)} views (${range}), ${own}${t.shared ? ", blended with the cohort" : ""}${p.accuracyWords ? `. ${p.accuracyWords}` : "."}`;
}

/** The clipper queue in one line, or null when there is nothing to say. */
export function clipperLine(c: ClipperPulse | null): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.running) parts.push(`${plural(c.running, "job")} running`);
  if (c.review) parts.push(`${plural(c.review, "job")} waiting for your review`);
  if (c.readyToPost) parts.push(`${plural(c.readyToPost, "clip")} rendered and ready to post`);
  if (c.failed) parts.push(`${plural(c.failed, "job")} failed`);
  if (!parts.length) return c.published ? `${plural(c.published, "clip")} published so far; nothing in the queue.` : "Nothing in the clipper queue.";
  return `${parts.join(", ")}${c.published ? `; ${plural(c.published, "clip")} published so far` : ""}.`;
}

/** Plain lines for a chat answer or an email paragraph; the same facts the Home card shows. */
export function pulseLines(p: IntelligencePulse): string[] {
  const lines = p.platforms.map(baselineLine);
  if (p.recommendation) lines.push(`Made for you: ${p.recommendation.title} (${platformName(p.recommendation.platform)}, ${p.recommendation.confidence}). ${p.recommendation.why}`);
  const c = clipperLine(p.clipper);
  if (c) lines.push(`Shorts clipper: ${c}`);
  return lines;
}

/**
 * The Monday email's "Your baselines" items (title + detail per platform, at most three), or none when nothing is
 * measured: the email never shows a baseline without a sample behind it.
 */
export function baselineItems(p: IntelligencePulse | null, max = 3): { title: string; detail: string }[] {
  if (!p) return [];
  return p.platforms
    .filter((x) => x.top)
    .slice(0, max)
    .map((x) => {
      const t = x.top!;
      const sample = t.n > 0 ? `from ${plural(t.n, "measured post")} of yours` : t.shared ? `from ${plural(t.shared.n, "cohort post")} scaled to your size` : "";
      return { title: `${platformName(x.platform)} ${t.format}: ~${num(t.predicted)} views`, detail: `usually ${num(t.low)} to ${num(t.high)}, ${sample}${x.accuracyWords && t.n > 0 ? `. ${x.accuracyWords}` : "."}` };
    });
}
