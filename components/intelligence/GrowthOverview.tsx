"use client";
import { Card, ConfidenceBadge } from "./bits";
import { confidenceNote, metricLabel } from "./view-core";
import { OBJECTIVE_METRICS } from "@/lib/intelligence/core";
import type { Overview } from "./types";

// R1238: what this page was computed from, before any claim is made from it.
export function GrowthOverview({ data, objectiveLabel }: { data: Overview; objectiveLabel: string }) {
  const note = confidenceNote(data.posts);
  const metrics = OBJECTIVE_METRICS[data.objective];
  const rows: { label: string; value: string }[] = [
    { label: "Posts in this period", value: data.posts.toLocaleString("en") },
    { label: "Posts compared in total", value: `${data.postsAnalyzed.toLocaleString("en")} (this period and the one before)` },
    { label: "Period", value: `${data.period.label}, against ${data.previous.label}` },
    { label: "Objective", value: objectiveLabel },
    { label: "Judged by", value: metrics.metrics.map(metricLabel).join(", ") },
  ];
  return (
    <Card id="intel-overview" title="Growth overview" desc="Only published posts on platforms that report per-post numbers are in here. One destination is one post, so the same video on two platforms is two rows.">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="text-[13px] text-muted-foreground">{r.label}</dt>
            <dd className="mt-0.5 text-[15px] font-medium">{r.value}</dd>
          </div>
        ))}
      </dl>
      {metrics.proxy && (
        <p className="mt-4 rounded-2xl bg-warning/[0.14] p-3 text-[13px] font-medium text-warning-ink hairline">
          Measured by a proxy: no platform gives Outlly clicks or sales, so {metrics.metrics.map(metricLabel).join(", ").toLowerCase()} stand in for it.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ConfidenceBadge level={note.level} />
        <p className="text-[13px] text-muted-foreground">{note.text}</p>
      </div>
    </Card>
  );
}
