"use client";
import { useEffect, useRef } from "react";
import { BrandGlyph } from "@/components/brand/brands";
import { HUBS } from "./land";
import { TAU, TILT, drawLand, landPoints, paintBase as paintGlobe, rot, toVec } from "./core";
import { ORBIT, type Orbiter } from "./orbit";

/**
 * The desktop waitlist globe (1061): a dotted Earth drawn on one 2D canvas, no WebGL and no library.
 *
 * - Land dots from a Fibonacci sphere (even spacing, no pole clumping), lit from the upper left, brand lime to
 *   brand green toward the limb. One full turn every 36 s, India facing you at the start.
 * - Great-circle arcs between creator hubs, a lime head running along each; the hub it lands on pulses.
 * - A few drifting particles, and the five platform icons on tilted orbits that pass BEHIND the globe (the icon
 *   drops under the canvas, which is opaque inside the sphere).
 * - Pointer parallax (fine pointers only), eased back to rest on leave; scrolling past shrinks and turns it a
 *   little. Both are eased, never jumpy.
 * - Pauses off screen and in a background tab. Reduced motion: one still frame. If frames keep running slow
 *   (over ~34 ms for a second and a half, twice), it calls onSlow and the page swaps in the still CSS globe.
 */
const TURN_MS = 36_000;
const START_YAW = (-92 * Math.PI) / 180; // India just left of centre, drifting in

type Arc = { a: [number, number, number]; b: [number, number, number]; to: number; t0: number; dur: number; w: number; h: number };
type Particle = { a: number; r: number; y: number; s: number; v: number; f: number };

export default function CanvasGlobe({ still, onReady, onSlow }: { still: boolean; onReady: () => void; onSlow: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const icons = useRef<(HTMLSpanElement | null)[]>([]);
  const ready = useRef(onReady);
  const slow = useRef(onSlow);
  ready.current = onReady;
  slow.current = onSlow;

  useEffect(() => {
    const el = wrap.current!;
    const cv = canvas.current!;
    const ctx = cv.getContext("2d", { alpha: true });
    if (!ctx) return slow.current();
    const pts = landPoints(14_000);
    const hubs = HUBS.map(([la, ln]) => toVec(la, ln));
    const pulse = hubs.map(() => -1e9); // when each hub last pulsed
    let w = 0;
    let h = 0;
    let R = 0;
    let dpr = 1;
    let base: HTMLCanvasElement | null = null;

    /** The parts that never move (glow, body, rim) are drawn once per size, then blitted. */
    const paintBase = () => {
      base = paintGlobe(w, h, R, dpr);
    };

    const size = () => {
      const r = el.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      R = Math.min(w, h) * 0.31;
      paintBase();
    };
    size();

    // ---------------------------------------------------------------------------------------- moving parts
    const arcs: Arc[] = [];
    const parts: Particle[] = Array.from({ length: 14 }, () => ({
      a: Math.random() * TAU,
      r: 1.08 + Math.random() * 0.5,
      y: (Math.random() - 0.5) * 1.5,
      s: 0.7 + Math.random() * 1.2,
      v: (0.012 + Math.random() * 0.025) * (Math.random() < 0.5 ? -1 : 1),
      f: Math.random() * TAU,
    }));
    let yaw = START_YAW;
    const par = { x: 0, y: 0 }; // eased pointer offset
    let want = { x: 0, y: 0 };
    let scroll = 0;
    let scrollEased = 0;

    const spawnArc = (now: number, cy: number, sy: number, ct: number, st: number) => {
      // Prefer pairs on the side facing you, so the arcs are seen, not drawn behind the globe.
      const tmp = [0, 0, 0];
      const front = hubs.map((v, i) => (rot(v, 0, cy, sy, ct, st, tmp), { i, z: tmp[2] })).filter((o) => o.z > 0.15);
      if (front.length < 2) return;
      const i = front[Math.floor(Math.random() * front.length)].i;
      let j = front[Math.floor(Math.random() * front.length)].i;
      if (j === i) j = front[(front.findIndex((o) => o.i === i) + 1) % front.length].i;
      const a = hubs[i];
      const b = hubs[j];
      const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
      if (ang < 0.15) return;
      arcs.push({ a, b, to: j, t0: now, dur: 1800 + ang * 900, w: ang, h: 0.06 + (ang / Math.PI) * 0.32 });
      pulse[i] = now;
    };

    const draw = (now: number, dt: number) => {
      // Ease the pointer and scroll offsets toward where they want to be (frame-rate independent).
      const k = 1 - Math.exp(-dt / 260);
      par.x += (want.x - par.x) * k;
      par.y += (want.y - par.y) * k;
      scrollEased += (scroll - scrollEased) * k;
      const Y = yaw + par.x * 0.45 + scrollEased * 0.5;
      const T = TILT + par.y * 0.16 + scrollEased * 0.08;
      const cy = Math.cos(Y);
      const sy = Math.sin(Y);
      const ct = Math.cos(T);
      const st = Math.sin(T);
      const sc = 1 - scrollEased * 0.08;
      const r = R * sc;
      const cx = w / 2;
      const cyy = h / 2;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const v = [0, 0, 0];

      // Orbit rings: the back half goes under the globe.
      const ring = (o: Orbiter, front: boolean) => {
        ctx.beginPath();
        let on = false;
        for (let s = 0; s <= 96; s++) {
          const th = (s / 96) * TAU;
          orbitPos(o, th, v);
          const z = v[2];
          if (z >= 0 === front) {
            const px = cx + v[0] * r;
            const py = cyy - v[1] * r;
            if (on) ctx.lineTo(px, py);
            else ctx.moveTo(px, py);
            on = true;
          } else on = false;
        }
        ctx.strokeStyle = front ? "rgba(190,255,90,0.22)" : "rgba(190,255,90,0.08)";
        ctx.lineWidth = 1;
        ctx.stroke();
      };
      for (const o of ORBIT) ring(o, false);

      if (base) {
        ctx.save();
        ctx.translate(cx, cyy);
        ctx.scale(sc, sc);
        ctx.drawImage(base, -cx, -cyy, w, h);
        ctx.restore();
      }

      // Land dots, batched by brightness: six fills a frame.
      drawLand(ctx, pts, cx, cyy, r, cy, sy, ct, st);
      const ds = Math.max(1, r / 190);

      // Hubs, and the soft pulse rings.
      for (let i = 0; i < hubs.length; i++) {
        rot(hubs[i], 0, cy, sy, ct, st, v);
        if (v[2] < 0.08) continue;
        const px = cx + v[0] * r;
        const py = cyy - v[1] * r;
        const age = (now - pulse[i]) / 1700;
        if (age >= 0 && age < 1) {
          ctx.beginPath();
          ctx.arc(px, py, 3 + age * 16 * ds, 0, TAU);
          ctx.strokeStyle = `rgba(200,255,80,${(0.55 * (1 - age) * v[2]).toFixed(3)})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(px, py, 4.5 * ds, 0, TAU);
        ctx.fillStyle = `rgba(190,255,70,${(0.16 * v[2]).toFixed(3)})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 1.7 * ds, 0, TAU);
        ctx.fillStyle = `rgba(225,255,150,${(0.5 + 0.5 * v[2]).toFixed(3)})`;
        ctx.fill();
      }
      // Now and then a hub glows on its own, not only when an arc lands.
      if (!still && Math.random() < dt / 1400) pulse[Math.floor(Math.random() * hubs.length)] = now;

      // Arcs: a trail that runs from one hub to another, lifted off the surface, then lets go.
      if (!still && arcs.length < 4 && Math.random() < dt / 700) spawnArc(now, cy, sy, ct, st);
      for (let n = arcs.length - 1; n >= 0; n--) {
        const A = arcs[n];
        const u = (now - A.t0) / A.dur;
        if (u > 1.45) {
          arcs.splice(n, 1);
          continue;
        }
        const head = Math.min(1, u);
        const tail = Math.max(0, u - 0.45);
        const steps = 28;
        const sw = Math.sin(A.w);
        let prev: [number, number, boolean] | null = null;
        for (let s = 0; s <= steps; s++) {
          const f = tail + ((head - tail) * s) / steps;
          const p1 = Math.sin((1 - f) * A.w) / sw;
          const p2 = Math.sin(f * A.w) / sw;
          const lift = 1 + A.h * Math.sin(Math.PI * f);
          const q = [(A.a[0] * p1 + A.b[0] * p2) * lift, (A.a[1] * p1 + A.b[1] * p2) * lift, (A.a[2] * p1 + A.b[2] * p2) * lift];
          rot(q, 0, cy, sy, ct, st, v);
          const seen = v[2] >= 0 || v[0] * v[0] + v[1] * v[1] > 1;
          const px = cx + v[0] * r;
          const py = cyy - v[1] * r;
          if (prev && prev[2] && seen) {
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(px, py);
            ctx.strokeStyle = `rgba(190,255,70,${(0.08 + 0.62 * (s / steps)).toFixed(3)})`;
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
          prev = [px, py, seen];
        }
        if (u < 1 && prev && prev[2]) {
          ctx.beginPath();
          ctx.arc(prev[0], prev[1], 5 * ds, 0, TAU);
          ctx.fillStyle = "rgba(200,255,90,0.22)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(prev[0], prev[1], 2 * ds, 0, TAU);
          ctx.fillStyle = "#eaffb0";
          ctx.fill();
        }
        if (u >= 1 && pulse[A.to] < A.t0 + A.dur) pulse[A.to] = now;
      }

      // Drifting particles around the globe (none inside its disc when they are behind it).
      for (const p of parts) {
        if (!still) p.a += p.v * (dt / 16.7) * 0.05;
        const x = Math.cos(p.a) * p.r;
        const z = Math.sin(p.a) * p.r;
        const yy = p.y;
        if (z < 0 && x * x + yy * yy < 1.05) continue;
        const tw = 0.5 + 0.5 * Math.sin(now / 900 + p.f);
        ctx.beginPath();
        ctx.arc(cx + x * r, cyy - yy * r * 0.8, p.s * ds, 0, TAU);
        ctx.fillStyle = `rgba(200,255,120,${(0.12 + 0.3 * tw).toFixed(3)})`;
        ctx.fill();
      }

      for (const o of ORBIT) ring(o, true);

      // Platform icons ride the same orbits. Behind the globe they drop under the canvas and dim.
      for (let n = 0; n < ORBIT.length; n++) {
        const node = icons.current[n];
        if (!node) continue;
        const o = ORBIT[n];
        orbitPos(o, o.phase + (still ? 0 : now / o.period) * TAU, v);
        const z = v[2];
        const s = 0.82 + 0.18 * Math.max(0, z / o.r);
        node.style.transform = `translate3d(${(cx + v[0] * r).toFixed(1)}px, ${(cyy - v[1] * r).toFixed(1)}px, 0) translate(-50%, -50%) scale(${s.toFixed(3)})`;
        const behind = z < 0;
        node.style.zIndex = behind ? "1" : "3";
        node.style.opacity = behind ? "0.45" : "1";
        node.style.pointerEvents = behind ? "none" : "auto";
      }
    };

    // ---------------------------------------------------------------------------------------- loop
    let raf = 0;
    let last = 0;
    let running = false;
    let onScreen = true;
    let firstAt = 0;
    let winSum = 0;
    let winN = 0;
    let winStart = 0;
    let strikes = 0;
    let told = false;

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(100, now - last) : 16.7;
      last = now;
      yaw += (dt / TURN_MS) * TAU;
      draw(now, dt);
      if (!told) {
        told = true;
        firstAt = now;
        winStart = now;
        ready.current();
      }
      // Slow-device check, after a 2 s settle-in (fonts, hydration).
      if (now - firstAt > 2000) {
        winSum += dt;
        winN++;
        if (now - winStart > 1500) {
          strikes = winSum / winN > 34 ? strikes + 1 : 0;
          winSum = 0;
          winN = 0;
          winStart = now;
          if (strikes >= 2) {
            stop();
            return slow.current();
          }
        }
      }
      if (running) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (running || still || !onScreen || document.hidden) return;
      running = true;
      last = 0;
      winSum = 0;
      winN = 0;
      winStart = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const still1 = () => {
      // Reduced motion: one considered frame, India facing you.
      yaw = (-78 * Math.PI) / 180;
      draw(performance.now(), 16.7);
      if (!told) {
        told = true;
        ready.current();
      }
    };

    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    io.observe(el);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", vis);
    const ro = new ResizeObserver(() => {
      size();
      if (still) still1();
      else if (!running) draw(performance.now(), 16.7);
    });
    ro.observe(el);

    // Pointer parallax on the whole panel, fine pointers only. Leaving eases it home.
    const host = (el.closest("[data-globe-host]") as HTMLElement | null) ?? el;
    const fine = window.matchMedia("(pointer: fine)").matches;
    const move = (e: PointerEvent) => {
      const b = host.getBoundingClientRect();
      want = { x: Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width) * 2 - 1)), y: Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height) * 2 - 1)) };
    };
    const leave = () => (want = { x: 0, y: 0 });
    if (fine && !still) {
      host.addEventListener("pointermove", move, { passive: true });
      host.addEventListener("pointerleave", leave);
    }
    // Scrolling past: shrink and turn a touch (eased in draw, so it glides).
    const onScroll = () => {
      const b = el.getBoundingClientRect();
      scroll = Math.max(0, Math.min(1, -b.top / Math.max(1, b.height)));
    };
    if (!still) window.addEventListener("scroll", onScroll, { passive: true });

    if (still) still1();
    else start();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", onScroll);
    };
  }, [still]);

  return (
    <div ref={wrap} className="wl-globe-canvas" aria-hidden="true">
      <canvas ref={canvas} />
      {ORBIT.map((o, n) => (
        <span
          key={o.brand}
          ref={(node) => {
            icons.current[n] = node;
          }}
          className="wl-orb-pos"
        >
          <span className="wl-orb">
            <BrandGlyph brand={o.brand} className="h-[18px] w-[18px]" />
          </span>
        </span>
      ))}
    </div>
  );
}

/** Where an orbiter is at angle th, in globe-radius units: a circle of radius r, tilted, then turned. */
function orbitPos(o: Orbiter, th: number, out: number[]) {
  const x = Math.cos(th) * o.r;
  const z = Math.sin(th) * o.r;
  const ci = Math.cos(o.incl);
  const si = Math.sin(o.incl);
  const y1 = -z * si;
  const z1 = z * ci;
  const cn = Math.cos(o.node);
  const sn = Math.sin(o.node);
  out[0] = x * cn - y1 * sn;
  out[1] = x * sn + y1 * cn;
  out[2] = z1;
}
