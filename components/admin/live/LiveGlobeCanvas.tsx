"use client";
import { useEffect, useRef, type MutableRefObject } from "react";
import { TAU, TILT, drawLand, landPoints, paintBase, rot, toVec } from "@/components/waitlist/globe/core";
import type { LivePlace } from "@/lib/live-map-core";

/**
 * The admin live globe (1062): the waitlist's dotted Earth (same kit, components/waitlist/globe/core.ts) with a
 * glowing marker per place where members are using Outlly.
 *
 * - Active places glow lime and pulse; idle places (seen in the last hour) are small dim green dots.
 * - When a place gains an active member, it pings. Lime arcs run between active places now and then.
 * - Drag to turn, wheel / pinch / +- to zoom, arrows to turn from the keyboard. Click a marker to open it.
 * - Turns slowly by itself until you touch it, then waits a few seconds before turning again.
 * - "lite" (phones, tablets, Save-Data, or a desktop that can't keep up): fewer dots, no arcs or particles, no
 *   auto-turn, and it only draws when something changes. Reduced motion: lite, plus no pulsing at all.
 * - Pauses off screen and in a background tab.
 */
const AUTO_TURN_MS = 80_000;
const START_YAW = (-78 * Math.PI) / 180; // India facing you
const ZMIN = 1;
const ZMAX = 3.6;

export type GlobeHandle = { zoomBy: (f: number) => void; reset: () => void; focus: (key: string) => void };
type Props = { places: LivePlace[]; selected: string | null; onSelect: (key: string | null) => void; lite: boolean; still: boolean; onSlow: () => void; handle: MutableRefObject<GlobeHandle | null> };
type Marker = { key: string; v: [number, number, number]; active: number; idle: number; ping: number };
type Arc = { a: [number, number, number]; b: [number, number, number]; t0: number; dur: number; w: number; h: number };

export default function LiveGlobeCanvas({ places, selected, onSelect, lite, still, onSlow, handle }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const api = useRef<GlobeHandle & { setPlaces: (p: LivePlace[]) => void; setSelected: (k: string | null) => void }>();
  const sel = useRef(onSelect);
  const slow = useRef(onSlow);
  const placesRef = useRef(places);
  const selRef = useRef(selected);
  sel.current = onSelect;
  slow.current = onSlow;
  placesRef.current = places;
  selRef.current = selected;

  handle.current = {
    zoomBy: (f) => api.current?.zoomBy(f),
    reset: () => api.current?.reset(),
    focus: (k) => api.current?.focus(k),
  };

  useEffect(() => {
    const el = wrap.current!;
    const cv = canvas.current!;
    const ctx = cv.getContext("2d", { alpha: true });
    if (!ctx) return slow.current();
    const pts = landPoints(lite ? 7_000 : 13_000);
    let w = 1;
    let h = 1;
    let R0 = 1;
    let dpr = 1;
    let base: HTMLCanvasElement | null = null;
    let baseR = 0;

    // View state. Tilt is clamped so the globe never flips over the pole.
    let yaw = START_YAW;
    let tilt = TILT;
    let zoom = 1;
    let want: { yaw: number; tilt: number } | null = null; // eased turn toward a chosen place
    let lastTouch = -1e9;
    let markers: Marker[] = [];
    let selKey: string | null = null;
    const arcs: Arc[] = [];
    let screen: { key: string; x: number; y: number; r: number }[] = [];

    const size = () => {
      const b = el.getBoundingClientRect();
      w = Math.max(1, b.width);
      h = Math.max(1, b.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      R0 = Math.min(w, h) * 0.4;
      base = null;
    };
    size();

    const draw = (now: number, dt: number) => {
      const r = R0 * zoom;
      if (!base || Math.abs(baseR - r) > 0.5) {
        base = paintBase(w, h, r, dpr);
        baseR = r;
      }
      if (want) {
        const k = 1 - Math.exp(-dt / 220);
        let dy = ((want.yaw - yaw + Math.PI) % TAU) - Math.PI;
        if (dy < -Math.PI) dy += TAU;
        yaw += dy * k;
        tilt += (want.tilt - tilt) * k;
        if (Math.abs(dy) < 0.002 && Math.abs(want.tilt - tilt) < 0.002) want = null;
      }
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const cx = w / 2;
      const cyy = h / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(base, 0, 0, w, h);
      drawLand(ctx, pts, cx, cyy, r, cy, sy, ct, st);

      const ds = Math.max(1, Math.min(2.2, r / 190));
      const v = [0, 0, 0];

      // Connection arcs between active places (not in lite / still).
      const act = markers.filter((m) => m.active > 0);
      if (!lite && !still && act.length >= 2 && arcs.length < 3 && Math.random() < dt / 900) {
        const a = act[Math.floor(Math.random() * act.length)];
        let b = act[Math.floor(Math.random() * act.length)];
        if (b === a) b = act[(act.indexOf(a) + 1) % act.length];
        const ang = Math.acos(Math.max(-1, Math.min(1, a.v[0] * b.v[0] + a.v[1] * b.v[1] + a.v[2] * b.v[2])));
        if (ang > 0.05) arcs.push({ a: a.v, b: b.v, t0: now, dur: 1600 + ang * 900, w: ang, h: 0.05 + (ang / Math.PI) * 0.3 });
      }
      for (let n = arcs.length - 1; n >= 0; n--) {
        const A = arcs[n];
        const u = (now - A.t0) / A.dur;
        if (u > 1.45) {
          arcs.splice(n, 1);
          continue;
        }
        const head = Math.min(1, u);
        const tail = Math.max(0, u - 0.45);
        const sw = Math.sin(A.w) || 1e-6;
        let prev: [number, number, boolean] | null = null;
        for (let s = 0; s <= 24; s++) {
          const f = tail + ((head - tail) * s) / 24;
          const p1 = Math.sin((1 - f) * A.w) / sw;
          const p2 = Math.sin(f * A.w) / sw;
          const lift = 1 + A.h * Math.sin(Math.PI * f);
          rot([(A.a[0] * p1 + A.b[0] * p2) * lift, (A.a[1] * p1 + A.b[1] * p2) * lift, (A.a[2] * p1 + A.b[2] * p2) * lift], 0, cy, sy, ct, st, v);
          const seen = v[2] >= 0 || v[0] * v[0] + v[1] * v[1] > 1;
          const px = cx + v[0] * r;
          const py = cyy - v[1] * r;
          if (prev && prev[2] && seen) {
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(px, py);
            ctx.strokeStyle = `rgba(190,255,70,${(0.06 + 0.55 * (s / 24)).toFixed(3)})`;
            ctx.lineWidth = 1.3;
            ctx.stroke();
          }
          prev = [px, py, seen];
        }
      }

      // Markers. Idle first, so active ones sit on top.
      screen = [];
      const order = [...markers].sort((a, b) => (a.active > 0 ? 1 : 0) - (b.active > 0 ? 1 : 0));
      for (const m of order) {
        rot(m.v, 0, cy, sy, ct, st, v);
        if (v[2] < 0.04) continue;
        const px = cx + v[0] * r;
        const py = cyy - v[1] * r;
        const face = 0.55 + 0.45 * v[2];
        const isSel = m.key === selKey;
        if (m.active > 0) {
          const size = (3 + Math.min(6, Math.sqrt(m.active) * 1.6)) * ds;
          const halo = ctx.createRadialGradient(px, py, 0, px, py, size * 4);
          halo.addColorStop(0, `rgba(200,255,80,${(0.5 * face).toFixed(3)})`);
          halo.addColorStop(1, "rgba(200,255,80,0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(px, py, size * 4, 0, TAU);
          ctx.fill();
          if (!still) {
            // A soft heartbeat on every active place, plus a bigger ring when someone just arrived.
            const beat = ((now + m.key.length * 397) % 2600) / 2600;
            ctx.beginPath();
            ctx.arc(px, py, size + beat * 14 * ds, 0, TAU);
            ctx.strokeStyle = `rgba(200,255,80,${(0.5 * (1 - beat) * face).toFixed(3)})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            const age = (now - m.ping) / 1800;
            if (age >= 0 && age < 1) {
              ctx.beginPath();
              ctx.arc(px, py, size + age * 34 * ds, 0, TAU);
              ctx.strokeStyle = `rgba(234,255,176,${(0.85 * (1 - age)).toFixed(3)})`;
              ctx.lineWidth = 2;
              ctx.stroke();
            }
          }
          ctx.beginPath();
          ctx.arc(px, py, size, 0, TAU);
          ctx.fillStyle = `rgba(234,255,176,${(0.75 + 0.25 * face).toFixed(3)})`;
          ctx.fill();
          screen.push({ key: m.key, x: px, y: py, r: Math.max(14, size * 2.2) });
        } else {
          const size = 2.4 * ds;
          ctx.beginPath();
          ctx.arc(px, py, size, 0, TAU);
          ctx.fillStyle = `rgba(110,200,90,${(0.55 * face).toFixed(3)})`;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = `rgba(170,240,120,${(0.5 * face).toFixed(3)})`;
          ctx.stroke();
          screen.push({ key: m.key, x: px, y: py, r: 12 });
        }
        if (isSel) {
          ctx.beginPath();
          ctx.arc(px, py, 11 * ds, 0, TAU);
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    };

    // ---------------------------------------------------------------------------------------- loop
    let raf = 0;
    let last = 0;
    let running = false;
    let onScreen = true;
    let dirty = true;
    let firstAt = 0;
    let winSum = 0;
    let winN = 0;
    let winStart = 0;
    let strikes = 0;
    const animated = !lite && !still;

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(100, now - last) : 16.7;
      last = now;
      if (animated && !want && now - lastTouch > 5000 && !selKey) yaw += (dt / AUTO_TURN_MS) * TAU;
      draw(now, dt);
      dirty = false;
      if (animated) {
        if (!firstAt) firstAt = winStart = now;
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
      }
      // Lite / still: keep drawing only while something moves (an eased turn, a fresh ping).
      const pinging = !still && markers.some((m) => now - m.ping < 1800);
      if (running && (animated || want || dirty || pinging)) raf = requestAnimationFrame(frame);
      else running = false;
    };
    const start = () => {
      if (running || !onScreen || document.hidden) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const kick = () => {
      dirty = true;
      start();
    };

    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen) kick();
      else stop();
    });
    io.observe(el);
    const vis = () => (document.hidden ? stop() : kick());
    document.addEventListener("visibilitychange", vis);
    const ro = new ResizeObserver(() => {
      size();
      kick();
    });
    ro.observe(el);

    // ---------------------------------------------------------------------------------------- input
    const ptrs = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; t: number; moved: number } | null = null;
    let pinch0 = 0;
    let zoom0 = 1;
    const setZoom = (z: number) => {
      zoom = Math.max(ZMIN, Math.min(ZMAX, z));
      kick();
    };
    const turn = (dx: number, dy: number) => {
      const r = R0 * zoom;
      yaw += dx / r;
      tilt = Math.max(-1.1, Math.min(1.25, tilt + dy / r));
      want = null;
      lastTouch = performance.now();
      kick();
    };
    const pick = (x: number, y: number) => {
      let best: string | null = null;
      let bd = Infinity;
      for (const s of screen) {
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < s.r && d < bd) {
          bd = d;
          best = s.key;
        }
      }
      return best;
    };
    const pdown = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        zoom0 = zoom;
        down = null;
      }
    };
    const pmove = (e: PointerEvent) => {
      const p = ptrs.get(e.pointerId);
      if (!p) {
        // Hover: a pointer cursor over a marker says it can be clicked.
        const b = cv.getBoundingClientRect();
        cv.style.cursor = pick(e.clientX - b.left, e.clientY - b.top) ? "pointer" : "grab";
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) setZoom(zoom0 * (d / pinch0));
        lastTouch = performance.now();
        return;
      }
      if (down) down.moved += Math.abs(dx) + Math.abs(dy);
      cv.style.cursor = "grabbing";
      turn(dx, dy);
    };
    const pup = (e: PointerEvent) => {
      ptrs.delete(e.pointerId);
      cv.style.cursor = "grab";
      if (down && ptrs.size === 0 && down.moved < 6 && performance.now() - down.t < 600) {
        const b = cv.getBoundingClientRect();
        sel.current(pick(e.clientX - b.left, e.clientY - b.top));
      }
      if (ptrs.size === 0) down = null;
    };
    const wheel = (e: WheelEvent) => {
      // A plain scroll still scrolls the page, unless the globe has focus (clicked or tabbed to). Trackpad pinch
      // arrives as ctrl + wheel and always zooms the globe.
      if (!e.ctrlKey && !e.metaKey && document.activeElement !== el) return;
      e.preventDefault();
      lastTouch = performance.now();
      setZoom(zoom * Math.exp(-e.deltaY * 0.0016));
    };
    const key = (e: KeyboardEvent) => {
      const step = 0.12;
      if (e.key === "ArrowLeft") turn(-step * R0 * zoom, 0);
      else if (e.key === "ArrowRight") turn(step * R0 * zoom, 0);
      else if (e.key === "ArrowUp") turn(0, -step * R0 * zoom);
      else if (e.key === "ArrowDown") turn(0, step * R0 * zoom);
      else if (e.key === "+" || e.key === "=") setZoom(zoom * 1.25);
      else if (e.key === "-" || e.key === "_") setZoom(zoom / 1.25);
      else if (e.key === "Escape") sel.current(null);
      else return;
      e.preventDefault();
    };
    cv.addEventListener("pointerdown", pdown);
    cv.addEventListener("pointermove", pmove);
    cv.addEventListener("pointerup", pup);
    cv.addEventListener("pointercancel", pup);
    cv.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("keydown", key);

    // ---------------------------------------------------------------------------------------- outside calls
    api.current = {
      zoomBy: (f) => setZoom(zoom * f),
      reset: () => {
        zoom = 1;
        want = { yaw: START_YAW, tilt: TILT };
        lastTouch = performance.now();
        kick();
      },
      focus: (k) => {
        const m = markers.find((x) => x.key === k);
        if (!m) return;
        // Turn so the place faces you: yaw brings its longitude to the front, tilt lifts its latitude a little.
        const lng = Math.atan2(m.v[0], m.v[2]);
        const lat = Math.asin(m.v[1]);
        want = { yaw: -lng, tilt: Math.max(-1.1, Math.min(1.25, lat * 0.85)) };
        lastTouch = performance.now();
        kick();
      },
      setPlaces: (list) => {
        const prev = new Map(markers.map((m) => [m.key, m]));
        const now = performance.now();
        markers = list.map((p) => {
          const o = prev.get(p.key);
          const grew = o ? p.active > o.active : p.active > 0 && prev.size > 0;
          return { key: p.key, v: toVec(p.lat, p.lng), active: p.active, idle: p.idle, ping: grew ? now : o?.ping ?? -1e9 };
        });
        kick();
      },
      setSelected: (k) => {
        selKey = k;
        kick();
      },
    };
    api.current.setPlaces(placesRef.current);
    api.current.setSelected(selRef.current);
    kick();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", vis);
      cv.removeEventListener("pointerdown", pdown);
      cv.removeEventListener("pointermove", pmove);
      cv.removeEventListener("pointerup", pup);
      cv.removeEventListener("pointercancel", pup);
      cv.removeEventListener("wheel", wheel);
      el.removeEventListener("keydown", key);
      api.current = undefined;
    };
  }, [lite, still]);

  // Data and selection flow into the running loop without restarting it.
  useEffect(() => api.current?.setPlaces(places), [places]);
  useEffect(() => api.current?.setSelected(selected), [selected]);

  return (
    <div
      ref={wrap}
      className="lg-canvas"
      tabIndex={0}
      role="group"
      aria-roledescription="globe"
      aria-label="Live globe. Arrow keys turn it, plus and minus zoom, Escape closes a place. Every place is also listed in the panel."
    >
      <canvas ref={canvas} style={{ cursor: "grab", touchAction: "none" }} />
    </div>
  );
}
