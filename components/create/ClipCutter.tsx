"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Play, Scissors, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/client/api";
import { cutClips } from "@/lib/client/captions";
import { toSrt, type CaptionPos, type CaptionStyle, type Cue } from "@/lib/captions/cues";
import { findText, rangesLength, shiftCues, type Highlight, type Range, type Word } from "@/lib/captions/subtitle-engine";
import { cn } from "@/lib/utils";

type Pick = Range & { title?: string; why?: string; on: boolean; from: "text" | "ai" };

const t = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/**
 * FunClip-style cutting inside the caption editor: type words from the transcript (several with #) or let
 * Gemini suggest highlights, preview each part, then record only the kept parts as the post's video.
 */
export function ClipCutter({ src, filename, duration, cues, words, style, pos, preview, disabled, onCut, onError }: {
  src: string;
  filename: string;
  duration: number;
  cues: Cue[];
  words: Word[];
  style: CaptionStyle;
  pos: CaptionPos;
  preview: React.RefObject<HTMLVideoElement>;
  disabled?: boolean;
  onCut: (file: File) => void;
  onError: (msg: string) => void;
}) {
  const [q, setQ] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "ai" | { p: number }>(null);
  const [withCaps, setWithCaps] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const stopAt = useRef<number | null>(null);

  // Preview a part: play from its start and pause at its end.
  useEffect(() => {
    const v = preview.current;
    if (!v) return;
    const on = () => {
      if (stopAt.current !== null && v.currentTime >= stopAt.current) {
        v.pause();
        stopAt.current = null;
      }
    };
    v.addEventListener("timeupdate", on);
    return () => v.removeEventListener("timeupdate", on);
  }, [preview]);
  useEffect(() => () => abort.current?.abort(), []);

  const play = (r: Range) => {
    const v = preview.current;
    if (!v) return;
    stopAt.current = r.end;
    v.currentTime = r.start;
    v.play().catch(() => {});
  };

  const find = () => {
    if (!q.trim()) return setNote("Type a few words you said, for example: the best part # one more thing");
    const { ranges, missing } = findText(words, q, undefined, duration || Infinity);
    const keepAi = picks.filter((p) => p.from === "ai");
    setPicks([...keepAi, ...ranges.map((r) => ({ ...r, on: true, from: "text" as const }))]);
    setNote(
      ranges.length
        ? `Found ${ranges.length} ${ranges.length === 1 ? "part" : "parts"}.${missing.length ? ` Not in the transcript: ${missing.join(", ")}.` : ""}`
        : `Those words aren't in the transcript${missing.length > 1 ? `: ${missing.join(", ")}` : ""}. Copy them from a caption line above.`,
    );
  };

  const suggest = async () => {
    setBusy("ai");
    setNote(null);
    try {
      const r = await api<{ clips: Highlight[] }>("/api/ai/highlights", { method: "POST", body: JSON.stringify({ cues, duration: duration || cues[cues.length - 1]?.end || 1 }) });
      setPicks((ps) => [...ps.filter((p) => p.from === "text"), ...r.clips.map((c, i) => ({ ...c, on: i === 0, from: "ai" as const }))]);
      setNote(r.clips.length ? `Gemini picked ${r.clips.length} ${r.clips.length === 1 ? "moment" : "moments"}. The first is ticked; tick any others to join them.` : "Gemini didn't find a moment that stands on its own. Try cutting by text.");
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Gemini didn't answer just now. Try again in a minute.");
    } finally {
      setBusy(null);
    }
  };

  const chosen = picks.filter((p) => p.on);
  const length = rangesLength(chosen);
  const working = !!busy || !!disabled;

  const cut = async () => {
    if (!chosen.length) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy({ p: 0 });
    try {
      const file = await cutClips(src, chosen, { cues: withCaps ? cues : undefined, style, pos, name: filename, signal: ctrl.signal, onProgress: (p) => setBusy({ p }) });
      onCut(file);
      setNote(`Cut done: ${length.toFixed(1)} s kept. It is now the post's video.`);
    } catch (e) {
      if ((e as Error).name !== "AbortError") onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const srt = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toSrt(shiftCues(cues, chosen))], { type: "application/x-subrip" }));
    a.download = `${filename.replace(/\.[^.]+$/, "") || "clip"}-cut.srt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <section className="mt-6 border-t border-border/60 pt-5" aria-labelledby="cut-title">
      <h3 id="cut-title" className="flex items-center gap-2 text-[15px] font-semibold">
        <Scissors className="h-4 w-4" aria-hidden /> Cut clips from what you said
      </h3>
      <p className="mt-1 text-[13px] text-muted-foreground">Type words from the captions to keep only those parts. Separate several with #. Or let Gemini find the best moments.</p>

      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); find(); }}>
        <label htmlFor="cut-q" className="sr-only">Words to keep</label>
        <input id="cut-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="the best part # one more thing" className="h-11 min-w-0 flex-1 basis-56 rounded-xl bg-secondary/50 px-3 text-[14px] hairline" />
        <Button type="submit" variant="outline" disabled={working}><Search className="h-4 w-4" aria-hidden /> Find</Button>
        <Button type="button" variant="outline" onClick={suggest} disabled={working}>
          {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {busy === "ai" ? "Finding highlights…" : "Find highlights"}
        </Button>
      </form>

      {note && <p role="status" className="mt-3 rounded-2xl bg-secondary/60 px-3.5 py-2.5 text-[13px]">{note}</p>}

      {picks.length > 0 && (
        <>
          <ul className="mt-3 space-y-1.5" aria-label="Parts to keep">
            {picks.map((p, i) => (
              <li key={`${p.from}-${p.start}-${i}`} className={cn("flex items-start gap-2 rounded-2xl p-2 hairline", p.on ? "bg-secondary/60" : "opacity-80")}>
                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-3 px-1 py-1.5">
                  <input type="checkbox" checked={p.on} onChange={(e) => setPicks((ps) => ps.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--lime))]" />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium">{p.title ?? cues.find((c) => c.end > p.start)?.text ?? "Part"}</span>
                    <span className="block text-[13px] tabular text-muted-foreground">
                      {t(p.start)} to {t(p.end)}, {(p.end - p.start).toFixed(1)} s{p.from === "ai" ? ", picked by Gemini" : ""}
                    </span>
                    {p.why && <span className="mt-0.5 block text-[13px] text-muted-foreground">{p.why}</span>}
                  </span>
                </label>
                <button type="button" onClick={() => play(p)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Preview ${t(p.start)} to ${t(p.end)}`}>
                  <Play className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>

          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" checked={withCaps} onChange={(e) => setWithCaps(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--lime))]" />
            Burn the captions into the cut
          </label>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" variant="primary" onClick={cut} disabled={working || !chosen.length}>
              {busy && typeof busy === "object" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Scissors className="h-4 w-4" aria-hidden />}
              {busy && typeof busy === "object" ? `Cutting ${Math.round(busy.p * 100)}%` : chosen.length ? `Cut to ${length.toFixed(1)} s` : "Tick a part to cut"}
            </Button>
            {busy && typeof busy === "object" && <Button type="button" variant="ghost" onClick={() => abort.current?.abort()}><X className="h-4 w-4" aria-hidden />Cancel</Button>}
            <Button type="button" variant="ghost" onClick={srt} disabled={working || !chosen.length}><Download className="h-4 w-4" aria-hidden />.srt for the cut</Button>
          </div>
          {busy && typeof busy === "object" && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label="Cutting the video" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(busy.p * 100)}>
              <div className="h-full rounded-full bg-lime transition-[width] duration-300" style={{ width: `${busy.p * 100}%` }} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
