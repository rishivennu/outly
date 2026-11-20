"use client";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, ConfidenceBadge } from "./bits";
import { hasTopicInsights, metricCell, metricLabel, topicLeadStat, topicLiftText, topicStatusWord, topicsEmptyText } from "./view-core";
import type { TopicInsight } from "./types";

// R1248: section 5, from overview.topics. A topic is only compared once it has enough posts, and says how many it lacks.
function TopicRow({ t }: { t: TopicInsight }) {
  const lead = topicLeadStat(t);
  const thin = topicStatusWord(t);
  const lift = topicLiftText(t);
  const Icon = (t.lift ?? 0) >= 0 ? TrendingUp : TrendingDown;
  return (
    <li className="rounded-2xl bg-secondary/40 p-4 hairline">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 text-[15px] font-semibold leading-snug">{t.topic}</h3>
        {lift && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-2.5 py-1 text-xs font-semibold hairline">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {lift}
          </span>
        )}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Posts</dt>
          <dd className="font-medium tabular">{t.n.toLocaleString("en")} ({t.scored.toLocaleString("en")} with numbers to compare)</dd>
        </div>
        {lead && (
          <div>
            <dt className="text-muted-foreground">Median {metricLabel(lead.metric).toLowerCase()}</dt>
            <dd className="font-medium tabular">{metricCell(lead, t.platform, t.format)}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {thin ? <p className="text-[13px] font-medium text-muted-foreground">{thin}</p> : <ConfidenceBadge level={t.confidence} n={t.scored} />}
      </div>
    </li>
  );
}

export function TopicInsights({ topics }: { topics: TopicInsight[] }) {
  const list = Array.isArray(topics) ? topics : [];
  return (
    <Card id="intel-topics" title="Topic and category insights" desc="Which subjects beat your usual numbers, like with like: each post is compared with your usual posts of its own platform and format.">
      {hasTopicInsights(list) ? <ul className="grid gap-3">{list.map((t) => <TopicRow key={t.topic} t={t} />)}</ul> : <p className="text-sm text-muted-foreground">{topicsEmptyText(list)}</p>}
    </Card>
  );
}
