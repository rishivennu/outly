/**
 * Subtitle engine. Ideas adapted from FunClip (modelscope/FunClip, MIT): build subtitles from word-level
 * timestamps instead of guessed cues, break lines on punctuation and pauses, "clip by text" (pick words from
 * the transcript and get the matching video ranges, several at once separated by #), and let an LLM pick
 * highlight ranges from the subtitle file. Pure module: shared by the server, the editor and tests.
 *
 * Engines: "gemini" (default, runs on our server) or "funasr" (a FunASR / Paraformer worker that FunClip is
 * built on, reached over HTTP; see FUNASR_URL). Settings live in the Setting table under SUBTITLE_KEY.
 */
import { toSeconds, toSrt, type Cue } from "./cues";

export const SUBTITLE_KEY = "engine:subtitles";

export interface Word {
  w: string; // the word as spoken, with any punctuation that follows it attached
  s: number; // seconds
  e: number;
  spk?: number;
}

export interface Range {
  start: number;
  end: number;
}

export interface Highlight extends Range {
  title: string;
  why: string;
}

export interface SubtitleRules {
  provider: "gemini" | "funasr";
  /** FunASR worker endpoint. Empty means use the FUNASR_URL env var. */
  workerUrl: string;
  /** Label for the model the worker runs (shown in admin), e.g. "paraformer-en". */
  model: string;
  /** Names the recogniser should favour (brands, people). FunASR calls these hotwords. */
  hotwords: string[];
  maxChars: number;
  maxWords: number;
  minCue: number;
  maxCue: number;
  /** A silence at least this long (seconds) always starts a new line. */
  pause: number;
  clipPad: { before: number; after: number };
  highlights: { count: number; minSec: number; maxSec: number };
}

export const DEFAULT_SUBTITLE_RULES: SubtitleRules = {
  provider: "gemini",
  workerUrl: "",
  model: "paraformer-en",
  hotwords: ["Outlly"],
  maxChars: 42,
  maxWords: 8,
  minCue: 0.6,
  maxCue: 5,
  pause: 0.45,
  clipPad: { before: 0.15, after: 0.35 },
  highlights: { count: 3, minSec: 6, maxSec: 45 },
};

const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Anything stored or posted -> a complete, clamped rule set. Unknown keys are dropped. */
export function mergeSubtitleRules(input: unknown): SubtitleRules {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const d = DEFAULT_SUBTITLE_RULES;
  const url = typeof i.workerUrl === "string" ? i.workerUrl.trim().slice(0, 300) : d.workerUrl;
  return {
    provider: i.provider === "funasr" ? "funasr" : "gemini",
    workerUrl: url === "" || /^https?:\/\/[^\s]+$/i.test(url) ? url : d.workerUrl,
    model: typeof i.model === "string" && i.model.trim() ? i.model.trim().slice(0, 120) : d.model,
    hotwords: Array.isArray(i.hotwords) ? i.hotwords.map((h: unknown) => String(h).trim()).filter(Boolean).slice(0, 50).map((h: string) => h.slice(0, 40)) : d.hotwords,
    maxChars: Math.round(num(i.maxChars, 16, 80, d.maxChars)),
    maxWords: Math.round(num(i.maxWords, 2, 16, d.maxWords)),
    minCue: num(i.minCue, 0.2, 2, d.minCue),
    maxCue: num(i.maxCue, 1.5, 10, d.maxCue),
    pause: num(i.pause, 0.15, 2, d.pause),
    clipPad: { before: num(i.clipPad?.before, 0, 2, d.clipPad.before), after: num(i.clipPad?.after, 0, 2, d.clipPad.after) },
    highlights: (() => {
      const minSec = num(i.highlights?.minSec, 2, 60, d.highlights.minSec);
      return { count: Math.round(num(i.highlights?.count, 1, 8, d.highlights.count)), minSec, maxSec: Math.max(minSec + 1, num(i.highlights?.maxSec, 3, 180, d.highlights.maxSec)) };
    })(),
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/;
const PUNCT_ONLY = /^[\p{P}\p{S}]+$/u;
const SENTENCE_END = /[.!?。！？…]["')\]]*$/;
const SOFT_END = /[,;:，、；：]$/;

/** Join words for display: no space between CJK characters or before punctuation. */
export function joinWords(ws: { w: string }[]): string {
  let out = "";
  for (const { w } of ws) {
    if (!out) out = w;
    else if (PUNCT_ONLY.test(w) || (CJK.test(out[out.length - 1]) && CJK.test(w[0]))) out += w;
    else out += ` ${w}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Clean model output: drop blanks, apply the chunk offset, sort, clamp, and give every word a positive span. */
export function cleanWords(raw: unknown, offset = 0, duration = Infinity): Word[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Word[] = [];
  for (const x of list) {
    const w = String((x as any)?.w ?? (x as any)?.word ?? (x as any)?.text ?? "").replace(/\s+/g, " ").trim();
    let s = toSeconds((x as any)?.s ?? (x as any)?.start) + offset;
    let e = toSeconds((x as any)?.e ?? (x as any)?.end) + offset;
    if (!w || !Number.isFinite(s)) continue;
    if (!Number.isFinite(e) || e <= s) e = s + Math.max(0.12, w.length * 0.06);
    s = Math.max(0, s);
    e = Math.min(duration, e);
    if (e <= s) continue;
    const spk = Number((x as any)?.spk);
    out.push({ w, s: r2(s), e: r2(e), ...(Number.isFinite(spk) ? { spk } : {}) });
  }
  out.sort((a, b) => a.s - b.s);
  // Punctuation-only tokens ride on the word before them.
  const merged: Word[] = [];
  for (const w of out) {
    if (PUNCT_ONLY.test(w.w) && merged.length) merged[merged.length - 1] = { ...merged[merged.length - 1], w: merged[merged.length - 1].w + w.w };
    else merged.push(w);
  }
  for (let i = 0; i < merged.length - 1; i++) if (merged[i].e > merged[i + 1].s) merged[i].e = Math.max(merged[i].s + 0.01, merged[i + 1].s);
  return merged;
}

/**
 * Words -> subtitle cues, the FunClip way: a line ends after sentence punctuation, before a pause, when the
 * speaker changes, or when the next word would break the length, word or duration limit. A comma ends a line
 * once it is at least half full, so lines break where people breathe.
 */
export function cuesFromWords(words: Word[], rules: SubtitleRules = DEFAULT_SUBTITLE_RULES): Cue[] {
  const cues: Cue[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) cues.push({ start: cur[0].s, end: cur[cur.length - 1].e, text: joinWords(cur) });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const nextText = joinWords([...cur, w]);
      const breakBefore =
        w.s - last.e >= rules.pause ||
        (w.spk !== undefined && last.spk !== undefined && w.spk !== last.spk) ||
        nextText.length > rules.maxChars ||
        cur.length + 1 > rules.maxWords ||
        w.e - cur[0].s > rules.maxCue;
      if (breakBefore) flush();
    }
    cur.push(w);
    const text = joinWords(cur);
    if (SENTENCE_END.test(w.w) || (SOFT_END.test(w.w) && (cur.length >= rules.maxWords / 2 || text.length >= rules.maxChars / 2))) flush();
  }
  flush();
  // Short lines stay up a little longer, borrowing silence after them, never time from the next line.
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.end - c.start < rules.minCue) {
      const limit = i + 1 < cues.length ? cues[i + 1].start : Infinity;
      c.end = r2(Math.min(limit, c.start + rules.minCue));
    }
  }
  return cues.filter((c) => c.end - c.start >= 0.05 && c.text);
}

/** Lowercase, no punctuation; CJK split into single characters so Chinese and Japanese match too. */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().normalize("NFKC").matchAll(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]|[^\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]+/g)) {
    const t = m[0].replace(/[\p{P}\p{S}]+/gu, "");
    if (t) out.push(t);
  }
  return out;
}

/** Overlapping or touching ranges become one; sorted. */
export function mergeRanges(ranges: Range[], gap = 0.05): Range[] {
  const xs = ranges.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start).map((r) => ({ ...r })).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of xs) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + gap) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out.map((r) => ({ start: r2(r.start), end: r2(r.end) }));
}

/**
 * Clip by text (FunClip's core idea): find each phrase in the transcript and return the video ranges where it
 * was said, padded a little so a cut never clips the first or last sound. Several phrases: separate with #.
 * Every occurrence counts. Returns ranges and which phrases weren't found.
 */
export function findText(words: Word[], query: string, rules: SubtitleRules = DEFAULT_SUBTITLE_RULES, duration = Infinity): { ranges: Range[]; missing: string[] } {
  // Every word becomes one or more tokens that share its time span (CJK words split evenly).
  const toks: { t: string; s: number; e: number }[] = [];
  for (const w of words) {
    const ts = tokens(w.w);
    const step = (w.e - w.s) / Math.max(1, ts.length);
    ts.forEach((t, i) => toks.push({ t, s: w.s + step * i, e: w.s + step * (i + 1) }));
  }
  const found: Range[] = [];
  const missing: string[] = [];
  for (const phrase of query.split("#").map((p) => p.trim()).filter(Boolean)) {
    const q = tokens(phrase);
    if (!q.length) continue;
    let hit = false;
    for (let i = 0; i + q.length <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < q.length && ok; j++) ok = toks[i + j].t === q[j];
      if (ok) {
        hit = true;
        found.push({ start: Math.max(0, toks[i].s - rules.clipPad.before), end: Math.min(duration, toks[i + q.length - 1].e + rules.clipPad.after) });
      }
    }
    if (!hit) missing.push(phrase);
  }
  return { ranges: mergeRanges(found), missing };
}

/** Rough words from cues (when an engine only gave lines): each line's time split by character share. */
export function wordsFromCues(cues: Cue[]): Word[] {
  const out: Word[] = [];
  for (const c of cues) {
    const parts = c.text.split(/\s+/).filter(Boolean);
    const total = parts.reduce((t, p) => t + p.length, 0) || 1;
    let t = c.start;
    for (const p of parts) {
      const span = ((c.end - c.start) * p.length) / total;
      out.push({ w: p, s: r2(t), e: r2(t + span) });
      t += span;
    }
  }
  return out;
}

/**
 * FunASR output -> words. Accepts the AutoModel shape ([{ text, timestamp: [[ms, ms], ...], sentence_info? }]),
 * where each timestamp pairs with one spoken unit (a word, or one CJK character) and punctuation has none,
 * or a worker that already returns { words } / { cues }.
 */
export function wordsFromFunasr(res: unknown, offset = 0, duration = Infinity): Word[] {
  const body = res as any;
  if (Array.isArray(body?.words)) return cleanWords(body.words, offset, duration);
  if (Array.isArray(body?.cues)) return cleanWords(wordsFromCues(body.cues), offset, duration);
  const items: any[] = Array.isArray(body) ? body : Array.isArray(body?.result) ? body.result : body ? [body] : [];
  const raw: { w: string; s: number; e: number; spk?: number }[] = [];
  const pair = (text: string, stamps: unknown, spk?: number) => {
    if (typeof text !== "string" || !Array.isArray(stamps)) return;
    const units: string[] = [];
    for (const m of text.matchAll(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]|[^\s\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]+/g)) {
      const u = m[0];
      if (PUNCT_ONLY.test(u) && units.length) units[units.length - 1] += u;
      else if (PUNCT_ONLY.test(u)) continue;
      else units.push(u);
    }
    // A unit like "word," can still hold one stamp; a stray "," stamp-less token was folded above.
    const n = Math.min(units.length, stamps.length);
    for (let k = 0; k < n; k++) {
      const st = stamps[k] as unknown[];
      if (!Array.isArray(st) || st.length < 2) continue;
      raw.push({ w: units[k], s: Number(st[0]) / 1000, e: Number(st[1]) / 1000, ...(spk !== undefined ? { spk } : {}) });
    }
  };
  for (const it of items) {
    if (Array.isArray(it?.sentence_info) && it.sentence_info.length) for (const s of it.sentence_info) pair(s.text, s.timestamp, Number.isFinite(Number(s.spk)) ? Number(s.spk) : undefined);
    else pair(it?.text, it?.timestamp);
  }
  return cleanWords(raw, offset, duration);
}

/** Captions re-timed onto a cut: only the parts inside the kept ranges, shifted to the new timeline. */
export function shiftCues(cues: Cue[], ranges: Range[]): Cue[] {
  const out: Cue[] = [];
  let base = 0;
  for (const r of mergeRanges(ranges)) {
    for (const c of cues) {
      const s = Math.max(c.start, r.start);
      const e = Math.min(c.end, r.end);
      if (e - s >= 0.2) out.push({ start: r2(base + s - r.start), end: r2(base + e - r.start), text: c.text });
    }
    base += r.end - r.start;
  }
  return out;
}

export const rangesLength = (ranges: Range[]) => r2(mergeRanges(ranges).reduce((t, r) => t + r.end - r.start, 0));

/** The prompt FunClip's LLM clipping uses, in Outlly's voice: read the SRT, return self-contained moments. */
export function highlightPrompt(cues: Cue[], rules: SubtitleRules = DEFAULT_SUBTITLE_RULES) {
  const { count, minSec, maxSec } = rules.highlights;
  return {
    system: `You are a short-form video editor. You read a subtitle file and pick the moments worth cutting into their own clip: a strong hook, a surprising fact, a punchline, a clear takeaway. Each moment must make sense on its own without what came before.`,
    prompt: `Pick up to ${count} moments from this video. Each must be ${minSec} to ${maxSec} seconds long, start at the beginning of a subtitle line and end at the end of one, and not overlap another pick.
Return JSON {"clips":[{"start": seconds, "end": seconds, "title": "4 to 8 word label", "why": "one plain sentence on why it works"}]}, best first. Times are seconds as numbers, taken from the subtitle timestamps.

${toSrt(cues)}`,
  };
}

/** Trust nothing the model returns: clamp, snap to line edges, enforce length, drop overlaps, keep order. */
export function parseHighlights(raw: unknown, cues: Cue[], duration: number, rules: SubtitleRules = DEFAULT_SUBTITLE_RULES): Highlight[] {
  const list: any[] = Array.isArray((raw as any)?.clips) ? (raw as any).clips : Array.isArray(raw) ? (raw as any[]) : [];
  const { count, minSec, maxSec } = rules.highlights;
  const end = Number.isFinite(duration) && duration > 0 ? duration : cues.length ? cues[cues.length - 1].end : 0;
  // Nearest line edge; a model time far from any line (over 3 s) is kept as given.
  const snap = (t: number, edge: "start" | "end") => {
    let best = t, d = 3;
    for (const c of cues) if (Math.abs(c[edge] - t) < d) (d = Math.abs(c[edge] - t)), (best = c[edge]);
    return best;
  };
  const snapStart = (t: number) => snap(t, "start");
  const snapEnd = (t: number) => snap(t, "end");
  const out: Highlight[] = [];
  for (const x of list) {
    let s = toSeconds(x?.start);
    let e = toSeconds(x?.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    if (cues.length) {
      s = snapStart(s);
      e = snapEnd(e);
    }
    s = Math.max(0, s);
    e = Math.min(end || e, e);
    if (e - s < Math.min(minSec, end) - 0.5) continue;
    if (e - s > maxSec + 0.5) e = s + maxSec;
    if (out.some((h) => s < h.end && e > h.start)) continue;
    out.push({ start: r2(s), end: r2(e), title: String(x?.title ?? "Highlight").trim().slice(0, 80) || "Highlight", why: String(x?.why ?? "").trim().slice(0, 200) });
    if (out.length >= count) break;
  }
  return out;
}
