"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { LEVEL_LABEL, type Level } from "@/lib/intelligence/profile-core";
import { personalEvidenceLine } from "@/lib/intelligence/personal-reco-core";
import { Card, Chips, ConfidenceBadge } from "./bits";
import { RecActions } from "./RecActions";
import { platformLabel, recStatusWord } from "./view-core";
import type { StoredRecommendation } from "./types";

/**
 * R1320: "Made for you". Recommendations drawn from the creator's own history only: the traits that moved their
 * numbers and the format their baselines favour on each platform. Each card says why it fits them, with both sides
 * of the comparison and their sample sizes. A platform without enough measured posts is named with its level on the
 * honesty ladder instead of being guessed about. The planner's buttons work here as on the workspace list.
 */

type Read = { recommendations: StoredRecommendation[]; reason: string | null; levels: { platform: string; level: Level; measured: number }[]; window: { label: string } };

function PersonalCard({ r }: { r: StoredRecommendation }) {
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
        <ConfidenceBadge level={r.confidence} n={r.evidence.n + r.evidence.baselineN} />
      </div>
      <dl className="mt-3 grid gap-2 text-[13px]">
        <div>
          <dt className="text-muted-foreground">The idea</dt>
          <dd className="font-medium">{r.concept}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Why this fits you</dt>
          <dd>{r.why}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Your numbers</dt>
          <dd className="tabular">{personalEvidenceLine(r.evidence)}</dd>
        </div>
      </dl>
      {r.id && <RecActions id={r.id} status={status} hadFeedback={!!r.feedback} onStatus={setStatus} />}
    </li>
  );
}

export function PersonalRecommendations({ client }: { client: string | null }) {
  const [data, setData] = useState<Read | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api<Read>(`/api/intelligence/recommendations${client ? `?client=${encodeURIComponent(client)}` : ""}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Could not read your personal recommendations just now."));
    return () => {
      live = false;
    };
  }, [client]);

  return (
    <Card id="intel-personal" title="Made for you" desc="From your own measured posts only: the traits and formats that moved your numbers, each with both sides of the comparison. Not general advice.">
      {error && <p className="rounded-2xl bg-destructive/10 p-4 text-sm font-medium text-destructive hairline">{error}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Comparing your posts with each other...</p>}
      {data && (
        <>
          {data.recommendations.length ? (
            <ul className="grid gap-3">{data.recommendations.map((r) => <PersonalCard key={`${r.id}:${r.status}`} r={r} />)}</ul>
          ) : (
            <p className="rounded-2xl bg-secondary/50 p-4 text-sm text-muted-foreground hairline">{data.reason}</p>
          )}
          {data.levels.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label="How much of this is your own data, per platform">
              {data.levels.map((l) => (
                <li key={l.platform} className="rounded-full bg-background/60 px-2.5 py-1 hairline">
                  {platformLabel(l.platform)}: {LEVEL_LABEL[l.level]} ({l.measured.toLocaleString("en")} measured)
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
