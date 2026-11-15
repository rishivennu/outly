"use client";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CalendarClock, Eye, Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/shared/Sheet";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { PreviewFor } from "./Previews";
import { publishLabel } from "./publish";
import type { AccountView, Draft, Step } from "./types";

export interface BarInput {
  online: boolean;
  hasMedia: boolean;
  uploadFailed: boolean;
  hasHook: boolean;
  /** Every place switched on is connected, passes its checks and has been looked over. */
  ready: boolean;
  enabledCount: number;
  launching: boolean;
  saving: boolean;
  /** Phase 3: the bar changes with the step. Left out, it is the Steps 1 and 2 bar. */
  step?: Step;
  mode?: "now" | "schedule";
  /** The places that will really get it (connected, checked, looked over). Names the Publish button. */
  targets?: Platform[];
  /** Names of the places still to look over on Everywhere, for the reason under the bar. */
  pending?: string[];
  /** Why the time picked can't be booked (past, a clash, a platform rule), or null. */
  scheduleIssue?: string | null;
}
export interface BarAction {
  disabled: boolean;
  /** Why it is off, in plain words. */
  hint: string | null;
}
export type BarId = "save" | "preview" | "schedule" | "publish" | "continue" | "back" | "mode";
export interface BarButton extends BarAction {
  id: BarId;
  label: string;
  /** Exactly one button is lit on Everywhere and Launch. */
  primary: boolean;
}
export interface BarState {
  save: BarAction;
  preview: BarAction;
  schedule: BarAction;
  publish: BarAction;
  /** The one line shown above the buttons. */
  note: string | null;
  /** What the bar shows, left to right, for this step. */
  buttons: BarButton[];
}

export const OFFLINE_SEND = "You're offline. Publishing and scheduling come back when you reconnect.";

const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));

/** Pure, so the rules are tested apart from the screen. */
export function barState(i: BarInput): BarState {
  const step = i.step ?? "video";
  const mode = i.mode ?? "now";
  const base = !i.hasMedia
    ? "Add a video first."
    : i.uploadFailed
      ? "Your video didn't upload. Try it again first."
      : i.enabledCount === 0
        ? "Pick at least one place to send it."
        : !i.hasHook
          ? "Pick a hook with Pip first."
          : null;
  const notReady = step === "launch" ? "Some places aren't ready yet. Leave them out or fix them in Everywhere." : i.pending?.length ? `Look over ${list(i.pending)} first.` : "Look over each place on the Everywhere step first.";
  const sendBlock = !i.online ? OFFLINE_SEND : (base ?? (!i.ready ? notReady : null));
  const send: BarAction = { disabled: !!sendBlock || i.launching, hint: sendBlock };
  const save: BarAction = { disabled: !i.hasMedia || i.saving, hint: null };
  const preview: BarAction = { disabled: !i.hasMedia, hint: null };
  const flat = { save, preview, schedule: send, publish: send };

  if (step === "everywhere") {
    // Moving on works offline: nothing is sent from here.
    const goBlock = base ?? (!i.ready ? notReady : null);
    return {
      ...flat,
      note: goBlock ?? (!i.online ? OFFLINE_SEND : null),
      buttons: [
        { id: "save", label: "Save draft", primary: false, ...save },
        { id: "preview", label: "Preview", primary: false, ...preview },
        { id: "continue", label: "Continue to Launch", primary: true, disabled: !!goBlock, hint: goBlock },
      ],
    };
  }
  if (step === "launch") {
    const block = sendBlock ?? (mode === "schedule" ? (i.scheduleIssue ?? null) : null);
    const go: BarAction = { disabled: !!block || i.launching, hint: block };
    const label = i.launching ? (mode === "schedule" ? "Scheduling" : "Publishing") : publishLabel(i.targets ?? [], mode, PLATFORM_META);
    return {
      ...flat,
      publish: go,
      note: block,
      buttons: [
        { id: "back", label: "Back to editing", primary: false, disabled: i.launching, hint: null },
        { id: "mode", label: mode === "schedule" ? "Publish now" : "Schedule", primary: false, disabled: i.launching, hint: null },
        { id: "publish", label, primary: true, ...go },
      ],
    };
  }
  return {
    ...flat,
    note: sendBlock,
    buttons: [
      { id: "save", label: "Save draft", primary: false, ...save },
      { id: "preview", label: "Preview", primary: false, ...preview },
      { id: "schedule", label: "Schedule", primary: false, ...send },
      { id: "publish", label: "Publish", primary: true, ...send },
    ],
  };
}

interface Props {
  state: BarState;
  saveLabel: string;
  /** Launch only: picks the icon on the button that switches between Publish now and Schedule for later. */
  mode?: "now" | "schedule";
  onAction: (id: BarId) => void;
  className?: string;
}

const ICON: Record<BarId, typeof Save> = { save: Save, preview: Eye, schedule: CalendarClock, publish: Send, continue: ArrowRight, back: ArrowLeft, mode: CalendarClock };

/**
 * The one set of post actions on every step, in one compact bar. Sticky in the page flow (not fixed), so the
 * end of the page always scrolls clear of it; on phones it sits above the tab bar and the home indicator,
 * and the assistant drawer opens over it.
 */
export function ActionBar({ state, saveLabel, mode, onAction, className }: Props) {
  const btn = "h-auto min-h-[52px] min-w-0 flex-col gap-0.5 px-1 text-xs font-semibold sm:min-h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm";
  return (
    <div role="region" aria-label="Post actions" className={cn("sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] z-30 mt-6 lg:bottom-4", className)}>
      <div className="glass-strong mx-auto w-full max-w-3xl rounded-[22px] p-1.5 shadow-[0_18px_40px_-24px_hsl(var(--foreground)/0.45)] hairline">
        {state.note && (
          <p id="bar-note" className="px-2.5 pb-1.5 pt-1 text-xs leading-snug text-muted-foreground" aria-live="polite">
            {state.note}
          </p>
        )}
        <div className={cn("grid gap-1.5", state.buttons.length === 3 ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)]" : "grid-cols-4")}>
          {state.buttons.map((b) => {
            const on = b.primary;
            const Icon = b.id === "mode" && mode === "schedule" ? Send : b.id === "save" && saveLabel === "Saving" ? Loader2 : ICON[b.id];
            const text = b.id === "save" ? saveLabel : b.label;
            return (
              <Button key={b.id} variant={on ? "lime" : "subtle"} className={btn} onClick={() => onAction(b.id)} disabled={b.disabled} aria-haspopup={b.id === "preview" ? "dialog" : undefined} aria-describedby={b.hint && on ? "bar-note" : undefined}>
                <Icon className={cn("h-4 w-4", Icon === Loader2 && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
                <span className="max-w-full truncate">{text}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * How the post looks in each place it is going. One preview player at a time; the caller pauses the
 * page's own player when this opens, so two videos never play over each other.
 */
export function PreviewSheet({ open, onOpenChange, platforms, drafts, accounts, src, poster }: { open: boolean; onOpenChange: (o: boolean) => void; platforms: Platform[]; drafts: Record<Platform, Draft>; accounts: Partial<Record<Platform, AccountView>>; src: string | null; poster: string | null }) {
  const [picked, setPicked] = useState<Platform | null>(null);
  const pl = picked && platforms.includes(picked) ? picked : platforms[0];
  const acct = pl ? accounts[pl] : undefined;
  const props = pl ? { draft: drafts[pl], src, poster, handle: acct?.username ?? `your${pl}`, name: acct?.displayName ?? acct?.username ?? "You", avatar: acct?.avatar } : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Preview" description={pl ? `How it looks on ${PLATFORM_META[pl].name}.` : "Switch on a place to send it to see a preview."} side="center">
      {platforms.length > 1 && (
        <div role="tablist" aria-label="Preview for" className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {platforms.map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={x === pl}
              onClick={() => setPicked(x)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition-[background-color,color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none hairline",
                x === pl ? "bg-foreground text-background" : "text-muted-foreground [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground",
              )}
            >
              <PlatformOrb platform={x} size={20} />
              {PLATFORM_META[x].name}
            </button>
          ))}
        </div>
      )}
      {props && pl ? (
        <div key={pl} className="mx-auto w-full max-w-[300px]">
          <PreviewFor platform={pl} {...props} />
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing is switched on yet. Pick a place under Publish to.</p>
      )}
    </Sheet>
  );
}
