"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

/*
 * The spotlight both tours share: the studio-wide welcome tour (Tour.tsx) and the first-visit tips on
 * each page (PageGuide.tsx). A stop points at a `data-tour` name ("calendar") or any CSS selector
 * ('[aria-labelledby="plans"]'); the first visible match wins, and no match means a centred card.
 */

export type Stop = { target?: string; title: string; body: string; owner?: boolean };

const sel = (t: string) => (/^[a-z-]+$/.test(t) ? `[data-tour="${t}"]` : t);

export function findTarget(target?: string): HTMLElement | null {
  if (!target) return null;
  let list: HTMLElement[] = [];
  try {
    list = Array.from(document.querySelectorAll<HTMLElement>(sel(target)));
  } catch {
    return null; // a bad selector must never break the page
  }
  for (const el of list) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

/** The stop's own target, or on a phone (where most pages live under More) the More button. */
function locate(target?: string, moreFallback = false): { el: HTMLElement | null; viaMore: boolean } {
  const el = findTarget(target);
  if (el || !target || !moreFallback) return { el, viaMore: false };
  const more = findTarget("more");
  return { el: more, viaMore: !!more };
}

type Props = {
  stops: Stop[];
  /** done: finished or closed; skip: the first card's secondary button. */
  onClose: (how: "done" | "skip") => void;
  /** Small label over the title, e.g. "Calendar tips". */
  kicker?: string;
  skipLabel?: string;
  /** Point at More when a target is hidden in the phone's More panel (the welcome tour's nav stops). */
  moreFallback?: boolean;
  /** Buttons for the last card; the default is a single "Got it". */
  finish?: (close: () => void, ref: React.Ref<HTMLAnchorElement & HTMLButtonElement>) => React.ReactNode;
  label: string;
};

export function Spotlight({ stops, onClose, kicker, skipLabel = "Skip", moreFallback, finish, label }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [viaMore, setViaMore] = useState(false);
  // Start from the real screen so the first paint never computes a negative card width.
  const [size, setSize] = useState(() => (typeof window === "undefined" ? { w: 1024, h: 768 } : { w: window.innerWidth, h: window.innerHeight }));
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLAnchorElement & HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    return () => (opener.current as HTMLElement | null)?.focus?.({ preventScroll: true });
  }, []);

  const i = Math.min(step, stops.length - 1);
  const stop = stops[i];

  // Follow the target through scrolls and resizes, one measurement per frame at most.
  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { el, viaMore: more } = locate(stop.target, moreFallback);
        setRect(el ? el.getBoundingClientRect() : null);
        setViaMore(more);
        setSize({ w: window.innerWidth, h: window.innerHeight });
      });
    };
    const { el } = locate(stop.target, moreFallback);
    const r = el?.getBoundingClientRect();
    // A tall target (a whole week, the assistant panel): bring its top in; the spotlight clips to the screen.
    // The margin keeps it clear of the phone's fixed top bar.
    if (el) {
      const was = el.style.scrollMarginTop;
      el.style.scrollMarginTop = "88px";
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: r && r.height > window.innerHeight * 0.6 ? "start" : "nearest", behavior: calm ? "auto" : "smooth" });
      el.style.scrollMarginTop = was;
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // Keyed on the step too: two stops in a row with the same (or no) target still re-measure.
  }, [i, stop.target, moreFallback]);

  useEffect(() => {
    next.current?.focus({ preventScroll: true });
  }, [i]);

  const last = i === stops.length - 1;
  const close = () => onClose("done");
  const go = (d: number) => setStep((s) => Math.min(stops.length - 1, Math.max(0, s + d)));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (e.key === "ArrowRight") return last ? close() : go(1);
    if (e.key === "ArrowLeft") return go(-1);
    if (e.key === "Tab" && card.current) {
      // keep focus inside the card while it is open
      const f = Array.from(card.current.querySelectorAll<HTMLElement>("button, a[href]"));
      if (!f.length) return;
      const [first, end] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), end.focus());
      else if (!e.shiftKey && document.activeElement === end) (e.preventDefault(), first.focus());
    }
  };

  // Listen on the document, not the card: a click on the dimmed page moves focus to <body>, and the
  // keys must still work then. The ref always holds this render's handler.
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const PAD = 6;
  const W = Math.min(340, size.w - 24);
  const phone = size.w < 1024;
  // Clip the spotlight to the screen so a tall target never pushes the card off it.
  const spot = rect && {
    left: Math.max(8, rect.left - PAD),
    top: Math.max(8, rect.top - PAD),
    right: Math.min(size.w - 8, rect.right + PAD),
    bottom: Math.min(size.h - 8, rect.bottom + PAD),
  };
  const big = !!spot && (spot.bottom - spot.top > size.h * 0.55 || spot.right - spot.left > size.w * 0.8);
  let pos: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (spot && big) {
    // Sits over the target's lower part, clear of the phone tab bar.
    pos = { left: "50%", transform: "translateX(-50%)", bottom: phone ? "calc(max(12px, env(safe-area-inset-bottom)) + 88px)" : 24 };
  } else if (spot) {
    const right = spot.right + 10 + W < size.w;
    if (right) pos = { left: spot.right + 10, top: Math.max(12, Math.min(spot.top - 2, size.h - 280)) };
    else {
      const above = spot.top > size.h / 2;
      const left = Math.max(12, Math.min((spot.left + spot.right) / 2 - W / 2, size.w - W - 12));
      pos = above ? { left, bottom: size.h - spot.top + 8 } : { left, top: Math.min(spot.bottom + 8, size.h - 280) };
    }
  }

  return createPortal(
    <div className="tour-root fixed inset-0 z-[95]">
      {spot ? (
        <div className="tour-spot pointer-events-none fixed rounded-2xl" style={{ left: spot.left, top: spot.top, width: spot.right - spot.left, height: spot.bottom - spot.top }} aria-hidden="true" />
      ) : (
        <div className="tour-dim fixed inset-0" aria-hidden="true" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-describedby="tour-body"
        key={i}
        className="tour-card glass-strong fixed rounded-[24px] p-5 shadow-2xl hairline"
        style={{ width: W, ...pos }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-foreground/80 tabular">
            {i + 1} of {stops.length}
          </span>
          <span className="flex flex-1 gap-1" aria-hidden="true">
            {stops.map((_, k) => (
              <span key={k} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${k <= i ? "bg-lime" : "bg-foreground/10"}`} />
            ))}
          </span>
          <button type="button" onClick={close} aria-label={`Close ${label.toLowerCase()}`} className="-mr-2 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {kicker && <p className="eyebrow mt-1 text-[11px]">{kicker}</p>}
        <h2 id="tour-title" className="mt-1 text-lg font-semibold tracking-tight">
          {stop.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {stop.body}
        </p>
        {viaMore && <p className="mt-2 text-[13px] font-medium text-foreground/85">On your phone, it&apos;s under More.</p>}
        <div className="mt-5 flex items-center gap-2">
          {i > 0 && (
            <button type="button" onClick={() => go(-1)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            </button>
          )}
          {i === 0 && (
            <button type="button" onClick={() => onClose("skip")} className="inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground">
              {skipLabel}
            </button>
          )}
          <span className="flex-1" />
          {last ? (
            finish ? (
              finish(close, next)
            ) : (
              <button ref={next} type="button" onClick={close} className="lime-bg inline-flex min-h-[44px] items-center rounded-full px-5 text-sm font-semibold">
                Got it
              </button>
            )
          ) : (
            <button ref={next} type="button" onClick={() => go(1)} className="lime-bg inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-5 text-sm font-semibold">
              {i === 0 && stops.length > 2 && !kicker ? "Show me" : "Next"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
