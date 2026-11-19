"use client";
import Link from "next/link";
import { Card, Chips, ConfidenceBadge } from "./bits";
import { createHref, evidenceLine } from "./view-core";
import type { Recommendation } from "./types";

/**
 * R1238: drafts the engine derived from upward signals only. Nothing generic is ever added to fill the list: when
 * there is nothing to say, the engine's own reason says why. R1239 gives these a stored id and a lifecycle; until a
 * recommendation has an id there is nothing to create from, so no button is shown.
 */
function RecommendationCard({ r }: { r: Recommendation }) {
  const href = createHref(r.id);
  return (
    <li className="rounded-2xl bg-secondary/40 p-4 hairline">
      <h3 className="text-[15px] font-semibold leading-snug">{r.title}</h3>
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
      {href && (
        <Link href={href} className="mt-3 inline-flex min-h-11 items-center rounded-full bg-secondary px-4 text-sm font-medium hairline transition-colors hover:bg-secondary/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Create from this
        </Link>
      )}
    </li>
  );
}

export function NextContentRecommendations({ recommendations, reason }: { recommendations: Recommendation[]; reason: string | null }) {
  return (
    <Card id="intel-next" title="Next content recommendations" desc="Built only from measured lifts, strongest first. Each one carries the numbers it rests on.">
      {recommendations.length ? (
        <ul className="grid gap-3">{recommendations.map((r) => <RecommendationCard key={r.id} r={r} />)}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">{reason ?? "No recommendation yet: no format or topic is far enough ahead of the period before to act on."}</p>
      )}
    </Card>
  );
}
