"use client";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PlanCardView } from "@/components/billing/PlanCardView";
import { RocketCta } from "@/components/billing/RocketCta";
import { CycleSwitch } from "@/components/billing/CycleSwitch";
import type { CardStyle } from "@/lib/billing/display";
import type { Cycle } from "@/lib/billing/cycle";
import { Reveal } from "./Reveal";
import { cn } from "@/lib/utils";

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
  year: { label: string; minor: number; save: number } | null;
};

/** The landing pricing grid: Monthly / Yearly switch, the admin's card style, and rocket CTAs. */
export function PricingCards({ plans, variant, top }: { plans: CardPlan[]; variant: CardStyle; top: string }) {
  const [cycle, setCycle] = useState<Cycle>("month");
  const reduce = useReducedMotion();
  const save = Math.max(0, ...plans.map((p) => p.year?.save ?? 0));
  const anyYear = plans.some((p) => p.year && p.state === "available");
  return (
    <>
      {anyYear && (
        <div className="mt-6 flex justify-center">
          <CycleSwitch value={cycle} onChange={setCycle} save={save} />
        </div>
      )}
      <Reveal as="ul" stagger className={cn("grid gap-5 md:grid-cols-3", top)}>
        {plans.map((p) => {
          const live = p.state === "available";
          const y = cycle === "year" && p.year ? p.year : null;
          const label = y ? y.label : p.month.label;
          const tone = variant === "bold" && p.featured && live ? "ink" : "lime";
          return (
            <li key={p.id}>
              <PlanCardView
                variant={variant}
                name={p.name}
                note={p.note}
                priceMinor={y ? y.minor : p.month.minor}
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
                      {label}
                    </motion.span>
                  </AnimatePresence>
                }
                cta={
                  live && p.free ? (
                    <RocketCta href="/signup" signup label="Start creating" tone={tone} />
                  ) : live ? (
                    <RocketCta href={`/billing?plan=${p.slug}${y ? "&cycle=year" : ""}`} label={`Choose ${p.name}${y ? " yearly" : ""}`} tone={tone} />
                  ) : (
                    <p className={cn("text-[13px] leading-relaxed", variant === "live" ? "la-mute" : "text-muted-foreground")}>Not on sale yet. Nothing changes for beta accounts without notice.</p>
                  )
                }
              />
            </li>
          );
        })}
      </Reveal>
    </>
  );
}
