"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { LEVEL_LABEL, type Level, type Lift } from "@/lib/intelligence/profile-core";
import { Card, Chips, ConfidenceBadge } from "./bits";
import type { Confidence } from "./types";

/**
 * R1319: "Your baselines". What a typical post of each format would do on each platform, from the creator's own
 * measured posts; the traits that moved their numbers; and how the estimates have done so far. Every figure names its
 * sample and its level on the honesty ladder; a platform with nothing measured says so instead of guessing.
 */

type FormatBaseline = { format: string; n: number; level: Exclude<Level, "none">; predicted: number; low: number; high: number; confidence: Confidence; explanation: string };
type PlatformPredictions = { platform: string; level: Level; measured: number; byFormat: FormatBaseline[]; lifts: Lift[]; accuracy: { n: number; medianApe: number | null; within: number | null } | null; accuracyWords: string };
type Overview = { model: { key: string } | null; platforms: PlatformPredictions[]; overall: { words: string }; recent: unknown[] };

const num = (n: number) => n.toLocaleString("en");

export function PersonalBaselines({ client }: { client: string | null }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api<Overview>(`/api/intelligence/predictions${client ? `?client=${encodeURIComponent(client)}` : ""}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Could not read your baselines just now."));
    return () => {
      live = false;
    };
  }, [client]);

  return (
    <Card
      id="intel-baselines"
      title="Your baselines"
      desc="What a typical post of yours does on each platform, worked out from your own measured posts. An estimate from the past, shown with its sample size, never a promise."
    >
      {error && <p className="rounded-2xl bg-destructive/10 p-4 text-sm font-medium text-destructive hairline">{error}</p>}
      {!data && !error && <p className="text-sm text-muted-foreground">Reading your measured posts...</p>}
      {data && !data.platforms.length && (
        <p className="rounded-2xl bg-secondary/50 p-4 text-sm text-muted-foreground hairline">
          Nothing measured yet. Baselines appear once a published post is a day old and has numbers (Instagram, YouTube or Facebook report them; the other platforms give none per post).
        </p>
      )}
      {data && data.platforms.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.platforms.map((p) => (
            <li key={p.platform} className="rounded-2xl bg-secondary/40 p-4 hairline">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Chips platform={p.platform} format={p.byFormat[0]?.format ?? "video"} />
                <span className="text-xs font-semibold text-muted-foreground">{LEVEL_LABEL[p.level]}</span>
              </div>
              {p.byFormat.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No measured post on this platform yet, so no number.</p>}
              {p.byFormat.length > 0 && (
                <ul className="mt-3 grid gap-2">
                  {p.byFormat.map((f) => (
                    <li key={f.format} className="rounded-xl bg-background/70 p-3 hairline">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium capitalize">{f.format}</p>
                        <ConfidenceBadge level={f.confidence} n={f.n} />
                      </div>
                      <p className="mt-1 text-2xl font-semibold tabular tracking-tight">
                        ~{num(f.predicted)} <span className="text-sm font-medium text-muted-foreground">views</span>
                      </p>
                      <p className="text-xs text-muted-foreground tabular">
                        usually {num(f.low)} to {num(f.high)}
                      </p>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{f.explanation}</p>
                    </li>
                  ))}
                </ul>
              )}
              {p.lifts.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-muted-foreground">What moved your views here</p>
                  <ul className="mt-1.5 grid gap-1">
                    {p.lifts.slice(0, 4).map((l) => (
                      <li key={l.trait} className="text-[13px] leading-relaxed">
                        Posts with {l.label}: median {num(l.withMedian)} vs {num(l.withoutMedian)} without ({l.liftPct > 0 ? "+" : ""}
                        {l.liftPct}%, {l.nWith} vs {l.nWithout} posts).
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{p.accuracyWords}</p>
            </li>
          ))}
        </ul>
      )}
      {data && data.platforms.length > 0 && <p className="mt-3 text-[13px] text-muted-foreground">{data.overall.words}</p>}
      {!client && <SharingRow />}
    </Card>
  );
}

/**
 * R1324: the one switch for shared learning. On, this workspace's measured posts join anonymised cohort medians
 * (never fewer than 5 creators and 20 posts per bucket, no single creator above half); off, they stay home. Either
 * way the creator's own estimates still read the shared baseline when they have little history of their own.
 */
function SharingRow() {
  const [share, setShare] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api<{ share: boolean }>("/api/intelligence/sharing")
      .then((r) => live && setShare(r.share))
      .catch(() => live && setShare(null));
    return () => {
      live = false;
    };
  }, []);
  if (share === null) return null;
  const flip = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ share: boolean }>("/api/intelligence/sharing", { method: "PATCH", json: { share: !share } });
      setShare(r.share);
      setNote(r.share ? "Your posts join the next hourly rebuild." : "Your posts leave the shared baselines at the next hourly rebuild.");
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "That didn't save. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-secondary/40 p-4 hairline">
      <div className="min-w-0 flex-1">
        <p id="intel-sharing-label" className="text-sm font-medium">Help the shared baselines</p>
        <p id="intel-sharing-hint" className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          Your measured posts join anonymised medians (never fewer than 5 creators and 20 posts in a group, no one creator more than half of it). Nothing of yours is shown to anyone; new creators get a fairer starting estimate. You keep reading them either way.
        </p>
        {note && <p className="mt-1.5 text-[13px] text-muted-foreground" aria-live="polite">{note}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={share}
        aria-labelledby="intel-sharing-label"
        aria-describedby="intel-sharing-hint"
        disabled={busy}
        onClick={flip}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${share ? "bg-lime" : "bg-muted"}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${share ? "translate-x-6" : "translate-x-1"}`} aria-hidden />
      </button>
    </div>
  );
}
