/**
 * R1239: the pure rules behind stored recommendations. No I/O and no node-only imports, so the dashboard and the
 * tests can use them too: the dedupe key that makes regeneration idempotent, when an open recommendation expires,
 * and the check an AI rewording must pass before it may replace the rule text.
 */

import { PLATFORM_META } from "../domain";
import { POST_FORMATS } from "../formats";
import type { Recommendation } from "./core";

export const RECO_STATUSES = ["open", "accepted", "edited", "rejected", "saved", "done", "expired"] as const;
export type RecoStatus = (typeof RECO_STATUSES)[number];
/** Statuses the dashboard still shows. Rejected, done and expired ones are history. */
export const ACTIVE_STATUSES: readonly RecoStatus[] = ["open", "accepted", "edited", "saved"];
/** A recommendation the creator closed is never reopened by a regeneration. */
export const CLOSED_STATUSES: readonly RecoStatus[] = ["rejected", "done"];

/** 64 bits from two FNV-1a passes: short, stable across runtimes, and needs no crypto module. */
function hash(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** The rule a draft came from plus what it is about: the same advice, whatever the period. */
export function ruleKeyOf(draft: Pick<Recommendation, "id" | "platform" | "format" | "nextAction">): string {
  const topic = draft.nextAction?.prefill?.topic?.trim().toLowerCase() ?? "";
  return [draft.id, draft.platform, draft.format, topic].join("|");
}

/**
 * Stable key over (rule, platform, format, topic, period from, period to): the same drafts for the same period give
 * the same key, so storing them again changes nothing.
 */
export function dedupeKeyOf(draft: Pick<Recommendation, "id" | "platform" | "format" | "nextAction">, period: { from: string; to: string }): string {
  return hash(`${ruleKeyOf(draft)}|${period.from}|${period.to}`);
}

/** Open recommendations older than twice their period's length are stale: the numbers behind them have moved on. */
export function isExpired(r: { status: string; createdAt: Date | string; periodFrom: string; periodTo: string }, now: number = Date.now()): boolean {
  if (r.status !== "open") return false;
  const len = Date.parse(r.periodTo) - Date.parse(r.periodFrom);
  const born = r.createdAt instanceof Date ? r.createdAt.getTime() : Date.parse(r.createdAt);
  if (!Number.isFinite(len) || len <= 0 || !Number.isFinite(born)) return false;
  return now - born > 2 * len;
}

/* ------------------------------------------------------------------ wording */

export interface RecoWording {
  title: string;
  concept: string;
  why: string;
  nextAction: { label: string };
}

const NUMBER = /\d+(?:[.,]\d+)*(?:\s?%|[KkMm]\b)?/g;
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PLATFORM_NAMES: [string, string][] = Object.values(PLATFORM_META).map((m) => [m.name, esc(m.name)]);
/** Singular or plural, so "carousel" and "carousels" are the same word. */
const FORMAT_WORDS: [string, string][] = POST_FORMATS.map((f) => [f, f === "story" ? "stor(?:y|ies)" : `${f}s?`]);

const numbersIn = (s: string) => (s.match(NUMBER) ?? []).map((x) => x.replace(/\s/g, "").toLowerCase());
const wordRe = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu");
const namesIn = (s: string, names: [string, string][]) => names.filter(([, re]) => wordRe(re).test(s));
const textOf = (w: RecoWording) => [w.title, w.concept, w.why, w.nextAction?.label].join("\n");

/** Limits per field, so a rewording can never turn a card into an essay. */
export const WORDING_MAX = { title: 90, concept: 220, why: 320, label: 40 } as const;

/**
 * Whether `worded` says what `original` says. In the spirit of mergeAi (lib/live/review-core.ts) the AI only words
 * facts the engine computed: every number, percentage, platform name and format word in the original must still be
 * there, and the rewording may not bring in a number or a platform the original does not have.
 */
export function validateWording(original: RecoWording, worded: unknown): { ok: boolean; reason: string | null } {
  const w = worded as Partial<RecoWording> | null;
  if (!w || typeof w !== "object") return { ok: false, reason: "No answer." };
  const fields: [keyof typeof WORDING_MAX, unknown][] = [["title", w.title], ["concept", w.concept], ["why", w.why], ["label", w.nextAction?.label]];
  for (const [k, v] of fields) {
    if (typeof v !== "string" || !v.trim()) return { ok: false, reason: `Missing ${k}.` };
    if (v.length > WORDING_MAX[k]) return { ok: false, reason: `${k} is too long.` };
  }
  const a = textOf(original);
  const b = textOf(w as RecoWording);
  const before = new Set(numbersIn(a));
  const after = new Set(numbersIn(b));
  for (const x of before) if (!after.has(x)) return { ok: false, reason: `Dropped or changed the number ${x}.` };
  for (const x of after) if (!before.has(x)) return { ok: false, reason: `Added the number ${x}.` };
  for (const [name, re] of namesIn(a, PLATFORM_NAMES)) if (!wordRe(re).test(b)) return { ok: false, reason: `Dropped ${name}.` };
  for (const [name, re] of namesIn(b, PLATFORM_NAMES)) if (!wordRe(re).test(a)) return { ok: false, reason: `Added ${name}.` };
  for (const [name, re] of namesIn(a, FORMAT_WORDS)) if (!wordRe(re).test(b)) return { ok: false, reason: `Dropped the format ${name}.` };
  for (const [name, re] of namesIn(b, FORMAT_WORDS)) if (!wordRe(re).test(a)) return { ok: false, reason: `Added the format ${name}.` };
  if (/[\u2014]/.test(b)) return { ok: false, reason: "Uses an em dash." };
  return { ok: true, reason: null };
}
