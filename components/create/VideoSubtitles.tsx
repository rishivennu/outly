"use client";
import { useEffect, useId, useState } from "react";
import { Captions, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCaptionPick } from "./captions/CaptionRun";
import type { CaptionState } from "./captions/run-store";

/** How many subtitle lines the video has, as a string so the reader re-renders only when it changes. */
const lineCount = (s: CaptionState) => String(s.tracks.orig.length);

/** "3 subtitles ready", "Transcribing…" or the invitation, for the closed section's summary line. */
export function subtitlesLine(n: number, transcribing: boolean): string {
  if (transcribing) return "Transcribing your video…";
  if (n > 0) return `${n} ${n === 1 ? "subtitle" : "subtitles"} ready`;
  return "None yet";
}

/**
 * R1198: the subtitle tools (transcribe, sync, style, burn) under one collapsible "Video subtitles" section, closed
 * by default. Subtitles are the spoken words on the video; they are a separate thing from each platform's social
 * caption and never feed or replace one. The editor inside stays mounted while folded, so its preview overlay on
 * the video and a run in progress carry on.
 */
export function VideoSubtitles({ transcribing, burning = false, children, className }: { transcribing: boolean; burning?: boolean; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const n = Number(useCaptionPick(lineCount) ?? 0);
  // A transcribe or burn started from Pip or a restored run opens the section, so its progress is never hidden.
  useEffect(() => {
    if (transcribing || burning) setOpen(true);
  }, [transcribing, burning]);
  return (
    <section aria-labelledby={`${id}-h`} className={className} data-subtitles={open ? "open" : "closed"}>
      <h2 id={`${id}-h`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen((v) => !v)}
          className="glass flex min-h-16 w-full items-center gap-3 rounded-[24px] px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-5"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary hairline" aria-hidden="true">
            <Captions className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight">Video subtitles</span>
            <span className="block text-[13px] leading-snug text-muted-foreground">Transcribe spoken words and synchronize subtitles with your video.</span>
          </span>
          <span className={cn("shrink-0 text-xs font-semibold tabular-nums", n > 0 ? "text-success-ink" : "text-muted-foreground")} aria-live="polite">
            {subtitlesLine(n, transcribing)}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h2>
      <div id={`${id}-body`} hidden={!open} className="mt-3">
        {children}
      </div>
    </section>
  );
}
