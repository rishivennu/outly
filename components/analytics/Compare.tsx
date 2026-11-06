"use client";
import { useState } from "react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn, compact } from "@/lib/utils";
import { ScrollX } from "@/components/ui/scroll-x";
import { compareValue } from "@/lib/analytics/core";
import type { AnalyticsSummary } from "@/lib/analytics";

type Acct = AnalyticsSummary["byAccount"][number];

/** Only metrics that mean the same thing on every platform that reports them (lib/analytics/core COMPARABLE). */
const COLUMNS: { k: "views" | "posts" | "engagement"; label: string; pct?: boolean }[] = [
  { k: "views", label: "Views" },
  { k: "posts", label: "Posts published" },
  { k: "engagement", label: "Engagement", pct: true },
];

/**
 * 1140: compare accounts side by side, including two accounts on the same platform. The first account
 * picked is the baseline and the rest show their difference from it. Only comparable metrics are offered,
 * and the note says plainly that each platform counts these its own way, so a difference is not a verdict.
 */
export function Compare({ accounts }: { accounts: Acct[] }) {
  const [picked, setPicked] = useState<string[]>(() => accounts.slice(0, 2).map((a) => a.accountId));
  if (accounts.length < 2) return null;
  const rows = picked.map((id) => accounts.find((a) => a.accountId === id)).filter((a): a is Acct => !!a);
  const base = rows[0];
  const toggle = (id: string) => setPicked((xs) => (xs.includes(id) ? (xs.length > 2 ? xs.filter((x) => x !== id) : xs) : [...xs, id].slice(0, 4)));
  const mixed = new Set(rows.map((r) => r.platform)).size > 1;

  return (
    <section aria-labelledby="compare" className="glass mt-3 rounded-[28px] p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="compare" className="text-lg font-semibold">Compare accounts</h2>
        <p className="text-sm text-muted-foreground">Pick two to four. The first one is the baseline.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {accounts.map((a) => {
          const on = picked.includes(a.accountId);
          return (
            <button
              key={a.accountId}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(a.accountId)}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium hairline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                on ? "bg-[hsl(var(--lime)/0.18)] ring-2 ring-[hsl(var(--lime))]" : "hover:bg-secondary/70",
              )}
            >
              <PlatformOrb platform={a.platform} size={18} />
              <span className="truncate">@{a.username.replace(/^@/, "")}</span>
              <span className="sr-only"> on {PLATFORM_META[a.platform].name}</span>
            </button>
          );
        })}
      </div>

      <ScrollX label="Compare accounts" className="pin-first mt-5 [--pin-bg:var(--background)]">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">Comparable metrics for the accounts you picked, with each one&apos;s difference from the baseline.</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="pb-2 pr-4 font-medium">Metric</th>
              {rows.map((r, i) => (
                <th key={r.accountId} scope="col" className="pb-2 pr-4 font-medium">
                  <span className="flex items-center gap-1.5">
                    <PlatformOrb platform={r.platform as Platform} size={16} /> @{r.username.replace(/^@/, "")}
                    {i === 0 && <span className="rounded-full bg-secondary px-2 py-px text-[10px] font-semibold uppercase tracking-wide">Baseline</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {COLUMNS.map((c) => (
              <tr key={c.k}>
                <th scope="row" className="py-2.5 pr-4 text-left font-medium">{c.label}</th>
                {rows.map((r, i) => {
                  const v = r[c.k];
                  const d = i === 0 ? null : compareValue(v, base[c.k]);
                  return (
                    <td key={r.accountId} className="py-2.5 pr-4 tabular">
                      <span className="font-semibold">{c.pct ? `${v.toFixed(1)}%` : compact(v)}</span>
                      {d && d.pct !== null && (
                        <span className={cn("ml-2 text-xs font-medium", d.pct >= 0 ? "text-success" : "text-warning")}>
                          {d.pct >= 0 ? "+" : "−"}{Math.round(Math.abs(d.pct))}%
                          <span className="sr-only"> compared with @{base.username.replace(/^@/, "")}</span>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        Only metrics that mean the same thing everywhere are compared: views, posts published and engagement.
        {mixed ? " These are different platforms, and each one counts a view its own way, so read the gap as a direction, not a score." : " Followers and reach are left out because they are counted differently per platform and are never added together."}
      </p>
    </section>
  );
}
