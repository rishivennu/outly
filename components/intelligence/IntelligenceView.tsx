"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { objectiveOptions } from "@/lib/intelligence/brand-core";
import { cn } from "@/lib/utils";
import { BestPerformingContent } from "./BestPerformingContent";
import { ClientSwitcher } from "./ClientSwitcher";
import { FormatPerformance } from "./FormatPerformance";
import { GrowthOverview } from "./GrowthOverview";
import { NextContentRecommendations } from "./NextContentRecommendations";
import { PersonalBaselines } from "./PersonalBaselines";
import { PersonalRecommendations } from "./PersonalRecommendations";
import { PlatformComparison } from "./PlatformComparison";
import { WhatIsWorking, WhatNeedsAttention } from "./SignalSection";
import { TopicInsights } from "./TopicInsights";
import { WeeklyReport } from "./WeeklyReport";
import { DAY_OPTIONS, emptyStateText, hasEnoughPosts, hasOutcomeLine, overviewUrl } from "./view-core";
import type { Objective, Overview, StoredOutcome } from "./types";

/**
 * R1238: Content Intelligence, part one. The server hands over the first read so the page paints with real numbers;
 * the window and objective switches refetch /api/intelligence/overview. The objective here never saves: the stored
 * one lives in Settings, Brand (R1235), and this is only "show me the same posts judged another way".
 */
const OBJECTIVES = objectiveOptions();
const DAY_LABEL: Record<number, string> = { 7: "7 days", 28: "28 days", 90: "90 days" };
const pill =
  "relative inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

type Listed = { recommendations: { id: string; outcome?: StoredOutcome | null }[] };

export function IntelligenceView({ initial, account, initialOutcomes }: { initial: Overview | null; account?: string | null; initialOutcomes?: Record<string, StoredOutcome> }) {
  const [data, setData] = useState<Overview | null>(initial);
  const [days, setDays] = useState<number>(initial?.period.days ?? 28);
  const [objective, setObjective] = useState<Objective | null>(initial?.objective ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  // R1243: the agency client whose brand profile judges this view ("" is your own brand).
  const [client, setClient] = useState("");
  // The first paint already matches the server's read, so it is not fetched again.
  const first = useRef(!!initial);
  // R1243: set when a read picked the objective itself (a client's), so adopting it does not fetch the same read twice.
  const adopted = useRef(false);
  const savedObjective = initial?.objective ?? null;
  // R1248: outcomes of accepted cards. The server page sends the first read's; a later read only asks
  // /api/recommendations when it brings accepted cards nobody has looked up yet, so a switch costs at most one call.
  const [outcomes, setOutcomes] = useState<Record<string, StoredOutcome>>(initialOutcomes ?? {});
  const asked = useRef(new Set<string>(initial && initialOutcomes ? initial.recommendations.filter((r) => hasOutcomeLine(r.status)).map((r) => r.id) : []));

  const load = useCallback(
    async (d: number, o: Objective | null, c: string) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api<Overview>(overviewUrl(d, o, account ?? null, c || null));
        setData(r);
        if (r.objective !== o) adopted.current = true;
        setObjective(r.objective);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Those numbers didn't load. Try again in a moment.");
      } finally {
        setLoading(false);
      }
    },
    [account],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (adopted.current) {
      adopted.current = false;
      return;
    }
    void load(days, objective, client);
  }, [days, objective, client, load]);

  useEffect(() => {
    const need = (data?.recommendations ?? []).filter((r) => r.id && hasOutcomeLine(r.status) && !asked.current.has(r.id)).map((r) => r.id);
    if (!need.length) return;
    for (const id of need) asked.current.add(id);
    const q = new URLSearchParams({ status: "accepted", limit: "50" });
    if (client) q.set("scope", client);
    api<Listed>(`/api/recommendations?${q.toString()}`)
      .then((r) => {
        const got: Record<string, StoredOutcome> = {};
        for (const row of r.recommendations) if (row.outcome) got[row.id] = row.outcome;
        setOutcomes((o) => ({ ...o, ...got }));
      })
      // No outcome reads as "Measuring", which is still true; the next read asks again.
      .catch(() => need.forEach((id) => asked.current.delete(id)));
  }, [data, client]);

  // R1243: a client brings its own objective, so the choice made for the previous one is dropped.
  const switchClient = (key: string) => {
    setClient(key);
    setObjective(key ? null : savedObjective);
  };

  const objectiveName = OBJECTIVES.find((o) => o.id === (data?.objective ?? objective))?.label ?? "Engagement";

  return (
    <div className={cn("page-frame pb-20", loading && "opacity-60")} aria-busy={loading}>
      <header className="mt-8 lg:mt-12">
        <p className="text-sm font-semibold text-muted-foreground">Outlly Intelligence</p>
        <h1 className="display mt-2 text-[clamp(1.9rem,4vw,3rem)]">Content Intelligence</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          What your published posts actually did, compared like with like. Every claim shows the numbers, the sample size and how confident it is, and anything a platform does not report is named instead of counted as zero.
        </p>
        <div className="mt-5 grid gap-3">
          <div role="radiogroup" aria-label="Time window" className="gseg scrollbar-none flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-full bg-secondary/60 p-1 hairline">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={days === d}
                onClick={() => setDays(d)}
                className={cn(pill, days === d ? "bg-background text-foreground shadow-sm" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}
              >
                {DAY_LABEL[d] ?? `${d} days`}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Judge these posts by" className="gseg scrollbar-none flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-full bg-secondary/60 p-1 hairline">
            {OBJECTIVES.map((o) => {
              const on = (data?.objective ?? objective) === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={o.proxy ? `${o.label}, measured by a proxy` : o.label}
                  onClick={() => setObjective(o.id)}
                  className={cn(pill, on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground")}
                >
                  <span aria-hidden="true">{o.label}</span>
                  {o.proxy && <span aria-hidden="true" className="ml-1.5 text-xs font-semibold">proxy</span>}
                </button>
              );
            })}
          </div>
          <p className="text-[13px] text-muted-foreground">Your saved objective lives in Settings, Brand. Switching here only changes this view.</p>
          <ClientSwitcher value={client} onChange={switchClient} />
        </div>
      </header>

      {error && <p className="mt-6 rounded-2xl bg-destructive/10 p-4 text-sm font-medium text-destructive hairline">{error}</p>}

      {data && (
        <div className="mt-6 grid gap-4">
          <GrowthOverview data={data} objectiveLabel={objectiveName} />
          {!hasEnoughPosts(data.posts) ? (
            <section aria-labelledby="intel-empty" className="glass rounded-[28px] p-5 sm:p-6">
              <h2 id="intel-empty" className="text-lg font-semibold tracking-tight">Not enough posts yet</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{emptyStateText(data.posts, data.period.days)}</p>
            </section>
          ) : (
            <>
              <WhatIsWorking signals={data.working} />
              <WhatNeedsAttention signals={data.attention} />
              <FormatPerformance formats={data.formats} />
              <PlatformComparison formats={data.formats} />
              <BestPerformingContent formats={data.formats} />
              <NextContentRecommendations recommendations={data.recommendations} reason={data.recommendationsReason} outcomes={outcomes} />
            </>
          )}
          <TopicInsights topics={data.topics} />
          <PersonalBaselines client={client || null} />
          <PersonalRecommendations client={client || null} />
          <WeeklyReport data={data} savedObjective={savedObjective} client={client || null} />
        </div>
      )}

      {!data && !error && <p className="mt-6 text-sm text-muted-foreground">Reading your published posts...</p>}
    </div>
  );
}
