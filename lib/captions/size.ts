/**
 * Caption size and face. The size is a percentage of each style's base size (100 = as before), kept with the
 * track so a draft and the burn agree. The face is Poppins Bold with tight tracking: -2% of the size, so the
 * same look at every frame size, in the live preview and in the burned video.
 */
export const SIZE_MIN = 60;
export const SIZE_MAX = 160;
export const SIZE_STEP = 10;
export const SIZE_BASE = 100;

/** Any input to a size in range, on the 10% grid. Not a number = the base size. */
export function clampSize(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return SIZE_BASE;
  return Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(n / SIZE_STEP) * SIZE_STEP));
}

export const stepSize = (v: number, dir: -1 | 1) => clampSize(clampSize(v) + dir * SIZE_STEP);

/** "100%" */
export const showSize = (v: number) => `${clampSize(v)}%`;

/** Spoken form for aria-valuetext. */
export const saySize = (v: number) => {
  const c = clampSize(v);
  return c === SIZE_BASE ? "Normal size" : `${c} percent`;
};

/** The caption face. `family` is the loaded Poppins family name (next/font gives it a hashed name); the system faces cover scripts Poppins lacks. */
export const CAPTION_WEIGHT = 700;
export const CAPTION_TRACKING = -0.02;
export const captionFont = (px: number, family?: string) => `${CAPTION_WEIGHT} ${px}px ${family ? `${family}, ` : ""}Poppins, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
export const captionTracking = (px: number) => `${(px * CAPTION_TRACKING).toFixed(2)}px`;
