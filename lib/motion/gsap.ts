"use client";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Animations only run inside this query; reduced-motion users get the final state, no tweening. */
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";

const NUM = /^(\d[\d,]*)(\.\d+)?(%?)$/;

/**
 * Count a number up from 0 inside `el`. The real value lives in `data-count` (React keeps it current),
 * so the text always lands on exactly what React rendered, even if the tween is cut short.
 * Values that are not plain numbers ("n/a", "<1%") are left alone.
 */
export function countUp(tl: gsap.core.Timeline, el: HTMLElement, at: number | string, duration = 0.9) {
  const final = el.dataset.count ?? "";
  const m = NUM.exec(final);
  if (!m) return;
  const target = Number(m[1].replace(/,/g, "") + (m[2] ?? ""));
  if (!target) return;
  const decimals = m[2] ? m[2].length - 1 : 0;
  const commas = m[1].includes(",");
  const fmt = (v: number) => {
    const n = decimals ? v.toFixed(decimals) : String(Math.round(v));
    return (commas ? Number(n).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : n) + m[3];
  };
  const o = { v: 0 };
  tl.to(o, {
    v: target,
    duration,
    ease: "power2.out",
    onStart: () => { el.textContent = fmt(0); },
    onUpdate: () => { el.textContent = fmt(o.v); },
    onComplete: () => { el.textContent = el.dataset.count ?? final; },
  }, at);
}

/** Put every count-up element back to its real value (used in cleanup). */
export function settleCounts(root: HTMLElement | null) {
  root?.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
    if (el.dataset.count != null) el.textContent = el.dataset.count;
  });
}

export { gsap, useGSAP };
