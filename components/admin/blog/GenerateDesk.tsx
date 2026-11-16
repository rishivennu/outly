"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2, Square, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import { cn } from "@/lib/utils";
import { BLOG_STAGES, STAGE_LABEL, type BlogJobView } from "@/lib/blog/types";
import { Card, CardTitle, Empty, Pill, Table, fmtDate } from "../ui";

type JobsRes = { running: BlogJobView | null; jobs: BlogJobView[]; ready: boolean; web: boolean };

/**
 * R1175 "Generate Today's Blog". One click starts a run; this component then drives it, one stage per request,
 * and shows each stage as it really finishes (the server's own timings). A second click while a run is going
 * simply re-attaches to it. Reloading the page re-attaches too: the run lives in the database, not in this tab.
 */
export function GenerateDesk({ initial }: { initial: JobsRes }) {
  const [state, setState] = useState<JobsRes>(initial);
  const [job, setJob] = useState<BlogJobView | null>(initial.running);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const stepping = useRef(false);

  const refresh = useCallback(async () => {
    const r = await adminApi<JobsRes>("/api/admin/blog/jobs");
    setState(r);
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
      if (cur.status === "done") toast("Today's blog draft is ready for review");
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
      const r = await adminApi<{ job: BlogJobView; existed: boolean }>("/api/admin/blog/jobs", { method: "POST", json: hint.trim() ? { hint: hint.trim() } : {} });
      setJob(r.job);
      if (r.existed) toast("A run is already going; showing it");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
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
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="blog-hint">Angle for today (optional)</Label>
            <Input id="blog-hint" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. creators who film on a phone and lose quality on upload" maxLength={300} disabled={running} />
          </div>
          <Button type="button" variant="lime" size="lg" onClick={start} disabled={busy || running || !state.ready} className="min-h-11">
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}
            {running ? "Generating" : "Generate Today's Blog"}
          </Button>
        </div>
        {err && (
          <p role="alert" className="mt-3 text-[13.5px] text-destructive">
            {err}
          </p>
        )}
      </Card>

      {job && <StageList job={job} onCancel={running ? cancel : undefined} />}

      <Card>
        <CardTitle hint="Every run, whoever or whatever started it. Times are the server's own.">Generation history</CardTitle>
        <div className="mt-3">
          {state.jobs.length ? (
            <Table head={["Day", "Started", "By", "Topic", "Result", "Draft"]} label="Generation history" lead={3}>
              {state.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.forDate}</td>
                  <td>{fmtDate(j.startedAt, true)}</td>
                  <td>{j.startedBy === "schedule" ? "Schedule" : j.startedBy}</td>
                  <td className="max-w-[28ch] truncate" title={j.topic}>
                    {j.topic || (j.topicHint ? `Angle: ${j.topicHint}` : "")}
                  </td>
                  <td>
                    <JobPill j={j} />
                    {j.status === "failed" && j.error && <span className="ml-2 text-[12px] text-muted-foreground">{j.error}</span>}
                  </td>
                  <td>
                    {j.postId ? (
                      <Link href={`/admin/blog/review/${j.postId}`} className="underline underline-offset-4">
                        Review
                      </Link>
                    ) : j.status === "running" && j.id !== job?.id ? (
                      <button type="button" className="underline underline-offset-4" onClick={() => setJob(j)}>
                        Attach
                      </button>
                    ) : (
                      ""
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="No runs yet" body="The first click above starts one. The schedule in Blog settings will start one every morning." />
          )}
        </div>
      </Card>
    </div>
  );
}

export function JobPill({ j }: { j: BlogJobView }) {
  const tone = j.status === "done" ? "ok" : j.status === "failed" ? "bad" : j.status === "cancelled" ? "muted" : "lime";
  const label = j.status === "done" ? "Draft ready" : j.status === "failed" ? "Failed" : j.status === "cancelled" ? "Stopped" : `Running: ${STAGE_LABEL[j.stage as keyof typeof STAGE_LABEL] ?? j.stage}`;
  return <Pill tone={tone}>{label}</Pill>;
}

/** The real stage display: a stage is "done" only when its server event says so, with the measured time. */
export function StageList({ job, onCancel, compact = false }: { job: BlogJobView; onCancel?: () => void; compact?: boolean }) {
  const idx = BLOG_STAGES.indexOf(job.stage as (typeof BLOG_STAGES)[number]);
  const done = job.status === "done";
  return (
    <Card as="div" className={cn(compact && "p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Run for {job.forDate}</p>
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
      <ol className="mt-4 grid gap-1.5" aria-label="Generation stages">
        {BLOG_STAGES.map((s, i) => {
          const ev = job.events.filter((e) => e.stage === s);
          const last = ev[ev.length - 1];
          const finished = ev.some((e) => e.status === "done");
          const failed = !finished && last?.status === "failed";
          const active = job.status === "running" && i === idx;
          const pending = !finished && !active && !failed;
          const doneEv = ev.find((e) => e.status === "done");
          return (
            <li key={s} className={cn("flex items-start gap-3 rounded-xl px-3 py-2", active && "bg-lime/10", pending && "opacity-60")}>
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center" aria-hidden>
                {finished ? <Check className="h-4 w-4 text-success" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : failed ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <span className="h-2 w-2 rounded-full bg-border" />}
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
