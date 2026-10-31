"use client";
import { useEffect, useRef } from "react";
import { prefersReduced } from "./motion";

/**
 * Slot-machine digits (1080). Each digit is a 0-9 strip in a one-line window; changing the value slides
 * every strip to its new digit, the leftmost first. The window's width is its widest digit, so the number
 * never shifts sideways mid-roll. Screen readers get the plain text once, never the strips.
 */
export function RollingNumber({ value, className }: { value: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const strips = [...el.querySelectorAll<HTMLElement>("[data-strip]")];
    const reduced = prefersReduced();
    const set = (s: HTMLElement, d: number, i: number, animate: boolean) => {
      s.style.transition = animate && !reduced ? `transform 900ms cubic-bezier(.2,.8,.2,1) ${i * 60}ms` : "none";
      s.style.transform = `translate3d(0,${-d * 10}%,0)`;
    };
    if (first.current) {
      // First paint: start every strip at 0 and roll up to the value when the card enters.
      first.current = false;
      if (!reduced) {
        strips.forEach((s, i) => set(s, 0, i, false));
        const start = () => strips.forEach((s, i) => set(s, Number(s.dataset.strip), i, true));
        const root = el.closest("[data-enter-js]");
        const on = () => requestAnimationFrame(() => requestAnimationFrame(start));
        if (root) {
          root.addEventListener("pulse:enter", on, { once: true });
          const fallback = setTimeout(on, 1500); // the root may have entered before this mounted
          return () => {
            clearTimeout(fallback);
            root.removeEventListener("pulse:enter", on);
          };
        }
        on();
        return;
      }
    }
    strips.forEach((s, i) => set(s, Number(s.dataset.strip), i, true));
  }, [value]);

  // Digits keep their position from the right, so 999 -> 1,000 rolls the ones into place instead of re-mounting.
  const chars = [...value];
  return (
    <span className={className}>
      <span className="sr-only">{value}</span>
      <span ref={box} aria-hidden="true" className="inline-flex tabular-nums leading-none">
        {chars.map((c, i) => {
          const key = `${chars.length - i}`;
          if (!/\d/.test(c)) return <span key={`s${key}${c}`} className="inline-block">{c}</span>;
          return (
            <span key={`d${key}`} className="relative inline-block h-[1em] overflow-hidden">
              <span data-strip={c} className="flex flex-col will-change-transform" style={{ transform: `translate3d(0,${-Number(c) * 10}%,0)` }}>
                {"0123456789".split("").map((d) => <span key={d} className="block h-[1em] leading-none">{d}</span>)}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
