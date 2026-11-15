/**
 * Phase 3 caption timing. Gemini writes word times itself (it has no acoustic aligner), so every chunk's times
 * are checked before they are used: seconds or milliseconds, clip-relative or video-absolute, in order, inside
 * the chunk. A chunk whose times make no sense is refused (the server asks again) instead of being stretched.
 * Chunks overlap a little so no word is cut at a seam; the copy heard twice is dropped by time and text.
 * Pure: shared by the server, the editor and tests.
 */
import { toSeconds, type Cue } from "./cues";
import { cuesFromWords, DEFAULT_SUBTITLE_RULES, joinWords, wordsFromCues, type SubtitleRules, type Word } from "./subtitle-engine";

export const CHUNK_STEP = 60;
/** Seconds each chunk hears of the next one. 62.5 s of 16 kHz mono WAV is about 2 MB, well under the 4 MB cap. */
export const CHUNK_OVERLAP = 2.5;
/** Longest a single spoken word may last. A model "word" longer than this is holding a pause, not a sound. */
export const MAX_WORD = 2.5;
/** A line stays up this long after its last word, unless the next line starts first. */
export const CUE_TAIL = 0.25;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type ChunkPlan = { index: number; offset: number; duration: number; from: number; to: number };

/**
 * Where each chunk sits in the video. `offset`/`duration` = the audio it carries (with the overlap);
 * `from`/`to` = the part of the timeline its words are trusted for (the seam sits mid-overlap).
 */
export function planChunks(total: number, step = CHUNK_STEP, overlap = CHUNK_OVERLAP): ChunkPlan[] {
  if (!(total > 0) || !Number.isFinite(total)) return [];
  const out: ChunkPlan[] = [];
  for (let k = 0; k === 0 || k * step < total - overlap; k++) {
    const offset = k * step;
    const end = Math.min(total, offset + step + overlap);
    out.push({ index: k, offset, duration: r3(end - offset), from: k === 0 ? 0 : r3(offset + overlap / 2), to: Infinity });
  }
  for (let i = 0; i < out.length - 1; i++) out[i].to = out[i + 1].from;
  return out;
}

type Raw = { w: string; s: number; e: number; spk?: number };
export type ChunkTiming = { ok: true; words: Raw[]; unit: "s" | "ms"; shifted: boolean; dropped: number } | { ok: false; reason: string };

/**
 * The model's words for one chunk -> clip-relative seconds, or a refusal when the times are garbage.
 * Correct times pass through untouched; only missing or impossible ends are filled from the next word.
 */
export function checkChunkWords(raw: unknown, duration: number, offset = 0): ChunkTiming {
  const list = Array.isArray(raw) ? raw : [];
  let items: Raw[] = [];
  for (const x of list) {
    const o = (x ?? {}) as Record<string, unknown>;
    const w = String(o.w ?? o.word ?? o.text ?? "").replace(/\s+/g, " ").trim();
    const s = toSeconds(o.s ?? o.start);
    const e = toSeconds(o.e ?? o.end);
    if (!w || !Number.isFinite(s)) continue;
    const spk = Number(o.spk);
    items.push({ w, s, e, ...(Number.isFinite(spk) ? { spk } : {}) });
  }
  if (!items.length) return { ok: true, words: [], unit: "s", shifted: false, dropped: 0 };
  const top = () => Math.max(...items.map((x) => (Number.isFinite(x.e) ? Math.max(x.s, x.e) : x.s)));
  let unit: "s" | "ms" = "s";
  let shifted = false;
  const far = duration + 2;
  const low = Math.min(...items.map((x) => x.s));
  if (offset > 0 && top() > far && low >= offset - 2 && top() <= offset + far) {
    // Counted from the start of the video instead of this chunk.
    shifted = true;
    items = items.map((x) => ({ ...x, s: x.s - offset, e: x.e - offset }));
  } else if (top() > duration * 1.5 + 2 && top() / 1000 <= far) {
    unit = "ms";
    items = items.map((x) => ({ ...x, s: x.s / 1000, e: x.e / 1000 }));
  }
  const n = items.length;
  const kept: Raw[] = [];
  let dropped = 0;
  let backwards = 0;
  let latest = -Infinity;
  for (const x of items) {
    if (x.s < -0.3 || x.s > duration + 0.3) {
      dropped++;
      continue;
    }
    if (x.s < latest - 0.3) backwards++;
    latest = Math.max(latest, x.s);
    const s = Math.min(duration, Math.max(0, x.s));
    const e = Number.isFinite(x.e) && x.e > s ? Math.min(x.e, duration, s + MAX_WORD) : NaN;
    kept.push({ ...x, s, e });
  }
  if (dropped > Math.max(1, n * 0.25)) return { ok: false, reason: "word times run past this part of the audio" };
  if (backwards > Math.max(2, n * 0.15)) return { ok: false, reason: "word times jump backwards" };
  if (kept.length >= 8) {
    const starts = new Set(kept.map((x) => Math.round(x.s * 10)));
    const span = Math.max(...kept.map((x) => x.s)) - Math.min(...kept.map((x) => x.s));
    if (starts.size < kept.length * 0.3) return { ok: false, reason: "many words share one time" };
    if (span < kept.length * 0.06) return { ok: false, reason: "words are squeezed into a moment" };
  }
  kept.sort((a, b) => a.s - b.s);
  const words: Raw[] = [];
  for (let i = 0; i < kept.length; i++) {
    const x = kept[i];
    let e = x.e;
    if (!Number.isFinite(e)) {
      const guess = Math.min(0.8, Math.max(0.12, x.w.length * 0.06));
      const next = kept.slice(i + 1).find((k) => k.s > x.s)?.s ?? Infinity;
      e = Math.min(x.s + guess, next, duration);
    }
    if (e <= x.s) e = Math.min(duration, x.s + 0.05);
    if (e <= x.s) continue;
    words.push({ ...x, e });
  }
  return { ok: true, words, unit, shifted, dropped };
}

const norm = (w: string) => w.toLowerCase().normalize("NFKC").replace(/[\p{P}\p{S}\s]+/gu, "");
const mid = (w: Word) => (w.s + w.e) / 2;

/** Words from overlapping chunks -> one whole-video list: each chunk owns [from, to); a word heard by both is kept once. */
export function stitchWords(parts: { from: number; to: number; words: Word[] }[], overlap = CHUNK_OVERLAP): Word[] {
  const out: Word[] = [];
  for (const p of [...parts].sort((a, b) => a.from - b.from)) {
    const base = out.length;
    for (const w of p.words) {
      const m = mid(w);
      if (m >= p.to || m < p.from - overlap / 2) continue;
      if (base && m < p.from + overlap / 2) {
        const k = norm(w.w);
        let dup = false;
        for (let i = base - 1; i >= 0 && out[i].e > w.s - 1.5; i--) {
          if (norm(out[i].w) === k && Math.abs(mid(out[i]) - m) < 1) {
            dup = true;
            break;
          }
        }
        if (dup) continue;
      }
      out.push(w);
    }
  }
  out.sort((a, b) => a.s - b.s);
  for (let i = 0; i < out.length - 1; i++) if (out[i].e > out[i + 1].s) out[i] = { ...out[i], e: Math.max(out[i].s + 0.01, out[i + 1].s) };
  return out;
}

/** Cues that start and end where the words are, held a beat after the last word, never into the next line. */
export function settleCues(cues: Cue[], total = Infinity): Cue[] {
  const end = total > 0 && Number.isFinite(total) ? total : Infinity;
  const out = [...cues].sort((a, b) => a.start - b.start).map((c) => ({ ...c }));
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const next = i + 1 < out.length ? out[i + 1].start : end;
    c.start = r2(Math.max(0, c.start));
    c.end = r2(Math.min(next, end, Math.max(c.end, Math.min(c.end + CUE_TAIL, next))));
  }
  return out.filter((c) => c.end - c.start >= 0.05 && c.text);
}

export function buildCues(words: Word[], rules: SubtitleRules = DEFAULT_SUBTITLE_RULES, total = Infinity): Cue[] {
  return settleCues(cuesFromWords(words, rules), total);
}

/** A re-transcribed part of the video replaces only the lines inside [from, to); edits elsewhere stay. */
export function spliceSpan(cues: Cue[], fresh: Cue[], from: number, to: number): Cue[] {
  const inside = (c: Cue) => (c.start + c.end) / 2 >= from && (c.start + c.end) / 2 < to;
  const merged = [...cues.filter((c) => !inside(c)), ...fresh.filter(inside)].sort((a, b) => a.start - b.start).map((c) => ({ ...c }));
  for (let i = 0; i < merged.length - 1; i++) if (merged[i].end > merged[i + 1].start) merged[i].end = merged[i + 1].start;
  return merged.filter((c) => c.end - c.start >= 0.05);
}

export function spliceWords(words: Word[], fresh: Word[], from: number, to: number): Word[] {
  const inside = (w: Word) => mid(w) >= from && mid(w) < to;
  return [...words.filter((w) => !inside(w)), ...fresh.filter(inside)].sort((a, b) => a.s - b.s);
}

/**
 * Words kept true to edited lines: a line whose text was changed by hand gets rough words spread over its own
 * time (what "cut by text" then searches); untouched lines keep the engine's real word times.
 */
export function syncWords(words: Word[], cues: Cue[]): Word[] {
  if (!words.length) return wordsFromCues(cues);
  const out: Word[] = [];
  let k = 0;
  const sorted = [...words].sort((a, b) => a.s - b.s);
  for (const c of cues) {
    while (k < sorted.length && mid(sorted[k]) < c.start) out.push(sorted[k++]);
    const inLine: Word[] = [];
    while (k < sorted.length && mid(sorted[k]) < c.end) inLine.push(sorted[k++]);
    if (norm(joinWords(inLine)) === norm(c.text)) out.push(...inLine);
    else out.push(...wordsFromCues([c]));
  }
  while (k < sorted.length) out.push(sorted[k++]);
  return out;
}

/**
 * Original and English tracks share one timeline. When the track on show changes (retime, delete, add, undo),
 * the other track follows its times line for line and keeps its own words. A line that is new on the edited
 * track has no counterpart yet, so it carries the edited text until the creator changes it.
 */
export function followTrack(before: Cue[], after: Cue[], other: Cue[]): Cue[] {
  if (other.length !== before.length) return other;
  if (after.length === before.length) return after.map((c, i) => ({ start: c.start, end: c.end, text: other[i].text }));
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  return after.map((c) => {
    let j = before.findIndex((b) => near(b.start, c.start) && near(b.end, c.end));
    if (j < 0) j = before.findIndex((b) => near(b.start, c.start));
    return { start: c.start, end: c.end, text: j >= 0 ? other[j].text : c.text };
  });
}

/**
 * Retrying one part of a transcript keeps the English track: a line whose times and original words did not
 * change keeps its English words (edits included); a new or re-heard line carries the original words and is
 * listed as untranslated, as is a kept line that was untranslated before.
 */
export function keepEnglish(orig: Cue[], en: Cue[], untranslated: number[], next: Cue[]): { en: Cue[]; untranslated: number[] } {
  const at = new Map<string, number>();
  orig.forEach((c, i) => at.set(`${c.start}|${c.end}`, i));
  const was = new Set(untranslated);
  const out: Cue[] = [];
  const left: number[] = [];
  next.forEach((c, i) => {
    const j = at.get(`${c.start}|${c.end}`);
    const hit = j !== undefined && en.length === orig.length && orig[j].text === c.text ? en[j] : undefined;
    out.push({ start: c.start, end: c.end, text: hit ? hit.text : c.text });
    if (!hit || was.has(j!)) left.push(i);
  });
  return { en: out, untranslated: left };
}
