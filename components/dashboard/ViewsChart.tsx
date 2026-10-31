"use client";
import { useEffect, useId, useRef, useState } from "react";
import { compact, niceMax, resample } from "@/lib/dashboard/pulse-core";
import { clamp01, easeOut, prefersReduced } from "./motion";

const N = 60; // every range is drawn with the same number of points, so ranges morph point for point
const H = 240;
const PAD_L = 44;
const PAD_B = 26;
const PAD_T = 10;

const fmtDay = (iso: string, days: number) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", days <= 7 ? { weekday: "short", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
const fmtLong = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Views over time (1080). This period as a lime line over a rising area, the period before as a dashed line.
 * A new range or platform morphs the old shapes into the new ones in one rAF loop that writes the path `d`
 * directly. Pointer or arrow keys move a crosshair with a glass tooltip; the summary is the accessible name.
 */
export function ViewsChart({ cur, prev, dates, days, label }: { cur: number[]; prev: number[]; dates: string[]; days: number; label: string }) {
  const id = useId().replace(/:/g, "");
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const lineEl = useRef<SVGPathElement>(null);
  const areaEl = useRef<SVGPathElement>(null);
  const prevEl = useRef<SVGPathElement>(null);
  const clipEl = useRef<SVGRectElement>(null);
  const ticks = useRef<(SVGTextElement | null)[]>([]);
  const cross = useRef<SVGGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  // null until measured: the first sweep waits for the real width instead of restarting when it arrives
  const [mw, setW] = useState<number | null>(null);
  const w = mw ?? 640;
  const shown = useRef<{ c: number[]; p: number[]; max: number } | null>(null);
  const raf = useRef(0);
  const focusIdx = useRef<number | null>(null);

  // ResizeObserver: the chart redraws to its box, never a fixed width.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = w - PAD_L - 8;
  const plotH = H - PAD_B - PAD_T;
  const xAt = (i: number, n: number) => PAD_L + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = (v: number, max: number) => PAD_T + plotH - (v / max) * plotH;

  const paths = (c: number[], p: number[], max: number) => {
    const ln = c.map((v, i) => `${i ? "L" : "M"}${xAt(i, N).toFixed(1)} ${yAt(v, max).toFixed(1)}`).join(" ");
    const pv = p.map((v, i) => `${i ? "L" : "M"}${xAt(i, N).toFixed(1)} ${yAt(v, max).toFixed(1)}`).join(" ");
    const base = (PAD_T + plotH).toFixed(1);
    return { ln, pv, ar: `${ln} L${xAt(N - 1, N).toFixed(1)} ${base} L${PAD_L} ${base} Z` };
  };
  const writeTicks = (max: number) => [0, 0.5, 1].forEach((f, i) => { const t = ticks.current[i]; if (t) t.textContent = compact(max * f); });

  // Draw (first time) or morph (every change after). Pure DOM writes inside the loop.
  useEffect(() => {
    if (mw === null) return;
    const c1 = resample(cur, N);
    const p1 = resample(prev, N);
    const max1 = niceMax(Math.max(...c1, ...p1, 1));
    const from = shown.current;
    const reduced = prefersReduced();
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const set = (c: number[], p: number[], max: number) => {
      const d = paths(c, p, max);
      lineEl.current?.setAttribute("d", d.ln);
      areaEl.current?.setAttribute("d", d.ar);
      prevEl.current?.setAttribute("d", d.pv);
      writeTicks(max);
    };
    if (!from) {
      // First draw: the line sweeps in left to right while the area rises from the baseline.
      set(c1, p1, max1);
      shown.current = { c: c1, p: p1, max: max1 };
      if (reduced) { clipEl.current?.setAttribute("width", String(w)); return; }
      const tick = (now: number) => {
        const t = (now - t0) / 1000;
        const pl = easeOut(clamp01((t - 0.25) / 1.1));
        const pa = easeOut(clamp01((t - 0.35) / 0.9));
        clipEl.current?.setAttribute("width", String(pl * w));
        if (areaEl.current) { areaEl.current.style.opacity = String(pa); areaEl.current.style.transform = `translateY(${(1 - pa) * 18}px)`; }
        if (pl < 1 || pa < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf.current);
    }
    clipEl.current?.setAttribute("width", String(w));
    if (reduced) { set(c1, p1, max1); shown.current = { c: c1, p: p1, max: max1 }; return; }
    const tick = (now: number) => {
      const k = easeOut(clamp01((now - t0) / 650));
      const c = from.c.map((v, i) => v + (c1[i] - v) * k);
      const p = from.p.map((v, i) => v + (p1[i] - v) * k);
      const max = from.max + (max1 - from.max) * k;
      set(c, p, max);
      shown.current = { c, p, max };
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.join(","), prev.join(","), mw]);

  // Crosshair + tooltip on a real data index (not a resampled point).
  const showAt = (i: number) => {
    const n = cur.length;
    if (!n || !shown.current) return;
    i = Math.max(0, Math.min(n - 1, i));
    focusIdx.current = i;
    const x = xAt(i, n);
    const max = shown.current.max;
    const y = yAt(cur[i], max);
    const g = cross.current;
    if (g) {
      g.style.opacity = "1";
      g.querySelector("line")?.setAttribute("x1", String(x));
      g.querySelector("line")?.setAttribute("x2", String(x));
      const dot = g.querySelector("circle");
      dot?.setAttribute("cx", String(x));
      dot?.setAttribute("cy", String(y));
    }
    const t = tip.current;
    if (t) {
      const was = prev[i] ?? 0;
      const ch = was ? Math.round(((cur[i] - was) / was) * 100) : null;
      t.innerHTML = "";
      const a = document.createElement("p"); a.className = "pulse-tip-date"; a.textContent = fmtLong(dates[i]);
      const b = document.createElement("p"); b.className = "pulse-tip-row"; b.innerHTML = `<span class="pulse-key pulse-key-cur"></span>This period<b></b>`; b.querySelector("b")!.textContent = cur[i].toLocaleString("en-US");
      const c = document.createElement("p"); c.className = "pulse-tip-row"; c.innerHTML = `<span class="pulse-key pulse-key-prev"></span>Before<b></b>`; c.querySelector("b")!.textContent = was.toLocaleString("en-US");
      t.append(a, b, c);
      if (ch !== null) { const d = document.createElement("p"); d.className = ch >= 0 ? "pulse-tip-delta is-up" : "pulse-tip-delta is-down"; d.textContent = `${ch >= 0 ? "+" : ""}${ch}% on the period before`; t.append(d); }
      t.style.opacity = "1";
      const tw = t.offsetWidth;
      const left = Math.min(w - tw - 4, Math.max(4, x + 14 > w - tw - 4 ? x - tw - 14 : x + 14));
      t.style.transform = `translate3d(${left}px, ${Math.max(4, Math.min(H - t.offsetHeight - 30, y - t.offsetHeight / 2))}px, 0)`;
    }
    if (live.current) live.current.textContent = `${fmtLong(dates[i])}: ${cur[i].toLocaleString("en-US")} views, ${(prev[i] ?? 0).toLocaleString("en-US")} the period before.`;
  };
  const hide = () => {
    if (cross.current) cross.current.style.opacity = "0";
    if (tip.current) tip.current.style.opacity = "0";
  };
  const idxFromX = (clientX: number) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * w;
    return Math.round(((x - PAD_L) / plotW) * (cur.length - 1));
  };

  const labelsAt = days <= 7 ? dates.map((_, i) => i) : [0, 1, 2, 3, 4, 5].map((k) => Math.round((k / 5) * (dates.length - 1)));
  const total = cur.reduce((a, b) => a + b, 0);
  const before = prev.reduce((a, b) => a + b, 0);

  return (
    <div ref={wrap} className="relative">
      <svg
        ref={svg}
        role="img"
        tabIndex={0}
        aria-label={`${label}: ${total.toLocaleString("en-US")} views in the last ${days} days, ${before.toLocaleString("en-US")} the ${days} days before. Use the arrow keys to read each day.`}
        viewBox={`0 0 ${w} ${H}`}
        width="100%"
        height={H}
        className="block touch-pan-y rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerMove={(e) => showAt(idxFromX(e.clientX))}
        onPointerLeave={() => document.activeElement !== svg.current && hide()}
        onFocus={() => showAt(focusIdx.current ?? cur.length - 1)}
        onBlur={hide}
        onKeyDown={(e) => {
          const i = focusIdx.current ?? cur.length - 1;
          const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? cur.length - 1 : null;
          if (to === null) return;
          e.preventDefault();
          showAt(to);
        }}
      >
        <defs>
          <linearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="pulse-stop" stopOpacity="0.32" />
            <stop offset="1" className="pulse-stop" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`k${id}`}><rect ref={clipEl} x="0" y="0" width="0" height={H} /></clipPath>
        </defs>
        {[0, 0.5, 1].map((f, i) => (
          <g key={f}>
            <line x1={PAD_L} x2={w - 8} y1={PAD_T + plotH * (1 - f)} y2={PAD_T + plotH * (1 - f)} className="pulse-grid" />
            <text ref={(el) => { ticks.current[i] = el; }} x={PAD_L - 8} y={PAD_T + plotH * (1 - f) + 4} textAnchor="end" className="pulse-axis" />
          </g>
        ))}
        {labelsAt.map((i) => (
          <text key={`${dates[i]}-${i}`} x={xAt(i, dates.length)} y={H - 6} textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"} className="pulse-axis">{fmtDay(dates[i], days)}</text>
        ))}
        <path ref={prevEl} className="pulse-prev" fill="none" />
        <g clipPath={`url(#k${id})`}>
          <path ref={areaEl} fill={`url(#a${id})`} />
          <path ref={lineEl} className="pulse-line" fill="none" />
        </g>
        <g ref={cross} style={{ opacity: 0 }} className="pulse-cross" aria-hidden="true">
          <line y1={PAD_T} y2={PAD_T + plotH} />
          <circle r="5" />
        </g>
      </svg>
      <div ref={tip} aria-hidden="true" className="pulse-tip pointer-events-none absolute left-0 top-0" style={{ opacity: 0 }} />
      <p ref={live} aria-live="polite" className="sr-only" />
    </div>
  );
}
