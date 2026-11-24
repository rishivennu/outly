"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, ApiError, offerUpgrade } from "@/lib/client/api";
import { exportClip } from "@/lib/client/clipper";
import { clampRange, mmss, previewStyle, slideAxis } from "@/lib/clipper/executor-core";
import { drawFor, keptShare, type ReframePlan } from "@/lib/clipper/reframe-core";
import { OUT_H, OUT_W } from "@/lib/clipper/settings-core";
import type { Cue } from "@/lib/captions/cues";
import type { ClipView } from "@/lib/clipper/jobs";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Card } from "@/components/intelligence/bits";
import { ProgressBar } from "./ClipperStudio";
import { DownloadButton } from "./ReviewScreen";

/**
 * R1322: one clip. A live 9:16 preview of the reframe (the source video shown through the same rectangles the render
 * uses), the range, the subtitle look, and the copy. Save sends only what changed; a timing, framing or subtitle
 * change makes the export stale and the screen says so. Export renders in this tab.
 */
export function ClipEditor({ clip, src, cues, duration, sourceName, onClose, onSaved }: { clip: ClipView; src: string; cues: Cue[]; duration: number; sourceName: string; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const fromClip = (c: ClipView) => ({ title: c.title, hook: c.hook ?? "", caption: c.caption ?? "", hashtags: c.hashtags ?? "", start: c.start, end: c.end, reframe: c.reframe, subtitle: c.subtitle });
  const [draft, setDraft] = useState(() => fromClip(clip));
  /** The range boxes hold text while they are typed in ("12." stays "12."); the numbers land on blur (R1322 review #19). */
  const [rangeText, setRangeText] = useState<{ start: string; end: string }>({ start: String(clip.start), end: String(clip.end) });
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "exporting"; p: number; phase: "render" | "upload" } | { kind: "error"; message: string }>({ kind: "idle" });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const backdrop = useRef<HTMLVideoElement>(null);
  const abort = useRef<AbortController | null>(null);
  /** The export reads the source URL at the moment it starts, never one captured by an older render (R1322 review #1). */
  const srcRef = useRef(src);
  srcRef.current = src;

  // A refreshed copy of the same clip (an approval elsewhere on the page) keeps the edits; a saved change replaces them.
  useEffect(() => {
    setDraft(fromClip(clip));
    setRangeText({ start: String(clip.start), end: String(clip.end) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, clip.updatedAt]);

  useEffect(() => {
    for (const v of [video.current, backdrop.current]) if (v) v.currentTime = draft.start;
  }, [draft.start]);

  // Leaving the editor stops a render that is still running, and a tab close asks first (R1322 review #5, #6).
  useEffect(() => () => abort.current?.abort(), []);
  const exporting = state.kind === "exporting";
  useEffect(() => {
    if (!exporting) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [exporting]);

  const dirty = useMemo(
    () =>
      draft.title.trim() !== clip.title ||
      (draft.hook || null) !== clip.hook ||
      (draft.caption || null) !== clip.caption ||
      (draft.hashtags || null) !== clip.hashtags ||
      draft.start !== clip.start ||
      draft.end !== clip.end ||
      JSON.stringify(draft.reframe) !== JSON.stringify(clip.reframe) ||
      JSON.stringify(draft.subtitle) !== JSON.stringify(clip.subtitle),
    [draft, clip],
  );
  const staleAfterSave = draft.start !== clip.start || draft.end !== clip.end || JSON.stringify(draft.reframe) !== JSON.stringify(clip.reframe) || JSON.stringify(draft.subtitle) !== JSON.stringify(clip.subtitle);

  /** True when the clip is now saved (or had nothing to save); false stops an export that was about to follow. */
  const save = async (): Promise<boolean> => {
    setState({ kind: "saving" });
    try {
      const body: Record<string, unknown> = {};
      if (draft.title.trim() && draft.title.trim() !== clip.title) body.title = draft.title.trim();
      if ((draft.hook || null) !== clip.hook) body.hook = draft.hook || null;
      if ((draft.caption || null) !== clip.caption) body.caption = draft.caption || null;
      if ((draft.hashtags || null) !== clip.hashtags) body.hashtags = draft.hashtags || null;
      if (draft.start !== clip.start) body.start = draft.start;
      if (draft.end !== clip.end) body.end = draft.end;
      if (JSON.stringify(draft.reframe) !== JSON.stringify(clip.reframe)) body.reframe = draft.reframe;
      if (JSON.stringify(draft.subtitle) !== JSON.stringify(clip.subtitle)) body.subtitle = draft.subtitle;
      if (Object.keys(body).length) await api(`/api/clipper/clips/${clip.id}`, { method: "PATCH", json: body });
      await onSaved();
      setState({ kind: "idle" });
      return true;
    } catch (e) {
      setState({ kind: "error", message: e instanceof ApiError ? e.message : "Couldn't save the clip." });
      return false;
    }
  };

  const doExport = async () => {
    // Unsaved edits go first; a save that fails must not export the older server copy (R1322 review #3).
    if (dirty && !(await save())) return;
    const src = srcRef.current;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState({ kind: "exporting", p: 0, phase: "render" });
    try {
      const fresh = await api<{ clip: ClipView }>(`/api/clipper/clips/${clip.id}`);
      await exportClip(src, fresh.clip, sourceName, {
        cues: fresh.clip.subtitle.burn ? cues : null,
        style: fresh.clip.subtitle.style,
        pos: fresh.clip.subtitle.pos,
        signal: ctrl.signal,
        onPhase: (phase) => setState((s) => (s.kind === "exporting" ? { ...s, phase, p: 0 } : s)),
        onProgress: (p) => setState((s) => (s.kind === "exporting" ? { ...s, p } : s)),
      });
      await onSaved();
      setState({ kind: "idle" });
    } catch (e) {
      if (ctrl.signal.aborted) {
        setState({ kind: "idle" });
        await onSaved().catch(() => {});
        return;
      }
      const message = e instanceof ApiError ? e.message : (e as Error)?.message || "The export stopped.";
      // The rendered file counts as an upload; a full library is a plan question, not a render fault (R1322 review #21).
      if (e instanceof ApiError && e.status === 402) offerUpgrade(message, (e.data?.feature as string | undefined) ?? "uploads");
      setState({ kind: "error", message });
      await onSaved().catch(() => {});
    } finally {
      if (abort.current === ctrl) abort.current = null;
    }
  };

  const regenerate = async () => {
    setState({ kind: "saving" });
    try {
      await api(`/api/clipper/clips/${clip.id}/regenerate`, { method: "POST" });
      await onSaved();
      setState({ kind: "idle" });
    } catch (e) {
      setState({ kind: "error", message: e instanceof ApiError ? e.message : "Couldn't redraft the words." });
    }
  };

  const commitRange = () => {
    const s = Number(rangeText.start);
    const e = Number(rangeText.end);
    const r = clampRange({ start: Number.isFinite(s) ? s : draft.start, end: Number.isFinite(e) ? e : draft.end }, duration || Math.max(e || 0, draft.end));
    setDraft((d) => ({ ...d, ...r }));
    setRangeText({ start: String(r.start), end: String(r.end) });
  };
  const busy = state.kind === "saving" || state.kind === "exporting";
  // A landscape source slides its window sideways; a tall one (rare) slides it up and down (R1322 review #17).
  const axis = size ? slideAxis(size.w, size.h) : "x";

  return (
    <Card id="clipper-editor" className="relative" title={clip.title} desc={`${mmss(clip.start)} to ${mmss(clip.end)}. ${clip.renderStatus === "rendered" ? (staleAfterSave ? "Saving these changes will need a new export." : "Exported.") : "Not exported yet."}`}>
      <div className="absolute right-4 top-4"><Button type="button" variant="ghost" size="icon-sm" disabled={exporting} onClick={onClose} aria-label={exporting ? "Stop the export before closing" : "Close editor"}><X className="h-4 w-4" aria-hidden /></Button></div>
      <div className="mt-4 grid gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
        <div>
          <Preview src={src} plan={draft.reframe} videoRef={video} backdropRef={backdrop} onSize={setSize} />
          {size && <p className="mt-2 text-[12px] text-muted-foreground">{draft.reframe.mode === "crop" ? `Keeps ${Math.round(keptShare(size.w, size.h, draft.reframe) * 100)}% of the picture. Slide to follow the speaker.` : "Whole picture over a blurred copy."}</p>}
          <div className="mt-3 flex gap-2">
            {(["crop", "pillarbox"] as const).map((m) => (
              <Button key={m} type="button" size="sm" variant={draft.reframe.mode === m ? "lime" : "outline"} aria-pressed={draft.reframe.mode === m} onClick={() => setDraft((d) => ({ ...d, reframe: { ...d.reframe, mode: m } }))}>
                {m === "crop" ? "Fill" : "Fit"}
              </Button>
            ))}
          </div>
          {draft.reframe.mode === "crop" && (
            <label className="mt-3 block text-[13px]">
              <span className="font-medium">Window position</span>
              <input type="range" min={0} max={100} value={Math.round(draft.reframe[axis] * 100)} onChange={(e) => setDraft((d) => ({ ...d, reframe: { ...d.reframe, [axis]: Number(e.target.value) / 100 } }))} className="mt-1 w-full accent-[hsl(var(--lime))]" aria-label={axis === "x" ? "Horizontal position of the 9:16 window" : "Vertical position of the 9:16 window"} />
            </label>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[13px]">
              <span className="font-medium">Start (s)</span>
              <Input inputMode="decimal" value={rangeText.start} onChange={(e) => setRangeText((t) => ({ ...t, start: e.target.value }))} onBlur={commitRange} className="mt-1 h-11 rounded-xl text-[14px]" />
            </label>
            <label className="text-[13px]">
              <span className="font-medium">End (s)</span>
              <Input inputMode="decimal" value={rangeText.end} onChange={(e) => setRangeText((t) => ({ ...t, end: e.target.value }))} onBlur={commitRange} className="mt-1 h-11 rounded-xl text-[14px]" />
            </label>
          </div>
          <p className="text-[12px] text-muted-foreground">{Math.round((draft.end - draft.start) * 10) / 10} s. Clips run 8 to 90 s.</p>

          <fieldset className="rounded-2xl bg-secondary/40 p-3 hairline">
            <legend className="px-1 text-[13px] font-medium">Subtitles</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={draft.subtitle.burn} onChange={(e) => setDraft((d) => ({ ...d, subtitle: { ...d.subtitle, burn: e.target.checked } }))} className="h-4 w-4 accent-[hsl(var(--lime))]" /> Burn in</label>
              <select aria-label="Subtitle style" value={draft.subtitle.style} onChange={(e) => setDraft((d) => ({ ...d, subtitle: { ...d.subtitle, style: e.target.value as typeof d.subtitle.style } }))} className="h-9 rounded-xl bg-background/70 px-2 text-[13px] hairline">
                <option value="pop">Pop</option>
                <option value="box">Box</option>
                <option value="clean">Clean</option>
              </select>
              <select aria-label="Subtitle position" value={draft.subtitle.pos} onChange={(e) => setDraft((d) => ({ ...d, subtitle: { ...d.subtitle, pos: e.target.value as typeof d.subtitle.pos } }))} className="h-9 rounded-xl bg-background/70 px-2 text-[13px] hairline">
                <option value="bottom">Bottom</option>
                <option value="middle">Middle</option>
                <option value="top">Top</option>
              </select>
            </div>
            {!cues.length && <p className="mt-2 text-[12px] text-muted-foreground">No transcript lines for this video, so nothing is burned.</p>}
          </fieldset>

          <label className="block text-[13px]">
            <span className="font-medium">Title</span>
            <Input value={draft.title} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} className="mt-1 h-11 rounded-xl text-[14px]" />
          </label>
          <label className="block text-[13px]">
            <span className="font-medium">Hook</span>
            <Input value={draft.hook} maxLength={300} onChange={(e) => setDraft((d) => ({ ...d, hook: e.target.value }))} className="mt-1 h-11 rounded-xl text-[14px]" />
          </label>
          <label className="block text-[13px]">
            <span className="font-medium">Caption</span>
            <Textarea value={draft.caption} maxLength={2200} rows={3} onChange={(e) => setDraft((d) => ({ ...d, caption: e.target.value }))} className="mt-1 text-[14px]" />
          </label>
          <label className="block text-[13px]">
            <span className="font-medium">Hashtags</span>
            <Input value={draft.hashtags} maxLength={300} onChange={(e) => setDraft((d) => ({ ...d, hashtags: e.target.value }))} className="mt-1 h-11 rounded-xl text-[14px]" />
          </label>
          <p className="text-[12px] text-muted-foreground">The words were drafted from what is said in the clip. Redraft puts them back.</p>

          {state.kind === "exporting" && <ProgressBar value={state.p} label={state.phase === "render" ? "Rendering" : "Uploading"} />}
          {state.kind === "exporting" && <p className="text-[12px] text-muted-foreground">{state.phase === "render" ? "Rendering plays the clip once in this tab. Keep this tab in front until it finishes; browsers slow a hidden tab down." : "Uploading the rendered clip to your library."}</p>}
          {state.kind === "error" && <p className="text-[13px] text-destructive" role="alert">{state.message}</p>}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="lime" disabled={busy || !dirty} onClick={save}>Save</Button>
            <Button type="button" variant="primary" disabled={busy || clip.status === "published"} onClick={doExport}>{clip.renderStatus === "rendered" && !staleAfterSave ? "Export again" : "Export 9:16"}</Button>
            {state.kind === "exporting" && <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>Stop</Button>}
            {clip.renderStatus === "rendered" && !staleAfterSave && <DownloadButton clip={clip} />}
            <Button type="button" variant="ghost" disabled={busy} onClick={regenerate}>Redraft words</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** The source through the reframe rectangles, at preview size. The same drawFor the render uses. */
function Preview({ src, plan, videoRef, backdropRef, onSize }: { src: string; plan: ReframePlan; videoRef: React.RefObject<HTMLVideoElement | null>; backdropRef: React.RefObject<HTMLVideoElement | null>; onSize: (s: { w: number; h: number }) => void }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const W = 240;
  const H = Math.round((W * OUT_H) / OUT_W);
  const d = size ? drawFor(size.w, size.h, plan) : null;
  const k = W / OUT_W;
  // The video element is sized so its source rectangle lands on the destination rectangle (previewStyle is the tested mapping).
  const style = d && size ? previewStyle(size, d, k) : undefined;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black hairline" style={{ width: W, height: H }} role="img" aria-label="9:16 preview of the clip">
      {/* The render blurs a cover-fitted copy by 36 px at 1080 wide: at this width that is 8 px, with the same dark wash over it. */}
      {d?.backdrop && <video ref={backdropRef} src={src} muted playsInline preload="metadata" aria-hidden className="absolute inset-0 h-full w-full object-cover blur-[8px] brightness-75" />}
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          const s = { w: v.videoWidth || 1920, h: v.videoHeight || 1080 };
          setSize(s);
          onSize(s);
        }}
        className="absolute left-0 top-0 max-w-none"
        style={style}
      />
    </div>
  );
}
