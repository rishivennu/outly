import { api, ApiError, offerUpgrade } from "@/lib/client/api";
import { audioChunks, burnCaptions, postChunk, type AudioChunk, type ChunkAnswer } from "@/lib/client/captions";
import { cuesFromScript, type CaptionPos, type CaptionStyle, type Cue } from "@/lib/captions/cues";
import { readTrack, type CaptionTrack, type CaptionView } from "@/lib/captions/edit";
import { exportCues, clampOffset } from "@/lib/captions/offset";
import { clampSize, SIZE_BASE } from "@/lib/captions/size";
import { runChunks } from "@/lib/captions/run";
import { mergeSubtitleRules, type Word } from "@/lib/captions/subtitle-engine";
import { buildCues, followTrack, keepEnglish, spliceSpan, spliceWords, stitchWords } from "@/lib/captions/timing";
import { translateWindows } from "@/lib/captions/translate-core";
import { clearMarker, readMarker, restartAction, sessionStore, writeMarker, type MarkerStorage, type RunStage } from "./run-resume";

/**
 * Phase 4: the caption run (transcribe, translate, burn) and the lines it makes live here, not in the editor.
 * The workspace keeps one store for as long as /create is open, so going to another step unmounts the editor
 * but the run keeps going and its lines still land in the draft. A run stops only on Stop, when a new video
 * comes in, when /create closes, or when the tab is closed or reloaded.
 */

export type Busy = null | { kind: "transcribe"; done: number; total: number } | { kind: "burn"; p: number } | { kind: "translate" };
export type Tracks = { orig: Cue[]; en: Cue[] | null; view: CaptionView };
/** A part of the video whose chunk did not come back: shown with a retry, the rest of the captions still count. */
export type Gap = { index: number; from: number; to: number };
export type Plan = { burn: boolean; left: number | null; limit: number | null; name: string };
/** How the last run ended, for the journey pill. Cleared when the next run starts or the editor has shown it. */
export type Outcome = null | "done" | "stopped" | "failed";

export type CaptionState = {
  /** Which video these lines belong to. */
  key: string | null;
  on: boolean;
  tracks: Tracks;
  words: Word[];
  style: CaptionStyle;
  pos: CaptionPos;
  /** Shift of every line on both tracks, seconds, applied when shown, burned or exported. */
  offset: number;
  /** Caption size, percent of the style's base (lib/captions/size.ts). */
  size: number;
  heard: string;
  langPick: string;
  untranslated: number[];
  gaps: Gap[];
  burned: boolean;
  typing: boolean;
  note: string | null;
  aiReady: boolean | null;
  plan: Plan | null;
  busy: Busy;
  outcome: Outcome;
  /** A burn that finished while the editor was not showing. Kept here so the video never changes under another step. */
  pendingBurn: File | null;
  /** R1265: a run on this video was still going when the page reloaded (read from the sessionStorage marker). */
  interrupted: { stage: RunStage } | null;
  /** Goes up when a run replaces the lines, so an open timing panel closes. */
  rev: number;
};

export type Session = { key: string; src: string; file?: Blob | null; filename: string; duration: number; initialTrack?: unknown };
export type Handlers = {
  onTrackChange?: (t: CaptionTrack | null) => void;
  onBurned?: (file: File, kind?: "captions" | "cut") => void;
  onError?: (msg: string) => void;
};

type Run = { run: string; lang: string; parts: Map<number, ChunkAnswer> };

export type Deps = {
  audioChunks: typeof audioChunks;
  postChunk: typeof postChunk;
  api: typeof api;
  burnCaptions: typeof burnCaptions;
  offerUpgrade: typeof offerUpgrade;
  runId: () => string;
  storage: () => MarkerStorage | null;
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const sameTimes = (a: Cue[], b: Cue[]) => a.length === b.length && a.every((c, i) => c.start === b[i].start && c.end === b[i].end);
/** The lines whose middle sits in [from, to). */
const within = (cs: Cue[], from: number, to: number) => cs.filter((c) => (c.start + c.end) / 2 >= from && (c.start + c.end) / 2 < to);
/** Same lines: start, end and words. */
const sameLines = (x: Cue[], y: Cue[]) => x.length === y.length && x.every((c, i) => c.start === y[i].start && c.end === y[i].end && c.text === y[i].text);
const QUIET: ChunkAnswer = { words: [], language: "" };
const newRunId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const DEPS: Deps = { audioChunks, postChunk, api, burnCaptions, offerUpgrade, runId: newRunId, storage: sessionStore };

function fresh(key: string | null, initialTrack: unknown, duration: number): CaptionState {
  const init = readTrack(initialTrack, duration || Infinity);
  return {
    key,
    on: !!init?.cues.length,
    tracks: { orig: init?.original ?? init?.cues ?? [], en: init?.translated ?? null, view: init?.translated ? (init.view ?? "original") : "original" },
    words: [],
    style: init?.style ?? "pop",
    pos: init?.pos ?? "bottom",
    offset: init?.offset ?? 0,
    size: init?.size ?? SIZE_BASE,
    heard: init?.lang ?? "",
    langPick: "auto",
    untranslated: [],
    gaps: [],
    burned: false,
    typing: false,
    note: null,
    aiReady: null,
    plan: null,
    busy: null,
    outcome: null,
    pendingBurn: null,
    interrupted: null,
    rev: 0,
  };
}

/** The track a draft keeps, or null when captions are off or there are no lines. */
export function trackOf(s: CaptionState): CaptionTrack | null {
  const showing = s.tracks.view === "english" && s.tracks.en ? s.tracks.en : s.tracks.orig;
  if (!s.on || !showing.length) return null;
  const both = s.tracks.en ? { original: s.tracks.orig, translated: s.tracks.en, view: s.tracks.view } : {};
  return { v: 1, cues: showing, style: s.style, pos: s.pos, ...(s.heard ? { lang: s.heard } : {}), ...(s.offset ? { offset: s.offset } : {}), ...(s.size !== SIZE_BASE ? { size: s.size } : {}), ...both };
}

/** The journey pill: what the run is doing, or how it ended. null = nothing to say. */
export function runPill(s: Pick<CaptionState, "busy" | "outcome"> & { pendingBurn?: File | null; interrupted?: CaptionState["interrupted"] }): string | null {
  const b = s.busy;
  if (b?.kind === "transcribe") return b.total > 1 ? `Transcribing, ${b.done} of ${b.total} parts` : b.total === 1 ? "Transcribing" : "Extracting audio";
  if (b?.kind === "translate") return "Translating";
  if (b?.kind === "burn") return `Adding captions ${Math.round(b.p * 100)}%`;
  if (s.pendingBurn) return "Captions ready";
  if (s.interrupted) return INTERRUPTED_PILL;
  if (s.outcome === "done") return "Done";
  if (s.outcome === "stopped") return "Stopped";
  if (s.outcome === "failed") return "Needs a look";
  return null;
}

/** The action bar line while a run is busy, so leaving the step is never a guess. */
export function runLine(s: Pick<CaptionState, "busy">): string | null {
  const b = s.busy;
  if (!b) return null;
  const what = b.kind === "transcribe" ? (b.total > 1 ? `Transcribing, ${b.done} of ${b.total} parts ready` : b.total === 1 ? "Transcribing" : "Extracting audio") : b.kind === "translate" ? "Translating your captions" : `Adding captions ${Math.round(b.p * 100)}%`;
  return `${what}. They keep going on every step; a reload stops them.`;
}

export const INTERRUPTED_PILL = "Run interrupted";

export const PILL_TIP = "Captions keep going while you work on other steps. Reloading or closing the tab stops them.";

export type CaptionStore = ReturnType<typeof createCaptionStore>;

export function createCaptionStore(deps: Partial<Deps> = {}) {
  const d: Deps = { ...DEPS, ...deps };
  let state: CaptionState = fresh(null, null, 0);
  let ctx: Omit<Session, "initialTrack"> = { key: "", src: "", file: null, filename: "video.mp4", duration: 0 };
  let handlers: Handlers = {};
  const listeners = new Set<() => void>();
  let abort: AbortController | null = null;
  let chunks: { key: Blob | string; chunks: AudioChunk[] } | null = null;
  let lastRun: Run | null = null;
  let planLoading = false;
  let lastTrack: string | undefined;

  const emitTrack = () => {
    const t = trackOf(state);
    const sig = JSON.stringify(t);
    if (sig === lastTrack) return;
    lastTrack = sig;
    handlers.onTrackChange?.(t);
  };
  const emit = () => {
    for (const l of [...listeners]) l();
    emitTrack();
  };
  const set = (patch: Partial<CaptionState> | ((s: CaptionState) => Partial<CaptionState>)) => {
    const p = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...p };
    emit();
  };
  /** One caption allowance per video, however many chunks or re-runs. Same file + length = same ref. */
  const ref = () => `${ctx.filename}:${Math.round(ctx.duration * 10)}`;
  const start = (busy: NonNullable<Busy>) => {
    abort?.abort();
    const ctrl = new AbortController();
    abort = ctrl;
    writeMarker(d.storage(), ctx.key, busy.kind);
    set({ busy, note: null, outcome: null, interrupted: null });
    return ctrl;
  };
  const finish = (ctrl: AbortController, outcome: Outcome) => {
    if (abort !== ctrl) return;
    abort = null;
    clearMarker(d.storage());
    set({ busy: null, outcome: ctrl.signal.aborted ? "stopped" : outcome });
  };
  const replaceOriginal = (orig: Cue[]): Partial<CaptionState> => ({ tracks: { orig, en: null, view: "original" }, untranslated: [] });

  const store = {
    getState: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /**
     * The mounted editor's latest callbacks. Lines keep reaching the draft after it unmounts; the burned video does
     * not (see detach), so only the editor on show can swap the video.
     */
    setHandlers(h: Handlers) {
      handlers = h;
    },
    /** The editor unmounted: a burn that lands now waits as pendingBurn instead of replacing the video. */
    detach() {
      handlers = { ...handlers, onBurned: undefined };
    },
    /** The editor's "Use captioned video": hands the waiting burn to the mounted editor. */
    takeBurn(onBurned?: Handlers["onBurned"]): boolean {
      const f = state.pendingBurn;
      // The Launch step has no editor mounted, so it hands in the workspace's own swap.
      const to = onBurned ?? handlers.onBurned;
      if (!f || !to) return false;
      set({ pendingBurn: null, burned: true, outcome: null });
      to(f, "captions");
      return true;
    },
    dropBurn() {
      if (state.pendingBurn) set({ pendingBurn: null, outcome: null });
    },
    /**
     * The editor for `s.key` is showing. Same video: everything carries on (a run in flight included). Another
     * video: its old run stops and its lines start from the draft's track. Does not notify; call flush() after.
     */
    attach(s: Session): boolean {
      ctx = { key: s.key, src: s.src, file: s.file, filename: s.filename, duration: s.duration };
      if (state.key === s.key) return false;
      abort?.abort();
      abort = null;
      chunks = null;
      lastRun = null;
      state = fresh(s.key, s.initialTrack, s.duration);
      const mark = readMarker(d.storage());
      // Only this video's run can have been cut short by a reload; any other marker belongs to a run that just stopped.
      if (mark?.key === s.key) state = { ...state, interrupted: { stage: mark.stage } };
      else clearMarker(d.storage());
      return true;
    },
    /** "Start again" after a reload: the same action as before, from scratch, on the lines the draft kept. */
    restart(font?: string): Promise<void> {
      const i = state.interrupted;
      if (!i) return Promise.resolve();
      const t = state.tracks;
      const onShow = t.view === "english" && t.en ? t.en : t.orig;
      const act = restartAction(i.stage, onShow.length > 0);
      clearMarker(d.storage());
      set({ interrupted: null, on: true });
      return act === "transcribe" ? store.transcribe() : act === "translate" ? store.translate() : store.burn(onShow, font);
    },
    dismissInterrupted() {
      if (!state.interrupted) return;
      clearMarker(d.storage());
      set({ interrupted: null });
    },
    /** The video's details change without it being another video (duration read, local file dropped). */
    update(s: Omit<Session, "initialTrack">) {
      if (s.key !== ctx.key) return;
      if (s.src !== ctx.src || s.file !== ctx.file) {
        chunks = null;
        lastRun = null;
      }
      ctx = { ...s };
    },
    flush: emit,
    set,
    /** Edits the track on show; the other track follows its timing. */
    setCues(next: Cue[] | ((cs: Cue[]) => Cue[])) {
      set((s) => {
        const t = s.tracks;
        const key = t.view === "english" && t.en ? "en" : "orig";
        const cur = key === "en" ? t.en! : t.orig;
        const val = typeof next === "function" ? next(cur) : next;
        if (key === "en") return { tracks: { ...t, en: val, orig: followTrack(cur, val, t.orig) } };
        return { tracks: { ...t, orig: val, en: t.en ? followTrack(cur, val, t.en) : null } };
      });
    },
    setOffset(v: number) {
      set({ offset: clampOffset(v) });
    },
    setSize(v: number) {
      set({ size: clampSize(v) });
    },
    /** Stop whatever is running. */
    stop() {
      abort?.abort();
    },
    /** /create is closing: stop and forget the editor's callbacks. */
    dispose() {
      abort?.abort();
      abort = null;
      clearMarker(d.storage());
      handlers = {};
    },
    ack() {
      if (state.outcome && !state.busy) set({ outcome: null });
    },
    loadPlan() {
      if (state.plan || planLoading) return;
      planLoading = true;
      d.api<{ plan: { name: string }; captions: { burn: boolean; left: number | null; limit: number | null; transcribe?: boolean } }>("/api/plan/limits")
        .then((l) => set({ plan: { burn: l.captions.burn, left: l.captions.left, limit: l.captions.limit, name: l.plan.name }, ...(typeof l.captions.transcribe === "boolean" ? { aiReady: l.captions.transcribe } : {}) }))
        .catch(() => {})
        .finally(() => (planLoading = false));
    },
    applyScript(script: string): boolean {
      const c = cuesFromScript(script, ctx.duration);
      if (!c.length) {
        set({ note: "Type a line or two first." });
        return false;
      }
      set((s) => ({ ...replaceOriginal(c), words: [], gaps: [], typing: false, rev: s.rev + 1, note: `Spread ${c.length} captions across the clip. Nudge the times if a line lands early or late.` }));
      return true;
    },

    /**
     * Whole video, or only the parts in `retry`. Chunks go up a few at a time, each retried on a passing failure; a
     * part that still fails is listed with a retry instead of throwing the rest away. If nothing comes back, the
     * lines you had stay as they were.
     */
    async transcribe(retry?: number[]) {
      const { file, src, duration } = ctx;
      const lang = state.langPick;
      const ctrl = start({ kind: "transcribe", done: 0, total: 0 });
      let outcome: Outcome = "failed";
      /** Stop or a plan stop mid-run: keeps the parts that landed as real answers, with the rest listed to retry. */
      let keepLanded: ((why: "stopped" | "fatal") => void) | null = null;
      try {
        const key = file ?? src;
        let got = chunks?.key === key ? chunks.chunks : null;
        if (!got) {
          // 1151: read the creator's own file when we still have it. Fetching the blob:/signed URL back is what
          // failed with "Failed to fetch" (CSP connect-src had no blob:), and a remote re-download is slower anyway.
          got = await d.audioChunks(file ?? src, ctrl.signal);
          chunks = { key, chunks: got };
        }
        const all = got;
        const again = !!retry && !!lastRun;
        const run: Run = again ? lastRun! : { run: d.runId(), lang, parts: new Map() };
        const todo = again ? retry!.filter((i) => all[i]) : all.map((c) => c.index);
        // A silent part is not sent (no AI call, no charge, no words made up for nothing). It is left out of the
        // runner, so the first part that is sent still goes alone and carries the run's one charge. Its span is
        // only cleared at the final commit, so lines typed over a quiet intro survive a Stop.
        const quiet = todo.filter((i) => all[i].silent);
        const send = todo.filter((i) => !all[i].silent);
        set({ busy: { kind: "transcribe", done: quiet.length, total: todo.length } });
        const span = (i: number) => ({ from: all[i].from, to: Math.min(all[i].to, duration || Infinity) });
        // Progressive (caption perf): a whole-video run shows each part's lines the moment that part lands, so the
        // first lines can be read and fixed while the rest are still out. Only the landed part's span changes, and
        // English lines whose original did not change stay until the run ends. A line you fix in a part that has
        // landed stays; a part that has not landed yet is replaced when it does, as before.
        const landed = new Map<number, ChunkAnswer>();
        /** Per landed part, the lines this run last put in its span; `edited` = parts someone changed since. */
        const mine = new Map<number, Cue[]>();
        const edited = new Set<number>();
        const touched = (i: number, cs: Cue[]) => edited.has(i) || (mine.has(i) && !sameLines(within(cs, span(i).from, span(i).to), mine.get(i)!));
        const showPart = (i: number, a: ChunkAnswer) => {
          if (again || abort !== ctrl) return;
          const cur = state;
          for (const k of mine.keys()) if (touched(k, cur.tracks.orig)) edited.add(k);
          landed.set(i, a);
          const order = [...landed.keys()].sort((x, y) => x - y);
          const sw = stitchWords(order.map((k) => ({ from: all[k].from, to: all[k].to, words: landed.get(k)!.words })));
          const lines = order.map((k) => landed.get(k)!.lines).find(Boolean);
          const built = buildCues(sw, mergeSubtitleRules(lines ?? {}), duration || Infinity);
          const orig = spliceSpan(cur.tracks.orig, built, span(i).from, span(i).to);
          const w = spliceWords(cur.words, sw, span(i).from, span(i).to);
          // Re-read every untouched part: this splice may have trimmed a neighbour's edge, which is not an edit.
          for (const k of order) if (!edited.has(k)) mine.set(k, within(orig, span(k).from, span(k).to));
          const en = cur.tracks.en ? keepEnglish(cur.tracks.orig, cur.tracks.en, cur.untranslated, orig) : null;
          const language = order.map((k) => landed.get(k)!.language).find(Boolean) ?? "";
          set({
            tracks: { ...cur.tracks, orig, ...(en ? { en: en.en } : {}) },
            ...(en ? { untranslated: en.untranslated } : {}),
            words: w,
            ...(language ? { heard: language } : {}),
          });
        };
        keepLanded = (why) => {
          if (again || !landed.size) return;
          for (const [i, a] of landed) run.parts.set(i, a);
          lastRun = run;
          const rest: Gap[] = todo.filter((i) => !landed.has(i)).map((i) => ({ index: i, ...span(i) }));
          set({ gaps: rest, ...(why === "stopped" && rest.length ? { note: `Stopped with ${landed.size} of ${todo.length} parts back. Retry the rest below.` } : {}) });
        };
        const out = await runChunks(send, (i, signal) => d.postChunk(all[i], { ref: ref(), run: run.run, lang: run.lang }, signal), {
          signal: ctrl.signal,
          onResult: showPart,
          onDone: (_, done) => abort === ctrl && set({ busy: { kind: "transcribe", done: quiet.length + done, total: todo.length } }),
        });
        for (const i of quiet) out.results.set(i, QUIET);
        if (ctrl.signal.aborted) {
          if (abort === ctrl) keepLanded("stopped");
          return;
        }
        if (out.fatal) {
          keepLanded("fatal");
          if (out.fatal.status === 402 && out.fatal.code === "PLAN_LIMIT") d.offerUpgrade(out.fatal.message, out.fatal.data.feature as string | undefined);
          throw new ApiError(out.fatal.status, out.fatal.message, out.fatal.code);
        }
        if (!out.results.size) throw new ApiError(out.failed[0]?.error.status ?? 502, out.failed[0]?.error.message ?? "Transcription didn't come back.", out.failed[0]?.error.code);
        for (const [i, a] of out.results) run.parts.set(i, a);
        lastRun = run;
        const order = [...run.parts.keys()].sort((a, b) => a - b);
        const stitched = stitchWords(order.map((i) => ({ from: all[i].from, to: all[i].to, words: run.parts.get(i)!.words })));
        const lines = order.map((i) => run.parts.get(i)!.lines).find(Boolean);
        const built = buildCues(stitched, mergeSubtitleRules(lines ?? {}), duration || Infinity);
        const language = order.map((i) => run.parts.get(i)!.language).find(Boolean) ?? "";
        const missing: Gap[] = out.failed.map((f) => ({ index: f.index, ...span(f.index) }));
        // Latest lines, read as the answers land, so lines edited while chunks were out are kept.
        const cur = state;
        let next: Cue[];
        let nextWords: Word[];
        let gaps: Gap[];
        if (again) {
          // Only the retried parts change; edits everywhere else stay, including ones made while this ran.
          next = cur.tracks.orig;
          nextWords = cur.words;
          for (const i of out.results.keys()) {
            next = spliceSpan(next, built, span(i).from, span(i).to);
            nextWords = spliceWords(nextWords, stitched, span(i).from, span(i).to);
          }
          gaps = [...cur.gaps.filter((x) => !out.results.has(x.index) && !missing.some((m) => m.index === x.index)), ...missing].sort((a, b) => a.index - b.index);
        } else if ([...mine.keys()].some((i) => touched(i, cur.tracks.orig))) {
          // Lines were fixed while the run was out: every part nobody touched gets the whole-video lines (so a
          // line across a seam is built from both parts' words); a part someone edited keeps their edits.
          next = cur.tracks.orig;
          nextWords = cur.words;
          for (const i of out.results.keys()) {
            if (touched(i, cur.tracks.orig)) continue;
            next = spliceSpan(next, built, span(i).from, span(i).to);
            nextWords = spliceWords(nextWords, stitched, span(i).from, span(i).to);
          }
          gaps = missing;
        } else {
          // A part that failed this time keeps the lines it had before, so a re-run never loses captions.
          // (Progressive display only touched the parts that landed, so `cur` still has the old lines there.)
          next = built;
          nextWords = stitched;
          for (const m of missing) {
            next = spliceSpan(next, cur.tracks.orig, m.from, m.to);
            nextWords = spliceWords(nextWords, cur.words, m.from, m.to);
          }
          gaps = missing;
        }
        const keptEn = again && cur.tracks.en ? keepEnglish(cur.tracks.orig, cur.tracks.en, cur.untranslated, next) : null;
        const gapText = missing.length ? ` ${missing.map((m) => `${fmt(m.from)} to ${fmt(m.to)}`).join(", ")} didn't come back. Retry ${missing.length === 1 ? "that part" : "those parts"} below.` : "";
        const kept = keptEn?.untranslated.length ? " Your English lines are kept. Translate the new lines to add them." : "";
        set({
          ...(keptEn ? { tracks: { ...cur.tracks, orig: next, en: keptEn.en }, untranslated: keptEn.untranslated } : replaceOriginal(next)),
          words: nextWords,
          gaps,
          rev: cur.rev + 1,
          ...(language ? { heard: language } : {}),
          plan: null, // re-read what's left this month
          note: next.length ? `${next.length} captions. Fix any word by clicking it.${gapText}${kept}` : missing.length ? `We couldn't transcribe this video yet.${gapText}` : "We didn't hear any speech. Type your captions instead.",
          ...(!next.length && !missing.length ? { typing: true } : {}),
        });
        outcome = missing.length || !next.length ? "failed" : "done";
      } catch (e) {
        if ((e as Error).name === "AbortError" || ctrl.signal.aborted) {
          if (abort === ctrl) keepLanded?.("stopped");
          return;
        }
        const noAi = e instanceof ApiError && e.code === "NO_AI";
        set({ note: (e as Error).message, ...(noAi ? { aiReady: false } : {}), ...(e instanceof ApiError && (e.code === "NO_AI" || e.code === "PLAN_LIMIT") ? { typing: true } : {}) });
      } finally {
        finish(ctrl, outcome);
      }
    },

    /**
     * English for every line (or only `only`), on the original's timing. Lines the engine left out are listed.
     * A long video goes in windows of lines, one request each; a window that fails leaves its lines listed.
     */
    async translate(only?: number[]) {
      const source = state.tracks.orig;
      if (!source.length) return;
      const from = state.langPick !== "auto" ? state.langPick : state.heard || "auto";
      const ctrl = start({ kind: "translate" });
      let outcome: Outcome = "failed";
      try {
        const merged = source.map((c) => ({ ...c }));
        const done = new Set<number>();
        const missing = new Set<number>();
        let firstErr: unknown = null;
        const wins = translateWindows(source.length, only?.length ? only : undefined);
        for (let k = 0; k < wins.length; k++) {
          const w = wins[k];
          const slice = source.slice(w.lo, w.hi);
          const ids = w.only ?? slice.map((_, i) => i);
          try {
            const r = await d.api<{ cues: Cue[]; untranslated: number[] }>("/api/ai/translate-captions", { method: "POST", json: { cues: slice, from, to: "en", ...(w.only ? { only: w.only } : {}) }, signal: ctrl.signal });
            if (!Array.isArray(r.cues) || !sameTimes(r.cues, slice)) throw new Error("The translation came back out of step with your lines, so we didn't use it. Try again.");
            const left = new Set(r.untranslated ?? []);
            for (const i of ids) {
              if (left.has(i)) missing.add(w.lo + i);
              else {
                merged[w.lo + i] = { ...merged[w.lo + i], text: r.cues[i].text };
                done.add(w.lo + i);
              }
            }
          } catch (e) {
            if ((e as Error).name === "AbortError" || ctrl.signal.aborted) throw e;
            firstErr ??= e;
            for (const i of ids) missing.add(w.lo + i);
            // Out of allowance, not set up, or refused: the windows after this one would be refused too.
            if (e instanceof ApiError && e.status !== 502) {
              for (const r of wins.slice(k + 1)) for (const i of r.only ?? []) missing.add(r.lo + i);
              break;
            }
          }
        }
        if (!done.size && firstErr) throw firstErr;
        const t = state.tracks;
        // Lines edited while the translation ran: their times moved, so this answer no longer fits.
        if (!sameTimes(t.orig, source)) {
          set({ note: "Your lines changed while we translated. Translate again to match them." });
          return;
        }
        const base = only?.length && t.en && sameTimes(t.en, source) ? t.en : null;
        const en = base ? base.map((c, i) => (done.has(i) ? { ...c, text: merged[i].text } : c)) : merged;
        const untranslated = (only?.length ? [...new Set([...state.untranslated.filter((i) => !only.includes(i)), ...missing])] : [...missing]).sort((a, b) => a - b);
        set((s) => ({
          tracks: { ...t, en, view: "english" },
          untranslated,
          rev: s.rev + 1,
          note: `Translated to English on the same timing. Switch between Original and English any time; both can be edited.${missing.size ? ` ${missing.size} line${missing.size === 1 ? "" : "s"} still show the original words.` : ""}`,
        }));
        outcome = missing.size ? "failed" : "done";
      } catch (e) {
        if ((e as Error).name === "AbortError" || ctrl.signal.aborted) return;
        set({ note: (e as Error).message, ...(e instanceof ApiError && e.code === "NO_AI" ? { aiReady: false } : {}) });
      } finally {
        finish(ctrl, outcome);
      }
    },

    /** The captioned MP4, made in the browser from the clean video, shifted lines and all. Handed to the workspace. `font` is the loaded caption family name. */
    async burn(cues: Cue[], font?: string) {
      if (!cues.length) return;
      try {
        await d.api("/api/plan/limits", { method: "POST", json: { feature: "burn" } });
      } catch (e) {
        // 402 already opened the upgrade popup
        set({ note: (e as Error).message });
        return;
      }
      const { src, filename, duration } = ctx;
      const s0 = state;
      const ctrl = start({ kind: "burn", p: 0 });
      let outcome: Outcome = "failed";
      try {
        const file = await d.burnCaptions(src, exportCues(cues, s0.offset, duration), { style: s0.style, pos: s0.pos, size: s0.size, font, name: filename, signal: ctrl.signal, onProgress: (p) => abort === ctrl && set({ busy: { kind: "burn", p } }) });
        if (ctrl.signal.aborted) return;
        if (handlers.onBurned) {
          set({ burned: true });
          handlers.onBurned(file, "captions");
        } else set({ pendingBurn: file });
        outcome = "done";
      } catch (e) {
        if ((e as Error).name !== "AbortError" && !ctrl.signal.aborted) handlers.onError?.((e as Error).message);
      } finally {
        finish(ctrl, outcome);
      }
    },
  };
  return store;
}
