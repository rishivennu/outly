"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";

/**
 * The sliding pill behind the active tab. Render it inside the active item only: framer's shared layoutId moves it
 * from the old item to the new one. Reduced motion: it jumps.
 */
export function AnimatedTabIndicator({ layoutId, className }: { layoutId: string; className?: string }) {
  const reduce = useReducedMotion();
  return <motion.span layoutId={layoutId} aria-hidden="true" className={cn("absolute inset-0 rounded-full bg-background shadow-sm", className)} transition={reduce ? { duration: 0 } : motionTransitions.springMorph} />;
}

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  content?: ReactNode;
  badge?: string | number;
}

export interface AnimatedTabsProps {
  tabs: TabItem[];
  label: string;
  defaultTab?: string;
  activeTab?: string;
  onChange?: (tabId: string) => void;
  className?: string;
  tabsContainerClassName?: string;
  renderContent?: boolean;
  layoutId?: string;
}

/** Buttons that switch panels in place (role="tablist", arrow keys move between tabs). */
export function AnimatedTabs({ tabs, label, defaultTab, activeTab: controlled, onChange, className, tabsContainerClassName, renderContent = true, layoutId }: AnimatedTabsProps) {
  const [own, setOwn] = useState(defaultTab ?? tabs[0]?.id ?? "");
  const active = controlled ?? own;
  const uid = useId();
  const pill = layoutId ?? `tab-pill-${uid}`;
  const reduce = useReducedMotion();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const pick = (id: string) => {
    if (controlled === undefined) setOwn(id);
    onChange?.(id);
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const j = (to + tabs.length) % tabs.length;
    pick(tabs[j].id);
    refs.current[j]?.focus();
  };
  const current = tabs.find((t) => t.id === active);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div role="tablist" aria-label={label} className={cn("gseg flex select-none items-center gap-1 self-start rounded-full bg-secondary/60 p-1 hairline", tabsContainerClassName)}>
        {tabs.map((t, i) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${t.id}`}
              aria-selected={on}
              aria-controls={renderContent ? `${uid}-panel` : undefined}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "relative flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                on ? "text-foreground" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground",
              )}
            >
              {on && <AnimatedTabIndicator layoutId={pill} className="gseg-pane" />}
              <span className="relative flex items-center gap-1.5">
                {t.icon}
                {t.label}
                {t.badge !== undefined && <span className="rounded-full bg-foreground/[0.08] px-1.5 text-[11px] tabular-nums text-foreground/60">{t.badge}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {renderContent && (
        <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${active}`} className="relative">
          <AnimatePresence mode="wait" initial={false}>
            {current?.content && (
              <motion.div key={active} initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }} transition={motionTransitions.springGentle}>
                {current.content}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
