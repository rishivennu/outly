"use client";
import { useState } from "react";
import { Card, Chips, ConfidenceBadge } from "./bits";
import { RecActions } from "./RecActions";
import { evidenceLine, hasOutcomeLine, outcomeLine, recStatusWord } from "./view-core";
import type { StoredOutcome, StoredRecommendation } from "./types";

/**
 * R1238: drafts the engine derived from upward signals only. Nothing generic is ever added to fill the list: when
 * there is nothing to say, the engine's own reason says why. R1239 gives these a stored id and a lifecycle; until a
 * recommendation has an id there is nothing to create from, so no button is shown. R1248: the planner's buttons
 * and, on accepted and done cards, the outcome of the post made from it.
 */
export function OutcomeLine({ outcome }: { outcome: StoredOutcome | null | undefined }) {
  const line = outcomeLine(outcome);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-background/60 p-3 text-[13px] hairline">
      <p className="min-w-0 flex-1">{line.text}</p>
      {line.confidence && <ConfidenceBadge level={line.confidence} n={outcome?.n} />}
    </div>
  );
}

function RecommendationCard({ r, outcome }: { r: StoredRecommendation; outcome: StoredOutcome | null | undefined }) {
  const [status, setStatus] = useState<string>(r.status);
  return (
    <li className="rounded-2xl bg-secondary/40 p-4 hairline">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 text-[15px] font-semibold leading-snug">{r.title}</h3>
        <span className="whitespace-nowrap rounded-full bg-background/70 px-2.5 py-1 text-xs font-semibold hairline" aria-live="polite">
          {recStatusWord(status)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chips platform={r.platform} format={r.format} />
        <ConfidenceBadge level={r.confidence} n={r.postsAnalyzed} />
      </div>
      <dl className="mt-3 grid gap-2 text-[13px]">
        <div>
          <dt className="text-muted-foreground">The idea</dt>
          <dd className="font-medium">{r.concept}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Why</dt>
          <dd>{r.why}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Evidence</dt>
          <dd className="tabular">{evidenceLine(r.evidence)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Period</dt>
          <dd>{r.period}, {r.postsAnalyzed.toLocaleString("en")} posts analysed</dd>
        </div>
      </dl>
      {hasOutcomeLine(status) && <OutcomeLine outcome={outcome} />}
      {r.id && <RecActions id={r.id} status={status} hadFeedback={!!r.feedback} onStatus={setStatus} />}
    </li>
  );
}

export function NextContentRecommendations({ recommendations, reason, outcomes = {} }: { recommendations: StoredRecommendation[]; reason: string | null; outcomes?: Record<string, StoredOutcome> }) {
  return (
    <Card id="intel-next" title="Next content recommendations" desc="Built only from measured lifts, strongest first. Each one carries the numbers it rests on.">
      {recommendations.length ? (
        <ul className="grid gap-3">{recommendations.map((r) => <RecommendationCard key={`${r.id}:${r.status}`} r={r} outcome={outcomes[r.id]} />)}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">{reason ?? "No recommendation yet: no format or topic is far enough ahead of the period before to act on."}</p>
      )}
    </Card>
  );
}
