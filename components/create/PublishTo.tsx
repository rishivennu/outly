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
}

/**
 * The first place destinations matter: right under the video, before any copy is written.
 * Same `enabled` state as the deck, so a choice made here is the choice that publishes.
 */
export function PublishTo({ platforms, drafts, accounts, onToggle }: Props) {
  const chosen = enabledPlatforms(drafts).filter((p) => platforms.includes(p));
  const needsConnecting = chosen.filter((p) => accounts[p]?.status !== "connected");

  return (
    <section aria-labelledby="publish-to" className="glass mt-6 rounded-[24px] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="publish-to" className="text-sm font-semibold">
          Publish to
        </h2>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {chosen.length === 0 ? "Pick at least one place to send it." : `${chosen.length} of ${platforms.length} chosen. Change it any time.`}
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {platforms.map((pl) => {
          const on = drafts[pl].enabled;
          return (
            <li key={pl}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(pl, !on)}
                className={cn(
                  "flex min-h-[44px] items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition hairline",
                  on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <PlatformOrb platform={pl} size={22} />
                {PLATFORM_META[pl].name}
                {on ? <Check className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
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
