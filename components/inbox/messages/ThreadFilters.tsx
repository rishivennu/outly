"use client";
import { ScrollX } from "@/components/ui/scroll-x";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META } from "@/lib/domain";
import type { DmPlatform } from "@/lib/messages/meta";
import { cn } from "@/lib/utils";
import { DM_VIEWS, type DmFilter } from "./status";

const ring = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const seg = cn("inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-[background-color,color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] motion-reduce:transition-none", ring);

/**
 * Phase 2 (1155): which conversations to list. Platform chips only for platforms that are connected and whose
 * API carries conversations (Instagram, Facebook), and only when there is more than one to choose from.
 */
export function ThreadFilters({ filter, onChange, platforms, archived }: { filter: DmFilter; onChange: (f: DmFilter) => void; platforms: DmPlatform[]; archived: number }) {
  return (
    <div className="mt-2.5 space-y-2">
      <ScrollX label="Which conversations to show" focusable={false} className="-mx-1 px-1">
        <div role="group" aria-label="Which conversations to show" className="inline-flex rounded-full bg-secondary p-0.5">
          {DM_VIEWS.map((v) => {
            const on = filter.view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={on}
                onClick={() => !on && onChange({ ...filter, view: v.id })}
                className={cn(seg, on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}
              >
                {v.label}
                {v.id === "archived" && archived > 0 && <span className="ml-1.5 tabular-nums text-muted-foreground">{archived}</span>}
              </button>
            );
          })}
        </div>
      </ScrollX>
      {platforms.length > 1 && (
        <div role="group" aria-label="Platform" className="flex flex-wrap gap-1.5">
          {(["all", ...platforms] as const).map((p) => {
            const on = filter.platform === p;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => !on && onChange({ ...filter, platform: p })}
                className={cn(seg, "gap-1.5 hairline", on ? "bg-foreground text-background" : "bg-card text-foreground [@media(hover:hover)]:hover:bg-secondary")}
              >
                {p !== "all" && <PlatformOrb platform={p} size={16} />}
                {p === "all" ? "All platforms" : PLATFORM_META[p].name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
