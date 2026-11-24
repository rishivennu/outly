import { OUT_H, OUT_W } from "./settings-core";

/**
 * R1321: 9:16 reframing maths, v1. A landscape or square source is cropped to a vertical window the creator can
 * slide left or right (x 0..1, 0.5 = centre), or shown whole over a blurred copy of itself (pillarbox). Speaker
 * tracking is a v2 worker feature; nothing here claims it.
 */

export type ReframeMode = "crop" | "pillarbox";

export interface ReframePlan {
  mode: ReframeMode;
  /** Horizontal position of the crop window, 0 = left edge, 1 = right edge, 0.5 = centre. */
  x: number;
  /** Vertical position for a source taller than 9:16 (rare). */
  y: number;
}

export const DEFAULT_REFRAME: ReframePlan = { mode: "crop", x: 0.5, y: 0.5 };

const unit = (v: unknown, d: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
};

export function reframeOf(input: unknown): ReframePlan {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return { mode: o.mode === "pillarbox" ? "pillarbox" : "crop", x: unit(o.x, 0.5), y: unit(o.y, 0.5) };
}

export function parseReframe(raw: string | null | undefined): ReframePlan {
  if (!raw) return { ...DEFAULT_REFRAME };
  try {
    return reframeOf(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_REFRAME };
  }
}

export interface Draw {
  /** Source rectangle to read. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination rectangle on the OUT_W x OUT_H canvas. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  /** For pillarbox: the source is also drawn blurred and scaled to fill the canvas behind the picture. */
  backdrop: boolean;
}

/** The draw rectangles for one frame of a w x h source under the plan. Integer pixels, never outside the source. */
export function drawFor(w: number, h: number, plan: ReframePlan): Draw {
  const W = Math.max(1, Math.floor(w));
  const H = Math.max(1, Math.floor(h));
  const target = OUT_W / OUT_H;
  const src = W / H;
  if (plan.mode === "pillarbox" || Math.abs(src - target) < 0.01) {
    // Whole picture, fitted inside the frame; bars (or the blurred backdrop) fill the rest.
    const scale = Math.min(OUT_W / W, OUT_H / H);
    const dw = Math.round(W * scale);
    const dh = Math.round(H * scale);
    return { sx: 0, sy: 0, sw: W, sh: H, dx: Math.round((OUT_W - dw) / 2), dy: Math.round((OUT_H - dh) / 2), dw, dh, backdrop: plan.mode === "pillarbox" && Math.abs(src - target) >= 0.01 };
  }
  if (src > target) {
    // Wider than 9:16 (landscape, square): full height, a vertical window slid by x.
    const sw = Math.max(1, Math.round(H * target));
    const sx = Math.round((W - sw) * plan.x);
    return { sx, sy: 0, sw, sh: H, dx: 0, dy: 0, dw: OUT_W, dh: OUT_H, backdrop: false };
  }
  // Taller than 9:16: full width, a horizontal window slid by y.
  const sh = Math.max(1, Math.round(W / target));
  const sy = Math.round((H - sh) * plan.y);
  return { sx: 0, sy, sw: W, sh, dx: 0, dy: 0, dw: OUT_W, dh: OUT_H, backdrop: false };
}

/** How much of the source width the crop keeps (1 = all), for the editor's note. */
export const keptShare = (w: number, h: number, plan: ReframePlan): number => {
  const d = drawFor(w, h, plan);
  return Math.round(((d.sw * d.sh) / (Math.max(1, Math.floor(w)) * Math.max(1, Math.floor(h)))) * 100) / 100;
};
