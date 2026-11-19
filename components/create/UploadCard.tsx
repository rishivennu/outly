"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, Check, ChevronDown, Film, HardDrive, Info, Layers, Loader2, Pause, Play, RefreshCw, RotateCcw, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptAttr, acceptedFormats, formatBytes, formatProblem, formatSpeed, type UploadLimits } from "@/lib/client/upload";
import { cn } from "@/lib/utils";
import { fmtBytes, fmtDay, type UsageState } from "@/lib/storage/quota-core";
import type { UploadState } from "./types";

/**
 * 1170: Step 1's upload card. A calm rectangle (thin dashed border, neutral fill, one lime mark) that takes a drop
 * anywhere on the page or a click anywhere on the card. Formats, the per-file limit and the storage that is left
 * all come from the server (GET /api/media/direct); nothing here is a made-up number. A drop of several videos is
 * handed to the batch planner by the caller.
 */

/** Same file picked twice (name, size and modified time): kept once. */
export const fileKey = (f: { name: string; size: number; lastModified?: number }) => `${f.name}:${f.size}:${f.lastModified ?? 0}`;
export function uniqueFiles<T extends { name: string; size: number; lastModified?: number }>(files: T[]): { files: T[]; dropped: number } {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const f of files) {
    const k = fileKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return { files: out, dropped: files.length - out.length };
}

/** Plain facts for the card's footer: formats, the per-file cap and, when the plan has one, the storage left. */
export function limitFacts(lim: UploadLimits | null) {
  const f = acceptedFormats(lim);
  const mb = lim ? (lim.maxMb ?? Math.round(lim.maxBytes / 1048576)) : null;
  const st = lim?.storage && lim.storage.limitBytes > 0 ? lim.storage : null;
  // R1209: on Free the limit is what may be uploaded this month, never shown as storage that is kept.
  const monthly = st?.kind === "monthly";
  const resetAt = monthly ? lim?.quota?.monthly?.resetAt : undefined;
  return {
    formats: f.label,
    size: mb == null ? null : `Up to ${mb >= 1024 ? formatBytes(mb * 1048576) : `${mb} MB`} per file`,
    // st.label is the server's whole sentence ("200 MB used, 300 MB remaining out of 500 MB"), so the cap is formatted here.
    storage: st
      ? monthly
        ? st.over
          ? `This month's ${formatBytes(st.limitBytes)} used`
          : `${formatBytes(st.remainingBytes)} of ${formatBytes(st.limitBytes)} left this month`
        : st.over
          ? `Storage full (${formatBytes(st.limitBytes)})`
          : `${formatBytes(st.remainingBytes)} of ${formatBytes(st.limitBytes)} left`
      : null,
    full: !!st?.over,
    monthly,
    renews: resetAt ? fmtDay(resetAt) : null,
  };
}

/**
 * R1209: Step 1's meter for the limit that binds, from the server's real figures (never negative, never invented).
 * Free reads what was uploaded this month and when it renews; a paid plan reads what is kept. Null with no cap.
 */
export function quotaMeter(lim: UploadLimits | null): { state: UsageState; pct: number; label: string; text: string; tight: boolean } | null {
  const q = lim?.quota;
  if (!q) return null;
  const m = q.monthly && !q.monthly.unlimited && q.monthly.allowanceBytes > 0 ? q.monthly : null;
  const s = q.storage && !q.storage.unlimited && q.storage.capacityBytes > 0 ? q.storage : null;
  const useMonthly = lim?.storage?.kind ? lim.storage.kind === "monthly" && !!m : !!m && !s;
  const pct = (x: number) => Math.max(0, Math.min(100, Number.isFinite(x) ? x : 0));
  if (useMonthly && m) {
    const used = Math.max(0, m.usedBytes + m.reservedBytes);
    return { state: q.state, pct: pct(m.percent), label: "Monthly upload allowance", text: `${fmtBytes(used)} of ${fmtBytes(m.allowanceBytes)} uploaded this month. Renews ${fmtDay(m.resetAt)}.`, tight: q.state !== "normal" };
  }
  if (!s) return null;
  return { state: q.state, pct: pct(s.percent), label: "Storage", text: `${fmtBytes(Math.max(0, s.usedBytes))} of ${fmtBytes(s.capacityBytes)} storage used (${Math.round(pct(s.percent))}%).`, tight: q.state !== "normal" };
}

const METER_BAR: Record<UsageState, string> = { normal: "bg-lime", warning: "bg-warning", critical: "bg-destructive", full: "bg-destructive" };

interface CardProps {
  limits: UploadLimits | null;
  /** The limits request failed (offline, server away): the size is checked when the upload starts. */
  limitsFailed?: boolean;
  onFiles: (files: File[]) => void;
  /** Why the last pick was turned away, said on the card. */
  error?: string | null;
  /** How many videos fit in one batch, for the guidance line. */
  batchMax: number;
  className?: string;
}

export function UploadCard({ limits, limitsFailed, onFiles, error, batchMax, className }: CardProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [typeError, setTypeError] = useState<string | null>(null);
  const facts = limitFacts(limits);
  const meter = quotaMeter(limits);
  const disabled = facts.full;
  const errId = useId();
  const factsId = useId();

  const take = (list: FileList | File[] | null | undefined) => {
    const all = Array.from(list ?? []);
    if (!all.length) return;
    const bad = all.map((f) => formatProblem(f, limits)).find(Boolean) ?? null;
    const good = all.filter((f) => !formatProblem(f, limits));
    setTypeError(bad && !good.length ? bad : bad ? `Skipped what wasn't a video. ${bad}` : null);
    if (good.length) onFiles(good);
  };

  // The whole page takes a drop while this card is on screen, so a video let go a little off target is not
  // opened by the browser in place of Create.
  useEffect(() => {
    if (disabled) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const dragover = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      take(e.dataTransfer?.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", dragover);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", dragover);
      window.removeEventListener("drop", drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, limits, onFiles]);

  const shownError = error ?? typeError;

  return (
    <div className={cn("w-full", className)}>
      <div
        data-testid="upload-card"
        data-state={disabled ? "disabled" : over ? "over" : "idle"}
        onClick={(e) => {
          if (disabled || (e.target as HTMLElement).closest("a,button")) return;
          input.current?.click();
        }}
        className={cn(
          "group relative flex flex-col items-center rounded-[24px] border-[1.5px] border-dashed px-5 py-8 text-center transition-[border-color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none sm:px-8 sm:py-10",
          "focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-ring/40",
          disabled
            ? "cursor-not-allowed border-border bg-secondary/25 opacity-80"
            : over
              ? "cursor-copy border-[hsl(var(--lime))] bg-[hsl(var(--lime)/0.07)] shadow-[0_0_0_4px_hsl(var(--lime)/0.12)]"
              : "cursor-pointer border-foreground/20 bg-secondary/35 [@media(hover:hover)]:hover:border-foreground/35 [@media(hover:hover)]:hover:bg-secondary/50",
        )}
      >
        <span className={cn("grid h-12 w-12 place-items-center rounded-2xl transition-transform duration-200 motion-reduce:transition-none", disabled ? "bg-secondary text-muted-foreground" : "lime-bg", over && "scale-105")} aria-hidden="true">
          {disabled ? <HardDrive className="h-5 w-5" /> : <UploadCloud className="h-5 w-5" />}
        </span>
        <h2 className="mt-4 text-lg font-semibold tracking-[-0.015em] sm:text-xl">{disabled ? (facts.monthly ? "This month's uploads are used up" : "Your storage is full") : over ? "Let go to upload" : "Drop your video here"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {disabled
            ? facts.monthly
              ? `Your allowance renews on ${facts.renews ?? "your renewal date"}. Upgrade your plan to unlock more upload capacity immediately.`
              : "Delete files you no longer need in Storage, or upgrade for more room. Your files are safe."
            : "Drag and drop your video or browse files"}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {disabled ? (
            <>
              <Button asChild variant="primary" className="min-h-11">
                <Link href="/billing">See plans</Link>
              </Button>
              {!facts.monthly && (
                <Button asChild variant="subtle" className="min-h-11">
                  <Link href="/settings#storage">Manage storage</Link>
                </Button>
              )}
            </>
          ) : (
            <Button type="button" variant="primary" className="min-h-11 px-5" onClick={() => input.current?.click()} aria-describedby={cn(factsId, shownError && errId) || undefined}>
              <UploadCloud className="h-4 w-4" aria-hidden="true" /> Browse files
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept={acceptAttr(limits)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
        <ul id={factsId} className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground" aria-label="What you can upload" data-testid="upload-limits">
          <li className="inline-flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5" aria-hidden="true" /> {facts.formats}
          </li>
          {facts.size ? (
            <li className="tabular-nums">{facts.size}</li>
          ) : limitsFailed ? (
            <li>Size checked when the upload starts</li>
          ) : (
            <li className="h-4 w-28 animate-pulse rounded-full bg-secondary motion-reduce:animate-none" aria-label="Checking your limits" />
          )}
          {facts.storage && (
            <li className={cn("inline-flex items-center gap-1.5 tabular-nums", facts.full && "text-foreground")}>
              <HardDrive className="h-3.5 w-3.5" aria-hidden="true" /> {facts.storage}
            </li>
          )}
        </ul>
        {meter && (
          <div className="mt-3 w-full max-w-[340px]" data-testid="upload-quota" data-state={meter.state}>
            <div role="progressbar" aria-label={meter.label} aria-valuetext={meter.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(meter.pct)} className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className={cn("h-full rounded-full", METER_BAR[meter.state])} style={{ width: `${meter.pct > 0 ? Math.max(2, meter.pct) : 0}%` }} />
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground tabular-nums">
              {meter.text}
              {meter.tight && !disabled && (
                <>
                  {" "}
                  <Link href="/billing" className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:min-h-0">
                    Upgrade
                  </Link>
                </>
              )}
            </p>
          </div>
        )}
        <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Several videos? Drop up to {batchMax} and{" "}
            <Link href="/create/bulk" className="font-medium text-foreground underline underline-offset-4">
              plan them as a batch
            </Link>
            .
          </span>
        </p>
      </div>
      {shownError && (
        <p id={errId} role="alert" className="mt-3 flex items-start gap-2 text-sm leading-snug text-[hsl(0_72%_42%)] dark:text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{shownError}</span>
        </p>
      )}
    </div>
  );
}

const pct = (p: number) => Math.round(Math.max(0, Math.min(1, p)) * 100);
const eta = (s?: number | null) => (s == null || !isFinite(s) || s <= 0 ? null : s < 60 ? `about ${Math.max(1, Math.round(s))} s left` : `about ${Math.round(s / 60)} min left`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** What the file row says, pure so the wording is tested: never "Uploaded" before the server has it. */
export function fileStatus(upload: UploadState, online = true): { tone: "busy" | "ok" | "bad" | "idle"; text: string } {
  switch (upload.kind) {
    case "uploading": {
      const at = pct(upload.progress);
      switch (upload.info?.phase) {
        case "preparing":
          return { tone: "busy", text: "Preparing the upload" };
        case "resuming":
          return { tone: "busy", text: `Resuming from ${at}%` };
        case "reconnecting":
          return { tone: "busy", text: online ? `Reconnecting at ${at}%. What's up is kept.` : `Waiting for a connection at ${at}%. It picks up on its own.` };
        case "finalizing":
          return { tone: "busy", text: "Finalizing the upload" };
        case "processing":
          return { tone: "busy", text: "Processing your video" };
      }
      const left = eta(upload.eta);
      return { tone: "busy", text: `Uploading ${at}%${left ? `, ${left}` : ""}` };
    }
    case "paused":
      return { tone: "idle", text: `Paused at ${pct(upload.progress)}%` };
    case "failed":
      return { tone: "bad", text: !online ? "Waiting for a connection. It starts again on its own." : upload.message };
    case "done":
      return { tone: "ok", text: "Uploaded" };
    default:
      return { tone: "idle", text: "Getting ready" };
  }
}

/** Less than half a megabyte reads as nothing yet, not as "1 MB". */
const amount = (b: number) => (b < 524_288 ? "0 MB" : formatBytes(b));

/** R1193: the quiet line under the status, "750 MB of 1 GB · 18 MB/s · 47 of 63 parts". Null when there's nothing to add. */
export function uploadDetail(upload: UploadState): string | null {
  const i = upload.kind === "uploading" ? upload.info : undefined;
  if (!i || i.phase === "preparing" || i.phase === "processing" || i.total <= 0) return null;
  const bits = [`${amount(i.bytes)} of ${formatBytes(i.total)}`];
  if (i.phase === "uploading" && i.speed) bits.push(formatSpeed(i.speed));
  if (i.partsTotal > 1) bits.push(`${i.partsDone} of ${i.partsTotal} parts`);
  return bits.join(" · ");
}

/** iPhone and iPad suspend a page in the background (an iPad says it is a Mac, but has touch). */
const isIos = () => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** The stage the card is in, read off the one upload state so no two readouts can disagree. */
export type UploadStage = "idle" | "preparing" | "uploading" | "reconnecting" | "paused" | "finalizing" | "processing" | "done" | "failed" | "offline";

export interface UploadFigures {
  stage: UploadStage;
  /** One word for the stage, the card's status pill. */
  label: string;
  /** 0..100 from the engine's fraction. Null when a number would mislead (processing, failed, not started). */
  pct: number | null;
  /** "750 MB of 1 GB" from the engine's bytes, or null (streamed uploads and the stages with no bytes moving). */
  bytes: string | null;
  /** "18 MB/s" only while bytes are moving, never a stale figure. */
  speed: string | null;
  /** "about 30 s left" only while bytes are moving and the engine has enough signal. */
  eta: string | null;
  /** "47 of 63 parts" for a multipart upload (R1193), null for a single part or when nothing is moving. */
  parts: string | null;
  /** The bar has no honest width: it animates instead (preparing, finalizing, processing). */
  indeterminate: boolean;
}

/**
 * R1212: every number on the card, from the one UploadState (lib/client/upload reports fraction, eta and info in
 * the same tick, so percent and bytes always agree). Paused keeps its percent and drops speed and time; processing
 * is its own stage with no percent at all, so "100%" never shows before the server has confirmed the file.
 */
export function uploadFigures(upload: UploadState, online = true): UploadFigures {
  const none = { bytes: null, speed: null, eta: null, parts: null, indeterminate: false };
  switch (upload.kind) {
    case "uploading": {
      const i = upload.info;
      // The number is capped at 99 until the server says done: a rounded 99.6% or the finalizing stitch is not "100%".
      const at = Math.min(pct(upload.progress), 99);
      const parts = i && i.partsTotal > 1 && i.phase !== "preparing" && i.phase !== "processing" ? `${i.partsDone} of ${i.partsTotal} parts` : null;
      const bytes = i && i.total > 0 && i.phase !== "preparing" && i.phase !== "processing" ? `${amount(i.bytes)} of ${formatBytes(i.total)}` : null;
      switch (i?.phase) {
        case "preparing":
          return { ...none, stage: "preparing", label: "Preparing", pct: null, indeterminate: true };
        case "finalizing":
          return { ...none, stage: "finalizing", label: "Finalizing", pct: at, bytes, parts, indeterminate: true };
        case "processing":
          return { ...none, stage: "processing", label: "Processing", pct: null, indeterminate: true };
        case "reconnecting":
          return { ...none, stage: online ? "reconnecting" : "offline", label: online ? "Reconnecting" : "Offline", pct: at, bytes, parts };
        case "resuming":
          return { ...none, stage: "uploading", label: "Resuming", pct: at, bytes, parts };
      }
      const moving = !i || i.phase === "uploading";
      return { stage: "uploading", label: "Uploading", pct: at, bytes, speed: moving && i?.speed ? formatSpeed(i.speed) : null, eta: moving ? eta(upload.eta) : null, parts, indeterminate: false };
    }
    case "paused":
      return { ...none, stage: "paused", label: "Paused", pct: pct(upload.progress) };
    case "done":
      return { ...none, stage: "done", label: "Uploaded", pct: 100 };
    case "failed":
      return { ...none, stage: online ? "failed" : "offline", label: online ? "Didn't upload" : "Offline", pct: null };
    default:
      return { ...none, stage: "idle", label: "Getting ready", pct: null };
  }
}

/** "MP4", "MOV", "WEBM": the container, from the type the browser or server gave, else the file's extension. */
export function fileFormat(mimeType: string | null | undefined, name: string): string | null {
  const m = (mimeType ?? "").toLowerCase();
  if (m === "video/quicktime") return "MOV";
  if (m === "video/x-matroska") return "MKV";
  const sub = /^video\/([a-z0-9.-]+)$/.exec(m)?.[1];
  if (sub && !/^x-/.test(sub)) return sub.toUpperCase();
  const ext = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1];
  return ext ? ext.toUpperCase() : null;
}

interface FileProps {
  name: string;
  size: number | null;
  poster: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  /** The container type, for the format fact. */
  mimeType?: string | null;
  upload: UploadState;
  online: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
  /** R1193: stop for good, and tell the server to drop what already went up. */
  onCancel?: () => void;
  onRemove: () => void;
  onReplace: (f: File) => void;
  limits: UploadLimits | null;
  className?: string;
}

const STAGE_PILL: Record<UploadStage, string> = {
  idle: "bg-secondary text-muted-foreground",
  preparing: "bg-secondary text-foreground",
  uploading: "bg-[hsl(var(--lime)/0.18)] text-foreground",
  reconnecting: "bg-warning/15 text-warning-ink",
  paused: "bg-secondary text-foreground",
  finalizing: "bg-[hsl(var(--lime)/0.18)] text-foreground",
  processing: "bg-accent/15 text-foreground",
  done: "bg-success/15 text-success-ink",
  failed: "bg-destructive/12 text-[hsl(0_72%_38%)] dark:text-destructive",
  offline: "bg-warning/15 text-warning-ink",
};

/**
 * The video picked on Step 1, with its own progress, pause, retry, replace and remove.
 * R1212: a premium status card. The frame is big and keeps the video's shape; the facts (size, length, shape,
 * format) sit as quiet chips under the name; the upload block leads with the percentage, then the bar, then bytes,
 * speed and time left; the controls sit on their own row. Every figure comes from uploadFigures, so the percentage,
 * the bytes and the bar never tell different stories, and "Uploaded" waits for the server (upload.kind "done").
 */
export function UploadFileCard({ name, size, poster, duration, width, height, mimeType, upload, online, onPause, onResume, onRetry, onCancel, onRemove, onReplace, limits, className }: FileProps) {
  const picker = useRef<HTMLInputElement>(null);
  const st = fileStatus(upload, online);
  const fig = uploadFigures(upload, online);
  // Read after mount: the server render can't know the device.
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(isIos()), []);
  const shape = width && height ? (height > width ? "Vertical" : height === width ? "Square" : "Horizontal") : null;
  const format = fileFormat(mimeType, name);
  const facts = [size ? formatBytes(size) : null, duration ? clock(duration) : null, shape, format].filter(Boolean) as string[];
  const busy = upload.kind === "uploading";
  // Once the bucket is stitching the parts there is nothing left to pause, and once it's processing nothing to cancel.
  const phase = upload.kind === "uploading" ? upload.info?.phase : undefined;
  const stitching = phase === "finalizing" || phase === "processing";
  const showBar = upload.kind !== "done" && upload.kind !== "idle";
  const barWidth = fig.indeterminate ? 100 : Math.max(fig.pct ?? 0, 2);
  const barTone = upload.kind === "failed" ? "bg-destructive/70" : upload.kind === "paused" ? "bg-foreground/40" : fig.stage === "offline" || fig.stage === "reconnecting" ? "bg-warning" : fig.stage === "processing" ? "bg-accent" : "bg-lime";
  const under = [fig.bytes, fig.speed, fig.eta, fig.parts].filter(Boolean).join(" · ");
  // With the big number on show, the status line says what is happening in words; the figures live in the progress block
  // (st.text keeps the numbers for the progressbar's aria-valuetext).
  const LINE: Partial<Record<UploadStage, string>> = { uploading: "Sending to Outlly.", paused: "Resume whenever you're ready.", reconnecting: "Picking up where it left off.", offline: "Waiting for your connection.", finalizing: "Putting the parts together.", processing: "Checking the file on our side.", preparing: "Reading the file." };
  const statusText = upload.kind === "done" ? "Ready for your story." : showBar && st.tone !== "bad" ? (LINE[fig.stage] ?? st.text) : st.text;
  return (
    <div data-testid="upload-file" data-state={upload.kind} data-stage={fig.stage} className={cn("overflow-hidden rounded-[24px] bg-card shadow-[0_18px_40px_-28px_hsl(var(--foreground)/0.35)] hairline", className)}>
      <div className="flex items-start gap-4 p-4 sm:gap-5 sm:p-5">
        <div className={cn("relative shrink-0 overflow-hidden rounded-2xl bg-secondary hairline", shape === "Horizontal" ? "h-[72px] w-[128px] sm:h-[81px] sm:w-[144px]" : shape === "Square" ? "h-[96px] w-[96px] sm:h-[108px] sm:w-[108px]" : "h-[128px] w-[72px] sm:h-[144px] sm:w-[81px]")}>
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="h-full w-full object-cover" />
          ) : (
            <Film className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight" title={name}>{name}</p>
            <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-11 w-11 shrink-0" onClick={onRemove} aria-label={busy ? `Stop uploading ${name}` : `Remove ${name}`}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {facts.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="About this video">
              {facts.map((f) => (
                <li key={f} className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {f}
                </li>
              ))}
            </ul>
          )}
          <p role="status" aria-live="polite" className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug">
            <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold", STAGE_PILL[fig.stage])}>
              {st.tone === "busy" && <Loader2 className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {st.tone === "ok" && <Check className="h-3 w-3 shrink-0" strokeWidth={3} aria-hidden="true" />}
              {st.tone === "bad" && <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />}
              {fig.stage === "paused" && <Pause className="h-3 w-3 shrink-0" aria-hidden="true" />}
              {fig.label}
            </span>
            <span className={cn("tabular-nums", st.tone === "bad" ? "text-[hsl(0_72%_42%)] dark:text-destructive" : st.tone === "ok" ? "text-foreground" : "text-muted-foreground")}>
              {statusText}
            </span>
          </p>
        </div>
      </div>
      {showBar && (
        <div className="px-4 pb-4 sm:px-5" data-testid="upload-progress">
          <div className="flex items-end justify-between gap-3">
            <p className="text-[28px] font-semibold leading-none tabular-nums tracking-[-0.02em]" aria-hidden="true">
              {fig.pct === null ? <span className="text-muted-foreground">{fig.stage === "processing" ? "Processing" : fig.stage === "preparing" ? "Preparing" : "Stopped"}</span> : `${fig.pct}%`}
            </p>
            {under && (
              <p data-testid="upload-detail" className="truncate text-xs tabular-nums text-muted-foreground">
                {under}
              </p>
            )}
          </div>
          <span className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`Upload of ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={fig.pct ?? undefined} aria-valuetext={st.text}>
            <span className={cn("block h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none", barTone, fig.indeterminate && "animate-pulse motion-reduce:animate-none")} style={{ width: `${barWidth}%` }} />
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-3 sm:px-5">
        {busy && !stitching && onPause && (
          <Button variant="subtle" size="sm" className="min-h-11" onClick={onPause}>
            <Pause className="h-4 w-4" aria-hidden="true" /> Pause
          </Button>
        )}
        {upload.kind === "paused" && onResume && (
          <Button variant="primary" size="sm" className="min-h-11" onClick={onResume}>
            <Play className="h-4 w-4" aria-hidden="true" /> Resume
          </Button>
        )}
        {((busy && phase !== "processing") || upload.kind === "paused") && onCancel && (
          <Button variant="ghost" size="sm" className="min-h-11" onClick={onCancel}>
            Cancel upload
          </Button>
        )}
        {upload.kind === "failed" && onRetry && (
          <Button variant="primary" size="sm" className="min-h-11" onClick={onRetry} disabled={!online}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Try again
          </Button>
        )}
        {!busy && (
          <Button variant="subtle" size="sm" className="min-h-11" onClick={() => picker.current?.click()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Replace
          </Button>
        )}
        <input
          ref={picker}
          type="file"
          accept={acceptAttr(limits)}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onReplace(f);
          }}
        />
        {upload.kind === "uploading" && (
          <p className="min-w-0 flex-1 basis-full text-xs leading-snug text-muted-foreground sm:basis-auto sm:text-right">
            {ios ? "Keep Outlly open. Uploads pause in the background and pick up when you come back." : "Keep this tab open while it uploads. A dropped connection picks up where it left off."}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * R1212: the tips under the card, folded by default. The formats and the per-file cap are the server's own
 * (GET /api/media/direct, through limitFacts), never typed in here; the rest is guidance.
 */
export function UploadTips({ limits, limitsFailed, className }: { limits: UploadLimits | null; limitsFailed?: boolean; className?: string }) {
  const facts = limitFacts(limits);
  const rows: { k: string; v: ReactNode }[] = [
    { k: "Formats", v: facts.formats },
    { k: "File size", v: facts.size ?? (limitsFailed ? "Checked when the upload starts" : "Checking your limits") },
    { k: "Shape", v: "Vertical 9:16 fits Reels, Shorts and TikTok without bars. Square and 16:9 suit feeds and YouTube." },
    { k: "Connection", v: "Keep this tab open while it uploads. A dropped connection picks up where it left off, and a reload resumes from the parts already in." },
    { k: "Music", v: "Want trending music? Add it in Instagram, YouTube or your editor, export the video, then upload it here. Outlly posts the sound that's in your video to every platform." },
    { k: "Saving", v: "Your work saves as you go: to this browser straight away, and to Outlly once the video is in." },
  ];
  return (
    <details data-testid="upload-tips" className={cn("group rounded-2xl bg-card/60 hairline", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:bg-secondary/50 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Tips for a smooth upload
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <dl className="grid gap-x-6 gap-y-3 px-4 pb-4 pt-1 text-[13px] leading-relaxed sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.k} className={cn(r.k === "Music" && "sm:col-span-2")}>
            <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{r.k}</dt>
            <dd className="mt-0.5 text-foreground/90">{r.v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
