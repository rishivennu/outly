import { api, ApiError, offerUpgrade } from "@/lib/client/api";
import { audioChunks, burnCaptions, postChunk, type AudioChunk, type ChunkAnswer } from "@/lib/client/captions";
import { cuesFromScript, type CaptionPos, type CaptionStyle, type Cue } from "@/lib/captions/cues";
import { readTrack, type CaptionTrack, type CaptionView } from "@/lib/captions/edit";
import { exportCues, clampOffset } from "@/lib/captions/offset";
import { runChunks } from "@/lib/captions/run";
import { mergeSubtitleRules, type Word } from "@/lib/captions/subtitle-engine";
import { buildCues, followTrack, keepEnglish, spliceSpan, spliceWords, stitchWords } from "@/lib/captions/timing";
import { translateWindows } from "@/lib/captions/translate-core";

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
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const sameTimes = (a: Cue[], b: Cue[]) => a.length === b.length && a.every((c, i) => c.start === b[i].start && c.end === b[i].end);
const newRunId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const DEPS: Deps = { audioChunks, postChunk, api, burnCaptions, offerUpgrade, runId: newRunId };

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
    rev: 0,
  };
}

/** The track a draft keeps, or null when captions are off or there are no lines. */
export function trackOf(s: CaptionState): CaptionTrack | null {
  const showing = s.tracks.view === "english" && s.tracks.en ? s.tracks.en : s.tracks.orig;
  if (!s.on || !showing.length) return null;
  const both = s.tracks.en ? { original: s.tracks.orig, translated: s.tracks.en, view: s.tracks.view } : {};
  return { v: 1, cues: showing, style: s.style, pos: s.pos, ...(s.heard ? { lang: s.heard } : {}), ...(s.offset ? { offset: s.offset } : {}), ...both };
}

/** The journey pill: what the run is doing, or how it ended. null = nothing to say. */
export function runPill(s: Pick<CaptionState, "busy" | "outcome"> & { pendingBurn?: File | null }): string | null {
  const b = s.busy;
  if (b?.kind === "transcribe") return b.total > 1 ? `Captions ${b.done} of ${b.total} parts` : b.total === 1 ? "Listening" : "Reading the audio";
  if (b?.kind === "translate") return "Translating";
  if (b?.kind === "burn") return `Adding captions ${Math.round(b.p * 100)}%`;
  if (s.pendingBurn) return "Captions ready";
  if (s.outcome === "done") return "Done";
  if (s.outcome === "stopped") return "Stopped";
  if (s.outcome === "failed") return "Needs a look";
  return null;
}

/** The action bar line while a run is busy, so leaving the step is never a guess. */
export function runLine(s: Pick<CaptionState, "busy">): string | null {
  const b = s.busy;
  if (!b) return null;
  const what = b.kind === "transcribe" ? (b.total > 1 ? `Captions ${b.done} of ${b.total} parts` : "Captions are being made") : b.kind === "translate" ? "Translating your captions" : `Adding captions ${Math.round(b.p * 100)}%`;
  return `${what}. They keep going on every step; a reload stops them.`;
}

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
  const start = (busy: Busy) => {
    abort?.abort();
    const ctrl = new AbortController();
    abort = ctrl;
    set({ busy, note: null, outcome: null });
    return ctrl;
  };
  const finish = (ctrl: AbortController, outcome: Outcome) => {
    if (abort !== ctrl) return;
    abort = null;
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
    takeBurn(): boolean {
      const f = state.pendingBurn;
      if (!f || !handlers.onBurned) return false;
      set({ pendingBurn: null, burned: true, outcome: null });
      handlers.onBurned(f, "captions");
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
      return true;
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
    /** Stop whatever is running. */
    stop() {
      abort?.abort();
    },
    /** /create is closing: stop and forget the editor's callbacks. */
    dispose() {
      abort?.abort();
      abort = null;
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
        set({ busy: { kind: "transcribe", done: 0, total: todo.length } });
        const out = await runChunks(todo, (i, signal) => d.postChunk(all[i], { ref: ref(), run: run.run, lang: run.lang }, signal), {
          signal: ctrl.signal,
          onDone: (_, done, total) => abort === ctrl && set({ busy: { kind: "transcribe", done, total } }),
        });
        if (ctrl.signal.aborted) return;
        if (out.fatal) {
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
        const span = (i: number) => ({ from: all[i].from, to: Math.min(all[i].to, duration || Infinity) });
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
        } else {
          // A part that failed this time keeps the lines it had before, so a re-run never loses captions.
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
        if ((e as Error).name === "AbortError" || ctrl.signal.aborted) return;
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

    /** The captioned MP4, made in the browser from the clean video, shifted lines and all. Handed to the workspace. */
    async burn(cues: Cue[]) {
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
        const file = await d.burnCaptions(src, exportCues(cues, s0.offset, duration), { style: s0.style, pos: s0.pos, name: filename, signal: ctrl.signal, onProgress: (p) => abort === ctrl && set({ busy: { kind: "burn", p } }) });
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
