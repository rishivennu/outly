"use client";
import { Check, Link2, Plus } from "lucide-react";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { cn } from "@/lib/utils";
import type { AccountView, Draft } from "./types";
import { enabledPlatforms } from "./publish";

interface Props {
  platforms: readonly Platform[];
  drafts: Record<Platform, Draft>;
  accounts: Partial<Record<Platform, AccountView>>;
  onToggle: (p: Platform, enabled: boolean) => void;
  className?: string;
}

/**
 * The first place destinations matter: right under the video, before any copy is written.
 * Same `enabled` state as the deck, so a choice made here is the choice that publishes.
 */
export function PublishTo({ platforms, drafts, accounts, onToggle, className }: Props) {
  const chosen = enabledPlatforms(drafts).filter((p) => platforms.includes(p));
  const needsConnecting = chosen.filter((p) => accounts[p]?.status !== "connected");

  return (
    <section aria-labelledby="publish-to" className={cn("glass rounded-[24px] p-4 sm:p-5", className ?? "mt-6")}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h2 id="publish-to" className="flex items-center gap-2 text-sm font-semibold">
          Publish to
          <span className={cn("tabular rounded-full px-2.5 py-0.5 text-xs font-semibold", chosen.length ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground")}>
            {chosen.length} selected
          </span>
        </h2>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {chosen.length === 0 ? "Pick at least one place to send it." : `${chosen.length} of ${platforms.length} chosen. Change it any time.`}
        </p>
      </div>
      <ul className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(min(100%,168px),1fr))] gap-2">
        {platforms.map((pl) => {
          const on = drafts[pl].enabled;
          return (
            <li key={pl}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(pl, !on)}
                className={cn(
                  "flex min-h-[48px] w-full items-center gap-2.5 rounded-2xl px-3.5 text-left text-sm font-semibold transition hairline motion-reduce:transition-none",
                  on ? "bg-foreground text-background shadow-[0_10px_24px_-14px_hsl(var(--foreground)/0.6)]" : "bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <PlatformOrb platform={pl} size={22} />
                <span className="min-w-0 flex-1 truncate">{PLATFORM_META[pl].name}</span>
                {on ? (
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-lime text-[hsl(240_8%_6%)]" aria-hidden="true"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
                ) : (
                  <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span className="sr-only">{on ? "Sending here" : "Skipping"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {needsConnecting.length > 0 && (
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{needsConnecting.map((p) => PLATFORM_META[p].name).join(", ")} still {needsConnecting.length === 1 ? "needs" : "need"} connecting. You can do that on the Everywhere step.</span>
        </p>
      )}
    </section>
  );
}
