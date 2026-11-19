"use client";
import { Card, Chips } from "./bits";
import { bestGroups, metricLabel } from "./view-core";
import { formatMetric } from "@/lib/insights/post-core";
import type { FormatGroup } from "./types";

// R1238: the best posts inside each ranked group, because that is the only fair comparison the engine makes.
export function BestPerformingContent({ formats }: { formats: FormatGroup[] }) {
  const groups = bestGroups(formats);
  return (
    <Card id="intel-best" title="Best-performing content" desc="Ranked inside its own platform and format by the metric your objective leads with. Groups without enough posts are left out rather than ranked on thin numbers.">
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No group has enough posts with numbers to rank yet. Format performance above shows how close each one is.</p>
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Chips platform={g.platform} format={g.format} />
                <p className="text-xs text-muted-foreground">Ranked by {metricLabel(g.metric).toLowerCase()}</p>
              </div>
              <ol className="mt-2 divide-y divide-border/60">
                {g.top.map((t, i) => (
                  <li key={t.id} className="flex items-center justify-between gap-4 py-2.5">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold tabular hairline">{i + 1}</span>
                      <span className="truncate text-[13px] text-muted-foreground">Post {t.id.slice(-6)}</span>
                    </span>
                    <span className="whitespace-nowrap text-[15px] font-medium tabular">{formatMetric(g.metric, t.value)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
