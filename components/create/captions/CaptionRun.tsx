"use client";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { languageName } from "@/lib/captions/languages";
import { RunCard, transcribeSteps } from "./RunCard";
import { createCaptionStore, PILL_TIP, runLine, runPill, type CaptionState, type CaptionStore } from "./run-store";

const Ctx = createContext<CaptionStore | null>(null);

/** Wrap /create in this with the store from useCaptionWorkspace(), so the run outlives the caption editor. */
export const CaptionRunProvider = Ctx.Provider;

const NONE = () => () => {};
const idle = () => null;

/**
 * One caption store for the whole of /create. It stops its run when /create closes, and while a run is busy
 * the browser asks before the tab is closed or reloaded (that does stop it; changing steps does not).
 */
export function useCaptionWorkspace(): CaptionStore {
  const [store] = useState(() => createCaptionStore());
  const busy = useSyncExternalStore(store.subscribe, () => !!store.getState().busy, () => false);
  useEffect(() => () => store.dispose(), [store]);
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  return store;
}

/** The workspace store, or one of the editor's own when nothing above provides it (it then stops on unmount). */
export function useCaptionStore(): CaptionStore {
  const shared = useContext(Ctx);
  const [own] = useState(() => (shared ? null : createCaptionStore()));
  useEffect(() => (own ? () => own.dispose() : undefined), [own]);
  return shared ?? own!;
}

export function useCaptionState(store: CaptionStore): CaptionState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

function useRunText(pick: (s: CaptionState) => string | null, store?: CaptionStore | null): string | null {
  const ctx = useContext(Ctx);
  const s = store ?? ctx;
  return useSyncExternalStore(s ? s.subscribe : NONE, s ? () => pick(s.getState()) : idle, idle);
}

/** True while captions are being burned in, so Publish and Schedule wait for the captioned video. */
export const useCaptionBurning = (store: CaptionStore) => useSyncExternalStore(store.subscribe, () => store.getState().busy?.kind === "burn", () => false);

/** R1193: true while the words are being transcribed, so the video column makes room for its run card. */
export const useCaptionTranscribing = (store: CaptionStore) => useSyncExternalStore(store.subscribe, () => store.getState().busy?.kind === "transcribe", () => false);

/**
 * R1193: the transcribe run card, under the video in the stage's column (it used to sit in the caption editor,
 * a long scroll away from the video it reads). Compact so the sticky column still fits the screen. Reads the
 * workspace store; renders nothing unless a transcribe is running.
 */
export function TranscribeRun({ className }: { className?: string }) {
  const store = useContext(Ctx);
  const s = useSyncExternalStore(store ? store.subscribe : NONE, store ? store.getState : idle, idle);
  const busy = s?.busy;
  if (!store || !s || busy?.kind !== "transcribe") return null;
  const spoken = s.langPick !== "auto" ? s.langPick : s.heard;
  return (
    <RunCard
      compact
      className={className}
      title={busy.total === 0 ? "Extracting audio" : "Transcribing"}
      chip={spoken ? languageName(spoken) : undefined}
      percent={busy.total === 0 ? null : (busy.done / busy.total) * 100}
      detail={busy.total > 1 ? `${busy.done} of ${busy.total} parts` : busy.total === 1 ? "One part" : undefined}
      steps={transcribeSteps(busy)}
      onStop={() => store.stop()}
    />
  );
}

/** The action bar line while captions are being made on any step. null when nothing is running. */
export const useCaptionRunLine = (store?: CaptionStore | null) => useRunText(runLine, store);

/** 1182: a short string picked from the run (Pip's caption notes), so its reader re-renders only when that string changes. */
export const useCaptionPick = (pick: (s: CaptionState) => string | null) => useRunText(pick);

/** The journey rail pill: progress, then how it ended. Renders nothing outside /create or with no run. */
export function CaptionRunPill({ className }: { className?: string }) {
  const text = useRunText(runPill);
  if (!text) return null;
  const settled = text === "Done" || text === "Captions ready";
  const working = !settled && text !== "Stopped" && text !== "Needs a look";
  return (
    <span title={PILL_TIP} className={cn("mt-1 inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-foreground tabular-nums hairline", className)}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", working ? "bg-lime motion-safe:animate-pulse" : settled ? "bg-[#173A24] dark:bg-lime" : "bg-muted-foreground")} />
      <span className="truncate">{text}</span>
      <span className="sr-only">. {PILL_TIP}</span>
    </span>
  );
}
