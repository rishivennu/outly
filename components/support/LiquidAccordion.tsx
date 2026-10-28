"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/marketing/Reveal";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * One answer panel. Before hydration the CSS grid-rows transition opens it; once mounted, GSAP takes over
 * (data-gs) and tweens the real height, so an answer opened or closed mid-motion turns around smoothly
 * from wherever it is. Reduced motion: instant.
 */
function Panel({ id, label, on, children }: { id: string; label: string; on: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    el.dataset.gs = "";
    if (first.current) {
      first.current = false;
      gsap.set(el, { height: on ? "auto" : 0 });
      return;
    }
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.killTweensOf(el);
    if (on) gsap.fromTo(el, { height: el.offsetHeight }, { height: "auto", duration: still ? 0 : 0.62, ease: "expo.out" });
    else gsap.fromTo(el, { height: el.offsetHeight }, { height: 0, duration: still ? 0 : 0.42, ease: "power3.inOut" });
  }, [on]);
  useEffect(() => () => { if (ref.current) gsap.killTweensOf(ref.current); }, []);
  return (
    <div ref={ref} id={id} role="region" aria-label={label} className="liquid-panel" data-open={on}>
      <div>
        <div className="liquid-inner max-w-prose pb-6 pr-11 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export type AccItem = { id: string; q: string; a: React.ReactNode };

/**
 * FAQ accordion with the liquid slide: the panel's grid row eases from 0fr to 1fr while the
 * answer un-blurs and settles. Real buttons with aria-expanded/controls, so it is keyboard
 * and screen-reader native. One open at a time unless `multi`.
 */
export function LiquidAccordion({ items, defaultOpen, multi, className, onOpen, reveal }: { items: AccItem[]; defaultOpen?: string[]; multi?: boolean; className?: string; onOpen?: (id: string) => void; /** Landing: each question rises in turn on scroll (the reveal engine). */ reveal?: boolean }) {
  const [open, setOpen] = useState<string[]>(defaultOpen ?? []);
  const base = useId();
  const toggle = (id: string) => {
    setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : multi ? [...o, id] : [id]));
    if (!open.includes(id)) onOpen?.(id);
  };
  const Root = reveal ? RevealRoot : PlainRoot;
  return (
    <Root className={cn("border-t border-border", className)}>
      {items.map((it) => {
        const on = open.includes(it.id);
        const pid = `${base}-${it.id}`;
        return (
          <div key={it.id} id={`faq-${it.id}`} className="scroll-mt-28 border-b border-border">
            <h3>
              <button type="button" aria-expanded={on} aria-controls={pid} onClick={() => toggle(it.id)} className="group flex w-full items-start gap-4 py-5 text-left text-[17px] font-medium tracking-tight transition-colors hover:text-foreground">
                <span className="flex-1 text-pretty">{it.q}</span>
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full transition-[transform,background-color] duration-500 [transition-timing-function:var(--ease-liquid)]", on ? "rotate-45 bg-lime text-[hsl(var(--lime-foreground))]" : "bg-secondary text-muted-foreground group-hover:scale-110")} aria-hidden="true">
                  <Plus className="h-4 w-4" />
                </span>
              </button>
            </h3>
            <Panel id={pid} label={it.q} on={on}>
              {it.a}
            </Panel>
          </div>
        );
      })}
    </Root>
  );
}

function PlainRoot({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={className}>{children}</div>;
}
function RevealRoot({ className, children }: { className?: string; children: React.ReactNode }) {
  return <Reveal stagger y={18} className={className}>{children}</Reveal>;
}
