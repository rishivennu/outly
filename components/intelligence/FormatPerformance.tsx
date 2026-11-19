"use client";
import { Card, Chips } from "./bits";
import { engagementCell, formatLabel, metricCell, metricLabel, platformLabel, statusWord, viewShareCell } from "./view-core";
import type { FormatGroup } from "./types";

// R1238: one row per platform and format. Rows are never ranked against each other, and a gap is a word.
export function FormatPerformance({ formats }: { formats: FormatGroup[] }) {
  return (
    <Card id="intel-formats" title="Format performance" desc="A carousel is not a video, so each platform and format is measured on its own. Medians, not averages, so one viral post does not move the row.">
      {formats.length === 0 ? (
        <p className="text-sm text-muted-foreground">No published posts in this period, so there is nothing to compare yet.</p>
      ) : (
        <ul className="grid gap-3">
          {formats.map((g) => {
            const primary = g.primary ? g.metrics.find((m) => m.metric === g.primary) : undefined;
            return (
              <li key={`${g.platform}|${g.format}`} className="rounded-2xl bg-secondary/40 p-4 hairline">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Chips platform={g.platform} format={g.format} />
                  <p className="text-xs font-semibold">{statusWord(g)}</p>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-[13px] text-muted-foreground">Posts</dt>
                    <dd className="text-[15px] font-medium tabular">{g.n.toLocaleString("en")}</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-muted-foreground">{primary ? `Median ${metricLabel(primary.metric).toLowerCase()}` : "Median"}</dt>
                    <dd className="text-[15px] font-medium">{primary ? metricCell(primary, g.platform, g.format) : statusWord(g)}</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-muted-foreground">Median engagement rate</dt>
                    <dd className="text-[15px] font-medium">{engagementCell(g)}</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-muted-foreground">Share</dt>
                    <dd className="text-[15px] font-medium">{g.postShare}% of your posts, {viewShareCell(g)}</dd>
                  </div>
                </dl>
                <p className="sr-only">{`${platformLabel(g.platform)} ${formatLabel(g.format)}: ${statusWord(g)}`}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
