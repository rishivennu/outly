"use client";
import Link from "next/link";
import { useMemo } from "react";
import { weeklyIntelligence, type ReportLine } from "@/lib/intelligence/report-core";
import { Card } from "./bits";
import { weeklyReportNote } from "./view-core";
import type { Objective, Overview } from "./types";

/**
 * R1243: section 9, the Monday summary built from the overview already on screen (no extra fetch), with the same
 * report-core the weekly email uses, so the two can never disagree.
 */
function Lines({ label, lines }: { label: string; lines: ReportLine[] }) {
  if (!lines.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold">{label}</h3>
      <ul className="mt-2 grid gap-2">
        {lines.map((l) => (
          <li key={l.title} className="rounded-2xl bg-secondary/40 p-3 hairline">
            <p className="text-[14px] font-medium leading-snug">{l.title}</p>
            <p className="mt-1 text-[13px] text-muted-foreground tabular">{l.evidence}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">{l.confidenceText}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeeklyReport({ data, savedObjective, client }: { data: Overview; savedObjective: Objective | null; client?: string | null }) {
  const w = useMemo(() => weeklyIntelligence(data), [data]);
  const r = w.topRecommendation;
  return (
    <Card id="intel-weekly" title="Weekly intelligence report" desc={weeklyReportNote({ days: data.period.days, objective: data.objective, savedObjective, client: client ?? null })}>
      <div className="grid gap-4">
        <div>
          <p className="text-[15px] font-semibold leading-snug">{w.headline}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {w.period}, judged on {w.objectiveLabel}, {w.postsAnalyzed.toLocaleString("en")} posts analysed
          </p>
          {w.emptyText && <p className="mt-2 text-sm text-muted-foreground">{w.emptyText}</p>}
        </div>
        <Lines label="What is working" lines={w.movers} />
        <Lines label="Needs attention" lines={w.attention} />
        {r ? (
          <div>
            <h3 className="text-sm font-semibold">Make next</h3>
            <div className="mt-2 rounded-2xl bg-secondary/40 p-3 hairline">
              <p className="text-[14px] font-medium leading-snug">{r.title}</p>
              <p className="mt-1 text-[13px]">{r.concept}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{r.why}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">{r.confidenceText}</p>
              {r.href && (
                <Link href={r.href} className="mt-2 inline-flex min-h-11 items-center rounded-full bg-secondary px-4 text-sm font-medium hairline transition-colors hover:bg-secondary/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  Create from this
                </Link>
              )}
            </div>
          </div>
        ) : (
          w.recommendationNote && <p className="text-sm text-muted-foreground">{w.recommendationNote}</p>
        )}
        <ul className="grid gap-1 text-xs leading-relaxed text-muted-foreground" aria-label="How to read this report">
          {w.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
