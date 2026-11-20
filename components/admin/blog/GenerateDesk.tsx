"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2, Square, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { BLOG_STAGES, STAGE_LABEL, type BlogHistoryRow, type BlogJobView } from "@/lib/blog/types";
import { Card, CardTitle, Pill } from "../ui";
import { BlogHistory } from "./BlogHistory";
import { delayedEvent } from "./calendar-grid";
import { addDays, fmtYmd } from "./zoned";

type JobsRes = { running: BlogJobView | null; jobs: BlogJobView[]; ready: boolean; web: boolean };

/**
 * R1175 "Generate Today's Blog". One click starts a run; this component then drives it, one stage per request,
 * and shows each stage as it really finishes (the server's own timings). A second click while a run is going
 * simply re-attaches to it. Reloading the page re-attaches too: the run lives in the database, not in this tab.
 */
export function GenerateDesk({ initial, history, timezone, today }: { initial: JobsRes; history: BlogHistoryRow[]; timezone: string; today: string }) {
  const [state, setState] = useState<JobsRes>(initial);
  const [job, setJob] = useState<BlogJobView | null>(initial.running);
  const [hint, setHint] = useState("");
  const [forDate, setForDate] = useState(today);
  const [historyKey, setHistoryKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const stepping = useRef(false);

  const refresh = useCallback(async () => {
    const r = await adminApi<JobsRes>("/api/admin/blog/jobs");
    setState(r);
    setHistoryKey((k) => k + 1);
    return r;
  }, []);

  // Drive the running job: each step request runs exactly one stage on the server and returns the job as it stands.
  useEffect(() => {
    if (!job || job.status !== "running" || stepping.current) return;
    stepping.current = true;
    let stop = false;
    (async () => {
      let cur = job;
      while (!stop && cur.status === "running") {
        try {
          const r = await adminApi<{ job: BlogJobView }>(`/api/admin/blog/jobs/${cur.id}`, { method: "POST", json: { action: "step" } });
          cur = r.job;
          setJob(cur);
        } catch (e: any) {
          // A network blip is not a failed run: the job is still in the database. Re-read it and carry on.
          await new Promise((r) => setTimeout(r, 2500));
          try {
            cur = (await adminApi<{ job: BlogJobView }>(`/api/admin/blog/jobs/${cur.id}`)).job;
            setJob(cur);
          } catch {
            setErr(e?.message ?? "Lost contact with the server.");
            break;
          }
        }
      }
      stepping.current = false;
      if (cur.status === "done") toast(cur.forDate === today ? "Today's blog draft is ready for review" : `The draft for ${fmtYmd(cur.forDate)} is ready for review`);
      refresh().catch(() => {});
    })();
    return () => {
      stop = true;
      stepping.current = false;
    };
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      // R1178: a future date starts the run now and the draft counts as that date's scheduled article.
      const body: Record<string, string> = {};
      if (hint.trim()) body.hint = hint.trim();
      if (forDate && forDate !== today) body.forDate = forDate;
      const r = await adminApi<{ job: BlogJobView; existed: boolean }>("/api/admin/blog/jobs", { method: "POST", json: body });
      setJob(r.job);
      setHistoryKey((k) => k + 1);
      if (r.existed) toast("A run is already going; showing it");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function attach(id: string) {
    const known = state.jobs.find((j) => j.id === id);
    if (known) return setJob(known);
    try {
      setJob((await adminApi<{ job: BlogJobView }>(`/api/admin/blog/jobs/${id}`)).job);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  async function cancel() {
    if (!job) return;
    try {
      const r = await adminApi<{ job: BlogJobView }>(`/api/admin/blog/jobs/${job.id}`, { method: "POST", json: { action: "cancel" } });
      setJob(r.job);
      toast("Run stopped");
    } catch (e: any) {
      setErr(e.message);
    }
  }

  const running = job?.status === "running";
  return (
    <div className="grid gap-5">
      <Card>
        <CardTitle hint={state.web ? "Research uses live web search; recorded sources are pages the search actually returned." : "No web search on this AI key: the article will lean on qualified statements and name no verified sources."}>Generate Today's Blog</CardTitle>
        {!state.ready && (
          <p className="mt-3 rounded-2xl bg-warning/10 p-3 text-[13.5px]">
            <AlertTriangle className="mr-1.5 inline h-4 w-4" aria-hidden /> No AI key is set for the blog. Add NVIDIA_API_KEY (or KIMI_API_KEY) in the deployment settings, then reload.
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="blog-hint">Angle for today (optional)</Label>
            <Input id="blog-hint" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. creators who film on a phone and lose quality on upload" maxLength={300} disabled={running} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="blog-for">For date</Label>
            <Input id="blog-for" type="date" value={forDate} min={today} max={addDays(today, 60)} onChange={(e) => setForDate(e.target.value || today)} disabled={running} className="min-h-11" />
          </div>
          <Button type="button" variant="lime" size="lg" onClick={start} disabled={busy || running || !state.ready} className="min-h-11">
            {running ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}
            {running ? "Generating" : forDate && forDate !== today ? `Generate for ${fmtYmd(forDate, { day: "numeric", month: "short" })}` : "Generate Today's Blog"}
          </Button>
        </div>
        {err && (
          <p role="alert" className="mt-3 text-[13.5px] text-destructive">
            {err}
          </p>
        )}
      </Card>

      {job && <StageList job={job} onCancel={running ? cancel : undefined} />}

      <BlogHistory timezone={timezone} initial={history} refreshKey={historyKey} onRetried={setJob} onAttach={attach} attachedId={running ? job?.id : null} />
    </div>
  );
}

export function JobPill({ j }: { j: BlogJobView }) {
  // R1178: past readyBy the runner adds a "delayed" event; say so plainly instead of the normal running label.
  if (delayedEvent(j)) return <Pill tone="warn">Running late: {STAGE_LABEL[j.stage as keyof typeof STAGE_LABEL] ?? j.stage}</Pill>;
  const tone = j.status === "done" ? "ok" : j.status === "failed" ? "bad" : j.status === "cancelled" ? "muted" : "lime";
  const label = j.status === "done" ? "Draft ready" : j.status === "failed" ? "Failed" : j.status === "cancelled" ? "Stopped" : `Running: ${STAGE_LABEL[j.stage as keyof typeof STAGE_LABEL] ?? j.stage}`;
  return <Pill tone={tone}>{label}</Pill>;
}

/** The real stage display: a stage is "done" only when its server event says so, with the measured time. */
export function StageList({ job, onCancel, compact = false }: { job: BlogJobView; onCancel?: () => void; compact?: boolean }) {
  const idx = BLOG_STAGES.indexOf(job.stage as (typeof BLOG_STAGES)[number]);
  const done = job.status === "done";
  const late = delayedEvent(job);
  return (
    <Card as="div" className={cn(compact && "p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-muted-foreground">Run for {job.forDate}</p>
          <p className="truncate font-display text-[1.05rem] font-semibold">{job.topic || "Choosing a creator problem"}</p>
        </div>
        <div className="flex items-center gap-2">
          <JobPill j={job} />
          {onCancel && (
            <Button type="button" variant="outline" size="sm" onClick={onCancel} className="min-h-9">
              <Square className="h-3.5 w-3.5" aria-hidden /> Stop
            </Button>
          )}
        </div>
      </div>
      {late && !BLOG_STAGES.includes(late.stage as (typeof BLOG_STAGES)[number]) && (
        <p className="mt-3 rounded-xl bg-warning/10 px-3 py-2 text-[13px]">
          <AlertTriangle className="mr-1.5 inline h-4 w-4" aria-hidden /> Running late{late.message ? `: ${late.message}` : ""}
        </p>
      )}
      <ol className="mt-4 grid gap-1.5" aria-label="Generation stages">
        {BLOG_STAGES.map((s, i) => {
          const ev = job.events.filter((e) => e.stage === s);
          const last = ev[ev.length - 1];
          const finished = ev.some((e) => e.status === "done");
          const failed = !finished && last?.status === "failed";
          const active = job.status === "running" && i === idx;
          const pending = !finished && !active && !failed;
          const doneEv = ev.find((e) => e.status === "done");
          const lateEv = !finished && job.status === "running" ? ev.filter((e) => e.status === "delayed").pop() : undefined;
          return (
            <li key={s} className={cn("flex items-start gap-3 rounded-xl px-3 py-2", active && "bg-lime/10", pending && "opacity-60")}>
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center" aria-hidden>
                {finished ? <Check className="h-4 w-4 text-success" /> : active ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : failed ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <span className="h-2 w-2 rounded-full bg-border" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium">
                  {STAGE_LABEL[s]}
                  {active && <span className="sr-only"> (in progress)</span>}
                </p>
                {doneEv && (
                  <p className="text-[12.5px] text-muted-foreground">
                    {doneEv.message}
                    {doneEv.ms ? ` in ${(doneEv.ms / 1000).toFixed(1)} s` : ""}
                  </p>
                )}
                {!finished && last?.status === "failed" && <p className="text-[12.5px] text-destructive">{last.message}</p>}
                {lateEv && (
                  <p className="text-[12.5px] pill-ink-warn">
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Running late{lateEv.message ? `: ${lateEv.message}` : ""}
                  </p>
                )}
                {active && job.attempts > 1 && <p className="text-[12.5px] text-muted-foreground">Attempt {job.attempts} of 3</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {done && job.postId && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="primary" className="min-h-11">
            <Link href={`/admin/blog/review/${job.postId}`}>Review &amp; edit</Link>
          </Button>
        </div>
      )}
      {job.status === "failed" && <p className="mt-3 text-[13.5px] text-destructive">{job.error}</p>}
    </Card>
  );
}
