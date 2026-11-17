"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shared/Toast";
import { adminApi } from "@/lib/client/admin-api";
import type { BlogHistoryRow, BlogJobView } from "@/lib/blog/types";
import { STAGE_LABEL } from "@/lib/blog/types";
import { Card, CardTitle, Empty, Pill, Table } from "../ui";
import { HISTORY_STATUS } from "./calendar-grid";
import { fmtYmd, fmtZoned } from "./zoned";

const LIVE: BlogHistoryRow["status"][] = ["running", "retrying", "delayed"];
const stageText = (s: string) => STAGE_LABEL[s as keyof typeof STAGE_LABEL] ?? s;

/**
 * R1178 generation history: every run from GET /api/admin/blog/history, newest first, on the blog's clock.
 * While a run is going it re-reads every 20 s, so a scheduled run started elsewhere shows up without a reload.
 * Retry resumes a failed or stopped run from its first unfinished stage; finished stages are kept.
 */
export function BlogHistory({ timezone, initial, refreshKey, onRetried, onAttach, attachedId }: { timezone: string; initial?: BlogHistoryRow[]; refreshKey?: unknown; onRetried?: (job: BlogJobView) => void; onAttach?: (jobId: string) => void; attachedId?: string | null }) {
  const [rows, setRows] = useState<BlogHistoryRow[] | null>(initial ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const r = await adminApi<{ rows: BlogHistoryRow[] }>("/api/admin/blog/history");
      setRows(r.rows);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);

  useEffect(() => {
    if (initial && refreshKey === undefined) return;
    load();
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = !!rows?.some((r) => LIVE.includes(r.status));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [live, load]);

  async function retry(id: string) {
    setBusy(id);
    setErr(null);
    try {
      const r = await adminApi<{ job: BlogJobView }>(`/api/admin/blog/jobs/${id}/retry`, { method: "POST" });
      toast("Run resumed from where it stopped");
      if (onRetried) onRetried(r.job);
      else router.push("/admin/blog/generate");
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardTitle hint={`Every run, whoever or whatever started it. Times in ${timezone}.`}>Generation history</CardTitle>
      {err && (
        <p role="alert" className="mb-3 text-[13.5px] text-destructive">
          {err}
        </p>
      )}
      {rows === null ? (
        <p className="text-[13.5px] text-muted-foreground" role="status">
          Loading runs
        </p>
      ) : rows.length ? (
        <Table head={["Date", "Started", "Completed", "Topic", "Status", <span key="a" className="sr-only">Action</span>]} label="Generation history" lead={3} minWidth={860}>
          {rows.map((r) => {
            const s = HISTORY_STATUS[r.status] ?? { label: r.status, tone: "muted" as const };
            const secondary = r.status === "failed" || r.status === "retrying" ? r.error || stageText(r.stage) : r.status === "done" ? "" : stageText(r.stage);
            return (
              <tr key={r.jobId}>
                <td className="whitespace-nowrap">{fmtYmd(r.date, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td className="whitespace-nowrap">
                  {fmtZoned(r.startedAt, timezone)}
                  <span className="block text-[12px] text-muted-foreground">{r.kind === "scheduled" || r.startedBy === "schedule" ? "Schedule" : r.startedBy}</span>
                </td>
                <td className="whitespace-nowrap">{r.finishedAt ? fmtZoned(r.finishedAt, timezone) : "Not yet"}</td>
                <td className="max-w-[32ch]">
                  {r.postId ? (
                    <Link href={`/admin/blog/review/${r.postId}`} className="underline underline-offset-4">
                      {r.topic || "Open the draft"}
                    </Link>
                  ) : (
                    <span className={r.topic ? "" : "text-muted-foreground"}>{r.topic || "No topic chosen yet"}</span>
                  )}
                </td>
                <td>
                  <Pill tone={s.tone}>{s.label}</Pill>
                  {secondary && <span className="mt-1 block max-w-[36ch] text-[12px] text-muted-foreground">{secondary}</span>}
                </td>
                <td>
                  {r.canRetry ? (
                    <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy !== null} onClick={() => retry(r.jobId)} aria-label={`Retry the run for ${fmtYmd(r.date)}`}>
                      {busy === r.jobId ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />} Retry
                    </Button>
                  ) : onAttach && LIVE.includes(r.status) && r.jobId !== attachedId ? (
                    <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => onAttach(r.jobId)}>
                      Follow
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <Empty title="No runs yet" body="Generate starts one now. With scheduled runs on, one starts every morning." />
      )}
    </Card>
  );
}
