"use client";
/* Ported from EasyUI (https://easyui.site), MIT License, Copyright (c) 2026 Suraj Maurya.
   Adapted for Outlly in R1288: Outlly tokens, imports and formatting. */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/components/ui/easy/lib/motion-tokens";

export interface CommandItem {
  id: string;
  title: string;
  category: string;
  icon?: ReactNode;
  /** Extra words that should find this entry (not shown). */
  keywords?: string;
  shortcut?: string;
  onSelect: () => void;
}

export interface CommandMenuProps {
  isOpen: boolean;
  onClose: () => void;
  items: CommandItem[];
  placeholder?: string;
  label?: string;
  /** Extra classes for the overlay root (e.g. a z-index layer). */
  className?: string;
}

/**
 * Fuzzy score: every query character must appear in order. Contiguous runs, word starts and an early first hit score
 * higher; null means no match. An empty query matches everything with the same score, so the list keeps its order.
 */
export function fuzzyScore(text: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 1000 - direct + (direct === 0 || /\W/.test(t[direct - 1]) ? 200 : 0);
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === " ") continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    run = at === ti ? run + 1 : 0;
    score += 1 + run * 3 + (at === 0 || /\W/.test(t[at - 1]) ? 5 : 0) - Math.min(at - ti, 10) * 0.2;
    ti = at + 1;
  }
  return score;
}

export function filterCommands<T extends Pick<CommandItem, "title" | "category" | "keywords">>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, i) => {
      // a title hit always ranks above a hit on the category or keywords only
      const t = fuzzyScore(item.title, query);
      const c = fuzzyScore(`${item.category} ${item.keywords ?? ""}`, query);
      return { item, i, s: t !== null ? 10_000 + t : c };
    })
    .filter((x): x is { item: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

const kbd = "rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground";

export function CommandMenu({ isOpen, onClose, items, placeholder = "Search", label = "Command palette", className }: CommandMenuProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const reduce = useReducedMotion();
  const id = useId();
  const list = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterCommands(items, query), [items, query]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelectedIndex(0);
  }, [isOpen]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const len = filtered.length || 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((p) => (p + 1) % len);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((p) => (p - 1 + len) % len);
    } else if (e.key === "Home") {
      e.preventDefault();
      setSelectedIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSelectedIndex(len - 1);
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].onSelect();
    }
  };

  const optId = (i: number) => `${id}-opt-${i}`;
  // Radix gives the focus trap, Escape, outside press, the scroll lock (which also pauses Lenis) and focus return.
  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTransitions.easeFast} className={cn("fixed inset-0 bg-foreground/40 backdrop-blur-[3px]", className)} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined} onKeyDown={onKeyDown}>
              <div className={cn("pointer-events-none fixed inset-0 flex items-start justify-center px-3 pt-[max(4.5rem,calc(var(--sa-t,0px)+3.5rem))] outline-none sm:px-6 sm:pt-24", className)}>
                <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -8 }}
            transition={motionTransitions.springSnappy}
            className="glass-strong pointer-events-auto relative flex max-h-[min(560px,calc(100dvh-7rem))] w-full max-w-xl flex-col overflow-hidden rounded-[24px] shadow-2xl"
          >
            <div className="flex items-center gap-2.5 border-b border-foreground/[0.08] px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                autoFocus
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${id}-list`}
                aria-activedescendant={filtered[selectedIndex] ? optId(selectedIndex) : undefined}
                aria-autocomplete="list"
                aria-label={placeholder}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder={placeholder}
                className="h-14 w-full min-w-0 bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <span className={cn(kbd, "hidden sm:inline")}>Esc</span>
            </div>

            <div ref={list} id={`${id}-list`} role="listbox" aria-label={label} data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
              {filtered.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing matches &quot;{query}&quot;.</p>
              ) : (
                filtered.map((item, idx) => {
                  const on = idx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      id={optId(idx)}
                      data-index={idx}
                      role="option"
                      aria-selected={on}
                      onClick={item.onSelect}
                      onPointerMove={() => !on && setSelectedIndex(idx)}
                      className={cn("relative flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-[14px] transition-colors", on ? "text-foreground" : "text-foreground/80")}
                    >
                      {on && <motion.span layoutId={`${id}-hl`} className="absolute inset-0 rounded-xl bg-foreground/[0.07]" transition={reduce ? { duration: 0 } : motionTransitions.springSnappy} aria-hidden />}
                      <span className="relative flex min-w-0 items-center gap-2.5">
                        {item.icon && <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", on ? "bg-lime/20 text-lime-ink" : "bg-foreground/[0.05] text-muted-foreground")}>{item.icon}</span>}
                        <span className="truncate font-medium">{item.title}</span>
                      </span>
                      <span className="relative flex shrink-0 items-center gap-2">
                        <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{item.category}</span>
                        {item.shortcut && <span className={kbd}>{item.shortcut}</span>}
                        <CornerDownLeft className={cn("h-3.5 w-3.5 text-muted-foreground", !on && "invisible")} aria-hidden />
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="hidden items-center gap-3 border-t border-foreground/[0.08] px-4 py-2 text-[11.5px] text-muted-foreground sm:flex">
              <span className="flex items-center gap-1"><span className={kbd}>↑↓</span> move</span>
              <span className="flex items-center gap-1"><span className={kbd}>Enter</span> open</span>
              <span className="flex items-center gap-1"><span className={kbd}>Esc</span> close</span>
            </div>
          </motion.div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
