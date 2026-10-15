"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TrendingUp, Loader2, Sparkles } from "lucide-react";
import type { AnalysisFull, AnalysisSummary, BehaviorStats } from "@/lib/admin/behavior";
import { cn } from "@/lib/utils";
import { BehaviorBreakdown } from "./BehaviorBreakdown";
import { BehaviorAnalyses } from "./BehaviorAnalyses";

const RANGES = [7, 30, 90] as const;
export type History = { items: AnalysisSummary[]; more: boolean; total: number };

export function BehaviorView({ stats, history, selected, tab, aiReady }: { stats: BehaviorStats; history: History; selected: AnalysisFull | null; tab: "breakdown" | "ai"; aiReady: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [t, setT] = useState(tab);
  const [pending, start] = useTransition();
  const [count, setCount] = useState(history.total);

  const setParam = (mut: (q: URLSearchParams) => void, nav: "push" | "silent" = "silent") => {
    const q = new URLSearchParams(sp.toString());
    mut(q);
    const qs = q.toString();
    const url = `${path}${qs ? `?${qs}` : ""}`;
    if (nav === "silent") window.history.replaceState(null, "", url);
    else start(() => router.push(url, { scroll: false }));
  };
  const chooseTab = (x: "breakdown" | "ai") => {
    setT(x);
    setParam((q) => (x === "ai" ? q.set("tab", "ai") : q.delete("tab")));
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="User behavior views" className="inline-flex rounded-full bg-secondary/70 p-1 hairline">
          {([["breakdown", "Breakdown", TrendingUp], ["ai", "Gemini analyses", Sparkles]] as const).map(([k, label, Icon]) => (
            <button key={k} id={`tab-${k}`} type="button" role="tab" aria-selected={t === k} aria-controls={`panel-${k}`} onClick={() => chooseTab(k)} className={cn("inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors", t === k ? "lime-bg" : "text-muted-foreground hover:text-foreground")}>
              <Icon className="h-4 w-4" aria-hidden />
              {label}
              {k === "ai" && count > 0 && <span className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular", t === k ? "bg-[hsl(var(--lime-foreground)/0.14)]" : "bg-foreground/[0.07]")}>{count}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label="Loading" />}
          <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-full bg-secondary/70 p-1 hairline">
            {RANGES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={stats.rangeDays === r} onClick={() => setParam((q) => (r === 30 ? q.delete("range") : q.set("range", String(r))), "push")} className={cn("h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors", stats.rangeDays === r ? "lime-bg" : "text-muted-foreground hover:text-foreground")}>
                {r} days
              </button>
            ))}
          </div>
        </div>
      </div>

      <div id="panel-breakdown" role="tabpanel" aria-labelledby="tab-breakdown" hidden={t !== "breakdown"} className={cn(pending && "opacity-60 transition-opacity")}>
        <BehaviorBreakdown s={stats} active={t === "breakdown"} />
      </div>
      <div id="panel-ai" role="tabpanel" aria-labelledby="tab-ai" hidden={t !== "ai"}>
        <BehaviorAnalyses history={history} selected={selected} aiReady={aiReady} range={stats.rangeDays} users={stats.totals.users} onCount={setCount} setParam={setParam} />
      </div>
    </div>
  );
}
