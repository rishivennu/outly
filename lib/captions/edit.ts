import { CAPTION_STYLES, toSeconds, type CaptionPos, type CaptionStyle, type Cue } from "./cues";

/** Shortest line the editor lets you make by hand. Shorter than this and nobody can read it. */
export const MIN_EDIT_CUE = 0.2;
export const NUDGE = 0.1;
export const MAX_CUE_TEXT = 120;

const round = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.005;

export type Edge = "start" | "end";
export type Bounds = { startMin: number; startMax: number; endMin: number; endMax: number };

/**
 * How far a line can move without touching its neighbours or leaving the clip. The list stays sorted and
 * never overlaps, so cueAt (a binary search) keeps finding the right line for the preview and the burn.
 */
export function cueBounds(cues: Cue[], i: number, duration: number): Bounds {
  const c = cues[i];
  const clipEnd = duration > 0 && Number.isFinite(duration) ? duration : Infinity;
  const startMin = i > 0 ? cues[i - 1].end : 0;
  const endMax = i < cues.length - 1 ? cues[i + 1].start : clipEnd;
  const startMax = Math.max(startMin, Math.min(c.end, endMax) - MIN_EDIT_CUE);
  const endMin = Math.min(endMax, Math.max(c.start, startMin) + MIN_EDIT_CUE);
  return { startMin: round(startMin), startMax: round(startMax), endMin: round(endMin), endMax: Number.isFinite(endMax) ? round(endMax) : endMax };
}

export type Retime = { ok: true; cues: Cue[]; value: number; clamped: boolean; bounds: Bounds } | { ok: false; error: string };

/** Moves one edge of line i to `value` seconds, clamped so it never overlaps a neighbour or gets too short. */
export function retimeCue(cues: Cue[], i: number, edge: Edge, value: number, duration: number): Retime {
  if (!cues[i]) return { ok: false, error: "That line is gone." };
  if (!Number.isFinite(value)) return { ok: false, error: "Type a time in seconds, like 2.5 or 0:02.5." };
  if (value < 0) return { ok: false, error: "Times start at 0." };
  const b = cueBounds(cues, i, duration);
  const [lo, hi] = edge === "start" ? [b.startMin, b.startMax] : [b.endMin, b.endMax];
  const v = round(Math.max(lo, Math.min(hi, value)));
  const clamped = Math.abs(v - value) > EPS;
  const next = cues.map((c, k) => (k === i ? { ...c, [edge]: v } : c));
  return { ok: true, cues: next, value: v, clamped, bounds: cueBounds(next, i, duration) };
}

export const nudgeCue = (cues: Cue[], i: number, edge: Edge, delta: number, duration: number): Retime =>
  cues[i] ? retimeCue(cues, i, edge, round(cues[i][edge] + delta), duration) : { ok: false, error: "That line is gone." };

/** What a person types into a time box: "2.5", "2,5", "2.5s", "0:02.5". NaN when it is not a time. */
export function parseTimeInput(s: string): number {
  const t = s.trim().replace(/\s*s(ec(onds?)?)?$/i, "");
  if (!t) return NaN;
  return toSeconds(t);
}

export const showSeconds = (s: number) => (Number.isFinite(s) ? s.toFixed(2) : "");

/** Reorder in a time-sorted list: the two lines swap words, the timing slots stay where the speech is. */
export function swapText(cues: Cue[], i: number, dir: -1 | 1): Cue[] | null {
  const j = i + dir;
  if (!cues[i] || !cues[j]) return null;
  return cues.map((c, k) => (k === i ? { ...c, text: cues[j].text } : k === j ? { ...c, text: cues[i].text } : c));
}

/**
 * Undo of a delete: the line goes back where it was. If another line has since taken part of its slot, it is
 * trimmed to the free part; if nothing usable is left, null (the caller says so instead of overlapping).
 */
export function restoreCue(cues: Cue[], cue: Cue): { cues: Cue[]; index: number } | null {
  const index = cues.filter((c) => c.start <= cue.start).length;
  const prevEnd = index > 0 ? cues[index - 1].end : 0;
  const nextStart = index < cues.length ? cues[index].start : Infinity;
  const start = round(Math.max(cue.start, prevEnd));
  const end = round(Math.min(cue.end, nextStart));
  if (end - start < MIN_EDIT_CUE - EPS) return null;
  return { cues: [...cues.slice(0, index), { ...cue, start, end }, ...cues.slice(index)], index };
}

export type CueIssue = { index: number; message: string };

/** What would make a burn or an .srt wrong. Empty list = good to go. */
export function cueIssues(cues: Cue[], duration: number): CueIssue[] {
  const out: CueIssue[] = [];
  const clipEnd = duration > 0 && Number.isFinite(duration) ? duration + EPS : Infinity;
  cues.forEach((c, i) => {
    const n = i + 1;
    if (!c.text.trim()) out.push({ index: i, message: `Line ${n} has no words. Type them or delete the line.` });
    if (!(c.end > c.start)) out.push({ index: i, message: `Line ${n} ends before it starts.` });
    if (c.start < 0 || c.end > clipEnd) out.push({ index: i, message: `Line ${n} runs past the end of the video.` });
    if (i > 0 && c.start < cues[i - 1].end - EPS) out.push({ index: i, message: `Line ${n} overlaps line ${i}.` });
  });
  return out;
}

/** The editor's whole caption state, as a device draft keeps it. */
export type CaptionTrack = { v: 1; cues: Cue[]; style: CaptionStyle; pos: CaptionPos };

const POS: CaptionPos[] = ["top", "middle", "bottom"];

/** Reads a stored track back defensively: anything malformed is dropped, the rest re-sorted without overlaps. */
export function readTrack(raw: unknown, duration = Infinity): CaptionTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.cues)) return null;
  const clipEnd = duration > 0 && Number.isFinite(duration) ? duration : Infinity;
  const cues: Cue[] = [];
  for (const c of r.cues as unknown[]) {
    const o = (c ?? {}) as Record<string, unknown>;
    const start = Number(o.start);
    const end = Math.min(Number(o.end), clipEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.05) continue;
    cues.push({ start: round(start), end: round(end), text: String(o.text ?? "").slice(0, MAX_CUE_TEXT) });
  }
  cues.sort((a, b) => a.start - b.start);
  const clean: Cue[] = [];
  for (const c of cues) {
    const prev = clean[clean.length - 1];
    const start = prev ? Math.max(c.start, prev.end) : c.start;
    if (c.end - start >= 0.05) clean.push({ ...c, start });
  }
  const style = CAPTION_STYLES.some((s) => s.id === r.style) ? (r.style as CaptionStyle) : "pop";
  const pos = POS.includes(r.pos as CaptionPos) ? (r.pos as CaptionPos) : "bottom";
  return { v: 1, cues: clean, style, pos };
}
