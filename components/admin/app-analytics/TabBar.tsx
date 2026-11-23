"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * R1308: one group at a time. The pick lives in `?tab=` so it survives a reload, the range controls and the
 * user-table filters (every other control keeps the rest of the query). Arrow keys move between tabs; the
 * active one scrolls into view on phones, where the row overflows.
 */
export type TabDef = { key: string; label: string; short?: string };

export function TabBar({ tabs, current, label = "Analytics groups" }: { tabs: readonly TabDef[]; current: string; label?: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  const list = useRef<HTMLDivElement>(null);

  const go = (key: string) => {
    const n = new URLSearchParams(sp.toString());
    key === tabs[0].key ? n.delete("tab") : n.set("tab", key);
    // user-table paging belongs to the users group only
    if (key !== "users") n.delete("page");
    const qs = n.toString();
    start(() => router.push(qs ? `${path}?${qs}` : path, { scroll: false }));
  };

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === current);
    const j = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    go(tabs[j].key);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[j]?.focus();
  };

  return (
    <div className="mb-5 -mx-5 flex items-center gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div ref={list} role="tablist" aria-label={label} aria-busy={pending} onKeyDown={onKey} className="inline-flex w-max shrink-0 rounded-full bg-secondary/70 p-1">
        {tabs.map((t) => {
          const on = t.key === current;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={on}
              aria-controls={`panel-${t.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => !on && go(t.key)}
              className={cn("inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11", on ? "lime-bg" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}
            >
              {t.short ? (<><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></>) : t.label}
            </button>
          );
        })}
      </div>
      {pending && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading" />}
    </div>
  );
}
