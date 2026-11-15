import type { Cue } from "./cues";
import type { Word } from "./subtitle-engine";

/**
 * Timestamps come from the model and can sit a little early or late on the whole clip. One shift moves every
 * line on both tracks at once; the stored line times never change, the shift is applied when lines are shown,
 * burned or exported.
 */
export const MAX_OFFSET = 2;
export const OFFSET_STEP = 0.1;

const tenth = (n: number) => Math.round(n * 10) / 10;
const round = (n: number) => Math.round(n * 100) / 100;

/** Any input to a shift in range, on the 0.1 s grid. Not a number = no shift. */
export function clampOffset(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const c = tenth(Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, n)));
  return c === 0 ? 0 : c;
}

export const stepOffset = (v: number, dir: -1 | 1, step = OFFSET_STEP) => clampOffset(tenth(v) + dir * step);

/** "+0.3 s", "-1.2 s", "0.0 s". A plain hyphen for minus, so screen readers and copy rules agree. */
export const showOffset = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(clampOffset(v)).toFixed(1)} s`;

/** Spoken form for aria-valuetext. */
export const sayOffset = (v: number) => {
  const c = clampOffset(v);
  if (!c) return "No shift";
  return `${Math.abs(c).toFixed(1)} seconds ${c > 0 ? "later" : "earlier"}`;
};

/**
 * The lines as they play on the video: same count and order as `cues` (so a row index still names the same
 * line), each moved by `offset` and kept inside the clip. A line pushed fully off the clip ends up empty.
 */
export function offsetCues(cues: Cue[], offset: number, duration = Infinity): Cue[] {
  const d = clampOffset(offset);
  if (!d) return cues;
  const end = duration > 0 && Number.isFinite(duration) ? duration : Infinity;
  return cues.map((c) => {
    const s = round(Math.min(end, Math.max(0, c.start + d)));
    const e = round(Math.min(end, Math.max(s, c.end + d)));
    return { ...c, start: s, end: e };
  });
}

/** What a burn, a cut or an .srt gets: the shifted lines, minus any that the shift pushed off the clip. */
export const exportCues = (cues: Cue[], offset: number, duration = Infinity): Cue[] => offsetCues(cues, offset, duration).filter((c) => c.end - c.start >= 0.05);

/** Word times move with the lines, so cutting by text cuts where the shifted captions say. */
export function offsetWords(words: Word[], offset: number, duration = Infinity): Word[] {
  const d = clampOffset(offset);
  if (!d) return words;
  const end = duration > 0 && Number.isFinite(duration) ? duration : Infinity;
  return words
    .map((w) => {
      const s = round(Math.min(end, Math.max(0, w.s + d)));
      return { ...w, s, e: round(Math.min(end, Math.max(s, w.e + d))) };
    })
    .filter((w) => w.e > w.s);
}
