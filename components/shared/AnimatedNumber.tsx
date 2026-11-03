"use client";
import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { bezier, formatOf, stepperOf, timingFor, type NumberFormat, type NumberTier } from "@/lib/motion/numbers";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * The last value each metric showed on this device's tab (browser only, never on the server). Coming back to
 * a page, or switching a range, counts from there instead of from zero.
 */
const seen = new Map<string, number>();

/**
 * 1104: how long a number inside a rising KPI card (.kpi-in: 500ms rise, cards 80ms apart) should wait so it
 * starts once its card is mostly in. Without it the later cards counted while still invisible and appeared with
 * the count already over. Zero outside a card, or once the card's rise has finished.
 */
function cardLead(node: HTMLElement): number {
  const host = node.closest<HTMLElement>(".kpi-in");
  if (!host || typeof host.getAnimations !== "function") return 0;
  const a = host.getAnimations().find((x) => (x as CSSAnimation).animationName === "kpi-rise");
  if (!a || a.playState !== "running") return 0;
  const raw = getComputedStyle(host).animationDelay.trim();
  const delay = (parseFloat(raw) || 0) * (raw.endsWith("ms") ? 1 : 1000);
  const t = typeof a.currentTime === "number" ? a.currentTime : 0;
  return Math.max(0, delay + 150 - t);
}

/**
 * A number that counts up to its value (Round 1, 1102). One rAF loop writes the text through a ref, so React
 * never re-renders per frame. Rules: the last frame is exactly format(value); compact numbers hold their unit
 * while counting (lib/motion/numbers.ts); null shows a dash and never animates; reduced motion shows the value
 * at once; it starts when it scrolls into view. Screen readers get the final value only, once.
 *
 * Pass `id` (stable per metric, e.g. "analytics:views") to remember the value between visits.
 */
export function AnimatedNumber({
  value,
  format = "compact",
  tier,
  id,
  className,
  srSuffix,
}: {
  value: number | null | undefined;
  format?: NumberFormat;
  tier?: NumberTier;
  id?: string;
  className?: string;
  srSuffix?: string;
}) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const played = useRef(false);
  const ok = typeof value === "number" && Number.isFinite(value);
  const text = ok ? formatOf(format)(value) : "–";
  // What the server and the first client render show: the count's start, never the final number (or a fresh
  // load would paint the value, drop to zero on hydration and count back up). The effect owns the text after.
  const start = ok ? formatOf(format)(0) : "–";

  useIso(() => {
    const node = el.current;
    if (!node) return;
    // Update React's own text node in place (replacing it would leave React holding a detached one).
    const write = (s: string) => {
      const t = node.firstChild;
      if (t && t.nodeType === 3) {
        if (t.nodeValue !== s) t.nodeValue = s;
      } else node.textContent = s;
    };
    if (!ok) {
      shown.current = null;
      return write("–");
    }
    const to = value as number;
    const f = format;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = shown.current ?? (id ? seen.get(id) : undefined) ?? 0;
    // Remembered only for what was really shown (on finishing, or where a count stopped), so a number that
    // unmounts before it scrolls into view still counts on the next visit.
    const remember = () => {
      if (id && shown.current !== null) seen.set(id, shown.current);
    };
    if (reduce || from === to) {
      shown.current = to;
      played.current = true;
      remember();
      return write(text);
    }
    const step = stepperOf(f, to);
    const { ms, ease } = timingFor(f, tier, played.current);
    const curve = bezier(ease);
    shown.current = from;
    // A count from zero waits as a plain "0" (not "0.0K") until it starts.
    write(from === 0 ? formatOf(f)(0) : step(from));

    let raf = 0;
    let wait = 0;
    let io: IntersectionObserver | null = null;
    const run = () => {
      const lead = played.current ? 0 : cardLead(node);
      if (lead > 0) {
        wait = window.setTimeout(count, lead);
        return;
      }
      count();
    };
    const count = () => {
      let t0 = 0;
      const frame = (now: number) => {
        if (!t0) t0 = now;
        played.current = true;
        const p = Math.min(1, (now - t0) / ms);
        const v = from + (to - from) * curve(p);
        shown.current = v;
        if (p >= 1) {
          shown.current = to;
          remember();
          return write(text);
        }
        write(step(v));
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    const r = node.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < window.innerHeight;
    if (onScreen || typeof IntersectionObserver === "undefined") run();
    else {
      io = new IntersectionObserver((es) => {
        const e = es[es.length - 1];
        // Jumped past it (End key, an anchor link): show the value, a count nobody sees is pointless.
        const past = !e.isIntersecting && e.boundingClientRect.bottom <= 0;
        if (!e.isIntersecting && !past) return;
        io?.disconnect();
        io = null;
        if (past) {
          shown.current = to;
          played.current = true;
          remember();
          write(text);
        } else run();
      });
      io.observe(node);
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(wait);
      io?.disconnect();
      remember();
    };
    // `text` changes exactly when value or format output does, so an inline format function (a new identity
    // every render) never restarts the count; the effect reads this render's `format` directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, value, text, id, tier]);

  return (
    <span className={cn("tabular", className)}>
      <span ref={el} aria-hidden="true">
        {start}
      </span>
      <span className="sr-only">
        {text}
        {srSuffix}
      </span>
    </span>
  );
}
