"use client";
import { useEffect, useRef } from "react";
import { gsap, useGSAP, MOTION_OK } from "@/lib/motion/gsap";
import { reduced, simple } from "@/lib/motion/prefs";
import * as H from "./heat";

/**
 * R1341: the kiln. A grid of 10 px cells painted from a heat value per cell (heat.ts has the arithmetic), drawn on a
 * canvas at 30 fps (20 on phones) only while it is on screen and the tab is visible. The pointer leaves heat that
 * cools; a click sends a ring out; with no pointer for a while (or no fine pointer at all) a ghost wanders so the
 * field never sits still. The word in `word` is spelled in the pixels and scrolls across.
 *
 * GSAP owns every time curve that is not the field's own clock: the reveal (the field grows top to down over
 * REVEAL_SEC once `armed`, power3.out) and the intensity (heat and speed glide to the chosen level). Reduced motion
 * draws one finished frame and never starts the loop. Decorative: aria-hidden, the text alternative is in the DOM.
 */
export function HeatField({ word, level, paused, armed, height, className }: { word: string; level: number; paused: boolean; armed: boolean; height: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const st = useRef<Engine | null>(null);

  // One engine per mounted canvas; it reads the DOM it needs and owns the rAF loop.
  useEffect(() => {
    const el = box.current, cv = canvas.current;
    if (!el || !cv) return;
    const e = new Engine(cv, el, word);
    st.current = e;
    e.mount();
    return () => { e.unmount(); st.current = null; };
  }, [word]);

  useEffect(() => { st.current?.setHeight(height); }, [height]);
  useEffect(() => { st.current?.setPaused(paused); }, [paused]);

  // Reveal: an object tween on the engine's state, so the field itself stays a pure function of (cell, time, reveal).
  useGSAP(() => {
    const e = st.current;
    if (!e || !armed) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.to(e.s, { reveal: 1, duration: H.REVEAL_SEC, ease: "power3.out", overwrite: "auto" });
    });
    mm.add("(prefers-reduced-motion: reduce)", () => {
      e.s.reveal = 1;
      e.still();
    });
  }, { dependencies: [armed] });

  // Intensity: heat and speed glide to the level (reduced motion: set and redraw the one frame).
  useGSAP(() => {
    const e = st.current;
    if (!e) return;
    const L = H.LEVELS[H.clampLevel(level)];
    if (reduced()) {
      e.s.heat = L.heat;
      e.s.speed = L.speed;
      e.still();
      return;
    }
    gsap.to(e.s, { heat: L.heat, speed: L.speed, duration: 0.6, ease: "power2.out", overwrite: "auto" });
  }, { dependencies: [level] });

  return (
    <div ref={box} aria-hidden="true" className={className ? `ek-field ${className}` : "ek-field"} style={{ height }}>
      <canvas ref={canvas} />
    </div>
  );
}

interface Burst { x: number; y: number; at: number }

class Engine {
  /** Tweened by GSAP: keep it a plain object. */
  s = { reveal: 0, heat: 0, speed: 1 };
  private ctx: CanvasRenderingContext2D | null;
  private off = document.createElement("canvas");
  private octx: CanvasRenderingContext2D | null;
  private img: ImageData | null = null;
  private field: H.Field = { cols: 1, rows: 1, fieldRows: 1, dripRows: 1 };
  private widthPx = 0;
  private heightPx = 0;
  private dpr = 1;
  private buf = new Float32Array(1);
  private bufHot = false;
  private mask: Uint8Array | null = null;
  private maskPeriod = 0;
  private maskRows = 0;
  private maskTop = 0;
  private wordOff = 0;
  private t = 0;
  private frame = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private seen = true;
  private visible = !document.hidden;
  private paused = false;
  private frozen = false;
  private lite = simple();
  private fine = typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches;
  private px = -1;
  private py = -1;
  private pointerAt = -Infinity;
  private bursts: Burst[] = [];
  private ro: ResizeObserver | null = null;
  private io: IntersectionObserver | null = null;
  private font = "";

  constructor(private cv: HTMLCanvasElement, private box: HTMLElement, private word: string) {
    this.ctx = cv.getContext("2d");
    this.octx = this.off.getContext("2d", { willReadFrequently: true });
    const fam = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
    this.font = `600 100px ${fam ? `${fam}, ` : ""}"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif`;
  }

  mount() {
    const stage = this.box.parentElement ?? this.box;
    stage.addEventListener("pointermove", this.onMove);
    stage.addEventListener("pointerdown", this.onDown);
    stage.addEventListener("pointerleave", this.onLeave);
    document.addEventListener("visibilitychange", this.onVis);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.box);
    this.io = new IntersectionObserver((es) => { this.seen = es.some((x) => x.isIntersecting); this.sync(); }, { rootMargin: "80px" });
    this.io.observe(this.box);
    this.frozen = reduced();
    this.resize();
    this.sync();
  }

  unmount() {
    const stage = this.box.parentElement ?? this.box;
    stage.removeEventListener("pointermove", this.onMove);
    stage.removeEventListener("pointerdown", this.onDown);
    stage.removeEventListener("pointerleave", this.onLeave);
    document.removeEventListener("visibilitychange", this.onVis);
    this.ro?.disconnect();
    this.io?.disconnect();
    this.stop();
  }

  setHeight(h: number) { if (h !== this.heightPx) this.resize(); }
  setPaused(p: boolean) { this.paused = p; this.sync(); }

  /** Reduced motion: one finished frame, no loop. Also used after a level change or resize in that mode. */
  still() {
    this.frozen = true;
    this.stop();
    this.t = 3;
    this.draw();
  }

  private onVis = () => { this.visible = !document.hidden; this.sync(); };
  private onLeave = () => { this.px = this.py = -1; };
  private onMove = (e: PointerEvent) => {
    if (this.frozen || this.paused) return;
    const r = this.cv.getBoundingClientRect();
    const x = (e.clientX - r.left) / H.PITCH, y = (e.clientY - r.top) / H.PITCH;
    const now = performance.now();
    if (this.px >= 0 && now - this.pointerAt < 200) this.stroke(this.px, this.py, x, y, H.POINTER.strength);
    else this.stamp(x, y, H.POINTER.strength);
    this.px = x; this.py = y; this.pointerAt = now;
  };
  private onDown = (e: PointerEvent) => {
    if (this.frozen || this.paused) return;
    if ((e.target as Element | null)?.closest("a, button, input, [role=button]")) return; // the controls and links are not the kiln
    const r = this.cv.getBoundingClientRect();
    this.bursts.push({ x: (e.clientX - r.left) / H.PITCH, y: (e.clientY - r.top) / H.PITCH, at: this.t });
    if (this.bursts.length > 6) this.bursts.shift();
  };

  private sync() {
    const go = !this.frozen && !this.paused && this.seen && this.visible && this.heightPx > 0;
    if (go && !this.running) this.start();
    else if (!go && this.running) this.stop();
  }
  private start() { this.running = true; this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
  private stop() { this.running = false; cancelAnimationFrame(this.raf); }

  private resize() {
    const w = this.box.clientWidth, h = this.box.clientHeight;
    if (!w || !h) return;
    this.widthPx = w; this.heightPx = h;
    this.dpr = Math.min(H.DPR_CAP, window.devicePixelRatio || 1);
    const drip = this.lite ? H.DRIP_PX_PHONE : H.DRIP_PX;
    this.field = H.layout(w, Math.max(H.PITCH, h - drip), this.lite);
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(h * this.dpr);
    this.off.width = this.field.cols;
    this.off.height = this.field.rows;
    this.img = this.octx ? this.octx.createImageData(this.field.cols, this.field.rows) : null;
    this.buf = new Float32Array(this.field.cols * this.field.rows);
    this.bufHot = false;
    this.buildMask();
    if (this.frozen) this.draw();
    else this.sync();
  }

  /** The word as a cell mask: letters 2, a one-cell outline 1. Built once per size; the field scrolls through it. */
  private buildMask() {
    const { cols, fieldRows } = this.field;
    const c = document.createElement("canvas");
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g || !this.word) { this.mask = null; return; }
    g.font = this.font;
    const perPx = g.measureText(this.word).width / 100; // text width per px of font size
    let rows = Math.max(4, Math.floor(fieldRows * 0.5));
    let fontPx = rows / 0.72;
    if (perPx * fontPx > cols * 0.86) {
      fontPx = (cols * 0.86) / perPx;
      rows = Math.max(4, Math.floor(fontPx * 0.72));
    }
    const textCols = Math.ceil(perPx * fontPx);
    const period = textCols + H.WORD_GAP_CELLS;
    c.width = period; c.height = rows;
    g.font = this.font.replace("100px", `${fontPx}px`);
    g.fillStyle = "#fff";
    g.textBaseline = "alphabetic";
    g.fillText(this.word, 0, (rows + fontPx * 0.72) / 2);
    const d = g.getImageData(0, 0, period, rows).data;
    const m = new Uint8Array(period * rows);
    for (let i = 0; i < m.length; i++) if (d[i * 4 + 3] > 110) m[i] = 2;
    this.mask = H.outline(m, period, rows);
    this.maskPeriod = period;
    this.maskRows = rows;
    this.maskTop = Math.floor((fieldRows - rows) / 2);
  }

  private stamp(x: number, y: number, strength: number) {
    const { cols, rows } = this.field;
    const r = (this.lite ? H.POINTER.radiusPx * 0.66 : H.POINTER.radiusPx) / H.PITCH;
    const k = -1 / (2 * (r * 0.5) * (r * 0.5));
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(cols - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(rows - 1, Math.ceil(y + r));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const dx = cx + 0.5 - x, dy = cy + 0.5 - y;
        const i = cy * cols + cx;
        this.buf[i] = Math.min(1, this.buf[i] + strength * Math.exp((dx * dx + dy * dy) * k));
      }
    }
    this.bufHot = true;
  }
  private stroke(x0: number, y0: number, x1: number, y1: number, strength: number) {
    const step = H.POINTER.radiusPx / H.PITCH / 2;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let i = 1; i <= n; i++) this.stamp(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, strength / Math.sqrt(n));
  }

  private tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const fps = this.lite ? 20 : H.FPS;
    const ms = now - this.last;
    if (ms < 1000 / fps) return;
    this.last = now - (ms % (1000 / fps));
    const dt = Math.min(0.1, ms / 1000);
    this.t += dt * this.s.speed;
    this.frame++;
    this.wordOff += dt * H.WORD_SPEED * this.s.speed;
    if (this.bufHot) {
      const f = Math.pow(H.POINTER.cooling, dt * 60);
      let max = 0;
      for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] *= f); if (v > max) max = v; }
      if (max < 0.004) { this.buf.fill(0); this.bufHot = false; }
    }
    // Nobody at the kiln: a ghost wanders so the field never sits still.
    if (!this.fine || now - this.pointerAt > H.POINTER.idleAfterMs) {
      const { cols, fieldRows } = this.field;
      const gx = cols * (0.5 + 0.38 * Math.sin(this.t * 0.33)), gy = fieldRows * (0.5 + 0.28 * Math.sin(this.t * 0.47 + 1.3));
      this.stamp(gx, gy, 0.9 * dt); // per second, so 20 and 30 fps glow alike
    }
    this.draw();
  };

  private draw() {
    const { ctx, octx, img } = this;
    if (!ctx || !octx || !img) return;
    const { cols, rows, fieldRows, dripRows } = this.field;
    const { t, frame, mask, maskPeriod, maskRows, maskTop, s, lite } = this;
    const shown = H.revealedRows(s.reveal, rows);
    const off = Math.floor(this.wordOff) % Math.max(1, maskPeriod);
    const data = img.data;
    const bursts = this.bursts.filter((b) => t - b.at < H.BURST.seconds);
    this.bursts = bursts;
    for (let cy = 0; cy < rows; cy++) {
      const inField = cy < fieldRows;
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        let heat = -1;
        if (cy < shown) {
          // Phones and low-power machines skip the domain warp: one fbm pass instead of two.
          heat = lite ? Math.min(H.CLOUD_CAP, (H.fbm(cx * 0.045 + t * 0.07, cy * 0.08 + t * 0.05) - 0.5) * 0.9 + 0.42) : H.cloud(cx, cy, t);
          heat += H.blobs(cx, cy, t, cols, fieldRows, 1) + H.body(cy, fieldRows) + this.buf[i] + s.heat + H.grain(cx, cy, frame);
          for (const b of bursts) heat += H.burst(cx, cy, b.x, b.y, t - b.at);
          if (inField) {
            const my = cy - maskTop;
            if (mask && my >= 0 && my < maskRows) heat = H.withWord(heat, mask[my * maskPeriod + ((cx + off) % maskPeriod)]);
          } else {
            const cut = H.dripCut(cx, t, fieldRows, dripRows);
            heat = cy > cut ? -1 : heat - ((cy - fieldRows) / dripRows) * 0.14;
          }
        }
        const b = H.band(heat);
        const o = i * 4;
        if (b < 0) { data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0; continue; }
        const c = H.RGB[b];
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    const W = this.cv.width, Hh = this.cv.height, k = H.PITCH * this.dpr;
    ctx.clearRect(0, 0, W, Hh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, cols, rows, 0, 0, cols * k, rows * k);
    // The gaps: cleared after the fact, so every cell is a crisp square whatever the device pixel ratio.
    const g = H.GAP * this.dpr, c = H.CELL * this.dpr;
    for (let x = 0; x < cols; x++) ctx.clearRect(x * k + c, 0, g, Hh);
    for (let y = 0; y < rows; y++) ctx.clearRect(0, y * k + c, W, g);
  }
}
