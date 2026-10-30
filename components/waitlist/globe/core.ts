import { isLand } from "./land";

/**
 * The dotted-Earth drawing kit (1061, shared since 1062): the waitlist globe (CanvasGlobe) and the admin live
 * globe (components/admin/live/LiveGlobe) draw the same Earth from these pieces, so they always match.
 */
export const TAU = Math.PI * 2;
export const TILT = 0.36; // the north leans toward you, so the populated half reads

export function norm(v: number[]) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l] as [number, number, number];
}
export const LIGHT = norm([-0.5, 0.55, 0.68]);

export const toVec = (lat: number, lng: number): [number, number, number] => {
  const p = (lat * Math.PI) / 180;
  const l = (lng * Math.PI) / 180;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
};

/** Land points of an evenly spread (Fibonacci) sphere, as a flat xyz array. */
export function landPoints(n: number) {
  const out: number[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const t = g * i;
    const x = Math.cos(t) * r;
    const z = Math.sin(t) * r;
    const lat = (Math.asin(y) * 180) / Math.PI;
    const lng = (Math.atan2(x, z) * 180) / Math.PI;
    if (isLand(lat, lng)) out.push(x, y, z);
  }
  return new Float32Array(out);
}

// Brand palette only: lime (logo top) to green (logo base), on a deep green-black body.
export const DOT_BUCKETS = 6;
export const DOT_FILL = Array.from({ length: DOT_BUCKETS }, (_, i) => {
  const k = i / (DOT_BUCKETS - 1); // 0 = limb / shade, 1 = lit centre
  const r = Math.round(30 + k * (205 - 30));
  const g = Math.round(200 + k * (255 - 200));
  const b = Math.round(70 + k * (40 - 70));
  return `rgba(${r},${g},${b},${(0.28 + k * 0.72).toFixed(3)})`;
});

/** Turns a unit vector by yaw (cy/sy) then tilt (ct/st). Reads v[i..i+2], writes out[0..2]. */
export function rot(v: ArrayLike<number>, i: number, cy: number, sy: number, ct: number, st: number, out: number[]) {
  const x = v[i];
  const y = v[i + 1];
  const z = v[i + 2];
  const x1 = x * cy + z * sy;
  const z1 = z * cy - x * sy;
  out[0] = x1;
  out[1] = y * ct - z1 * st;
  out[2] = y * st + z1 * ct;
}

/** The parts that never move (glow, body, rim), drawn once per size into an offscreen canvas, then blitted. */
export function paintBase(w: number, h: number, R: number, dpr: number) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const b = c.getContext("2d")!;
  b.scale(dpr, dpr);
  const cx = w / 2;
  const cy = h / 2;
  const glow = b.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.42);
  glow.addColorStop(0, "rgba(170,255,60,0.30)");
  glow.addColorStop(0.35, "rgba(90,235,70,0.12)");
  glow.addColorStop(1, "rgba(40,200,60,0)");
  b.fillStyle = glow;
  b.fillRect(0, 0, w, h);
  const body = b.createRadialGradient(cx - R * 0.38, cy - R * 0.42, R * 0.1, cx, cy, R * 1.05);
  body.addColorStop(0, "#123d17");
  body.addColorStop(0.55, "#0a2410");
  body.addColorStop(1, "#04120a");
  b.beginPath();
  b.arc(cx, cy, R, 0, TAU);
  b.fillStyle = body;
  b.fill();
  const rim = b.createRadialGradient(cx, cy, R * 0.78, cx, cy, R);
  rim.addColorStop(0, "rgba(160,255,60,0)");
  rim.addColorStop(1, "rgba(160,255,60,0.22)");
  b.fillStyle = rim;
  b.fill();
  b.lineWidth = 1.2;
  b.strokeStyle = "rgba(190,255,80,0.45)";
  b.stroke();
  return c;
}

/** Land dots for one frame, batched by brightness: six fills a frame. */
export function drawLand(ctx: CanvasRenderingContext2D, pts: Float32Array, cx: number, cy: number, r: number, cyaw: number, syaw: number, ct: number, st: number) {
  const v = [0, 0, 0];
  const ds = Math.max(1, r / 190);
  const paths = Array.from({ length: DOT_BUCKETS }, () => new Path2D());
  for (let i = 0; i < pts.length; i += 3) {
    rot(pts, i, cyaw, syaw, ct, st, v);
    const z = v[2];
    if (z <= 0.02) continue;
    const lit = Math.max(0, v[0] * LIGHT[0] + v[1] * LIGHT[1] + z * LIGHT[2]);
    const bright = Math.min(1, 0.15 + z * 0.45 + lit * 0.5);
    const bi = Math.min(DOT_BUCKETS - 1, Math.floor(bright * DOT_BUCKETS));
    const s = ds * (0.9 + z * 0.9);
    paths[bi].rect(cx + v[0] * r - s / 2, cy - v[1] * r - s / 2, s, s);
  }
  for (let b = 0; b < DOT_BUCKETS; b++) {
    ctx.fillStyle = DOT_FILL[b];
    ctx.fill(paths[b]);
  }
}
