"use client";
import { useEffect, useId, useState } from "react";
import { Captions, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCaptionPick } from "./captions/CaptionRun";
import type { CaptionState } from "./captions/run-store";

/** R1206: what the closed section says about the subtitles, in the brief's own vocabulary. */
export type SubtitleFacts = { lines: number; busy: "transcribe" | "translate" | "burn" | null; failed: boolean; gaps: number; english: boolean };
export type SubtitleTone = "idle" | "busy" | "ok" | "warn";

/** A short string, so the reader re-renders only when one of these facts changes. */
export const subtitleFactsKey = (s: CaptionState) =>
  JSON.stringify({ lines: s.tracks.orig.length, busy: s.busy?.kind ?? null, failed: s.outcome === "failed", gaps: s.gaps.length, english: !!s.tracks.en } satisfies SubtitleFacts);

/**
 * R1206: the one status line, the brief's six states in priority order. A run in progress wins, then a failure,
 * then parts that came back empty, then the English track, then the count. Never a claim the video has words
 * on it when it has none.
 */
export function subtitleStatus(f: SubtitleFacts): { label: string; tone: SubtitleTone } {
  if (f.busy === "transcribe") return { label: "Transcribing", tone: "busy" };
  if (f.busy === "translate") return { label: "Translating", tone: "busy" };
  if (f.busy === "burn") return { label: "Adding them to the video", tone: "busy" };
  if (f.failed) return { label: "Failed — retry", tone: "warn" };
  if (f.gaps > 0) return { label: "Needs review", tone: "warn" };
  if (!f.lines) return { label: "Not generated yet", tone: "idle" };
  const count = `${f.lines} ${f.lines === 1 ? "subtitle" : "subtitles"} ready`;
  return f.english ? { label: `${count} · translation available`, tone: "ok" } : { label: count, tone: "ok" };
}

const TONE: Record<SubtitleTone, string> = {
  idle: "text-muted-foreground",
  busy: "text-foreground",
  ok: "text-success-ink",
  warn: "text-destructive",
};

/**
 * R1198, R1206: the subtitle tools (transcribe, sync, style, burn) under one collapsible "Video subtitles" section,
 * closed by default and sitting directly above Your caption. Subtitles are the spoken words on the video; they are a
 * separate thing from each platform's social caption and never feed or replace one. The editor inside stays mounted
 * while folded, so its preview overlay on the video and a run in progress carry on.
 */
export function VideoSubtitles({ transcribing, burning = false, children, className }: { transcribing: boolean; burning?: boolean; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const key = useCaptionPick(subtitleFactsKey);
  const facts: SubtitleFacts = key ? (JSON.parse(key) as SubtitleFacts) : { lines: 0, busy: null, failed: false, gaps: 0, english: false };
  const status = subtitleStatus(facts);
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
            <span className="block text-[13px] leading-snug text-muted-foreground">Transcribe speech and create synchronized subtitles for your video.</span>
          </span>
          <span className={cn("shrink-0 text-right text-xs font-semibold tabular-nums", TONE[status.tone])} aria-live="polite">
            {status.label}
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
