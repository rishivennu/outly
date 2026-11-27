/**
 * R1341: the kiln's arithmetic, DOM-free so tests can run it. HeatField.tsx owns the canvas, the pointer and the clock;
 * everything here is a pure function of (cell, time, state).
 *
 * The field is a grid of CELL px squares with a GAP between them. Each cell has a heat 0..1 which the palette turns
 * into one of five bands (below the first threshold the cell is clear and the stage shows through). Heat comes from:
 * a slow domain-warped noise cloud (capped at CLOUD_CAP, so the cloud alone never reaches the hottest bands),
 * two wandering glow blobs, a body gradient (warmer at the top), the pointer's own heat (deposited and cooling,
 * HeatField keeps that buffer), a click burst that rides out as a ring, grain, and the spelled word, whose letters
 * are forced hot and whose outline is cooled so it reads against the cloud.
 */

export const CELL = 10;
export const GAP = 1;
export const PITCH = CELL + GAP;
export const FPS = 30;
export const DPR_CAP = 2;

/** Outlly's kiln: indigo, blue, the brand cyan, lime, then the pale lime the pointer leaves behind. */
export const THRESHOLDS = [0.3, 0.44, 0.6, 0.76, 0.9] as const;
export const COLORS = ["#2b3a7c", "#1f7fb8", "#17b3c4", "#7fe03a", "#d9ff5c"] as const;

export const CLOUD_CAP = 0.72;
/** Letters sit in the lime band, always under the top threshold, so the pointer still reads as hotter than the word. */
export const WORD_HEAT = 0.84;
export const OUTLINE_COOL = 0.16;
export const WORD_GAP_CELLS = 18;
export const WORD_SPEED = 8; // cells per second
export const DRIP_PX = 160;
export const DRIP_PX_PHONE = 66;
export const REVEAL_SEC = 1.4;

export const POINTER = { radiusPx: 96, strength: 0.45, cooling: 0.972, idleAfterMs: 2500 } as const;
export const BURST = { reachPx: 340, seconds: 1.1, strength: 0.6, widthPx: 36 } as const;
export const BLOB = { sizePx: 160, strength: 0.36 } as const;

/** The three intensity levels behind the −, pause and + buttons. */
export const LEVELS = [
  { heat: -0.08, speed: 0.6 },
  { heat: 0, speed: 1 },
  { heat: 0.09, speed: 1.7 },
] as const;
export const LEVEL_DEFAULT = 1;
export const clampLevel = (n: number) => Math.min(LEVELS.length - 1, Math.max(0, Math.round(n)));

/** Palette band for a heat value: -1 means clear. */
export function band(heat: number): number {
  let b = -1;
  for (let i = 0; i < THRESHOLDS.length; i++) if (heat >= THRESHOLDS[i]) b = i;
  return b;
}

const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
export const RGB: readonly [number, number, number][] = COLORS.map(hexRgb);

/* ---- value noise -------------------------------------------------------------------------------------------- */

/** Deterministic hash of an integer lattice point to 0..1 (a spin on the classic sine hash, kept integer-friendly). */
export function hash2(x: number, y: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Bilinear value noise, 0..1. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** Three octaves, normalised to 0..1. */
export function fbm(x: number, y: number): number {
  let v = 0, amp = 0.5, f = 1, sum = 0;
  for (let o = 0; o < 3; o++) {
    v += amp * noise2(x * f, y * f);
    sum += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return v / sum;
}

/** The cloud: domain-warped fbm drifting with time, contrast .9 around warmth .42, capped so it stays a cloud. */
export function cloud(cx: number, cy: number, t: number): number {
  const q = fbm(cx * 0.045 + t * 0.07, cy * 0.08 + t * 0.05);
  const n = fbm(cx * 0.045 + 1.7 * q + t * 0.03, cy * 0.08 + 1.3 * q - t * 0.04);
  return Math.min(CLOUD_CAP, (n - 0.5) * 0.9 + 0.42);
}

/** Two glow blobs wandering on sine paths, in cell units. On a narrow field (phones) they shrink with it, else they would flood it. */
export function blobs(cx: number, cy: number, t: number, cols: number, rows: number, speed: number): number {
  const sigma = Math.min(BLOB.sizePx / PITCH, cols * 0.12);
  const k = -1 / (2 * sigma * sigma);
  let v = 0;
  for (let i = 0; i < 2; i++) {
    const ph = i * 2.1;
    const bx = cols * (0.5 + 0.36 * Math.sin(t * speed * 0.21 + ph));
    const by = rows * (0.45 + 0.3 * Math.cos(t * speed * 0.17 + ph * 1.7));
    const dx = cx - bx, dy = cy - by;
    v += BLOB.strength * Math.exp((dx * dx + dy * dy) * k);
  }
  return v;
}

/** Warmer at the top of the field, fading down. */
export const body = (cy: number, rows: number) => 0.1 * (1 - cy / Math.max(1, rows));

/** Click burst: a ring riding out to BURST.reachPx over BURST.seconds, fading as it goes. 0 once it is spent. */
export function burst(cx: number, cy: number, bx: number, by: number, age: number): number {
  const p = age / BURST.seconds;
  if (p <= 0 || p >= 1) return 0;
  const eased = 1 - Math.pow(1 - p, 3);
  const r = (BURST.reachPx / PITCH) * eased;
  const w = BURST.widthPx / PITCH;
  const d = Math.hypot(cx - bx, cy - by) - r;
  return BURST.strength * Math.exp(-(d * d) / (2 * w * w)) * (1 - p);
}

/** Film grain, ±0.03, new every frame. */
export const grain = (cx: number, cy: number, frame: number) => (hash2(cx * 7 + frame * 131, cy * 13 + frame * 17) - 0.5) * 0.06;

/**
 * The ragged bottom edge: for a 4-cell column group, the row where the field ends (inclusive of fieldRows..fieldRows+dripRows).
 * Noise-driven and slowly moving, so the drips crawl.
 */
export function dripCut(cx: number, t: number, fieldRows: number, dripRows: number): number {
  const g = Math.floor(cx / 4);
  const n = fbm(g * 0.35 + 11.3, t * 0.1);
  const shaped = Math.pow(Math.max(0, (n - 0.35) / 0.65), 1.5);
  return fieldRows + Math.round(dripRows * shaped);
}

export interface Field {
  cols: number;
  rows: number;
  fieldRows: number;
  dripRows: number;
}

/** Grid for a CSS-pixel box; the drip rows sit below the field proper. */
export function layout(widthPx: number, fieldPx: number, phone: boolean): Field {
  const cols = Math.max(1, Math.ceil(widthPx / PITCH));
  const fieldRows = Math.max(1, Math.floor(fieldPx / PITCH));
  const dripRows = Math.max(2, Math.round((phone ? DRIP_PX_PHONE : DRIP_PX) / PITCH));
  return { cols, rows: fieldRows + dripRows, fieldRows, dripRows };
}

/** 1-cell dilation of the letter mask (2) into an outline (1); 0 stays 0. */
export function outline(mask: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (mask[y * cols + x] !== 0) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (mask[ny * cols + nx] === 2) { near = true; break; }
        }
      }
      if (near) out[y * cols + x] = 1;
    }
  }
  return out;
}

/** Apply the word mask to a heat value. */
export function withWord(heat: number, m: number): number {
  if (m === 2) return Math.min(THRESHOLDS[THRESHOLDS.length - 1] - 0.01, Math.max(heat, WORD_HEAT));
  if (m === 1) return heat - OUTLINE_COOL;
  return heat;
}

/** Rows revealed so far: the field grows top to down (eased by GSAP in HeatField). */
export const revealedRows = (reveal: number, rows: number) => Math.ceil(Math.min(1, Math.max(0, reveal)) * rows);
