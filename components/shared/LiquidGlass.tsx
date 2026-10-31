"use client";

import { useEffect } from "react";

/*
 * Liquid glass refraction, after prabinpebam/figma-liquid-glass (MIT). The plugin's WebGL shader bends the
 * background inside an edge band of a rounded box: distortion = strength * pow(edgeAmount, 2), sampled toward
 * the centre, with red and blue pulled by slightly different amounts (chromatic aberration). The web has no
 * shader for backdrops, so this builds the same edge map as an image and feeds it to an SVG feDisplacementMap,
 * referenced from `backdrop-filter: url(#...)`.
 *
 * Only Chromium supports an SVG filter in backdrop-filter. Safari and Firefox keep the CSS layers of `.lg-glass`
 * (frosted blur, angled rim, reflection, inner glow), which read as glass without the bend.
 * People who ask for less transparency or more contrast get the solid surface from globals.css.
 *
 * 1077, the website: any element with `data-lens` opts in too, and tunes itself from CSS custom properties
 * (unitless px): --lg-band (edge band), --lg-bend (strength), --lg-ca (colour split) and --lg-core. With
 * --lg-core > 0 the filter does its own frost: the rim shows the page sharp and bent, as Liquid Glass does,
 * and only the middle, where the labels sit, is blurred by --lg-core. CSS then drops its own blur.
 * Elements with `data-lg-shine` also light up under the pointer (a soft glow from the contact point).
 */

const EDGE = 20; // px, the plugin's "edge" (edgeDistortionThickness)
const STRENGTH = 25; // px, the plugin's "strength" (refractionStrength)
const CA = 5; // px, the plugin's "ca" (chromatic aberration)
const SELECTOR = ".lg-glass, html[data-app] .liquid, [data-lens]";
const MAX_FILTERS = 48;

function chromium(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  if (brands) return brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
  return /Chrom(e|ium)\//.test(navigator.userAgent) && !/Firefox|FxiOS|EdgiOS|CriOS/.test(navigator.userAgent);
}

type Lens = { band: number; bend: number; ca: number; core: number };

/**
 * Edge map for a w x h rounded box: R/G = x/y displacement (128 = none), toward the centre, strongest at the rim.
 * B = how much of the sharp rim shows over the frosted core (255 at the edge, 0 past the band).
 */
function edgeMap(w: number, h: number, r: number, edge: number): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  for (let y = 0; y < h; y++) {
    const py = y + 0.5 - h / 2;
    const qy = Math.abs(py) - hy;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const px = x + 0.5 - w / 2;
      const qx = Math.abs(px) - hx;
      // signed distance to the rounded box (negative inside), and its outward normal
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const outer = Math.hypot(ox, oy);
      const sdf = outer + Math.min(Math.max(qx, qy), 0) - r;
      let nx = 0;
      let ny = 0;
      if (outer > 0) {
        nx = (ox / outer) * Math.sign(px);
        ny = (oy / outer) * Math.sign(py);
      } else if (qx > qy) nx = Math.sign(px);
      else ny = Math.sign(py);
      let amt = 0;
      let rim = 0;
      if (sdf < 0 && sdf > -edge) {
        const e = (sdf + edge) / edge;
        amt = e * e;
        rim = e * e * (3 - 2 * e); // smoothstep: no visible seam where the sharp rim meets the frost
      } else if (sdf >= 0) rim = 1;
      // feDisplacementMap samples at p + scale * (C - 0.5); -normal pulls the rim's pixels from further in
      d[i] = Math.round(128 - nx * amt * 127);
      d[i + 1] = Math.round(128 - ny * amt * 127);
      d[i + 2] = Math.round(rim * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

const NS = "http://www.w3.org/2000/svg";

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function buildFilter(id: string, w: number, h: number, r: number, lens: Lens): SVGFilterElement {
  const edge = Math.min(lens.band, Math.min(w, h) / 2);
  const f = el("filter", { id, x: 0, y: 0, width: w, height: h, filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" }) as SVGFilterElement;
  f.appendChild(el("feImage", { href: edgeMap(w, h, r, edge), x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "map" }));
  // Split mode samples a hair-softened copy so the sharp rim doesn't shimmer as the page scrolls under it.
  const src = lens.core > 0 ? "src" : "SourceGraphic";
  if (lens.core > 0) f.appendChild(el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 0.6, result: "src" }));
  // No colour split (--lg-ca: 0): one pass instead of three, and nothing for saturate() to tint.
  if (lens.ca <= 0 && lens.core > 0) {
    f.appendChild(el("feDisplacementMap", { in: src, in2: "map", scale: 2 * lens.bend, xChannelSelector: "R", yChannelSelector: "G", result: "bent" }));
    return core(f, lens.core);
  }
  const channel = (scale: number, keep: string, out: string) => {
    f.appendChild(el("feDisplacementMap", { in: src, in2: "map", scale, xChannelSelector: "R", yChannelSelector: "G", result: `${out}d` }));
    f.appendChild(el("feColorMatrix", { in: `${out}d`, type: "matrix", values: keep, result: out }));
  };
  channel(2 * Math.max(0, lens.bend - lens.ca / 2), "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", "r");
  channel(2 * lens.bend, "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", "g");
  channel(2 * (lens.bend + lens.ca / 2), "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0", "b");
  f.appendChild(el("feBlend", { in: "r", in2: "g", mode: "screen", result: "rg" }));
  if (lens.core <= 0) {
    f.appendChild(el("feBlend", { in: "rg", in2: "b", mode: "screen" }));
    return f;
  }
  f.appendChild(el("feBlend", { in: "rg", in2: "b", mode: "screen", result: "bent" }));
  return core(f, lens.core);
}

/** Split mode's last step: the sharp, bent rim (from "bent") over a frosted middle. */
function core(f: SVGFilterElement, frost: number): SVGFilterElement {
  // the map's blue channel becomes the rim's alpha
  f.appendChild(el("feColorMatrix", { in: "map", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0", result: "rimA" }));
  f.appendChild(el("feComposite", { in: "bent", in2: "rimA", operator: "in", result: "rim" }));
  f.appendChild(el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: frost, edgeMode: "duplicate", result: "soft" }));
  f.appendChild(el("feComposite", { in: "rim", in2: "soft", operator: "over" }));
  return f;
}

function lensOf(node: HTMLElement): Lens {
  const cs = getComputedStyle(node);
  const num = (name: string, fallback: number, max: number) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? Math.max(0, Math.min(v, max)) : fallback;
  };
  return { band: num("--lg-band", EDGE, 48), bend: num("--lg-bend", STRENGTH, 40), ca: num("--lg-ca", CA, 10), core: num("--lg-core", 0, 30) };
}

function radiusOf(node: HTMLElement, w: number, h: number): number {
  const raw = getComputedStyle(node).borderTopLeftRadius;
  const n = parseFloat(raw) || 0;
  const px = raw.endsWith("%") ? (n / 100) * Math.min(w, h) : n;
  return Math.max(0, Math.min(px, w / 2, h / 2));
}

/** 1077: a glow that starts where the pointer is, on `[data-lg-shine]` surfaces. Plain CSS, so every browser gets it. */
function useShine() {
  useEffect(() => {
    let lit: HTMLElement | null = null;
    let raf = 0;
    let last: PointerEvent | null = null;
    let off: ReturnType<typeof setTimeout> | undefined;
    const set = (node: HTMLElement | null) => {
      if (lit === node) return;
      lit?.removeAttribute("data-lg-lit");
      lit = node;
      lit?.setAttribute("data-lg-lit", "");
    };
    const paint = () => {
      raf = 0;
      if (!last) return;
      const node = (last.target instanceof Element ? last.target.closest<HTMLElement>("[data-lg-shine]") : null) ?? null;
      set(node);
      if (!node) return;
      const b = node.getBoundingClientRect();
      node.style.setProperty("--lg-x", `${Math.round(last.clientX - b.left)}px`);
      node.style.setProperty("--lg-y", `${Math.round(last.clientY - b.top)}px`);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      last = e;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    // a tap glows for a moment from the fingertip, then fades
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      last = e;
      paint();
      if (off) clearTimeout(off);
      off = setTimeout(() => set(null), 450);
    };
    const leave = () => set(null);
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerdown", down, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", down);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      if (raf) cancelAnimationFrame(raf);
      if (off) clearTimeout(off);
      set(null);
    };
  }, []);
}

export function LiquidGlass() {
  useShine();
  useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !chromium()) return;
    const root = document.documentElement;
    const svg = el("svg", { "aria-hidden": "true", focusable: "false", width: 0, height: 0 }) as SVGSVGElement;
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    const defs = el("defs", {});
    svg.appendChild(defs);
    document.body.appendChild(svg);
    root.setAttribute("data-lg", "refract");

    const filters = new Map<string, SVGFilterElement>(); // key -> filter, oldest first
    const keyOf = new Map<HTMLElement, string>();

    const prune = () => {
      if (filters.size <= MAX_FILTERS) return;
      const used = new Set(keyOf.values());
      for (const [k, f] of filters) {
        if (filters.size <= MAX_FILTERS) break;
        if (!used.has(k)) { f.remove(); filters.delete(k); }
      }
    };

    const apply = (node: HTMLElement) => {
      if (!node.isConnected) return;
      const w = Math.round(node.offsetWidth);
      const h = Math.round(node.offsetHeight);
      if (w < 8 || h < 8 || w * h > 1_600_000) { node.removeAttribute("data-lg-ready"); return; }
      const r = Math.round(radiusOf(node, w, h));
      const lens = lensOf(node);
      const key = `${w}x${h}r${r}` + (node.hasAttribute("data-lens") ? `b${lens.band}s${lens.bend}c${lens.ca}k${lens.core}`.replace(/\./g, "_") : "");
      if (keyOf.get(node) === key && node.hasAttribute("data-lg-ready")) return;
      let f = filters.get(key);
      if (!f) {
        f = buildFilter(`lg-${key}`, w, h, r, lens);
        defs.appendChild(f);
        filters.set(key, f);
      }
      keyOf.set(node, key);
      node.style.setProperty("--lg-url", `url(#lg-${key})`);
      node.setAttribute("data-lg-ready", "");
      prune();
    };

    // Sizes settle over a few frames (sheets and toasts animate in); coalesce to one pass per frame.
    const pending = new Set<HTMLElement>();
    let raf = 0;
    const queue = (node: HTMLElement) => {
      pending.add(node);
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; pending.forEach(apply); pending.clear(); });
    };
    const ro = new ResizeObserver((entries) => entries.forEach((e) => queue(e.target as HTMLElement)));
    const watch = (node: HTMLElement) => { if (!keyOf.has(node)) { keyOf.set(node, ""); ro.observe(node); queue(node); } };
    const scan = (scope: ParentNode) => {
      if (scope instanceof HTMLElement && scope.matches(SELECTOR)) watch(scope);
      scope.querySelectorAll<HTMLElement>(SELECTOR).forEach(watch);
    };
    const forget = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      const gone = [node, ...node.querySelectorAll<HTMLElement>("[data-lg-ready]")];
      gone.forEach((n) => { if (keyOf.has(n)) { ro.unobserve(n); keyOf.delete(n); } });
    };

    scan(document);
    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach((n) => { if (n instanceof HTMLElement) scan(n); });
        rec.removedNodes.forEach(forget);
        if (rec.type === "attributes" && rec.target instanceof HTMLElement && rec.target.matches(SELECTOR)) watch(rec.target);
      }
      prune();
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

    return () => {
      mo.disconnect();
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      keyOf.forEach((_, n) => { n.removeAttribute("data-lg-ready"); n.style.removeProperty("--lg-url"); });
      svg.remove();
      root.removeAttribute("data-lg");
    };
  }, []);
  return null;
}
