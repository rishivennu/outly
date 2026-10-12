/** Caption cues: pure helpers shared by the transcribe API, the editor and the in-browser burner. */
export interface Cue {
  start: number; // seconds
  end: number;
  text: string;
}

export const MAX_CUE_CHARS = 42; // two short lines on a 9:16 frame
export const MIN_CUE = 0.6;

/** "1:02.5", "00:01:02,500", "62.5", 62.5 -> seconds. NaN when unreadable. */
export function toSeconds(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const s = v.trim().replace(",", ".");
  if (/^\d+(\.\d+)?s?$/.test(s)) return parseFloat(s);
  const parts = s.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((t, n) => t * 60 + n, 0);
}

/** Break long text into chunks that fit one cue, on word boundaries. */
export function chunkText(text: string, max = MAX_CUE_CHARS): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > max) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Clean whatever the model (or a person) gave us: drop blanks, sort, clamp to the clip, split long cues
 * proportionally to their characters, and stop overlaps so only one cue shows at a time.
 */
export function normalizeCues(raw: { start: unknown; end: unknown; text: unknown }[], duration = Infinity, offset = 0): Cue[] {
  const cues: Cue[] = [];
  for (const r of raw ?? []) {
    const text = String(r?.text ?? "").replace(/\s+/g, " ").trim();
    let start = toSeconds(r?.start) + offset;
    let end = toSeconds(r?.end) + offset;
    if (!text || !Number.isFinite(start)) continue;
    if (!Number.isFinite(end) || end <= start) end = start + Math.max(MIN_CUE, text.length / 15);
    start = Math.max(0, start);
    end = Math.min(duration, end);
    if (end - start < 0.05) continue;
    const parts = chunkText(text);
    const total = parts.reduce((t, p) => t + p.length, 0);
    let t = start;
    for (const p of parts) {
      const span = ((end - start) * p.length) / total;
      cues.push({ start: round(t), end: round(t + span), text: p });
      t += span;
    }
  }
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length - 1; i++) if (cues[i].end > cues[i + 1].start) cues[i].end = cues[i + 1].start;
  return cues.filter((c) => c.end - c.start >= 0.05);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The cue on screen at time t, or null. Cues are sorted. */
export function cueAt(cues: Cue[], t: number): Cue | null {
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return c;
  }
  return null;
}

/** Spread a typed script evenly across the clip, for creators without AI (or who already have a script). */
export function cuesFromScript(script: string, duration: number): Cue[] {
  const chunks = script.split(/\n+/).flatMap((l) => chunkText(l)).filter(Boolean);
  if (!chunks.length || !(duration > 0)) return [];
  const total = chunks.reduce((t, c) => t + c.length, 0);
  let t = 0;
  return chunks.map((text) => {
    const span = (duration * text.length) / total;
    const c = { start: round(t), end: round(t + span), text };
    t += span;
    return c;
  });
}

const stamp = (s: number) => {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** SubRip file, for platforms (YouTube) that take a caption track instead of burned-in text. */
export function toSrt(cues: Cue[]) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join("\n");
}

/** Greedy line wrap by measured width. `measure` is ctx.measureText(...).width in the burner. */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines = 2): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next) > maxWidth) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  return [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(" ")];
}

export type CaptionStyle = "pop" | "box" | "clean";
export type CaptionPos = "bottom" | "middle" | "top";
export const CAPTION_STYLES: { id: CaptionStyle; label: string }[] = [
  { id: "pop", label: "Bold pop" },
  { id: "box", label: "Boxed" },
  { id: "clean", label: "Clean" },
];
