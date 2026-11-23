"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import s from "./workshops.module.css";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const ARROW = cn("grid h-12 w-12 place-items-center rounded-full transition disabled:opacity-35 disabled:hover:border-[hsl(var(--foreground)/.14)]", s.whiteBtn, FOCUS);

/**
 * Horizontal card rail with prev/next arrows below (the "Industry Insiders" row). The rail itself is a
 * plain scroll-snap list, so touch, trackpad and Tab all work without the buttons; the arrows are extra.
 */
export function Carousel({ label, children }: { label: string; children: React.ReactNode }) {
  const rail = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState<"start" | "mid" | "end" | "none">("none");

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 4) return setAt("none");
    setAt(el.scrollLeft <= 4 ? "start" : el.scrollLeft >= max - 4 ? "end" : "mid");
  }, []);

  useEffect(() => {
    measure();
    const el = rail.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure]);

  function go(dir: -1 | 1) {
    const el = rail.current;
    if (!el) return;
    const card = el.querySelector("li");
    const step = card ? card.getBoundingClientRect().width + 18 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }

  return (
    <div role="group" aria-label={label}>
      <ul ref={rail} className={s.rail}>
        {children}
      </ul>
      {at !== "none" && (
        <div className="mt-2 flex items-center gap-3 px-5 sm:px-8 xl:mx-auto xl:w-full xl:max-w-[1240px]">
          <button type="button" onClick={() => go(-1)} disabled={at === "start"} aria-label="Previous sessions" className={ARROW}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => go(1)} disabled={at === "end"} aria-label="Next sessions" className={ARROW}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
