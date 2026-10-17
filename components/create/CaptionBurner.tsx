"use client";
import { useEffect, useRef, useState } from "react";
import { Captions, Download, Loader2, Plus, Sparkles, Trash2, Type, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { ApiError } from "@/lib/client/api";
import { audioChunks, burnCaptions, drawCue, recorderType } from "@/lib/client/captions";
import { CAPTION_STYLES, cueAt, cuesFromScript, normalizeCues, toSrt, type CaptionPos, type CaptionStyle, type Cue } from "@/lib/captions/cues";
import { cn } from "@/lib/utils";
import { wordsFromCues, type Word } from "@/lib/captions/subtitle-engine";
import { ClipCutter } from "./ClipCutter";

interface Props {
  src: string;
  filename: string;
  duration: number;
  /** A captioned copy is ready: parent uploads it and swaps it in. */
  onBurned: (file: File, kind?: "captions" | "cut") => void;
  /** Shown after a burn so the creator can go back to the clean video. */
  onUndo?: () => void;
  onError: (msg: string) => void;
}

type Busy = null | { kind: "transcribe"; done: number; total: number } | { kind: "burn"; p: number };

const POSITIONS: { id: CaptionPos; label: string }[] = [
  { id: "bottom", label: "Bottom" },
  { id: "middle", label: "Middle" },
  { id: "top", label: "Top" },
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * Off by default. Turning the switch on reveals transcribe / type, an editable cue list, a live preview
 * and "Burn into video", which makes a new MP4 in the browser and swaps it in as the post's video.
 */
export function CaptionBurner({ src, filename, duration, onBurned, onUndo, onError }: Props) {
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
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const canRecord = typeof window !== "undefined" && !!recorderType();

  // Live preview: the same drawCue the recorder uses, on a transparent canvas over the player.
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      const c = canvas.current;
      if (v && c && v.videoWidth) {
        if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        const cue = cueAt(cues, v.currentTime);
        if (cue) drawCue(ctx, cue.text, c.width, c.height, style, pos);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, cues, style, pos]);

  useEffect(() => () => abort.current?.abort(), []);

  async function transcribe() {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setNote(null);
    try {
      const chunks = await audioChunks(src, ctrl.signal);
      setBusy({ kind: "transcribe", done: 0, total: chunks.length });
      const all: Cue[] = [];
      const ws: Word[] = [];
      let lang = "";
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const r = await fetch(`/api/ai/transcribe?offset=${c.offset}&duration=${c.duration}`, { method: "POST", body: c.blob, headers: { "content-type": "audio/wav" }, credentials: "same-origin", signal: ctrl.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new ApiError(r.status, j.error ?? "Transcription didn't come back.", j.code);
        all.push(...(j.cues as Cue[]));
        if (Array.isArray(j.words)) ws.push(...(j.words as Word[]));
        lang ||= j.language;
        setBusy({ kind: "transcribe", done: i + 1, total: chunks.length });
      }
      const clean = normalizeCues(all, duration || Infinity);
      setCues(clean);
      setWords(ws.length ? ws : wordsFromCues(clean));
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toSrt(cues)], { type: "application/x-subrip" }));
    a.download = `${filename.replace(/\.[^.]+$/, "") || "captions"}.srt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const edit = (i: number, patch: Partial<Cue>) => setCues((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const working = !!busy;

  return (
    <section aria-labelledby="cap-title" className="glass mt-6 rounded-[28px] p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-secondary/70 hairline" aria-hidden>
          <Captions className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="cap-title" className="text-[15px] font-semibold">Captions on the video</h2>
          <p className="text-[13px] text-muted-foreground">{burned ? "On. The post uses the captioned copy of your video." : on ? "Burned into the picture, so they show on every platform." : "Off. Turn on to add subtitles to the video itself."}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <span className="sr-only">Add captions</span>
          <input type="checkbox" role="switch" checked={on} disabled={working} onChange={(e) => {
            setOn(e.target.checked);
            if (!e.target.checked) {
              abort.current?.abort();
              // switching captions off puts the clean video back
              if (burned && onUndo) { setBurned(false); onUndo(); }
            }
          }} className="peer sr-only" />
          <span aria-hidden className="relative h-7 w-12 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-background after:shadow after:transition-transform after:duration-300 peer-checked:after:translate-x-5" />
        </label>
      </div>

      {on && (
        <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <div className="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl bg-black">
            <video ref={video} src={src} controls playsInline muted className="block h-auto w-full" aria-label="Caption preview" />
            <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
          </div>

          <div className="min-w-0">
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

            {typing && (
              <div className="mt-3">
                <label htmlFor="cap-script" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">Your script, one line per caption</label>
                <Textarea id="cap-script" rows={4} value={script} onChange={(e) => setScript(e.target.value)} placeholder={"I quit my job to bake bread.\nSix months later…"} />
                <Button type="button" variant="subtle" className="mt-2" onClick={applyScript}>Use these lines</Button>
              </div>
            )}

            {note && <p role="status" className="mt-3 rounded-2xl bg-secondary/60 px-3.5 py-2.5 text-[13px]">{note}</p>}

            {cues.length > 0 && (
              <>
                <ol className="mt-4 max-h-64 space-y-1.5 overflow-y-auto pr-1" aria-label="Captions">
                  {cues.map((c, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <button type="button" onClick={() => { if (video.current) { video.current.currentTime = c.start; } }} className="min-h-[44px] w-16 shrink-0 rounded-xl text-[13px] tabular text-muted-foreground hover:bg-secondary" aria-label={`Jump to ${fmt(c.start)}`}>
                        {fmt(c.start)}
                      </button>
                      <input value={c.text} onChange={(e) => edit(i, { text: e.target.value })} aria-label={`Caption ${i + 1} text`} className="h-11 min-w-0 flex-1 rounded-xl bg-secondary/50 px-3 text-[14px] hairline" />
                      <button type="button" onClick={() => setCues((cs) => cs.filter((_, j) => j !== i))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Delete caption ${i + 1}`}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ol>
                <button type="button" onClick={() => { const last = cues[cues.length - 1]; const s = Math.min(duration, last ? last.end : 0); setCues((cs) => [...cs, { start: s, end: Math.min(duration || s + 2, s + 2), text: "New caption" }]); }} className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] text-muted-foreground hover:text-foreground">
                  <Plus className="h-4 w-4" aria-hidden /> Add a caption
                </button>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Seg label="Caption style" value={style} onChange={setStyle} options={CAPTION_STYLES} />
                  <Seg label="Caption position" value={pos} onChange={setPos} options={POSITIONS} />
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {canRecord ? (
                    <Button type="button" variant="primary" onClick={burn} disabled={working}>
                      {busy?.kind === "burn" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Captions className="h-4 w-4" aria-hidden />}
                      {busy?.kind === "burn" ? `Adding captions ${Math.round(busy.p * 100)}%` : "Burn into video"}
                    </Button>
                  ) : (
                    <p className="text-[13px] text-muted-foreground">This browser can&apos;t make MP4 video. Use the latest Chrome, Edge or Safari to burn captions in.</p>
                  )}
                  {busy?.kind === "burn" && <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}>Cancel</Button>}
                  <Button type="button" variant="ghost" onClick={downloadSrt} disabled={working}><Download className="h-4 w-4" aria-hidden />.srt file</Button>
                  {burned && onUndo && !working && <Button type="button" variant="ghost" onClick={() => { setBurned(false); onUndo(); }}><Undo2 className="h-4 w-4" aria-hidden />Use the video without captions</Button>}
                </div>
                {busy?.kind === "burn" && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Adding captions" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(busy.p * 100)}>
                    <div className="h-full rounded-full bg-lime transition-[width] duration-300" style={{ width: `${busy.p * 100}%` }} />
                  </div>
                )}
                <p className="mt-2 text-[13px] text-muted-foreground">Burning plays the clip once in the background, so it takes about as long as the video. Keep this tab open.</p>

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
        </div>
      )}
    </section>
  );
}

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-2xl bg-secondary/60 p-1 hairline">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)} className={cn("min-h-[40px] flex-1 rounded-xl px-2 text-[13px] font-semibold transition-colors", value === o.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
