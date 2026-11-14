"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Captions, Download, Loader2, Lock, Plus, Sparkles, Trash2, Type, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { api, ApiError, offerUpgrade } from "@/lib/client/api";
import { audioChunks, burnCaptions, drawCue, recorderType } from "@/lib/client/captions";
import { CAPTION_STYLES, cueAt, cuesFromScript, normalizeCues, toSrt, type CaptionPos, type CaptionStyle, type Cue } from "@/lib/captions/cues";
import { cn } from "@/lib/utils";
import { wordsFromCues, type Word } from "@/lib/captions/subtitle-engine";
import { insertCue } from "@/lib/captions/insert";
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
export function CaptionBurner({ src, file, filename, duration, onBurned, onUndo, onError, video, canvas, onLive }: Props) {
  const [on, setOn] = useState(false);
  const [cues, setCues] = useState<Cue[]>([]);
  /* Word timings from the engine: what "cut by text" searches. Typed captions fall back to rough ones. */
  const [words, setWords] = useState<Word[]>([]);
  const [style, setStyle] = useState<CaptionStyle>("pop");
  const [pos, setPos] = useState<CaptionPos>("bottom");
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
  const canRecord = typeof window !== "undefined" && !!recorderType();
  /* Plan gates: burning is paid-only; Free gets AI captions on a few videos a month. null = not loaded yet. */
  const [plan, setPlan] = useState<null | { burn: boolean; left: number | null; limit: number | null; name: string }>(null);
  useEffect(() => {
    if (!on || plan) return;
    api<{ plan: { name: string }; captions: { burn: boolean; left: number | null; limit: number | null } }>("/api/plan/limits")
      .then((l) => setPlan({ burn: l.captions.burn, left: l.captions.left, limit: l.captions.limit, name: l.plan.name }))
      .catch(() => {});
  }, [on, plan]);
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
      setWords(ws.length ? ws : wordsFromCues(clean));
      setPlan(null); // re-read what's left this month
      setNote(clean.length ? `${clean.length} captions${lang ? ` in ${lang}` : ""}. Fix any word by clicking it.` : "We didn't hear any speech. Type your captions instead.");
      if (!clean.length) setTyping(true);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const msg = (e as Error).message;
      setNote(msg);
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
    setTyping(false);
    setNote(`Spread ${c.length} captions across the clip. Nudge the times if a line lands early or late.`);
  }

  async function burn() {
    if (!cues.length) return;
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
    const j = i + dir;
    if (j < 0 || j >= cues.length) return;
    setCues((cs) => cs.map((c, k) => (k === i ? { ...c, text: cs[j].text } : k === j ? { ...c, text: cs[i].text } : c)));
    setMoved(`Caption moved to ${fmt(cues[j].start)}.`);
    focusRow(j);
  };
  const remove = (i: number) => {
    setCues((cs) => cs.filter((_, j) => j !== i));
    setMoved(`Caption ${i + 1} deleted.`);
    if (cues.length > 1) focusRow(Math.max(0, Math.min(i, cues.length - 2)));
    else requestAnimationFrame(() => addBtn.current?.focus());
  };
  /* A new line goes in at the playhead, in the first free gap (never on top of another line), kept in time order. */
  const add = () => {
    const r = insertCue(cues, video.current?.currentTime ?? 0, duration);
    if (!r) { setMoved("There is no room for another caption. Shorten a line first."); return; }
    setCues(r.cues);
    setMoved(`Caption added at ${fmt(r.cues[r.index].start)}.`);
    focusRow(r.index);
  };
  const working = !!busy;

  return (
    <section aria-labelledby="cap-title" className="glass rounded-[28px] p-5 sm:p-6">
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
            <Button type="button" variant="lime" onClick={transcribe} disabled={working}>
              {busy?.kind === "transcribe" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {busy?.kind === "transcribe" ? `Listening${busy.total > 1 ? ` ${busy.done}/${busy.total}` : ""}…` : cues.length ? "Transcribe again" : "Transcribe with AI"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setTyping((t) => !t)} disabled={working} aria-expanded={typing}>
              <Type className="h-4 w-4" aria-hidden /> Type or paste
            </Button>
            {busy?.kind === "transcribe" && <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}><X className="h-4 w-4" aria-hidden />Stop</Button>}
          </div>
          {plan?.limit != null && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              {plan.left ? `AI captions: ${plan.left} of ${plan.limit} videos left this month on ${plan.name}.` : `You've used this month's ${plan.limit} AI-captioned videos on ${plan.name}. You can still type captions.`}
            </p>
          )}

          {typing && (
            <div className="mt-4">
              <label htmlFor="cap-script" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Your script, one line per caption</label>
              <Textarea id="cap-script" rows={4} value={script} onChange={(e) => setScript(e.target.value)} placeholder={"I quit my job to bake bread.\nSix months later…"} />
              <Button type="button" variant="subtle" className="mt-2" onClick={applyScript}>Use these lines</Button>
            </div>
          )}

          {note && <p role="status" className="mt-4 rounded-2xl bg-secondary/60 px-3.5 py-2.5 text-[13px]">{note}</p>}

          {cues.length > 0 && (
            <>
              <div className="mt-5 flex items-baseline justify-between gap-3">
                <h3 className="text-[13px] font-semibold">Lines <span className="font-normal text-muted-foreground tabular">({cues.length})</span></h3>
                <p className="text-[12px] text-muted-foreground">Press a time to jump the preview there.</p>
              </div>
              <ol ref={list} className="relative mt-2 max-h-[min(52dvh,460px)] space-y-2 overflow-y-auto overscroll-contain rounded-2xl p-1 pr-1.5" aria-label="Captions">
                {cues.map((c, i) => {
                  const live = i === active;
                  return (
                    <li key={i} aria-current={live ? "true" : undefined} className={cn("flex items-center gap-1.5 rounded-2xl p-1.5 transition-colors motion-reduce:transition-none sm:gap-2", live ? "bg-lime/10 ring-1 ring-lime/60" : "bg-secondary/30 hairline")}>
                      <button type="button" onClick={() => jump(c)} className={cn("flex min-h-[44px] shrink-0 flex-col items-start justify-center rounded-xl px-2 text-left tabular hover:bg-secondary sm:w-[92px]", live ? "text-foreground" : "text-muted-foreground")} aria-label={`Jump to ${fmt(c.start)}, caption ${i + 1}`}>
                        <span className="text-[13px] font-semibold leading-tight">{fmt(c.start)}</span>
                        <span className="text-[12px] leading-tight">to {fmt(c.end)}</span>
                      </button>
                      <input data-cue value={c.text} onChange={(e) => edit(i, { text: e.target.value })} onFocus={() => { const v = video.current; if (v && v.paused) jump(c); }} aria-label={`Caption ${i + 1} text, ${fmt(c.start)} to ${fmt(c.end)}`} className="h-11 min-w-0 flex-1 rounded-xl bg-background/70 px-3 text-[14px] hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1" />
                      <div className="flex shrink-0 items-center">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="hidden h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent sm:grid" aria-label={`Move caption ${i + 1} up`}>
                          <ArrowUp className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === cues.length - 1} className="hidden h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent sm:grid" aria-label={`Move caption ${i + 1} down`}>
                          <ArrowDown className="h-4 w-4" aria-hidden />
                        </button>
                        <button type="button" onClick={() => remove(i)} className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-destructive/15 hover:text-[hsl(0_72%_38%)] dark:hover:text-destructive" aria-label={`Delete caption ${i + 1}`}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="sr-only" aria-live="polite">{moved}</p>
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
