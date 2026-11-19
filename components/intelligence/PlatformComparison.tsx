"use client";
import { Card } from "./bits";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { byPlatform, engagementCell, formatLabel, isPlatformKey, metricCell, metricLabel, platformLabel, statusWord } from "./view-core";
import type { FormatGroup } from "./types";

// R1238: the same rows grouped by platform. Nothing is summed across platforms: the metrics do not mean the same thing.
export function PlatformComparison({ formats }: { formats: FormatGroup[] }) {
  const groups = byPlatform(formats);
  return (
    <Card id="intel-platforms" title="Platform comparison" desc="Side by side, never added up. Instagram views and YouTube views are not the same measurement, so each platform keeps its own numbers.">
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No published posts in this period, so there is nothing to compare yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((p) => (
            <div key={p.platform} className="rounded-2xl bg-secondary/40 p-4 hairline">
              <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                {isPlatformKey(p.platform) && <PlatformOrb platform={p.platform} size={18} />}
                {platformLabel(p.platform)}
              </h3>
              <ul className="mt-3 grid gap-3">
                {p.groups.map((g) => {
                  const primary = g.primary ? g.metrics.find((m) => m.metric === g.primary) : undefined;
                  return (
                    <li key={g.format} className="border-t border-border/60 pt-3 first:border-0 first:pt-0">
                      <p className="text-[13px] font-medium">{formatLabel(g.format)} <span className="tabular text-muted-foreground">{g.n.toLocaleString("en")} posts</span></p>
                      <p className="mt-1 text-[13px]">
                        {primary ? (
                          <>
                            <span className="text-muted-foreground">Median {metricLabel(primary.metric).toLowerCase()}: </span>
                            <span className="font-medium">{metricCell(primary, g.platform, g.format)}</span>
                          </>
                        ) : (
                          <span className="font-medium">{statusWord(g)}</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[13px]">
                        <span className="text-muted-foreground">Engagement rate: </span>
                        <span className="font-medium">{engagementCell(g)}</span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
