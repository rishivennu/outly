"use client";
import { useState } from "react";
import { CalendarClock, Eye, Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/shared/Sheet";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { InstagramReel, XPost, YouTubeShort } from "./Previews";
import type { AccountView, Draft } from "./types";

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
}
export interface BarAction {
  disabled: boolean;
  /** Why it is off, in plain words. */
  hint: string | null;
}
export interface BarState {
  save: BarAction;
  preview: BarAction;
  schedule: BarAction;
  publish: BarAction;
  /** The one line shown above the buttons. */
  note: string | null;
}

export const OFFLINE_SEND = "You're offline. Publishing and scheduling come back when you reconnect.";

/** Pure, so the rules are tested apart from the screen. */
export function barState(i: BarInput): BarState {
  const sendBlock = !i.online
    ? OFFLINE_SEND
    : !i.hasMedia
      ? "Add a video first."
      : i.uploadFailed
        ? "Your video didn't upload. Try it again first."
        : i.enabledCount === 0
          ? "Pick at least one place to send it."
          : !i.hasHook
            ? "Pick a hook with Pip first."
            : !i.ready
              ? "Look over each place on the Everywhere step first."
              : null;
  const send: BarAction = { disabled: !!sendBlock || i.launching, hint: sendBlock };
  return {
    save: { disabled: !i.hasMedia || i.saving, hint: null },
    preview: { disabled: !i.hasMedia, hint: null },
    schedule: send,
    publish: send,
    note: sendBlock,
  };
}

interface Props {
  state: BarState;
  saveLabel: string;
  /** Which of Schedule / Publish is the lit one. */
  primary: "now" | "schedule";
  launching: boolean;
  onSave: () => void;
  onPreview: () => void;
  onSchedule: () => void;
  onPublish: () => void;
  className?: string;
}

/**
 * The four things you can do with a post from any step, in one compact bar. Sticky in the page flow (not
 * fixed), so the end of the page always scrolls clear of it; on phones it sits above the tab bar and the
 * home indicator, and the assistant drawer opens over it.
 */
export function ActionBar({ state, saveLabel, primary, launching, onSave, onPreview, onSchedule, onPublish, className }: Props) {
  const btn = "h-auto min-h-[52px] min-w-0 flex-col gap-0.5 px-1 text-xs font-semibold sm:min-h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm";
  return (
    <div role="region" aria-label="Post actions" className={cn("sticky bottom-[calc(env(safe-area-inset-bottom)+76px)] z-30 mt-6 lg:bottom-4", className)}>
      <div className="glass-strong mx-auto w-full max-w-3xl rounded-[22px] p-1.5 shadow-[0_18px_40px_-24px_hsl(var(--foreground)/0.45)] hairline">
        {state.note && (
          <p className="px-2.5 pb-1.5 pt-1 text-xs leading-snug text-muted-foreground" aria-live="polite">
            {state.note}
          </p>
        )}
        <div className="grid grid-cols-4 gap-1.5">
          <Button variant="subtle" className={btn} onClick={onSave} disabled={state.save.disabled}>
            {saveLabel === "Saving" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            <span className="max-w-full truncate">{saveLabel}</span>
          </Button>
          <Button variant="subtle" className={btn} onClick={onPreview} disabled={state.preview.disabled} aria-haspopup="dialog">
            <Eye className="h-4 w-4" aria-hidden="true" />
            <span className="max-w-full truncate">Preview</span>
          </Button>
          <Button variant={primary === "schedule" ? "lime" : "subtle"} className={btn} onClick={onSchedule} disabled={state.schedule.disabled}>
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            <span className="max-w-full truncate">{launching && primary === "schedule" ? "Booking" : "Schedule"}</span>
          </Button>
          <Button variant={primary === "now" ? "lime" : "subtle"} className={btn} onClick={onPublish} disabled={state.publish.disabled}>
            <Send className="h-4 w-4" aria-hidden="true" />
            <span className="max-w-full truncate">{launching && primary === "now" ? "Sending" : "Publish"}</span>
          </Button>
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
          {pl === "instagram" ? <InstagramReel {...props} /> : pl === "youtube" ? <YouTubeShort {...props} /> : <XPost {...props} />}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing is switched on yet. Pick a place under Publish to.</p>
      )}
    </Sheet>
  );
}
