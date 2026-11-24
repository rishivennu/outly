"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Download, Pencil, Search, Send, X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { mmss } from "@/lib/clipper/executor-core";
import { performanceLine, type ClipPlatformPerformance } from "@/lib/clipper/publish-core";
import type { CandidateView, ClipView, JobDetail } from "@/lib/clipper/jobs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Card } from "@/components/intelligence/bits";
import { cn } from "@/lib/utils";
import { ClipEditor } from "./ClipEditor";

/**
 * R1322: review. The ranked moments with their reasons (approve, reject), cut by text, a hand-picked range, and the
 * approved clips with edit, export and download. Every number shown was computed in a core file on the server.
 */
export function ReviewScreen({ detail, sourceFile, onChange, onNew }: { detail: JobDetail; sourceFile: File | null; onChange: (d: JobDetail) => void; onNew: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  // The local file gets one blob URL for as long as it is here; it is never revoked under a render because a refresh
  // signed a new remote URL (R1322 review #1). Without a file, the latest signed URL is used.
  const remoteUrl = detail.media?.url ?? null;
  useEffect(() => {
    if (!sourceFile) return;
    const u = URL.createObjectURL(sourceFile);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [sourceFile]);
  useEffect(() => {
    if (!sourceFile) setSrc(remoteUrl);
  }, [sourceFile, remoteUrl]);

  const refresh = useCallback(async () => onChange(await api<JobDetail>(`/api/clipper/jobs/${detail.job.id}?transcript=1`)), [detail.job.id, onChange]);

  const act = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Something got in the way. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const suggested = useMemo(() => detail.candidates.filter((c) => c.status === "suggested"), [detail.candidates]);
  const clips = detail.clips;
  const duration = detail.job.durationSec ?? detail.media?.duration ?? 0;
  const editingClip = clips.find((c) => c.id === editing) ?? null;

  return (
    <div className="space-y-5">
      {editingClip && src ? (
        <ClipEditor clip={editingClip} src={src} cues={detail.transcript?.cues ?? []} duration={duration} sourceName={detail.media?.filename ?? "video"} onClose={() => setEditing(null)} onSaved={refresh} />
      ) : null}

      <Card id="clipper-moments" title={suggested.length ? `${suggested.length} moment${suggested.length === 1 ? "" : "s"} worth a look` : "No more moments to review"} desc={suggested.length ? "Each one says why it ranked where it did. Approve the ones you want as clips; reject the rest." : clips.length ? "Add your own below, or finish the review." : "Cut by text or pick a range below."}>
        {error && <p className="mt-2 text-[13px] text-destructive" role="alert">{error}</p>}
        <ol className="mt-4 space-y-2">
          {suggested.map((c) => (
            <CandidateRow key={c.id} c={c} busy={busy === c.id} onApprove={() => act(c.id, () => api(`/api/clipper/candidates/${c.id}`, { method: "POST", json: { action: "approve" } }))} onReject={() => act(c.id, () => api(`/api/clipper/candidates/${c.id}`, { method: "POST", json: { action: "reject" } }))} />
          ))}
        </ol>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <form
            className="rounded-2xl bg-secondary/40 p-3 hairline"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim().length < 2) return;
              act("text", () => api(`/api/clipper/jobs/${detail.job.id}/candidates`, { method: "POST", json: { query: query.trim() } }).then(() => setQuery("")));
            }}
          >
            <label className="text-[13px] font-medium" htmlFor="clip-text">Cut by text</label>
            <p className="text-[12px] text-muted-foreground">Type words that were said; every place they appear becomes a moment.</p>
            <div className="mt-2 flex gap-2">
              <Input id="clip-text" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={300} className="h-11 min-w-0 flex-1 rounded-xl text-[14px]" placeholder="e.g. the biggest mistake" />
              <Button type="submit" variant="outline" disabled={busy === "text" || query.trim().length < 2}><Search className="h-4 w-4" aria-hidden /> Find</Button>
            </div>
          </form>
          <form
            className="rounded-2xl bg-secondary/40 p-3 hairline"
            onSubmit={(e) => {
              e.preventDefault();
              const s = Number(manual.start);
              const en = Number(manual.end);
              if (!Number.isFinite(s) || !Number.isFinite(en)) return;
              act("manual", () => api(`/api/clipper/jobs/${detail.job.id}/clips`, { method: "POST", json: { start: s, end: en } }).then(() => setManual({ start: "", end: "" })));
            }}
          >
            <span className="text-[13px] font-medium">Pick a range</span>
            <p className="text-[12px] text-muted-foreground">Seconds into the video; 8 to 90 s long. {duration ? `The video is ${mmss(duration)}.` : ""}</p>
            <div className="mt-2 flex gap-2">
              <Input aria-label="Start, seconds" inputMode="decimal" value={manual.start} onChange={(e) => setManual((m) => ({ ...m, start: e.target.value }))} className="h-11 w-24 rounded-xl text-[14px]" placeholder="Start" />
              <Input aria-label="End, seconds" inputMode="decimal" value={manual.end} onChange={(e) => setManual((m) => ({ ...m, end: e.target.value }))} className="h-11 w-24 rounded-xl text-[14px]" placeholder="End" />
              <Button type="submit" variant="outline" disabled={busy === "manual" || !manual.start || !manual.end}>Add</Button>
            </div>
          </form>
        </div>
      </Card>

      <Card id="clipper-clips" title={clips.length ? `${clips.length} clip${clips.length === 1 ? "" : "s"}` : "Your clips"} desc={clips.length ? "Edit the words and the 9:16 framing, then export. Exports render in this tab and land in your Content library." : "Approved moments show up here."}>
        <ul className="mt-4 space-y-2">
          {clips.map((c) => (
            <ClipRow key={c.id} c={c} busy={busy === c.id} onEdit={() => setEditing(c.id)} onDiscard={() => act(c.id, () => api(`/api/clipper/clips/${c.id}`, { method: "DELETE" }))} />
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          {detail.job.status === "ready" && detail.job.stage === "review" && (
            <Button type="button" variant="lime" disabled={busy === "reviewed"} onClick={() => act("reviewed", () => api(`/api/clipper/jobs/${detail.job.id}/stage`, { method: "POST", json: { event: "reviewed" } }))}>
              Finish review
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onNew}>New upload</Button>
        </div>
      </Card>
    </div>
  );
}

const KIND_WORD: Record<string, string> = { hook: "Hook", insight: "Insight", story: "Story", punchline: "Punchline", takeaway: "Takeaway", text: "From your words", manual: "Picked by hand" };

function CandidateRow({ c, busy, onApprove, onReject }: { c: CandidateView; busy: boolean; onApprove: () => void; onReject: () => void }) {
  return (
    <li className="rounded-2xl bg-secondary/40 p-4 hairline">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span className="rounded-full bg-background/70 px-2 py-0.5 font-semibold hairline">#{c.rank}</span>
            <span>{KIND_WORD[c.kind] ?? c.kind}</span>
            <span aria-hidden>·</span>
            <span>{mmss(c.start)} to {mmss(c.end)} ({Math.round(c.end - c.start)} s)</span>
            <span aria-hidden>·</span>
            <span title="Score, 0 to 1, from the clip's own words and your history">score {c.score.toFixed(2)}</span>
          </div>
          <h3 className="mt-1 text-[15px] font-semibold leading-snug">{c.title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{c.reason}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="lime" size="sm" disabled={busy} onClick={onApprove}><Check className="h-4 w-4" aria-hidden /> Approve</Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onReject} aria-label={`Reject ${c.title}`}><X className="h-4 w-4" aria-hidden /></Button>
        </div>
      </div>
    </li>
  );
}

const RENDER_WORD: Record<string, string> = { pending: "Not exported yet", rendering: "Exporting", rendered: "Exported", failed: "Export failed" };

function ClipRow({ c, busy, onEdit, onDiscard }: { c: ClipView; busy: boolean; onEdit: () => void; onDiscard: () => void }) {
  return (
    <li className="rounded-2xl bg-secondary/40 p-4 hairline">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span>{mmss(c.start)} to {mmss(c.end)} ({Math.round(c.end - c.start)} s)</span>
            <span aria-hidden>·</span>
            <span className={cn(c.renderStatus === "failed" && "text-destructive")}>{RENDER_WORD[c.renderStatus] ?? c.renderStatus}</span>
            {c.status === "published" && <span className="rounded-full bg-background/70 px-2 py-0.5 font-semibold hairline">Published</span>}
          </div>
          <h3 className="mt-1 text-[15px] font-semibold leading-snug">{c.title}</h3>
          {c.hook && <p className="mt-1 text-[13px] text-muted-foreground">{c.hook}</p>}
          {c.post && <PerformanceLine clip={c} />}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden /> {c.renderStatus === "rendered" ? "Edit" : "Edit & export"}</Button>
          {c.renderStatus === "rendered" && <DownloadButton clip={c} />}
          {c.renderStatus === "rendered" && !c.post && (
            <Button asChild variant="lime" size="sm"><Link href={`/create?clip=${encodeURIComponent(c.id)}`}><Send className="h-4 w-4" aria-hidden /> Post this clip</Link></Button>
          )}
          {c.post && (
            <Button asChild variant="outline" size="sm"><Link href={`/create?post=${encodeURIComponent(c.post.id)}`}>Open post</Link></Button>
          )}
          {c.status !== "published" && !c.post && <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onDiscard} aria-label={`Discard ${c.title}`}><X className="h-4 w-4" aria-hidden /></Button>}
        </div>
      </div>
    </li>
  );
}

/**
 * R1323: the one line about the clip's post. Drafts and scheduled posts need no fetch; a published one reads its
 * numbers (from the same rows Insights uses) and says so only for what the platform actually gave.
 */
function PerformanceLine({ clip }: { clip: ClipView }) {
  const live = clip.post?.status === "published" || clip.post?.status === "partial";
  const [perf, setPerf] = useState<{ platforms: ClipPlatformPerformance[]; line: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!live) return;
    let alive = true;
    setFailed(false);
    api<{ platforms: ClipPlatformPerformance[]; line: string }>(`/api/clipper/clips/${clip.id}/performance`)
      .then((r) => alive && setPerf(r))
      .catch(() => alive && (setPerf(null), setFailed(true)));
    return () => {
      alive = false;
    };
  }, [clip.id, clip.post?.status, clip.updatedAt, live]);
  const line = perf?.line ?? (live ? (failed ? "Published. The numbers didn't load; they'll show on the next refresh." : "Published. Reading the numbers…") : performanceLine(clip.post, []));
  const given = perf?.platforms.flatMap((p) => p.metrics.filter((m) => m.value !== null).map((m) => `${p.platform}: ${m.value!.toLocaleString()} ${m.key}`)) ?? [];
  return (
    <p className="mt-1 text-[12px] text-muted-foreground" title={given.length ? given.join(" · ") : undefined}>
      {line}
    </p>
  );
}

export function DownloadButton({ clip }: { clip: ClipView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          // The window opens in the click itself (after an await a popup blocker eats it, R1322 review #20); the file lands in it.
          const w = window.open("", "_blank");
          if (w) w.opener = null;
          try {
            const r = await api<{ media: { url: string | null; filename: string } }>(`/api/clipper/clips/${clip.id}/download`);
            if (!r.media.url) throw new Error("The rendered file is not ready to download yet.");
            if (w) w.location.href = r.media.url;
            else window.location.assign(r.media.url);
          } catch (e) {
            w?.close();
            setError(e instanceof ApiError ? e.message : (e as Error)?.message || "Couldn't fetch the file.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download className="h-4 w-4" aria-hidden /> Download
      </Button>
      {error && <span className="text-[12px] text-destructive" role="alert">{error}</span>}
    </span>
  );
}
