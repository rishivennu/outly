"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scissors } from "lucide-react";
import { api, ApiError, offerUpgrade } from "@/lib/client/api";
import { failJob, probeVideo, runJob } from "@/lib/client/clipper";
import { uploadVideo, useUploadLimits, limitsProblem, upgradeFor } from "@/lib/client/upload";
import { browserProblem, screenOf, stalledWords, workingWords, type Screen } from "@/lib/clipper/executor-core";
import { overallProgress, stageWords } from "@/lib/clipper/settings-core";
import type { JobDetail, JobView } from "@/lib/clipper/jobs";
import type { MediaView } from "@/lib/services";
import { UploadCard } from "@/components/create/UploadCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card } from "@/components/intelligence/bits";
import { ReviewScreen } from "./ReviewScreen";

/**
 * R1322: the Clipper studio. One screen per job state (upload, processing, review, done), the recent jobs on the
 * side, the browser executor running in this tab. A job that lost its tab shows as stalled with a Resume button;
 * nothing is promised that the tab cannot do (speaker tracking, two-hour sources).
 */

type Run = { kind: "idle" } | { kind: "uploading"; p: number } | { kind: "working"; p: number; parts?: { done: number; total: number }; stage: string } | { kind: "error"; message: string };

export function ClipperStudio({ initialJobs, openId }: { initialJobs: JobView[]; openId: string | null }) {
  const [jobs, setJobs] = useState<JobView[]>(initialJobs);
  const [current, setCurrent] = useState<string | null>(openId ?? initialJobs.find((j) => j.status === "running" || j.status === "ready")?.id ?? null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [pickError, setPickError] = useState<string | null>(null);
  const limits = useUploadLimits();
  const abort = useRef<AbortController | null>(null);
  const localSrc = useRef<{ id: string; file: File } | null>(null);

  const job = useMemo(() => jobs.find((j) => j.id === current) ?? null, [jobs, current]);
  const screen: Screen = run.kind === "working" || run.kind === "uploading" ? "processing" : screenOf(job);

  const putJob = useCallback((j: JobView) => setJobs((all) => (all.some((x) => x.id === j.id) ? all.map((x) => (x.id === j.id ? j : x)) : [j, ...all])), []);

  const load = useCallback(
    async (id: string, withTranscript = true) => {
      const d = await api<JobDetail>(`/api/clipper/jobs/${id}${withTranscript ? "?transcript=1" : ""}`);
      setDetail(d);
      putJob(d.job);
      return d;
    },
    [putJob],
  );

  useEffect(() => {
    if (!current) return setDetail(null);
    load(current).catch((e) => setRun({ kind: "error", message: e instanceof ApiError ? e.message : "Couldn't load that job." }));
  }, [current, load]);

  /** Transcribe + detect in this tab; `src` is the local file right after an upload, the signed URL on a resume. */
  const work = useCallback(
    async (j: JobView, src: string | Blob) => {
      const ctrl = new AbortController();
      abort.current = ctrl;
      setRun({ kind: "working", p: 0, stage: j.stage });
      try {
        const d = await runJob(j, src, {
          signal: ctrl.signal,
          onJob: (nj) => {
            putJob(nj);
            setRun((r) => (r.kind === "working" ? { ...r, stage: nj.stage } : r));
          },
          onProgress: (p, parts) => setRun((r) => (r.kind === "working" ? { ...r, p, parts } : r)),
        });
        setDetail(d);
        putJob(d.job);
        setRun({ kind: "idle" });
      } catch (e) {
        if (ctrl.signal.aborted) return setRun({ kind: "idle" });
        const message = e instanceof ApiError ? e.message : (e as Error)?.message || "The tab could not finish this job.";
        if (e instanceof ApiError && e.status === 402) offerUpgrade(message, (e.data?.feature as string | undefined) ?? "ai");
        await failJob(j.id, message);
        setRun({ kind: "error", message });
        load(j.id, false).catch(() => {});
      } finally {
        if (abort.current === ctrl) abort.current = null;
      }
    },
    [load, putJob],
  );

  const onFiles = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setPickError(null);
      const problem = limits ? limitsProblem(file, limits) : null;
      if (problem) {
        setPickError(problem.message);
        const f = upgradeFor(problem.kind);
        if (f) offerUpgrade(problem.message, f);
        return;
      }
      let meta: { duration: number; width: number; height: number };
      try {
        meta = await probeVideo(file);
      } catch (e) {
        return setPickError((e as Error).message);
      }
      const bp = browserProblem({ duration: meta.duration, mimeType: file.type });
      if (bp) return setPickError(bp);
      const ctrl = new AbortController();
      abort.current = ctrl;
      setRun({ kind: "uploading", p: 0 });
      try {
        const up = await uploadVideo<MediaView>(file, (p) => setRun((r) => (r.kind === "uploading" ? { ...r, p } : r)), ctrl.signal);
        await api(`/api/media/${up.media.id}`, { method: "PATCH", json: { duration: Math.round(meta.duration * 100) / 100 || undefined, width: meta.width || undefined, height: meta.height || undefined } }).catch(() => null);
        const r = await api<{ job: JobView; created: boolean }>("/api/clipper/jobs", { method: "POST", json: { mediaId: up.media.id, clientKey: `m:${up.media.id}`, executor: "browser" } });
        localSrc.current = { id: r.job.id, file };
        putJob(r.job);
        setCurrent(r.job.id);
        await work(r.job, file);
      } catch (e) {
        if (ctrl.signal.aborted) return setRun({ kind: "idle" });
        const message = e instanceof ApiError ? e.message : (e as Error)?.message || "The upload did not finish.";
        if (e instanceof ApiError && e.status === 402) offerUpgrade(message, (e.data?.feature as string | undefined) ?? "uploads");
        setRun({ kind: "error", message });
      }
    },
    [limits, putJob, work],
  );

  const resume = useCallback(async () => {
    if (!job) return;
    let j = job;
    if (j.status === "failed") {
      const r = await api<{ job: JobView }>(`/api/clipper/jobs/${j.id}/stage`, { method: "POST", json: { event: "retry" } }).catch((e) => {
        setRun({ kind: "error", message: e instanceof ApiError ? e.message : "Couldn't restart the job." });
        return null;
      });
      if (!r) return;
      j = r.job;
      putJob(j);
    }
    const src = localSrc.current?.id === j.id ? localSrc.current.file : detail?.media?.url ?? null;
    if (!src) return setRun({ kind: "error", message: "The source video is gone. Start again from a new upload." });
    await work(j, src);
  }, [job, detail, putJob, work]);

  const cancel = useCallback(async () => {
    abort.current?.abort();
    if (job && (job.status === "queued" || job.status === "running" || job.status === "failed")) {
      await api<{ job: JobView }>(`/api/clipper/jobs/${job.id}/cancel`, { method: "POST" })
        .then((r) => putJob(r.job))
        .catch(() => {});
    }
    setRun({ kind: "idle" });
  }, [job, putJob]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        {screen === "upload" && (
          <Card id="clipper-upload" title="Turn a long video into shorts" desc="Upload a talk, a podcast or a vlog. The Clipper listens to it, finds the moments worth their own clip, and gives each one a reason. You approve, trim and reframe to 9:16; nothing is posted until you say so.">
            <UploadCard limits={limits} onFiles={onFiles} error={pickError} batchMax={1} className="mt-4" />
            <p className="mt-3 text-[13px] text-muted-foreground">Runs in this tab: videos up to 40 minutes for now. Keep the tab open while it works. Speaker tracking is not part of this version; you slide the 9:16 window yourself.</p>
          </Card>
        )}

        {screen === "processing" && (
          <Card id="clipper-processing" title={run.kind === "uploading" ? "Uploading your video" : workingWords(run.kind === "working" ? run.stage : job?.stage ?? "transcribe", run.kind === "working" ? run.p : 0, run.kind === "working" ? run.parts : undefined)} desc="Keep this tab open. You can keep using Outlly in another tab.">
            <ProgressBar value={run.kind === "uploading" ? run.p * 0.3 : run.kind === "working" ? 0.3 + 0.7 * overallProgress(run.stage, run.p) : 0} />
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
            </div>
          </Card>
        )}

        {(screen === "stalled" || screen === "failed") && job && (
          <Card id="clipper-stalled" title={screen === "failed" ? "This job stopped" : "This job lost its tab"} desc={screen === "failed" ? stageWords(job) : stalledWords(job)}>
            {run.kind === "error" && <p className="mt-2 text-[13px] text-destructive" role="alert">{run.message}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="lime" onClick={resume}>Resume</Button>
              <Button type="button" variant="outline" onClick={cancel}>Cancel job</Button>
              <Button type="button" variant="ghost" onClick={() => setCurrent(null)}>New upload</Button>
            </div>
          </Card>
        )}

        {screen === "cancelled" && job && (
          <Card id="clipper-cancelled" title="Cancelled" desc="This job was cancelled. Clips you had already approved are still below.">
            <div className="mt-4"><Button type="button" variant="lime" onClick={() => setCurrent(null)}>New upload</Button></div>
          </Card>
        )}

        {(screen === "review" || screen === "done" || screen === "cancelled") && detail && detail.job.id === job?.id && (
          <ReviewScreen detail={detail} sourceFile={localSrc.current?.id === detail.job.id ? localSrc.current.file : null} onChange={(d) => { setDetail(d); putJob(d.job); }} onNew={() => setCurrent(null)} />
        )}

        {run.kind === "error" && screen !== "stalled" && screen !== "failed" && (
          <p className="text-[13px] text-destructive" role="alert">{run.message}</p>
        )}
      </div>

      <aside className="min-w-0">
        <Card id="clipper-jobs" title="Your videos" desc={jobs.length ? undefined : "Nothing clipped yet."}>
          <ul className="mt-3 space-y-2">
            {jobs.slice(0, 12).map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => (run.kind === "idle" || run.kind === "error" ? setCurrent(j.id) : undefined)}
                  aria-current={j.id === current ? "true" : undefined}
                  className={cn("w-full rounded-2xl p-3 text-left hairline transition", j.id === current ? "bg-secondary/70" : "bg-secondary/30 hover:bg-secondary/50")}
                >
                  <div className="flex items-center gap-2 text-[14px] font-medium">
                    <Scissors className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{new Date(j.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {j.durationSec ? `${Math.round(j.durationSec / 60)} min` : "video"}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-muted-foreground">{stageWords(j)} · {j.counts.clips} clip{j.counts.clips === 1 ? "" : "s"}</div>
                </button>
              </li>
            ))}
          </ul>
          {current && (run.kind === "idle" || run.kind === "error") && (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setCurrent(null)}>New upload</Button>
          )}
        </Card>
      </aside>
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="mt-4" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? "Progress"}>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full lime-bg transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 text-[12px] text-muted-foreground">{pct}%</div>
    </div>
  );
}
