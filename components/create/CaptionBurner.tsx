"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Captions, Clock, Download, Loader2, Lock, Plus, Sparkles, Trash2, Type, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { api, ApiError, offerUpgrade } from "@/lib/client/api";
import { audioChunks, burnCaptions, drawCue, recorderType } from "@/lib/client/captions";
import { CAPTION_STYLES, cueAt, cuesFromScript, normalizeCues, toSrt, type CaptionPos, type CaptionStyle, type Cue } from "@/lib/captions/cues";
import { cn } from "@/lib/utils";
import { wordsFromCues, type Word } from "@/lib/captions/subtitle-engine";
import { insertCue } from "@/lib/captions/insert";
import { cueBounds, cueIssues, MAX_CUE_TEXT, nudgeCue, readTrack, restoreCue, retimeCue, swapText, type CaptionTrack, type Edge } from "@/lib/captions/edit";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useToast } from "@/components/shared/Toast";
import { TimeStepper } from "./captions/TimeStepper";
import { ClipCutter } from "./ClipCutter";
import { saveBlob } from "@/lib/client/native";

interface Props {
  src: string;
  /** The creator's local file for this same video, when we still have it: transcribed without a network read. */
  file?: Blob | null;
  filename: string;
  duration: number;
  /** A captioned copy is ready: parent uploads it and swaps it in. */
  onBurned: (file: File, kind?: "captions" | "cut") => void;
  /** Shown after a burn so the creator can go back to the clean video. */
  onUndo?: () => void;
  onError: (msg: string) => void;
  /**
   * 1152: the page's one video player and the canvas laid over it. The editor no longer keeps a second preview of
   * its own (that copy was the black box): it draws onto, seeks and reads the time of the player on the left.
   */
  video: React.RefObject<HTMLVideoElement | null>;
  canvas: React.RefObject<HTMLCanvasElement | null>;
  /** Captions switched on or off: the parent shows the clean video with the live overlay while they are on. */
  onLive?: (on: boolean) => void;
  /** A caption track kept with a device draft (CaptionTrack). Read defensively; anything malformed is dropped. */
  initialTrack?: unknown;
  /** Every edit, so the draft can keep the captions. null = captions off or no lines. */
  onTrackChange?: (track: CaptionTrack | null) => void;
}

type Busy = null | { kind: "transcribe"; done: number; total: number } | { kind: "burn"; p: number };

// Top to bottom, the order they sit on the frame.
const POSITIONS: { id: CaptionPos; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "middle", label: "Middle" },
  { id: "bottom", label: "Bottom" },
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * Off by default. Turning the switch on reveals transcribe / type, an editable cue list, a live preview
 * and "Burn into video", which makes a new MP4 in the browser and swaps it in as the post's video.
 */
export function CaptionBurner({ src, file, filename, duration, onBurned, onUndo, onError, video, canvas, onLive, initialTrack, onTrackChange }: Props) {
  const [init] = useState(() => readTrack(initialTrack, duration || Infinity));
  const [on, setOn] = useState(!!init?.cues.length);
  const [cues, setCues] = useState<Cue[]>(init?.cues ?? []);
  const cuesRef = useRef(cues);
  cuesRef.current = cues;
  /* Word timings from the engine: what "cut by text" searches. Typed captions fall back to rough ones. */
  const [words, setWords] = useState<Word[]>([]);
  const [style, setStyle] = useState<CaptionStyle>(init?.style ?? "pop");
  const [pos, setPos] = useState<CaptionPos>(init?.pos ?? "bottom");
  const [busy, setBusy] = useState<Busy>(null);
  const [typing, setTyping] = useState(false);
  const [script, setScript] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [burned, setBurned] = useState(false);
  const abort = useRef<AbortController | null>(null);
  /** The caption under the playhead, so the list can show which line is on screen. */
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const list = useRef<HTMLOListElement>(null);
  const [moved, setMoved] = useState("");
  /* The row whose timing panel is open, and a visible word when a typed time had to be pulled in. */
  const [timing, setTiming] = useState<number | null>(null);
  const [hint, setHint] = useState<{ i: number; text: string } | null>(null);
  /* Replacing lines the creator may have edited asks first. */
  const [ask, setAsk] = useState<null | "transcribe" | "script">(null);
  /* Whether the server has a transcription engine. null = not known yet; false = typing only, never a fake transcript. */
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const toast = useToast();
  const canRecord = typeof window !== "undefined" && !!recorderType();
  /* Plan gates: burning is paid-only; Free gets AI captions on a few videos a month. null = not loaded yet. */
  const [plan, setPlan] = useState<null | { burn: boolean; left: number | null; limit: number | null; name: string }>(null);
  useEffect(() => {
    if (!on || plan) return;
    api<{ plan: { name: string }; captions: { burn: boolean; left: number | null; limit: number | null; transcribe?: boolean } }>("/api/plan/limits")
      .then((l) => {
        setPlan({ burn: l.captions.burn, left: l.captions.left, limit: l.captions.limit, name: l.plan.name });
        if (typeof l.captions.transcribe === "boolean") setAiReady(l.captions.transcribe);
      })
      .catch(() => {});
  }, [on, plan]);
  useEffect(() => {
    if (on && aiReady === false) setTyping(true);
  }, [on, aiReady]);
  const trackCb = useRef(onTrackChange);
  trackCb.current = onTrackChange;
  useEffect(() => {
    trackCb.current?.(on && cues.length ? { v: 1, cues, style, pos } : null);
  }, [on, cues, style, pos]);
  // One video = one caption allowance, however many chunks or re-runs. Same file + length = same ref.
  const ref = `${filename}:${Math.round(duration * 10)}`;

  useEffect(() => {
    onLive?.(on);
  }, [on, onLive]);
  useEffect(() => () => onLive?.(false), [onLive]);

  // Live preview: the same drawCue the recorder uses, on a transparent canvas over the one player. Every edit
  // (text, style, position) shows on the next frame, and the list follows the playhead.
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      const c = canvas.current;
      const cue = v ? cueAt(cues, v.currentTime) : null;
      if (v && c && v.videoWidth) {
        if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        if (cue) drawCue(ctx, cue.text, c.width, c.height, style, pos);
      } else if (c && c.width) {
        // A new source is loading (burn, undo, replace): no stale line over the poster.
        c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      }
      const i = cue ? cues.indexOf(cue) : -1;
      if (i !== activeRef.current) {
        activeRef.current = i;
        setActive(i);
        // While it plays, keep the line on screen in view inside the list (never scrolls the page).
        const ol = list.current;
        const row = i >= 0 ? (ol?.children[i] as HTMLElement | undefined) : undefined;
        if (v && !v.paused && ol && row && (row.offsetTop < ol.scrollTop || row.offsetTop + row.offsetHeight > ol.scrollTop + ol.clientHeight)) {
          ol.scrollTop = row.offsetTop - 8;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      const c = canvas.current;
      c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    };
  }, [on, cues, style, pos, video, canvas]);

  useEffect(() => () => abort.current?.abort(), []);

  async function transcribe() {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setNote(null);
    try {
      // 1151: read the creator's own file when we still have it. Fetching the blob:/signed URL back is what
      // failed with "Failed to fetch" (CSP connect-src had no blob:), and a remote re-download is slower anyway.
      const chunks = await audioChunks(file ?? src, ctrl.signal);
      setBusy({ kind: "transcribe", done: 0, total: chunks.length });
      const all: Cue[] = [];
      const ws: Word[] = [];
      let lang = "";
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const r = await fetch(`/api/ai/transcribe?offset=${c.offset}&duration=${c.duration}&ref=${encodeURIComponent(ref)}`, { method: "POST", body: c.blob, headers: { "content-type": "audio/wav" }, credentials: "same-origin", signal: ctrl.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (r.status === 402 && j.code === "PLAN_LIMIT") offerUpgrade(j.error, j.feature);
          throw new ApiError(r.status, j.error ?? "Transcription didn't come back.", j.code);
        }
        all.push(...(j.cues as Cue[]));
        if (Array.isArray(j.words)) ws.push(...(j.words as Word[]));
        lang ||= j.language;
        setBusy({ kind: "transcribe", done: i + 1, total: chunks.length });
      }
      const clean = normalizeCues(all, duration || Infinity);
      setCues(clean);
      setTiming(null);
      setWords(ws.length ? ws : wordsFromCues(clean));
      setPlan(null); // re-read what's left this month
      setNote(clean.length ? `${clean.length} captions${lang ? ` in ${lang}` : ""}. Fix any word by clicking it.` : "We didn't hear any speech. Type your captions instead.");
      if (!clean.length) setTyping(true);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = (e as Error).message;
      setNote(msg);
      if (e instanceof ApiError && e.code === "NO_AI") setAiReady(false);
      if (e instanceof ApiError && (e.code === "NO_AI" || e.code === "PLAN_LIMIT")) setTyping(true);
    } finally {
      setBusy(null);
    }
  }

  function applyScript() {
    const c = cuesFromScript(script, duration);
    if (!c.length) return setNote("Type a line or two first.");
    setCues(c);
    setWords([]);
    setTiming(null);
    setTyping(false);
    setNote(`Spread ${c.length} captions across the clip. Nudge the times if a line lands early or late.`);
  }

  /** The first thing that would make the burn or the .srt wrong, said plainly, with that line in focus. */
  function blocked() {
    const issue = cueIssues(cues, duration)[0];
    if (!issue) return false;
    setNote(issue.message);
    focusRow(issue.index);
    return true;
  }

  async function burn() {
    if (!cues.length || blocked()) return;
    try {
      await api("/api/plan/limits", { method: "POST", json: { feature: "burn" } });
    } catch (e) {
      // 402 already opened the upgrade popup
      setNote((e as Error).message);
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy({ kind: "burn", p: 0 });
    setNote(null);
    try {
      const file = await burnCaptions(src, cues, { style, pos, name: filename, signal: ctrl.signal, onProgress: (p) => setBusy({ kind: "burn", p }) });
      setBurned(true);
      onBurned(file, "captions");
    } catch (e) {
      if ((e as Error).name !== "AbortError") onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function downloadSrt() {
    if (blocked()) return;
    void saveBlob(new Blob([toSrt(cues)], { type: "application/x-subrip" }), `${filename.replace(/\.[^.]+$/, "") || "captions"}.srt`).catch(() => {});
  }

  const edit = (i: number, patch: Partial<Cue>) => setCues((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addBtn = useRef<HTMLButtonElement>(null);
  const focusRow = (i: number) => requestAnimationFrame(() => list.current?.querySelectorAll<HTMLInputElement>("input[data-cue]")[i]?.focus());
  const jump = (c: Cue) => {
    const v = video.current;
    if (v) v.currentTime = Math.min(c.start + 0.01, Math.max(0, c.end - 0.01));
  };
  /* Reorder = the lines swap places, the timing slots stay where the speech is. */
  const move = (i: number, dir: -1 | 1) => {
    const next = swapText(cues, i, dir);
    if (!next) return;
    const j = i + dir;
    setCues(next);
    setMoved(`Caption moved to ${fmt(cues[j].start)}.`);
    if (timing === i) setTiming(j);
    focusRow(j);
  };
  const remove = (i: number) => {
    const cue = cues[i];
    setCues((cs) => cs.filter((_, j) => j !== i));
    setTiming(null);
    setHint(null);
    setMoved(`Caption ${i + 1} deleted.`);
    toast(`Caption ${i + 1} deleted.`, "info", {
      action: {
        label: "Undo",
        onClick: () => {
          const r = restoreCue(cuesRef.current, cue);
          if (!r) return setNote("Another line uses that time now, so the deleted one could not go back. Add it again.");
          setCues(r.cues);
          setMoved(`Caption ${r.index + 1} is back.`);
          focusRow(r.index);
        },
      },
    });
    if (cues.length > 1) focusRow(Math.max(0, Math.min(i, cues.length - 2)));
    else requestAnimationFrame(() => addBtn.current?.focus());
  };
  /* A new line goes in at the playhead, in the first free gap (never on top of another line), kept in time order. */
  const add = () => {
    const r = insertCue(cues, video.current?.currentTime ?? 0, duration);
    if (!r) { setMoved("There is no room for another caption. Shorten a line first."); return; }
    setCues(r.cues);
    setTiming(r.index);
    setHint(null);
    setMoved(`Caption added at ${fmt(r.cues[r.index].start)}.`);
    focusRow(r.index);
  };
  /* Retiming moves the preview to the edge being set, so the change shows on the picture at once. */
  const showEdge = (c: Cue, edge: Edge) => {
    const v = video.current;
    if (!v) return;
    if (!v.paused) v.pause();
    v.currentTime = edge === "start" ? Math.min(c.start + 0.01, c.end) : Math.max(c.start, c.end - 0.05);
  };
  const applyRetime = (i: number, edge: Edge, r: ReturnType<typeof retimeCue>): string | null => {
    if (!r.ok) return r.error;
    setCues(r.cues);
    showEdge(r.cues[i], edge);
    const where = edge === "start" ? "starts" : "ends";
    setHint(r.clamped ? { i, text: `Line ${i + 1} ${where} at ${r.value.toFixed(2)} s, the nearest time that keeps it clear of the lines around it.` } : null);
    setMoved(`Caption ${i + 1} ${where} at ${r.value.toFixed(2)} seconds.`);
    return null;
  };
  const retime = (i: number, edge: Edge, value: number) => applyRetime(i, edge, retimeCue(cues, i, edge, value, duration));
  const nudge = (i: number, edge: Edge, delta: number) => void applyRetime(i, edge, nudgeCue(cues, i, edge, delta, duration));
  const working = !!busy;

  return (
    <section aria-labelledby="cap-title" className="glass rounded-[28px] p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden>
          <Captions className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="cap-title" className="text-[15px] font-semibold">Captions on the video</h2>
          <p className="text-[13px] text-muted-foreground">{burned ? "On. The post uses the captioned copy of your video." : on ? "Burned into the picture, so they show on every platform. Edits show on the preview right away." : "Off. Turn on to add subtitles to the video itself."}</p>
        </div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2">
          <span className="sr-only">Add captions</span>
          <input type="checkbox" role="switch" checked={on} disabled={working} onChange={(e) => {
            setOn(e.target.checked);
            if (!e.target.checked) {
              abort.current?.abort();
              // switching captions off puts the clean video back
              if (burned && onUndo) { setBurned(false); onUndo(); }
            }
          }} className="peer sr-only" />
          <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 motion-reduce:after:transition-none peer-checked:after:translate-x-5" />
        </label>
      </div>

      {on && (
        <div className="mt-5 min-w-0">
          <div className="flex flex-wrap gap-2">
            {aiReady !== false && (
              <Button type="button" variant="lime" onClick={() => (cues.length ? setAsk("transcribe") : transcribe())} disabled={working}>
                {busy?.kind === "transcribe" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                {busy?.kind === "transcribe" ? `Listening${busy.total > 1 ? ` ${busy.done}/${busy.total}` : ""}…` : cues.length ? "Transcribe again" : "Transcribe with AI"}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setTyping((t) => !t)} disabled={working} aria-expanded={typing}>
              <Type className="h-4 w-4" aria-hidden /> Type or paste
            </Button>
            {busy?.kind === "transcribe" && <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}><X className="h-4 w-4" aria-hidden />Stop</Button>}
          </div>
          {aiReady === false && (
            <p className="mt-2 text-[13px] text-muted-foreground">AI transcription is not set up on this workspace. Type or paste your lines, or add them one at a time.</p>
          )}
          {aiReady !== false && plan?.limit != null && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {plan.left ? `AI captions: ${plan.left} of ${plan.limit} videos left this month on ${plan.name}.` : `You've used this month's ${plan.limit} AI-captioned videos on ${plan.name}. You can still type captions.`}
            </p>
          )}

          {typing && (
            <div className="mt-4">
              <label htmlFor="cap-script" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Your script, one line per caption</label>
              <Textarea id="cap-script" rows={4} value={script} onChange={(e) => setScript(e.target.value)} placeholder={"I quit my job to bake bread.\nSix months later…"} />
              <Button type="button" variant="subtle" className="mt-2" onClick={() => (cues.length ? setAsk("script") : applyScript())}>Use these lines</Button>
            </div>
          )}

          {note && <p role="status" className="mt-4 rounded-2xl bg-secondary/60 px-3.5 py-2.5 text-[13px]">{note}</p>}

          <p className="sr-only" aria-live="polite">{moved}</p>
          {cues.length === 0 && (
            <Button ref={addBtn} type="button" variant="subtle" size="sm" className="mt-4" onClick={add} disabled={working}>
              <Plus className="h-4 w-4" aria-hidden /> Add caption
            </Button>
          )}

          {cues.length > 0 && (
            <>
              <div className="mt-5 flex items-baseline justify-between gap-3">
                <h3 className="text-[13px] font-semibold">Lines <span className="font-normal text-muted-foreground tabular">({cues.length})</span></h3>
                <p className="text-[12px] text-muted-foreground">Press a time to jump there. The clock sets timing.</p>
              </div>
              <ol ref={list} className="relative mt-2 max-h-[min(52dvh,460px)] space-y-2 overflow-y-auto overscroll-contain rounded-2xl p-1 pr-1.5" aria-label="Captions">
                {cues.map((c, i) => {
                  const live = i === active;
                  const open = timing === i;
                  const b = open ? cueBounds(cues, i, duration) : null;
                  return (
                    <li key={i} aria-current={live ? "true" : undefined} className={cn("flex flex-wrap items-center gap-1.5 rounded-2xl p-1.5 transition-colors motion-reduce:transition-none sm:flex-nowrap sm:gap-2", open && "sm:flex-wrap", live ? "bg-lime/10 ring-1 ring-lime/60" : "bg-secondary/30 hairline")}>
                      <input data-cue value={c.text} maxLength={MAX_CUE_TEXT} onChange={(e) => edit(i, { text: e.target.value })} onFocus={() => { const v = video.current; if (v && v.paused) jump(c); }} aria-label={`Caption ${i + 1} text, ${fmt(c.start)} to ${fmt(c.end)}`} aria-invalid={!c.text.trim() || undefined} className="order-first h-11 min-w-0 basis-full rounded-xl bg-background/70 px-3 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 sm:order-none sm:basis-0 sm:flex-1" />
                      <button type="button" onClick={() => jump(c)} className={cn("flex min-h-[44px] shrink-0 flex-col items-start justify-center rounded-xl px-2 text-left tabular [@media(hover:hover)]:hover:bg-secondary sm:order-first sm:w-[92px]", live ? "text-foreground" : "text-muted-foreground")} aria-label={`Jump to ${fmt(c.start)}, caption ${i + 1}`}>
                        <span className="text-[13px] font-semibold leading-tight">{fmt(c.start)}</span>
                        <span className="text-[12px] leading-tight">to {fmt(c.end)}</span>
                      </button>
                      <span className="flex-1 sm:hidden" aria-hidden />
                      <div className="flex shrink-0 items-center">
                        <button type="button" onClick={() => { setTiming(open ? null : i); setHint(null); }} aria-expanded={open} aria-controls={`cap-timing-${i}`} className={cn("grid h-11 w-11 place-items-center rounded-xl text-muted-foreground active:scale-[0.96] [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground", open && "bg-secondary text-foreground")} aria-label={`Edit timing of caption ${i + 1}`}>
                          <Clock className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" onClick={() => remove(i)} className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground active:scale-[0.96] [@media(hover:hover)]:hover:bg-destructive/15 [@media(hover:hover)]:hover:text-[hsl(0_72%_38%)] dark:[@media(hover:hover)]:hover:text-destructive" aria-label={`Delete caption ${i + 1}`}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                      {open && b && (
                        <div id={`cap-timing-${i}`} role="group" aria-label={`Timing of caption ${i + 1}`} className="basis-full space-y-2 px-0.5 pb-1 pt-1">
                          <div className="grid gap-2 min-[400px]:grid-cols-2">
                            <TimeStepper label="Starts" name={`Caption ${i + 1} start`} value={c.start} min={b.startMin} max={b.startMax} onCommit={(v) => retime(i, "start", v)} onNudge={(d) => nudge(i, "start", d)} />
                            <TimeStepper label="Ends" name={`Caption ${i + 1} end`} value={c.end} min={b.endMin} max={b.endMax} onCommit={(v) => retime(i, "end", v)} onNudge={(d) => nudge(i, "end", d)} />
                          </div>
                          {hint?.i === i && <p className="text-[12px] text-muted-foreground">{hint.text}</p>}
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="mr-1 text-[12px] text-muted-foreground">Swap words with the line</span>
                            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="flex h-11 items-center gap-1 rounded-xl px-2.5 text-[13px] font-medium text-muted-foreground active:scale-[0.96] [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground disabled:opacity-40" aria-label={`Move caption ${i + 1} up`}>
                              <ArrowUp className="h-4 w-4" aria-hidden /> Before
                            </button>
                            <button type="button" onClick={() => move(i, 1)} disabled={i === cues.length - 1} className="flex h-11 items-center gap-1 rounded-xl px-2.5 text-[13px] font-medium text-muted-foreground active:scale-[0.96] [@media(hover:hover)]:hover:bg-secondary [@media(hover:hover)]:hover:text-foreground disabled:opacity-40" aria-label={`Move caption ${i + 1} down`}>
                              <ArrowDown className="h-4 w-4" aria-hidden /> After
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
              <Button ref={addBtn} type="button" variant="subtle" size="sm" className="mt-3" onClick={add} disabled={working}>
                <Plus className="h-4 w-4" aria-hidden /> Add caption
              </Button>

              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:group-data-[pip=open]/edit:grid-cols-1 2xl:group-data-[pip=open]/edit:grid-cols-2">
                <Seg label="Style" value={style} onChange={setStyle} options={CAPTION_STYLES} />
                <Seg label="Position" value={pos} onChange={setPos} options={POSITIONS} />
              </div>

              <div className="mt-6 rounded-2xl bg-secondary/40 p-3 hairline sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {canRecord ? (
                    <Button type="button" variant="primary" onClick={burn} disabled={working}>
                      {busy?.kind === "burn" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : plan && !plan.burn ? <Lock className="h-4 w-4" aria-hidden /> : <Captions className="h-4 w-4" aria-hidden />}
                      {busy?.kind === "burn" ? `Adding captions ${Math.round(busy.p * 100)}%` : plan && !plan.burn ? "Burn into video (paid plans)" : "Burn into video"}
                    </Button>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">This browser can&apos;t make MP4 video. Use the latest Chrome, Edge or Safari to burn captions in.</p>
                  )}
                  {busy?.kind === "burn" && <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}>Cancel</Button>}
                  <Button type="button" variant="outline" onClick={downloadSrt} disabled={working} aria-label="Download captions as an .srt file"><Download className="h-4 w-4" aria-hidden />Download .srt</Button>
                  {burned && onUndo && !working && <Button type="button" variant="ghost" onClick={() => { setBurned(false); onUndo(); }}><Undo2 className="h-4 w-4" aria-hidden />Use the video without captions</Button>}
                </div>
                {busy?.kind === "burn" && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Adding captions" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(busy.p * 100)}>
                    <div className="h-full rounded-full bg-lime transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${busy.p * 100}%` }} />
                  </div>
                )}
                <p className="mt-2.5 text-[13px] text-muted-foreground">Burn makes a new MP4 with the captions in the picture; it plays the clip once, so it takes about as long as the video. Keep this tab open. The .srt is a separate subtitle file for platforms that take one.</p>
              </div>

              {canRecord && (
                <ClipCutter
                  src={src}
                  filename={filename}
                  duration={duration}
                  cues={cues}
                  words={words.length ? words : wordsFromCues(cues)}
                  style={style}
                  pos={pos}
                  preview={video}
                  disabled={working}
                  onCut={(f) => { setBurned(true); onBurned(f, "cut"); }}
                  onError={onError}
                />
              )}
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={!!ask}
        onOpenChange={(o) => !o && setAsk(null)}
        title="Replace your caption lines?"
        body={`This swaps the ${cues.length} line${cues.length === 1 ? "" : "s"} you have, edits included, for new ones.`}
        confirmLabel={ask === "transcribe" ? "Transcribe again" : "Use the new lines"}
        cancelLabel="Keep my lines"
        onConfirm={() => {
          const a = ask;
          setAsk(null);
          if (a === "transcribe") void transcribe();
          else if (a === "script") applyScript();
        }}
      />
    </section>
  );
}

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; label: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[13px] font-medium text-muted-foreground" aria-hidden>{label}</p>
      <div role="radiogroup" aria-label={`Caption ${label.toLowerCase()}`} className="flex w-full rounded-2xl bg-secondary/60 p-1 hairline">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)} className={cn("min-h-[44px] min-w-0 flex-1 whitespace-nowrap rounded-xl px-2.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none", value === o.id ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/15" : "text-muted-foreground hover:text-foreground")}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
