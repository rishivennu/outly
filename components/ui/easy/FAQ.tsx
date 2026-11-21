"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { Reveal } from "@/components/marketing/Reveal";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";
import { cn } from "@/lib/utils";

export interface FAQItem {
  id: string;
  question: string;
  answer: React.ReactNode;
}

export interface FAQProps {
  items: FAQItem[];
  allowMultiple?: boolean;
  defaultOpen?: string[];
  /** Fires when an answer opens. */
  onOpen?: (id: string) => void;
  /** Landing: each question rises in turn on scroll (the reveal engine). */
  reveal?: boolean;
  className?: string;
}

/**
 * The FAQ accordion: one answer open at a time unless `allowMultiple`, a spring on the real height, and the
 * plus turning into a lime close mark. Closed answers stay in the page (find-in-page and crawlers still see
 * them) but are inert, so their links are not in the tab order. Each row is `#faq-<id>` for deep links.
 */
export function FAQ({ items, allowMultiple = false, defaultOpen, onOpen, reveal = false, className }: FAQProps) {
  const [open, setOpen] = React.useState<string[]>(defaultOpen ?? []);
  const calm = useReducedMotion();
  const base = React.useId();
  const t = calm ? { duration: 0 } : motionTransitions.springGentle;

  const toggle = (id: string) => {
    const opening = !open.includes(id);
    setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : allowMultiple ? [...o, id] : [id]));
    if (opening) onOpen?.(id);
  };

  const rows = items.map((item) => {
    const on = open.includes(item.id);
    const head = `${base}-h-${item.id}`;
    const body = `${base}-b-${item.id}`;
    return (
      <div key={item.id} id={`faq-${item.id}`} className="scroll-mt-28 border-b border-border">
        <h3>
          <button
            id={head}
            type="button"
            aria-expanded={on}
            aria-controls={body}
            onClick={() => toggle(item.id)}
            className="group flex min-h-11 w-full items-start gap-4 rounded-xl py-5 text-left text-[17px] font-medium tracking-tight outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            <span className="flex-1 text-pretty">{item.question}</span>
            <motion.span
              aria-hidden="true"
              initial={false}
              animate={{ rotate: on ? 45 : 0 }}
              transition={calm ? { duration: 0 } : motionTransitions.springSnappy}
              className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors duration-300", on ? "bg-lime text-[hsl(var(--lime-foreground))]" : "bg-secondary text-muted-foreground")}
            >
              <Plus className="h-4 w-4" />
            </motion.span>
          </button>
        </h3>
        <motion.div
          id={body}
          role="region"
          aria-labelledby={head}
          inert={!on}
          initial={false}
          animate={{ height: on ? "auto" : 0, opacity: on ? 1 : 0 }}
          transition={t}
          className="overflow-hidden"
        >
          <div className="max-w-prose pb-6 pr-11 text-[15px] leading-relaxed text-muted-foreground">{item.answer}</div>
        </motion.div>
      </div>
    );
  });

  return reveal ? (
    <Reveal stagger y={18} className={cn("border-t border-border", className)}>
      {rows}
    </Reveal>
  ) : (
    <div className={cn("border-t border-border", className)}>{rows}</div>
  );
}
