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
  /** R1209: the main caption on Your Story is written. Everywhere is written from it, so it is the gate. */
  hasCaption: boolean;
  /** Every place switched on is connected, passes its checks and has been approved. */
  ready: boolean;
  enabledCount: number;
  launching: boolean;
  saving: boolean;
  /** Phase 3: the bar changes with the step. Left out, it is the Steps 1 and 2 bar. */
  step?: Step;
  mode?: "now" | "schedule";
  /** The places that will really get it (connected, checked, approved). Names the Publish button. */
  targets?: Platform[];
  /** Names of the places still to approve on Everywhere, for the reason under the bar. */
  pending?: string[];
  /** Why the time picked can't be booked (past, a clash, a platform rule), or null. */
  scheduleIssue?: string | null;
  /** Phase 4: a draft is saved (on the server or in this browser), so Step 1 offers Save draft. */
  hasDraft?: boolean;
  /** Phase 4: work still running in the background (captions), shown in the note when nothing blocks. */
  activity?: string | null;
  /** Captions are being burned in: the video is about to change, so nothing is sent until it has. */
  burning?: boolean;
  /** 1170: where the Step 1 upload stands. Continue waits until the server has the video. */
  upload?: "idle" | "uploading" | "paused" | "failed" | "done";
  /** 0..1 while uploading, for the note. */
  progress?: number;
  /** The creator has already been on Your Story this session, so going forward again doesn't wait for the upload. */
  storySeen?: boolean;
  /** Continue was pressed and Your Story is opening. */
  moving?: boolean;
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
  /** Exactly one button is lit on every step. */
  primary: boolean;
  /** Working: the button shows a spinner. */
  loading?: boolean;
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
export const BURN_SEND = "Captions are still being burned in.";

const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));

/** Pure, so the rules are tested apart from the screen. */
export function barState(i: BarInput): BarState {
  const step = i.step ?? "video";
  const mode = i.mode ?? "now";
  const base = !i.hasMedia
    ? "Add a video first."
    : i.uploadFailed
      ? "Your video didn't upload. Try it again first."
      : i.upload === "paused"
        ? "Your upload is paused. Resume it on Your Video first."
      : i.enabledCount === 0
        ? "Pick at least one place to send it."
        : !i.hasCaption
          ? "Write your caption on Your Story first."
          : null;
  // R1206: on Launch the note names who is held; the list above has the one action that clears each.
  const heldLine = i.pending?.length ? (i.pending.length === 1 ? `${i.pending[0]} isn't ready yet. Fix it or leave it out in the list above.` : `${list(i.pending)} aren't ready yet. Fix them or leave them out in the list above.`) : "Some places aren't ready yet. Leave them out or fix them in Everywhere.";
  const notReady = step === "launch" ? heldLine : i.pending?.length ? `Approve ${list(i.pending)} first.` : "Approve each platform caption on the Everywhere step first.";
  const sendBlock = !i.online ? OFFLINE_SEND : (base ?? (!i.ready ? notReady : i.burning ? BURN_SEND : null));
  const send: BarAction = { disabled: !!sendBlock || i.launching, hint: sendBlock };
  // 1170: a paused upload has no video on the server yet, so there is nothing to save until it resumes.
  const save: BarAction = { disabled: !i.hasMedia || i.saving || i.upload === "paused", hint: i.upload === "paused" ? "Resume your upload first." : null };
  const preview: BarAction = { disabled: !i.hasMedia, hint: null };
  const flat = { save, preview, schedule: send, publish: send };
  const activity = i.activity || null;

  // Phase 4: Steps 1 and 2 use the same one-lit-button bar as Everywhere and Launch. Nothing is sent from here.
  if (step === "video") {
    const up = i.upload ?? (i.uploadFailed ? "failed" : "done");
    const pct = i.progress != null ? ` (${Math.round(Math.max(0, Math.min(1, i.progress)) * 100)}%)` : "";
    const goBlock = !i.hasMedia
      ? "Add a video to continue to your story."
      : up === "failed"
        ? "Your video didn't upload. Try it again, or pick another, to continue."
        : up === "paused"
          ? "Your upload is paused. Resume it to continue."
          : up === "uploading" && !i.storySeen
            ? `Your video is uploading${pct}. Continue opens as soon as it's in.`
            : null;
    return {
      ...flat,
      note: goBlock ?? activity,
      buttons: [
        ...(i.hasDraft ? [{ id: "save" as const, label: "Save draft", primary: false, ...save }] : []),
        { id: "continue", label: i.moving ? "Opening your story" : "Continue to Your Story", primary: true, disabled: !!goBlock || !!i.moving, hint: goBlock, loading: !!i.moving },
      ],
    };
  }
  if (step === "story") {
    const goBlock = !i.hasMedia ? "Add a video first." : !i.hasCaption ? "Write your caption to continue to Everywhere." : null;
    const failed = i.hasMedia && i.uploadFailed ? "Your video didn't upload. Try it again first." : null;
    return {
      ...flat,
      note: goBlock ?? failed ?? activity ?? (!i.online ? OFFLINE_SEND : null),
      buttons: [
        { id: "save", label: "Save draft", primary: false, ...save },
        { id: "preview", label: "Preview", primary: false, ...preview },
        { id: "continue", label: "Continue to Everywhere", primary: true, disabled: !!goBlock, hint: goBlock },
      ],
    };
  }

  if (step === "everywhere") {
    // Moving on works offline: nothing is sent from here.
    const goBlock = base ?? (!i.ready ? notReady : null);
    return {
      ...flat,
      note: goBlock ?? activity ?? (!i.online ? OFFLINE_SEND : null),
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
      note: block ?? activity,
      buttons: [
        { id: "back", label: "Back to editing", primary: false, disabled: i.launching, hint: null },
        { id: "mode", label: mode === "schedule" ? "Publish now" : "Schedule", primary: false, disabled: i.launching, hint: null },
        { id: "publish", label, primary: true, ...go },
      ],
    };
  }
  return { ...flat, note: sendBlock, buttons: [] };
}

const GRID: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]",
  3: "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)]",
};

interface Props {
  state: BarState;
  saveLabel: string;
  /** Launch only: picks the icon on the button that switches between Publish now and Schedule for later. */
  mode?: "now" | "schedule";
  onAction: (id: BarId) => void;
  className?: string;
  /** 1170: as wide as the workspace column it sits in (Step 1), instead of the centred 768px bar. */
  fill?: boolean;
  /** 1182: the folded Pip button on phones and tablets. It floats over the bar's right end, with room kept above. */
  pip?: React.ReactNode;
}

const ICON: Record<BarId, typeof Save> = { save: Save, preview: Eye, schedule: CalendarClock, publish: Send, continue: ArrowRight, back: ArrowLeft, mode: CalendarClock };

/**
 * The one set of post actions on every step, in one compact bar. Sticky in the page flow (not fixed), so the
 * end of the page always scrolls clear of it. 11-16: on phones it sits 12px above the shell's tab bar (62px plus the
 * safe area; 11-19: the bar floats and only compacts on a long scroll, so this one holds its place), so the
 * two never stack and never leave a gap. The assistant drawer opens over both.
 */
export function ActionBar({ state, saveLabel, mode, onAction, className, fill, pip }: Props) {
  const btn = "h-auto min-h-[52px] min-w-0 flex-col gap-0.5 px-1 text-xs font-semibold sm:min-h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm";
  return (
    <div role="region" aria-label="Post actions" className={cn("sticky bottom-[calc(env(safe-area-inset-bottom)+84px)] z-30 mt-6 [html[data-app]_&]:bottom-[calc(env(safe-area-inset-bottom)+12px)] max-lg:[html:has(&)]:scroll-pb-[calc(env(safe-area-inset-bottom)+210px)] lg:bottom-4", pip && "max-xl:mt-[70px]", className)}>
      {/* 1182: in the app Create has no tab bar, so the bar sits 12px off the bottom; focus scrolls fields clear of it. */}
      {pip && <div className="absolute bottom-full right-1 mb-2.5 xl:hidden">{pip}</div>}
      <div className={cn("glass-strong mx-auto w-full rounded-[22px] p-1.5 shadow-[0_18px_40px_-24px_hsl(var(--foreground)/0.45)] hairline", fill ? "max-w-none sm:flex sm:items-center sm:gap-3 sm:pl-4" : "max-w-3xl")}>
        {state.note && (
          <p id="bar-note" className={cn("px-2.5 pb-1.5 pt-1 text-xs leading-snug text-muted-foreground", fill && "sm:min-w-0 sm:flex-1 sm:p-0 sm:text-[13px]")} aria-live="polite">
            {state.note}
          </p>
        )}
        <div className={cn("grid gap-1.5", GRID[state.buttons.length] ?? GRID[3], fill && "sm:ml-auto sm:flex sm:shrink-0")}>
          {state.buttons.map((b) => {
            const on = b.primary;
            const Icon = b.loading ? Loader2 : b.id === "mode" && mode === "schedule" ? Send : b.id === "save" && saveLabel === "Saving" ? Loader2 : ICON[b.id];
            const text = b.id === "save" ? saveLabel : b.label;
            return (
              <Button key={b.id} variant={on ? "lime" : "subtle"} className={cn(btn, fill && "sm:px-5")} onClick={() => onAction(b.id)} disabled={b.disabled} aria-busy={b.loading || undefined} aria-haspopup={b.id === "preview" ? "dialog" : undefined} aria-describedby={b.hint && on ? "bar-note" : undefined}>
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
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing is switched on yet. Switch a platform on in Everywhere.</p>
      )}
    </Sheet>
  );
}
