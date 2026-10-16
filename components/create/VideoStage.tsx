"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Minimize2, Pause, Play, RefreshCw, Replace, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aspectLabel, cn, formatBytes, formatDuration, resolutionLabel } from "@/lib/utils";
import { validateVideoFile } from "@/lib/client/handoff";
import type { UploadState } from "./types";
import { OutlyMark } from "@/components/brand/Logo";
import { DancingPip } from "./Groove";

interface Props {
  src: string | null;
  poster: string | null;
  filename?: string | null;
  meta: { duration?: number | null; width?: number | null; height?: number | null; size?: number | null; mimeType?: string | null } | null;
  upload: UploadState;
  onReplace: (f: File) => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onError?: (msg: string) => void;
  compact?: boolean;
}

export function VideoStage({ src, poster, filename, meta, upload, onReplace, onRetry, onCancel, onError, compact }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(meta?.duration ?? 0);
  const [full, setFull] = useState(false);
  const [justIn, setJustIn] = useState(false);

  useEffect(() => {
    if (upload.kind !== "done") return;
    setJustIn(true);
    const id = setTimeout(() => setJustIn(false), 2800);
    return () => clearTimeout(id);
  }, [upload.kind]);

  useEffect(() => {
    const f = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  useEffect(() => {
    setPlaying(false);
    setT(0);
  }, [src]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v || !src) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, [src]);

  const seek = (s: number) => {
    const v = video.current;
    if (!v || !d) return;
    v.currentTime = Math.max(0, Math.min(d, s));
    setT(v.currentTime);
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap.current?.requestFullscreen?.().catch(() => {});
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input,button")) return;
    if (e.key === " " || e.key === "k") (e.preventDefault(), toggle());
    else if (e.key === "ArrowRight") (e.preventDefault(), seek(t + 5));
    else if (e.key === "ArrowLeft") (e.preventDefault(), seek(t - 5));
    else if (e.key === "m") setMuted((m) => !m);
    else if (e.key === "f") fullscreen();
  };

  const etaLabel = (() => {
    if (upload.kind !== "uploading") return null;
    const s = upload.eta;
    if (s == null || !Number.isFinite(s) || s < 0) return null;
    if (s < 60) return `about ${Math.max(1, Math.round(s))}s left`;
    return `about ${Math.round(s / 60)}m left`;
  })();

  const ratio = meta?.width && meta?.height ? meta.width / meta.height : 9 / 16;
  const vertical = ratio < 1;
  const p = d ? (t / d) * 100 : 0;
  const chips = [
    meta?.duration ? formatDuration(meta.duration) : null,
    meta?.width && meta?.height ? resolutionLabel(meta.width, meta.height) : null,
    meta?.width && meta?.height ? aspectLabel(meta.width, meta.height) : null,
    meta?.size ? formatBytes(meta.size) : null,
    meta?.mimeType ? (meta.mimeType.includes("quicktime") ? "MOV" : "MP4") : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex w-full flex-col items-center">
      <div
        ref={wrap}
        tabIndex={0}
        role="region"
        aria-label={`Video player${filename ? `: ${filename}` : ""}. Space to play or pause, arrows to seek, M to mute, F for fullscreen.`}
        onKeyDown={onKey}
        className={cn(
          "group relative isolate overflow-hidden bg-[hsl(240_8%_4%)] shadow-[0_40px_100px_-40px_hsl(262_40%_18%/0.55)] hairline",
          full ? "flex h-full w-full items-center justify-center rounded-none" : "rounded-[28px]",
        )}
        style={full ? undefined : { aspectRatio: String(ratio), height: vertical ? (compact ? "min(46dvh, 420px)" : "min(64dvh, 680px)") : undefined, width: vertical ? undefined : "100%", maxWidth: "100%" }}
      >
        {src ? (
          <video
            ref={video}
            src={src}
            poster={poster ?? undefined}
            muted={muted}
            playsInline
            preload="metadata"
            className={cn("h-full w-full", full ? "object-contain" : "object-cover")}
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setD(e.currentTarget.duration)}
            onEnded={() => setPlaying(false)}
          />
        ) : poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="skeleton h-full w-full" />
        )}

        {/* Soft vignette so controls stay legible on bright footage */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" aria-hidden="true" />

        {/* Centre play affordance */}
        <AnimatePresence>
          {src && !playing && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.15 }}
              onClick={toggle}
              aria-label="Play"
              className="absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white backdrop-blur-md hairline transition hover:bg-white/25"
            >
              <Play className="ml-1 h-8 w-8 fill-current" />
            </motion.button>
          )}
        </AnimatePresence>

        {!src && (
          <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm text-white/80">
            Sample video. The preview plays once you upload your own.
          </p>
        )}

        {/* Upload status pill */}
        <div className="absolute inset-x-0 top-4 flex justify-center px-4" aria-live="polite">
          <AnimatePresence mode="wait">
            {upload.kind === "uploading" && (
              <motion.div key="up" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="la-card relative w-full max-w-[340px] overflow-hidden rounded-[1.6rem] p-3 text-[13px] font-medium text-white">
                <span className="la-grid" aria-hidden="true" />
                <div className="relative flex items-center gap-2.5">
                  <DancingPip size={40} className="groove-glass shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{upload.progress < 1 ? "Bringing it over" : "Making it ready"}</p>
                    <p className="truncate text-[11px] font-bold uppercase tracking-[0.1em] text-[hsl(var(--lime))]">{etaLabel ?? (upload.progress < 1 ? "On its way" : "Almost there")}</p>
                  </div>
                  {onCancel && (
                    <button
                      type="button"
                      onClick={onCancel}
                      aria-label="Cancel upload"
                      title="Cancel upload"
                      className="-my-1 -mr-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="la-track relative mt-2.5 h-9 rounded-full" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(upload.progress * 100)}>
                  <motion.div className="la-fill la-fill-anim absolute inset-y-0 left-0 rounded-full" style={{ minWidth: "2.25rem" }} animate={{ width: `${Math.round(upload.progress * 100)}%` }} transition={{ ease: "easeOut" }}>
                    <span className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center">
                      <OutlyMark variant="ink" size={18} className="la-rocket la-rocket-anim" />
                    </span>
                  </motion.div>
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs font-semibold tabular-nums text-white/60">{Math.round(upload.progress * 100)}%</span>
                </div>
              </motion.div>
            )}
            {upload.kind === "done" && justIn && (
              <motion.div key="in" initial={{ opacity: 0, y: -8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} className="lime-bg lime-glow rounded-full px-4 py-2 text-[13px] font-semibold">
                Your video is in.
              </motion.div>
            )}
            {upload.kind === "failed" && (
              <motion.div key="fail" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex max-w-full items-center gap-3 rounded-full bg-[hsl(240_10%_8%/0.62)] py-1.5 pl-4 pr-1.5 backdrop-blur-xl text-[13px] text-white hairline">
                <span>{upload.message}</span>
                {onRetry && (
                  <Button size="sm" variant="primary" onClick={onRetry} className="h-8">
                    <RefreshCw className="h-3.5 w-3.5" /> Let&apos;s try again
                  </Button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Controls */}
        {src && (
          <div className={cn("absolute inset-x-0 bottom-0 flex flex-col gap-1 px-4 pb-3 pt-10 text-white transition-opacity duration-300", playing ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" : "opacity-100")}>
            <input
              type="range"
              className="timeline w-full"
              min={0}
              max={1000}
              value={Math.round(p * 10)}
              style={{ ["--p" as string]: `${p}%` }}
              onChange={(e) => seek((Number(e.target.value) / 1000) * d)}
              aria-label="Timeline"
              aria-valuetext={`${formatDuration(t)} of ${formatDuration(d)}`}
            />
            <div className="flex items-center gap-1">
              <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/15">
                {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
              </button>
              <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/15">
                {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <span className="tabular ml-1 text-xs text-white/85">
                {formatDuration(t)} / {formatDuration(d)}
              </span>
              <span className="flex-1" />
              <button type="button" onClick={fullscreen} aria-label={full ? "Exit fullscreen" : "Fullscreen"} className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/15">
                {full ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Metadata + replace */}
      <div className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-1.5">
        {chips.map((c) => (
          <span key={c} className="tabular rounded-full bg-secondary/70 px-3 py-1 text-xs text-secondary-foreground hairline">
            {c}
          </span>
        ))}
        <Button variant="ghost" size="sm" onClick={() => picker.current?.click()} disabled={upload.kind === "uploading"}>
          <Replace className="h-4 w-4" /> Replace
        </Button>
        <input
          ref={picker}
          type="file"
          accept="video/mp4,video/quicktime,.mp4,.mov"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const err = validateVideoFile(f);
            if (err) onError?.(err);
            else onReplace(f);
          }}
        />
      </div>
    </div>
  );
}
