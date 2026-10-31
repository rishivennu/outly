"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Reel-style captions (1070, after the agenticmatt UX reel): one word at a time, big, bold and upper case,
 * each one popping in where the last one was, like auto-captions on a Reel or Short. Words ending a
 * sentence hold a little longer, and the line rests for a beat before it starts again.
 *
 * Decoration: the words are aria-hidden and the whole line sits in an sr-only copy (skipped when the
 * parent is already aria-hidden). It only runs while on screen and while the tab is visible. Reduced
 * motion shows the whole line, still.
 */
const WORD = 340; // ms a word stays up
const STOP = 640; // after . ! ?
const REST = 1100; // before the line starts over

export function CaptionPop({ text, className, srText = true }: { text: string; className?: string; srText?: boolean }) {
  const words = text.split(/\s+/).filter(Boolean);
  const [i, setI] = useState(0);
  const [still, setStill] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(reduce.matches);
    sync();
    reduce.addEventListener("change", sync);
    return () => reduce.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (still || words.length < 2) return;
    const el = ref.current;
    let seen = true;
    let t = 0;
    let at = 0;
    const next = () => {
      if (!seen || document.hidden) {
        t = 0;
        return; // resumed by the observer / visibility listener
      }
      at = (at + 1) % words.length;
      setI(at);
      schedule();
    };
    const schedule = () => {
      const w = words[at];
      const last = at === words.length - 1;
      t = window.setTimeout(next, (/[.!?]$/.test(w) ? STOP : WORD) + (last ? REST : 0));
    };
    const resume = () => {
      if (!t && seen && !document.hidden) schedule();
    };
    const io = typeof IntersectionObserver !== "undefined" && el
      ? new IntersectionObserver(([e]) => {
          seen = e.isIntersecting;
          resume();
        })
      : null;
    if (io && el) io.observe(el);
    document.addEventListener("visibilitychange", resume);
    schedule();
    return () => {
      clearTimeout(t);
      io?.disconnect();
      document.removeEventListener("visibilitychange", resume);
    };
  }, [still, text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span ref={ref} className={cn("cap-pop", className)}>
      {srText && <span className="sr-only">{text}</span>}
      {still ? (
        <span aria-hidden="true" className="cap-line">{text}</span>
      ) : (
        <span aria-hidden="true" key={i} className="cap-w">
          {words[i]}
        </span>
      )}
    </span>
  );
}
