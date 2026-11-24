import type { Cue } from "../captions/cues";
import { joinWords, type Highlight, type Range, type Word } from "../captions/subtitle-engine";
import { CANDIDATES_MAX, type ClipSettings } from "./settings-core";

/**
 * R1321: candidate moments and their ranking. The detector (Gemini over the subtitles, or the creator's own words)
 * proposes ranges; this file scores every one of them the same way, deterministically, so the order the creator sees
 * can be explained line by line and reproduced in a test. The personal part comes from the creator's own lifts
 * (lib/intelligence) and is a small weight, never the whole score.
 */

export const KINDS = ["hook", "insight", "story", "punchline", "takeaway", "text", "manual"] as const;
export type Kind = (typeof KINDS)[number];

export interface CandidateScores {
  hook: number;
  selfContained: number;
  length: number;
  density: number;
  personal: number;
  total: number;
}

export const WEIGHTS = { hook: 0.3, selfContained: 0.25, length: 0.2, density: 0.1, personal: 0.15 } as const;

/** What the creator's own history says, when it says anything (null = no personal signal, scored neutral). */
export interface PersonalHints {
  /** Lift of posts with a written hook vs without, percent; null when unknown. */
  hookLiftPct: number | null;
  /** Lift of videos under 30 s vs longer, percent; null when unknown. */
  shortVideoLiftPct: number | null;
}

export const NO_HINTS: PersonalHints = { hookLiftPct: null, shortVideoLiftPct: null };

export interface ScoredCandidate extends Range {
  kind: Kind;
  title: string;
  reason: string;
  scores: CandidateScores;
  score: number;
  source: "ai" | "text" | "manual";
  rank: number;
}

/** Length sweet spot per platform (seconds): where its short-form feed rewards a clip that holds to the end. */
const SWEET: Record<string, number> = { instagram: 30, tiktok: 30, youtube: 45, facebook: 40, linkedin: 45, x: 30, threads: 30 };
export function sweetSpot(s: Pick<ClipSettings, "platforms" | "minSec" | "maxSec">): number {
  const list = s.platforms.map((p) => SWEET[p] ?? 35);
  const avg = list.length ? list.reduce((a, b) => a + b, 0) / list.length : 35;
  return Math.min(s.maxSec, Math.max(s.minSec, Math.round(avg)));
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const HOOK_WORDS = /\b(why|how|never|secret|mistake|stop|best|worst|nobody|everyone|truth|wrong|actually|biggest|only|first|last|free|proof|warning)\b/i;
const STORY_WORDS = /\b(when i|one day|years? ago|i remember|story|happened|back then|the time)\b/i;
const TAKEAWAY_WORDS = /\b(so remember|the lesson|takeaway|in short|bottom line|that's why|which means|the point is)\b/i;
const INSIGHT_WORDS = /\b(step|because|means|the reason|here's how|the way|works|rule|tip)\b|\d/i;

export const wordsIn = (words: Word[], r: Range): Word[] => words.filter((w) => w.s >= r.start - 0.05 && w.e <= r.end + 0.05);
export const textOf = (words: Word[], r: Range): string => joinWords(wordsIn(words, r));

/** Score 0..1 for how the first seconds grab: a question, a number, "you", a hook word, each counts. */
export function hookScore(opening: string): number {
  const o = opening.trim();
  if (!o) return 0;
  let s = 0;
  if (/\?/.test(o)) s += 0.35;
  if (/\d/.test(o)) s += 0.25;
  if (/\byou(r|'re)?\b/i.test(o)) s += 0.2;
  if (HOOK_WORDS.test(o)) s += 0.3;
  if (o.split(/\s+/).length <= 12) s += 0.1; // a short opening line lands faster
  return r3(clamp01(s));
}

/** Score 0..1 for standing on its own: starts where a line starts, ends where a sentence ends. */
export function selfContainedScore(r: Range, cues: Cue[]): number {
  if (!cues.length) return 0.5;
  const startsOnLine = cues.some((c) => Math.abs(c.start - r.start) <= 0.3);
  const endCue = cues.find((c) => Math.abs(c.end - r.end) <= 0.3);
  const endsSentence = !!endCue && /[.!?]["')]?\s*$/.test(endCue.text.trim());
  return r3((startsOnLine ? 0.5 : 0) + (endCue ? 0.25 : 0) + (endsSentence ? 0.25 : 0));
}

export function lengthScore(durationSec: number, sweet: number): number {
  if (!(sweet > 0) || !(durationSec > 0)) return 0;
  return r3(clamp01(1 - Math.abs(durationSec - sweet) / sweet));
}

/** Words per second against a spoken pace of 2.5: a range full of silence scores low. */
export function densityScore(wordCount: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  return r3(clamp01(wordCount / durationSec / 2.5));
}

export function personalScore(h: PersonalHints, hook: number, durationSec: number): number {
  let s = 0.5;
  if (h.hookLiftPct !== null) s += h.hookLiftPct > 0 ? (hook >= 0.5 ? 0.25 : -0.1) : hook >= 0.5 ? -0.05 : 0.1;
  if (h.shortVideoLiftPct !== null) s += (h.shortVideoLiftPct > 0) === durationSec < 30 ? 0.25 : -0.1;
  return r3(clamp01(s));
}

export function kindOf(text: string, source: "ai" | "text" | "manual"): Kind {
  if (source !== "ai") return source;
  const t = text.trim();
  const opening = t.split(/\s+/).slice(0, 12).join(" ");
  if (/\?/.test(opening)) return "hook";
  if (STORY_WORDS.test(t)) return "story";
  if (TAKEAWAY_WORDS.test(t)) return "takeaway";
  if (/[!?]\s*$/.test(t) && t.length < 160) return "punchline";
  if (INSIGHT_WORDS.test(t)) return "insight";
  return "hook";
}

export function scoreOf(parts: Omit<CandidateScores, "total">): CandidateScores {
  const total = r3(parts.hook * WEIGHTS.hook + parts.selfContained * WEIGHTS.selfContained + parts.length * WEIGHTS.length + parts.density * WEIGHTS.density + parts.personal * WEIGHTS.personal);
  return { ...parts, total };
}

export interface ScoreContext {
  cues: Cue[];
  words: Word[];
  settings: ClipSettings;
  hints?: PersonalHints;
}

/** Plain words for why a candidate ranks where it does, from its own scores. */
export function reasonOf(s: CandidateScores, durationSec: number, sweet: number): string {
  const bits: string[] = [];
  bits.push(s.hook >= 0.6 ? "opens strong" : s.hook >= 0.3 ? "a fair opening" : "a slow opening");
  bits.push(s.selfContained >= 0.75 ? "stands on its own" : s.selfContained >= 0.5 ? "starts clean" : "cuts mid-thought");
  bits.push(Math.abs(durationSec - sweet) <= 5 ? `${Math.round(durationSec)} s, right at the sweet spot` : `${Math.round(durationSec)} s against a ${sweet} s sweet spot`);
  if (s.personal >= 0.7) bits.push("matches what works for you");
  else if (s.personal <= 0.35) bits.push("unlike what has worked for you");
  return bits.join(", ") + ".";
}

/** One range scored in the context; title and source as given. */
export function scoreCandidate(r: Range & { title?: string; why?: string }, source: "ai" | "text" | "manual", ctx: ScoreContext): Omit<ScoredCandidate, "rank"> {
  const dur = r.end - r.start;
  const ws = wordsIn(ctx.words, r);
  const text = joinWords(ws);
  const opening = joinWords(ws.slice(0, 12));
  const sweet = sweetSpot(ctx.settings);
  const hook = hookScore(opening || text);
  const scores = scoreOf({ hook, selfContained: selfContainedScore(r, ctx.cues), length: lengthScore(dur, sweet), density: densityScore(ws.length, dur), personal: personalScore(ctx.hints ?? NO_HINTS, hook, dur) });
  const fallbackTitle = (text.split(/[.!?]/)[0] || "Moment").trim().split(/\s+/).slice(0, 8).join(" ");
  const title = (r.title?.trim() || fallbackTitle || "Moment").slice(0, 80);
  const own = reasonOf(scores, dur, sweet);
  const reason = (r.why?.trim() ? `${r.why.trim().replace(/[.\s]+$/, "")}. ${own}` : own).slice(0, 300);
  return { start: r.start, end: r.end, kind: kindOf(text, source), title, reason, scores, score: scores.total, source };
}

const overlap = (a: Range, b: Range) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * Fit the ranges to the settings (too short dropped, too long trimmed at the last line end that fits), score them,
 * drop the lower of two that overlap by more than 30%, order by score then time, cap at CANDIDATES_MAX, number them.
 */
export function rankCandidates(ranges: (Range & { title?: string; why?: string; source?: "ai" | "text" | "manual" })[], ctx: ScoreContext): ScoredCandidate[] {
  const { minSec, maxSec } = ctx.settings;
  const fitted: (Range & { title?: string; why?: string; source: "ai" | "text" | "manual" })[] = [];
  for (const r of ranges) {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end)) continue;
    let end = r.end;
    if (end - r.start > maxSec) {
      const limit = r.start + maxSec;
      const edge = ctx.cues.filter((c) => c.end <= limit && c.end - r.start >= minSec).map((c) => c.end);
      end = edge.length ? Math.max(...edge) : limit;
    }
    if (end - r.start < minSec) continue;
    fitted.push({ start: Math.round(r.start * 100) / 100, end: Math.round(end * 100) / 100, title: r.title, why: r.why, source: r.source ?? "ai" });
  }
  const scored = fitted.map((r) => scoreCandidate(r, r.source, ctx)).sort((a, b) => b.score - a.score || a.start - b.start);
  const kept: Omit<ScoredCandidate, "rank">[] = [];
  for (const c of scored) {
    const clash = kept.some((k) => overlap(k, c) / Math.min(k.end - k.start, c.end - c.start) > 0.3);
    if (!clash) kept.push(c);
    if (kept.length >= CANDIDATES_MAX) break;
  }
  return kept.map((c, i) => ({ ...c, rank: i + 1 }));
}

/**
 * Grow a range (a phrase the creator searched for, a hand-picked moment) to whole subtitle lines and to at least
 * `minSec`, so a cut never opens or closes mid-sentence. Lines after the range are added first (the phrase stays
 * the opening), then lines before; the result never leaves [0, duration] or exceeds maxSec.
 */
export function widen(r: Range, cues: Cue[], minSec: number, maxSec: number, duration = Infinity): Range {
  const lo = Math.max(0, r.start);
  const hi = Math.min(duration, r.end);
  let start = lo;
  let end = hi;
  for (const c of cues) {
    if (c.start <= lo && c.end > lo) start = Math.min(start, c.start);
    if (c.start < hi && c.end >= hi) end = Math.max(end, c.end);
  }
  const after = cues.filter((c) => c.start >= end).sort((a, b) => a.start - b.start);
  const before = cues.filter((c) => c.end <= start).sort((a, b) => b.end - a.end);
  let flip = 0;
  while (end - start < minSec && (after.length || before.length)) {
    const takeAfter = after.length && (!before.length || flip % 3 !== 2);
    if (takeAfter) end = Math.max(end, after.shift()!.end);
    else start = Math.min(start, before.shift()!.start);
    flip++;
  }
  if (end - start > maxSec) end = start + maxSec;
  if (end - start < minSec && Number.isFinite(duration)) {
    end = Math.min(duration, start + minSec);
    start = Math.max(0, end - minSec);
  }
  return { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 };
}

/** The AI's picks as ranges (titles and reasons kept). */
export const fromHighlights = (hs: Highlight[]) => hs.map((h) => ({ start: h.start, end: h.end, title: h.title, why: h.why, source: "ai" as const }));
