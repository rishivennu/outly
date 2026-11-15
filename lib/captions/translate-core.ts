/**
 * Caption translation, the pure half (the model call lives in lib/ai/translate.ts). Lines go to the model in
 * numbered batches with a few lines either side for context; the answer must name every id it was given.
 * Timing is never the model's job: a translated line keeps its source line's start and end, one for one.
 */
import type { Cue } from "./cues";
import { MAX_CUE_TEXT } from "./edit";
import { isEnglish, languageName } from "./languages";

export const BATCH = 40;
export const CONTEXT = 3;

export type Batch = { ids: number[]; before: number[]; after: number[] };

/** Ids to translate, in batches, each with the lines just before and after it for context. */
export function batchIds(total: number, only?: number[], size = BATCH, context = CONTEXT): Batch[] {
  const ids = [...new Set((only ?? Array.from({ length: total }, (_, i) => i)).filter((i) => Number.isInteger(i) && i >= 0 && i < total))].sort((a, b) => a - b);
  const out: Batch[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const part = ids.slice(i, i + size);
    const lo = part[0];
    const hi = part[part.length - 1];
    const before = Array.from({ length: Math.min(context, lo) }, (_, k) => lo - Math.min(context, lo) + k);
    const after = Array.from({ length: Math.max(0, Math.min(context, total - 1 - hi)) }, (_, k) => hi + 1 + k);
    out.push({ ids: part, before, after });
  }
  return out;
}

/** Lines per translate request from the browser, so a long video fits the route's time and line limits. */
export const TRANSLATE_WINDOW = 300;

/** One request: the lines [lo, hi) and, inside them, the ids to translate (relative to lo). */
export type TranslateWindow = { lo: number; hi: number; only?: number[] };

/**
 * A long track goes in windows of `size` lines, one request each, each with CONTEXT lines either side so a
 * sentence over the seam still reads right; only the window's own lines are asked for. A track that fits in one
 * window is one request, as before. `only` (lines to retry) keeps just the windows that hold one of them.
 */
export function translateWindows(total: number, only?: number[], size = TRANSLATE_WINDOW, context = CONTEXT): TranslateWindow[] {
  if (total <= 0) return [];
  if (total <= size) return [{ lo: 0, hi: total, ...(only ? { only } : {}) }];
  const want = [...new Set((only ?? Array.from({ length: total }, (_, i) => i)).filter((i) => Number.isInteger(i) && i >= 0 && i < total))].sort((a, b) => a - b);
  const out: TranslateWindow[] = [];
  for (let w = 0; w < total; w += size) {
    const end = Math.min(total, w + size);
    const ids = want.filter((i) => i >= w && i < end);
    if (!ids.length) continue;
    const lo = Math.max(0, w - context);
    out.push({ lo, hi: Math.min(total, end + context), only: ids.map((i) => i - lo) });
  }
  return out;
}

export const TRANSLATE_SYSTEM = `You translate short-form video captions into natural, spoken English for the creator's audience.
Write what a fluent English speaker would actually say on screen, not a word-for-word swap. Keep the meaning, tone, emotion and humour.
Keep names, brands, numbers and slang that has no good English version. Keep regional words of address or feeling (for example anna, amma, bro, yaar, macha) when they carry the voice, otherwise say the feeling in plain English.
The lines are pieces of one video in order. A sentence may run across lines: each English line must still match what is said during that line, so do not move words between lines.
Return exactly one English line for every id you are asked to translate, with the same id. Never merge, split, skip or add lines. Lines that are already English stay as they are.`;

export function translatePrompt(cues: Cue[], batch: Batch, from: string): string {
  const src = from && from !== "auto" ? languageName(from) : "the spoken language (detect it)";
  const show = (i: number) => `${i}: ${cues[i].text}`;
  const ctx = (ids: number[]) => (ids.length ? ids.map(show).join("\n") : "(none)");
  return `Translate these caption lines from ${src} into natural English. Keep each line under ${MAX_CUE_TEXT - 20} characters.
Context before (do not translate):
${ctx(batch.before)}
Translate these, one answer per id:
${batch.ids.map(show).join("\n")}
Context after (do not translate):
${ctx(batch.after)}
Return JSON {"lines":[{"id": number, "text": "English line"}]}.`;
}

export const TRANSLATE_SCHEMA = {
  type: "OBJECT",
  properties: { lines: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "INTEGER" }, text: { type: "STRING" } }, required: ["id", "text"] } } },
  required: ["lines"],
};

/** Letters outside Latin: a line that comes back unchanged with these in it was not translated. */
const NON_LATIN = /(?!\p{Script=Latin})\p{L}/u;

/** Keep only answers for ids that were asked for, once each, non-empty, and actually changed when they had to. */
export function readAnswer(raw: unknown, cues: Cue[], ids: number[], from: string): Map<number, string> {
  const want = new Set(ids);
  const list: unknown[] = Array.isArray((raw as { lines?: unknown })?.lines) ? ((raw as { lines: unknown[] }).lines) : Array.isArray(raw) ? (raw as unknown[]) : [];
  const out = new Map<number, string>();
  for (const x of list) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = Number(o.id);
    if (!want.has(id) || out.has(id)) continue;
    let text = String(o.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const same = text === cues[id].text.trim();
    if (same && !isEnglish(from) && NON_LATIN.test(text)) continue;
    if (text.length > MAX_CUE_TEXT) text = text.slice(0, MAX_CUE_TEXT).replace(/\s+\S*$/, "") || text.slice(0, MAX_CUE_TEXT);
    out.set(id, text);
  }
  return out;
}

/** Same count, same times; a line with no translation keeps its source text and is listed as untranslated. */
export function applyTranslation(cues: Cue[], texts: Map<number, string>): { cues: Cue[]; untranslated: number[] } {
  const untranslated: number[] = [];
  const out = cues.map((c, i) => {
    const t = texts.get(i);
    if (t === undefined) untranslated.push(i);
    return { start: c.start, end: c.end, text: t ?? c.text };
  });
  return { cues: out, untranslated };
}
