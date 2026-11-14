import type { Cue } from "./cues";

const MIN = 0.3;
const LEN = 2;

/**
 * Where a new caption goes: the first free gap at or after the playhead, else the first free gap anywhere,
 * else the line under the playhead (or the longest one) is split in two. Never overlaps another line, so
 * cueAt (a binary search over sorted, non-overlapping cues) stays right. Returns null if there is no room.
 */
export function insertCue(cues: Cue[], at: number, duration: number, text = "New caption"): { cues: Cue[]; index: number } | null {
  const end = duration > 0 && Number.isFinite(duration) ? duration : Infinity;
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const gaps: [number, number][] = [];
  let edge = 0;
  for (const c of sorted) {
    if (c.start - edge > 0) gaps.push([edge, c.start]);
    edge = Math.max(edge, c.end);
  }
  if (end - edge > 0) gaps.push([edge, end]);

  const fit = (a: number, b: number, from: number) => {
    const s = Math.max(a, from);
    return b - s >= MIN ? { start: s, end: Math.min(b, s + LEN) } : null;
  };
  const t = Math.max(0, Math.min(at, end));
  let slot: { start: number; end: number } | null = null;
  for (const [a, b] of gaps) if (b > t && (slot = fit(a, b, t))) break;
  if (!slot) for (const [a, b] of gaps) if ((slot = fit(a, b, a))) break;

  if (slot) {
    const cue = { start: round(slot.start), end: round(slot.end), text };
    const index = sorted.filter((c) => c.start <= cue.start).length;
    return { cues: [...sorted.slice(0, index), cue, ...sorted.slice(index)], index };
  }

  // No gap: split the line on screen (or the longest) at its middle.
  let i = sorted.findIndex((c) => t >= c.start && t < c.end);
  if (i < 0 || sorted[i].end - sorted[i].start < MIN * 2) {
    i = -1;
    sorted.forEach((c, k) => { if (c.end - c.start >= MIN * 2 && (i < 0 || c.end - c.start > sorted[i].end - sorted[i].start)) i = k; });
  }
  if (i < 0) return null;
  const c = sorted[i];
  const mid = round((c.start + c.end) / 2);
  const next = [...sorted];
  next.splice(i, 1, { ...c, end: mid }, { start: mid, end: c.end, text });
  return { cues: next, index: i + 1 };
}

const round = (n: number) => Math.round(n * 100) / 100;
