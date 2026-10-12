"use client";
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type AccItem = { id: string; q: string; a: React.ReactNode };

/**
 * FAQ accordion with the liquid slide: the panel's grid row eases from 0fr to 1fr while the
 * answer un-blurs and settles. Real buttons with aria-expanded/controls, so it is keyboard
 * and screen-reader native. One open at a time unless `multi`.
 */
export function LiquidAccordion({ items, defaultOpen, multi, className, onOpen }: { items: AccItem[]; defaultOpen?: string[]; multi?: boolean; className?: string; onOpen?: (id: string) => void }) {
  const [open, setOpen] = useState<string[]>(defaultOpen ?? []);
  const base = useId();
  const toggle = (id: string) => {
    setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : multi ? [...o, id] : [id]));
    if (!open.includes(id)) onOpen?.(id);
  };
  return (
    <div className={cn("border-t border-border", className)}>
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
            <div id={pid} role="region" aria-label={it.q} className="liquid-panel" data-open={on}>
              <div>
                <div className="liquid-inner max-w-prose pb-6 pr-11 text-[15px] leading-relaxed text-muted-foreground">{it.a}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
