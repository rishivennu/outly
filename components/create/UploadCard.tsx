"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, Film, HardDrive, Layers, Loader2, Pause, Play, RefreshCw, RotateCcw, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { acceptAttr, acceptedFormats, formatBytes, formatProblem, type UploadLimits } from "@/lib/client/upload";
import { cn } from "@/lib/utils";
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
  return {
    formats: f.label,
    size: mb == null ? null : `Up to ${mb >= 1024 ? formatBytes(mb * 1048576) : `${mb} MB`} per file`,
    // st.label is the server's whole sentence ("200 MB used, 300 MB remaining out of 500 MB"), so the cap is formatted here.
    storage: st ? (st.over ? `Storage full (${formatBytes(st.limitBytes)})` : `${formatBytes(st.remainingBytes)} of ${formatBytes(st.limitBytes)} left`) : null,
    full: !!st?.over,
  };
}

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
        <h2 className="mt-4 text-lg font-semibold tracking-[-0.015em] sm:text-xl">{disabled ? "Your storage is full" : over ? "Let go to upload" : "Drop your video here"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {disabled ? "Delete some files in Content, or upgrade for more room. Your files are safe." : "Drag and drop your video or browse files"}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {disabled ? (
            <>
              <Button asChild variant="primary" className="min-h-11">
                <Link href="/billing">See plans</Link>
              </Button>
              <Button asChild variant="subtle" className="min-h-11">
                <Link href="/content">Manage files</Link>
              </Button>
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
      const left = eta(upload.eta);
      return { tone: "busy", text: `Uploading ${pct(upload.progress)}%${left ? `, ${left}` : ""}` };
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

interface FileProps {
  name: string;
  size: number | null;
  poster: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  upload: UploadState;
  online: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onRetry?: () => void;
  onRemove: () => void;
  onReplace: (f: File) => void;
  limits: UploadLimits | null;
  className?: string;
}

/** The video picked on Step 1, with its own progress, pause, retry, replace and remove. */
export function UploadFileCard({ name, size, poster, duration, width, height, upload, online, onPause, onResume, onRetry, onRemove, onReplace, limits, className }: FileProps) {
  const picker = useRef<HTMLInputElement>(null);
  const st = fileStatus(upload, online);
  const progress = upload.kind === "uploading" || upload.kind === "paused" ? pct(upload.progress) : upload.kind === "done" ? 100 : 0;
  const shape = width && height ? (height > width ? "Vertical" : height === width ? "Square" : "Horizontal") : null;
  const facts = [size ? formatBytes(size) : null, duration ? clock(duration) : null, shape].filter(Boolean).join(" · ");
  const busy = upload.kind === "uploading";
  return (
    <div data-testid="upload-file" data-state={upload.kind} className={cn("rounded-[24px] bg-card/70 p-3 hairline sm:p-4", className)}>
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="relative h-[72px] w-[54px] shrink-0 overflow-hidden rounded-xl bg-secondary hairline sm:h-20 sm:w-[60px]">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="h-full w-full object-cover" />
          ) : (
            <Film className="absolute inset-0 m-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={name}>{name}</p>
          {facts && <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">{facts}</p>}
          <p
            role="status"
            aria-live="polite"
            className={cn("mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug", st.tone === "bad" ? "text-[hsl(0_72%_42%)] dark:text-destructive" : st.tone === "ok" ? "text-foreground" : "text-muted-foreground")}
          >
            {st.tone === "busy" && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {st.tone === "ok" && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" strokeWidth={3} aria-hidden="true" />}
            {st.tone === "bad" && <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className="tabular-nums">{st.text}</span>
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={onRemove} aria-label={busy ? `Stop uploading ${name}` : `Remove ${name}`}>
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {upload.kind !== "done" && upload.kind !== "idle" && (
        <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`Upload of ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={st.text}>
          <span className={cn("block h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none", upload.kind === "failed" ? "bg-destructive/70" : upload.kind === "paused" ? "bg-foreground/40" : "bg-lime")} style={{ width: `${Math.max(progress, 2)}%` }} />
        </span>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {busy && onPause && (
          <Button variant="subtle" size="sm" className="min-h-11" onClick={onPause}>
            <Pause className="h-4 w-4" aria-hidden="true" /> Pause
          </Button>
        )}
        {upload.kind === "paused" && onResume && (
          <Button variant="primary" size="sm" className="min-h-11" onClick={onResume}>
            <Play className="h-4 w-4" aria-hidden="true" /> Resume
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
        {upload.kind === "uploading" && <p className="text-xs text-muted-foreground">Keep this tab open while it uploads.</p>}
      </div>
    </div>
  );
}
