"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { exportClip } from "@/lib/client/clipper";
import { clampRange, mmss } from "@/lib/clipper/executor-core";
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
  const [draft, setDraft] = useState(() => ({ title: clip.title, hook: clip.hook ?? "", caption: clip.caption ?? "", hashtags: clip.hashtags ?? "", start: clip.start, end: clip.end, reframe: clip.reframe, subtitle: clip.subtitle }));
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "exporting"; p: number; phase: "render" | "upload" } | { kind: "error"; message: string }>({ kind: "idle" });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setDraft({ title: clip.title, hook: clip.hook ?? "", caption: clip.caption ?? "", hashtags: clip.hashtags ?? "", start: clip.start, end: clip.end, reframe: clip.reframe, subtitle: clip.subtitle });
  }, [clip]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.currentTime = draft.start;
  }, [draft.start]);

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

  const save = async () => {
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
    } catch (e) {
      setState({ kind: "error", message: e instanceof ApiError ? e.message : "Couldn't save the clip." });
    }
  };

  const doExport = async () => {
    if (dirty) await save();
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
      if (ctrl.signal.aborted) return setState({ kind: "idle" });
      setState({ kind: "error", message: e instanceof ApiError ? e.message : (e as Error)?.message || "The export stopped." });
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

  const setRange = (r: { start: number; end: number }) => setDraft((d) => ({ ...d, ...clampRange(r, duration || Math.max(r.end, d.end)) }));
  const busy = state.kind === "saving" || state.kind === "exporting";

  return (
    <Card id="clipper-editor" className="relative" title={clip.title} desc={`${mmss(clip.start)} to ${mmss(clip.end)}. ${clip.renderStatus === "rendered" ? (staleAfterSave ? "Saving these changes will need a new export." : "Exported.") : "Not exported yet."}`}>
      <div className="absolute right-4 top-4"><Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close editor"><X className="h-4 w-4" aria-hidden /></Button></div>
      <div className="mt-4 grid gap-5 md:grid-cols-[240px_minmax(0,1fr)]">
        <div>
          <Preview src={src} plan={draft.reframe} videoRef={video} onSize={setSize} />
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
              <input type="range" min={0} max={100} value={Math.round(draft.reframe.x * 100)} onChange={(e) => setDraft((d) => ({ ...d, reframe: { ...d.reframe, x: Number(e.target.value) / 100 } }))} className="mt-1 w-full accent-[hsl(var(--lime))]" aria-label="Horizontal position of the 9:16 window" />
            </label>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[13px]">
              <span className="font-medium">Start (s)</span>
              <Input inputMode="decimal" value={String(draft.start)} onChange={(e) => setRange({ start: Number(e.target.value) || 0, end: draft.end })} className="mt-1 h-11 rounded-xl text-[14px]" />
            </label>
            <label className="text-[13px]">
              <span className="font-medium">End (s)</span>
              <Input inputMode="decimal" value={String(draft.end)} onChange={(e) => setRange({ start: draft.start, end: Number(e.target.value) || 0 })} className="mt-1 h-11 rounded-xl text-[14px]" />
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
          {state.kind === "exporting" && <p className="text-[12px] text-muted-foreground">{state.phase === "render" ? "Rendering plays the clip once in this tab; keep it open." : "Uploading the rendered clip to your library."}</p>}
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
function Preview({ src, plan, videoRef, onSize }: { src: string; plan: ReframePlan; videoRef: React.RefObject<HTMLVideoElement | null>; onSize: (s: { w: number; h: number }) => void }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const W = 240;
  const H = Math.round((W * OUT_H) / OUT_W);
  const d = size ? drawFor(size.w, size.h, plan) : null;
  const k = W / OUT_W;
  // The video element is sized so its source rectangle lands on the destination rectangle.
  const style = d && size ? { width: `${(size.w * d.dw * k) / d.sw}px`, height: `${(size.h * d.dh * k) / d.sh}px`, transform: `translate(${(d.dx - (d.sx * d.dw) / d.sw) * k}px, ${(d.dy - (d.sy * d.dh) / d.sh) * k}px)` } : undefined;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black hairline" style={{ width: W, height: H }} aria-label="9:16 preview">
      {d?.backdrop && <video src={src} muted playsInline aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl opacity-70" />}
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
