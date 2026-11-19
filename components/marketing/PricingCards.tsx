"use client";
import { useBeta } from "./BetaContext";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PlanCardView } from "@/components/billing/PlanCardView";
import { RocketCta } from "@/components/billing/RocketCta";
import { CycleSwitch } from "@/components/billing/CycleSwitch";
import type { CardStyle } from "@/lib/billing/display";
import type { Cycle } from "@/lib/billing/cycle";
import { HScroll } from "./HScroll";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { GUARANTEE_LINE } from "@/lib/billing/guarantee-core";

export type CardPlan = {
  id: string;
  slug: string;
  name: string;
  note: string;
  features: string[];
  state: string;
  featured: boolean;
  free: boolean;
  month: { label: string; minor: number; interval: string };
  /** null when the plan has no yearly option (free, already yearly, or yearly switched off). */
  year: { label: string; minor: number; save: number; intro?: IntroPrice | null } | null;
  /** 1147: the first-time subscriber price, server-rendered from the policy; absent while the policy is off. */
  intro?: IntroPrice | null;
};
export type IntroPrice = { label: string; minor: number; then: string };

/**
 * The landing pricing cards: Monthly / Yearly switch, the admin's card style, and rocket CTAs.
 * R1194: one sideways row instead of a grid; cards keep one readable width on every screen.
 * R1196 (user, 11-18): the row is the landing's GSAP horizontal scrolling gallery (HScroll, lib/motion/hscroll.ts), like
 * What you get and Try it: the sheet holds while the page scroll drives the plans sideways and each card grows in from
 * the right. Without it (no JS, reduced motion) the row is a native snap scroller, focusable for the keyboard, and two
 * arrows step it a card at a time for mouse users; with the gallery on, the arrows stand down (globals.css). When every
 * card fits, the row centres itself and the arrows stay away.
 */
export function PricingCards({ plans, variant, top }: { plans: CardPlan[]; variant: CardStyle; top: string }) {
  const beta = useBeta();
  const [cycle, setCycle] = useState<Cycle>("month");
  const reduce = useReducedMotion();
  const save = Math.max(0, ...plans.map((p) => p.year?.save ?? 0));
  const anyYear = plans.some((p) => p.year && p.state === "available");
  const wrapRef = useRef<HTMLDivElement>(null);
  const box = () => wrapRef.current?.querySelector<HTMLElement>("[data-hs-box]") ?? null; // HScroll's own scroll box
  const [more, setMore] = useState("");
  useEffect(() => {
    const el = box();
    if (!el) return;
    const read = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = max <= 1 ? "" : [el.scrollLeft > 1 ? "left" : "", el.scrollLeft < max - 1 ? "right" : ""].filter(Boolean).join(" ");
      setMore((m) => (m === next ? m : next));
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", read); ro?.disconnect(); };
  }, [plans.length]);
  // One card (plus the gap) per tap, in the row's own scroll, so snap settles it on a card edge.
  const step = (dir: 1 | -1) => {
    const el = box();
    if (!el) return;
    const card = el.querySelector<HTMLElement>("li");
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? 320) + 20), behavior: reduce ? "auto" : "smooth" });
  };
  const arrow = "inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-35 disabled:hover:bg-background";
  return (
    <>
      {anyYear && (
        <div className="mt-6 flex justify-center">
          <CycleSwitch value={cycle} onChange={setCycle} save={save} />
        </div>
      )}
      <div ref={wrapRef} className={cn("relative", top)}>
        <HScroll label="Plans" focusable list className="price-hs">
            {plans.map((p) => {
          const live = p.state === "available";
          const y = cycle === "year" && p.year ? p.year : null;
          const intro = y ? y.intro : p.intro;
          const label = intro ? intro.label : y ? y.label : p.month.label;
          const tone = variant === "bold" && p.featured && live ? "ink" : "lime";
          return (
            <li key={p.id} className="hs-item price-item">
              <PlanCardView
                variant={variant}
                name={p.name}
                note={p.note}
                priceMinor={intro ? intro.minor : y ? y.minor : p.month.minor}
                interval={y ? "year" : p.month.interval}
                save={y?.save ?? 0}
                state={p.state}
                features={p.features}
                featured={p.featured}
                price={
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={label}
                      className="block"
                      initial={reduce ? false : { opacity: 0, y: 10, filter: "blur(4px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, filter: "blur(4px)" }}
                      transition={{ duration: 0.3 }}
                    >
                      <PriceLabel label={label} />
                    </motion.span>
                  </AnimatePresence>
                }
                cta={
                  live && p.free ? (
                    <RocketCta href="/signup" signup label="Start creating" tone={tone} />
                  ) : live ? (
                    <>
                      {intro && (
                        <p className={cn("mb-3 text-[13px] leading-snug", variant === "live" ? "la-mute" : tone === "ink" ? "text-current" : "text-muted-foreground")}>
                          <span className="font-semibold">First-time subscriber offer.</span> {intro.then}
                        </p>
                      )}
                      <RocketCta href={`/billing?plan=${p.slug}${y ? "&cycle=year" : ""}`} label={`Choose ${p.name}${y ? " yearly" : ""}`} tone={tone} />
                      {/* 1076: the guarantee on every paid card, right under the button. */}
                      <p className={cn("mt-2.5 flex items-center justify-center gap-1.5 text-[12.5px] font-medium", variant === "live" ? "la-mute" : tone === "ink" ? "text-current" : "text-muted-foreground")}>
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {GUARANTEE_LINE}
                      </p>
                    </>
                  ) : (
                    <p className={cn("text-[13px] leading-relaxed", variant === "live" ? "la-mute" : "text-muted-foreground")}>{beta ? "Not on sale yet. Nothing changes for beta accounts without notice." : "Not on sale yet. You'll see the price here before anything changes."}</p>
                  )
                }
              />
            </li>
          );
        })}
        </HScroll>
        {more && (
          <div className="price-arrows mt-5 flex items-center justify-center gap-3">
            <button type="button" onClick={() => step(-1)} disabled={!more.includes("left")} aria-label="Previous plans" className={arrow}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => step(1)} disabled={!more.includes("right")} aria-label="Next plans" className={arrow}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * R1223: a currency sign outside Latin-1 (the rupee) is set in the system font. Inter's latin subset has no "₹", so
 * the three prices alone made every landing visit download Inter's 83 KB latin-ext file, for one glyph that looks the
 * same from the system font. Signs in Latin-1 or in that subset ("$", "€") are left as they are.
 */
export function PriceLabel({ label }: { label: string }) {
  const m = /^(\D+?)(\d.*)$/s.exec(label);
  if (!m || /^[\u0000-\u00ff\u20ac]+$/.test(m[1])) return <>{label}</>;
  return (
    <>
      <span className="cur-sym">{m[1]}</span>
      {m[2]}
    </>
  );
}
