"use client";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, Chips, ConfidenceBadge } from "./bits";
import { attentionEmptyText, evidenceLine, liftWord, workingEmptyText } from "./view-core";
import type { Signal } from "./types";

// R1238: one card per measured change. The number and its baseline are always shown next to the claim.
function SignalCard({ s }: { s: Signal }) {
  const Icon = s.direction === "up" ? TrendingUp : TrendingDown;
  return (
    <li className="rounded-2xl bg-secondary/40 p-4 hairline">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 text-[15px] font-semibold leading-snug">{s.title}</h3>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-background/70 px-2.5 py-1 text-xs font-semibold hairline">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {liftWord(s.evidence.lift)}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">{evidenceLine(s.evidence)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Chips platform={s.platform} format={s.format} />
        <ConfidenceBadge level={s.confidence} n={s.postsAnalyzed} />
      </div>
    </li>
  );
}

export function WhatIsWorking({ signals }: { signals: Signal[] }) {
  return (
    <Card id="intel-working" title="What is working" desc="Formats and topics clearly ahead of the period before, compared only with posts of the same platform and format.">
      {signals.length ? <ul className="grid gap-3">{signals.map((s) => <SignalCard key={s.id} s={s} />)}</ul> : <p className="text-sm text-muted-foreground">{workingEmptyText}</p>}
    </Card>
  );
}

export function WhatNeedsAttention({ signals }: { signals: Signal[] }) {
  return (
    <Card id="intel-attention" title="What needs attention" desc="The same measurement the other way round: clearly behind the period before, never a guess.">
      {signals.length ? <ul className="grid gap-3">{signals.map((s) => <SignalCard key={s.id} s={s} />)}</ul> : <p className="text-sm text-muted-foreground">{attentionEmptyText}</p>}
    </Card>
  );
}
