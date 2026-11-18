"use client";
import { useState } from "react";
import { Check, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { DECK_ASKS, isCaptionAsk, STORY_ASKS, type CaptionAsk, type PipAsk } from "@/lib/ai/pip-asks";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { fieldsFor } from "./deck-logic";

export interface PipActionsProps {
  step: "story" | "everywhere";
  /** The places Pip can work on: switched on and holding words. */
  places: Platform[];
  /** The one place the asks work on: the place open in the editor on Everywhere. Your Story has none (see `caption`). */
  target: Platform | null;
  /** An ask in flight, so the same one is never sent twice. */
  busy: { p: Platform; ask: PipAsk } | null;
  /** Places with a suggestion from Pip waiting for Accept or Skip. */
  proposed: Platform[];
  onAccept: (p: Platform) => void;
  onReject: (p: Platform) => void;
  /** Step 2: places that could be added, for "Adapt for another platform". */
  others?: Platform[];
  onAdd?: (p: Platform) => void;
  onAsk: (p: Platform, ask: PipAsk) => void;
  /** Why the asks are off right now (offline, nothing written yet, Pip writing), or null. */
  why: string | null;
  /** What Pip is working from, in a line: the caption's length, the places, how many are approved. */
  context: string;
  /**
   * R1206: on Your Story the asks work on the creator's own caption, not on a platform. The answer waits under
   * Your caption as a suggestion to apply or skip there.
   */
  caption?: { busy: CaptionAsk | null; waiting: boolean; onAsk: (a: CaptionAsk) => void };
}

const CHIP =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition hairline motion-reduce:transition-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * R1198: Pip's one-tap asks. Each works on one place's words and comes back as a suggestion to accept or skip:
 * nothing Pip writes here lands without the creator's say-so, and the page never gets a second writing box.
 */
export function PipActions(p: PipActionsProps) {
  const [picking, setPicking] = useState(false);
  const t = p.target;
  // A platform with no hashtags field (X) never gets the hashtags ask: its answer would have nowhere to go.
  // R1206: a platform's own ask (YouTube's metadata, LinkedIn's lesson, X's one post) shows only on that platform.
  const cap = p.step === "story" ? p.caption : undefined;
  // On Your Story with `caption` the asks work on the creator's own words, so no one platform's fields decide them.
  const asks = (p.step === "story" ? STORY_ASKS : DECK_ASKS).filter((a) => (a.id !== "hashtags" || !!cap || !t || fieldsFor(t).hashtags) && (!a.only || (!!t && a.only.includes(t))));
  const off = cap ? !!p.why || !!cap.busy || !!p.busy : !!p.why || !!p.busy || !t;
  const name = t ? PLATFORM_META[t].name : "";

  return (
    <div role="group" aria-label="Ask Pip" className="rounded-2xl bg-secondary/50 p-3.5 hairline" data-pip-actions={p.step}>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Sparkles className="h-3.5 w-3.5 text-lime" aria-hidden="true" />
        {p.step === "story" ? "Ask Pip about your caption" : `Ask Pip about ${name || "this place"}`}
      </p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{p.context}</p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {asks.map((a) => {
          if (a.id === "other") {
            const none = !p.others?.length;
            return (
              <button key={a.id} type="button" className={cn(CHIP, picking ? "bg-foreground text-background" : "text-muted-foreground [@media(hover:hover)]:hover:bg-card [@media(hover:hover)]:hover:text-foreground")} aria-expanded={picking} disabled={none || !!p.busy || !!cap?.busy || !!p.why} title={none ? "Every place you can post to is already on." : undefined} onClick={() => setPicking((v) => !v)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {a.label}
              </button>
            );
          }
          const running = cap ? cap.busy === a.id : p.busy?.ask === a.id && p.busy.p === t;
          const go = () => (cap ? isCaptionAsk(a.id) && cap.onAsk(a.id) : t && p.onAsk(t, a.id as PipAsk));
          return (
            <button key={a.id} type="button" className={cn(CHIP, "text-muted-foreground [@media(hover:hover)]:hover:bg-card [@media(hover:hover)]:hover:text-foreground")} disabled={off} aria-busy={running || undefined} onClick={go}>
              {running && <Sparkles className="h-3.5 w-3.5 motion-safe:animate-pulse" aria-hidden="true" />}
              {a.label}
            </button>
          );
        })}
      </div>

      {picking && p.others && p.others.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Add a place">
          {p.others.map((pl) => (
            <li key={pl}>
              <button
                type="button"
                className={cn(CHIP, "bg-card text-foreground")}
                onClick={() => {
                  setPicking(false);
                  p.onAdd?.(pl);
                }}
              >
                <PlatformOrb platform={pl} size={18} />
                {PLATFORM_META[pl].name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-xs leading-snug text-muted-foreground" aria-live="polite">
        {cap?.busy
          ? "Working on your caption…"
          : p.busy
            ? `Working on ${PLATFORM_META[p.busy.p].name}…`
            : (p.why ?? (cap?.waiting ? "Pip's suggestion is waiting under Your caption. Apply it or skip it there; a new ask replaces it." : "Each answer is a suggestion. Nothing changes until you accept it."))}
      </p>

      {p.proposed.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Suggestions waiting">
          {p.proposed.map((pl) => (
            <li key={pl} className="flex flex-wrap items-center gap-2 rounded-2xl bg-card p-2.5 hairline">
              <PlatformOrb platform={pl} size={22} />
              <span className="min-w-0 flex-1 text-[13px] leading-snug">New words for {PLATFORM_META[pl].name}. The same suggestion as on its card, if you'd rather decide from here.</span>
              <span className="flex gap-1.5">
                <Button type="button" size="sm" variant="lime" className="min-h-11 rounded-full px-3" onClick={() => p.onAccept(pl)}>
                  <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Accept <span className="sr-only">for {PLATFORM_META[pl].name}</span>
                </Button>
                <Button type="button" size="sm" variant="ghost" className="min-h-11 rounded-full px-3" onClick={() => p.onReject(pl)}>
                  <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Skip <span className="sr-only">for {PLATFORM_META[pl].name}</span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
