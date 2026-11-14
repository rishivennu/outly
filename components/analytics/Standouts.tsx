"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { PlatformOrb } from "@/components/shared/PlatformIcon";
import { PLATFORM_META, type Platform } from "@/lib/domain";
import { cn, compact } from "@/lib/utils";
import { ease } from "@/lib/motion/tokens";
import { ranksFor, rankStandouts, vsAverage, type RankKey, type StandoutPost } from "@/lib/analytics/core";

/**
 * 1140 "Your standout content": the posts that did best in the chosen range, ranked by what you care about
 * and filterable by platform. Every number is the one stored for that destination, so the same video on two
 * platforms is two rows: nothing is merged and nothing is added across platforms.
 *
 * A ranking a platform never reports (saves outside Instagram, shares on Facebook) is not offered, and a
 * post with no number for the current ranking sorts last rather than being shown as a zero.
 */
export function Standouts({ posts, avgViews }: { posts: StandoutPost[]; avgViews: number }) {
  const [by, setBy] = useState<RankKey>("views");
  const [only, setOnly] = useState<Platform | null>(null);
  const reduce = useReducedMotion();
  const platforms = useMemo(() => [...new Set(posts.map((p) => p.platform))] as Platform[], [posts]);
  const ranks = useMemo(() => ranksFor(platforms), [platforms]);
  const shown = useMemo(() => rankStandouts(only ? posts.filter((p) => p.platform === only) : posts, ranks.some((r) => r.k === by) ? by : "views").slice(0, 10), [posts, only, by, ranks]);
  if (!posts.length) return null;
  const pill = "relative h-9 rounded-full px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  return (
    <section aria-labelledby="standouts" className="glass mt-3 rounded-[28px] p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="standouts" className="text-lg font-semibold">Your standout content</h2>
        <div className="flex flex-wrap items-center gap-2">
          {platforms.length > 1 && (
            <div role="radiogroup" aria-label="Filter by platform" className="flex gap-1 rounded-full bg-secondary/60 p-1">
              <button type="button" role="radio" aria-checked={only === null} onClick={() => setOnly(null)} className={cn(pill, only === null ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {only === null && <motion.span layoutId="so-plat" className="absolute inset-0 rounded-full bg-background shadow-sm" />}
                <span className="relative">All</span>
              </button>
              {platforms.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={only === p} onClick={() => setOnly(p)} className={cn(pill, "px-2.5", only === p ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {only === p && <motion.span layoutId="so-plat" className="absolute inset-0 rounded-full bg-background shadow-sm" />}
                  <span className="relative flex items-center gap-1.5">
                    <PlatformOrb platform={p} size={16} /> {PLATFORM_META[p].name}
                  </span>
                </button>
              ))}
            </div>
          )}
          {ranks.length > 1 && (
            <div role="radiogroup" aria-label="Rank by" className="flex gap-1 rounded-full bg-secondary/60 p-1">
              {ranks.map((r) => (
                <button key={r.k} type="button" role="radio" aria-checked={by === r.k} onClick={() => setBy(r.k)} className={cn(pill, by === r.k ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {by === r.k && <motion.span layoutId="so-rank" className="absolute inset-0 rounded-full bg-background shadow-sm" />}
                  <span className="relative">{r.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <ol className="divide-y divide-border/60">
        {shown.map((p, i) => {
          const vs = vsAverage(p.views, avgViews);
          // The stored rows carry the platform as a string; it is one of ours because that is how it was published.
          const plat = p.platform as Platform;
          return (
            <motion.li key={p.targetId} layout={!reduce} transition={{ duration: 0.35, ease: ease("out") }} className="py-3 first:pt-0 last:pb-0">
              <div className="grid grid-cols-[48px_1fr] items-center gap-x-4 gap-y-2 sm:grid-cols-[56px_minmax(0,1.5fr)_repeat(5,minmax(0,0.55fr))_auto]">
                <div className="relative row-span-2 aspect-[9/14] w-12 shrink-0 overflow-hidden rounded-xl bg-secondary sm:row-span-1 sm:w-14">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.thumbnailUrl && <img src={p.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
                  <span className="absolute left-1 top-1 rounded-md bg-background/85 px-1.5 text-xs font-bold tabular">{i + 1}</span>
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{p.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <PlatformOrb platform={plat} size={16} />
                    <span>{PLATFORM_META[plat].name}</span>
                    {p.username && <span>@{p.username.replace(/^@/, "")}</span>}
                    {p.publishedAt && <span>{new Date(p.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
                    {vs !== null && (
                      <span className={cn("rounded-full px-2 py-px font-medium", vs >= 0 ? "bg-lime/25 text-lime-ink" : "bg-secondary")}>
                        {Math.abs(vs) < 1 ? "About your average" : `${Math.round(Math.abs(vs))}% ${vs >= 0 ? "above" : "below"} your average`}
                      </span>
                    )}
                  </p>
                </div>
                <dl className="col-start-2 flex flex-wrap gap-x-4 gap-y-1 text-xs sm:contents">
                  <Cell k="Views" v={compact(p.views)} />
                  <Cell k="Likes" v={compact(p.likes)} />
                  <Cell k="Comments" v={compact(p.comments)} />
                  <Cell k="Shares" v={compact(p.shares)} />
                  <Cell k="Engaged" v={p.engagement === null ? "Not available" : `${p.engagement.toFixed(1)}%`} />
                </dl>
                <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-start-auto sm:justify-end">
                  <Link href={`/content?post=${encodeURIComponent(p.postId)}`} className="inline-flex min-h-11 items-center text-xs font-semibold text-lime-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    Details
                  </Link>
                  {p.url && (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      Open <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only"> on {PLATFORM_META[plat].name}</span>
                    </a>
                  )}
                </div>
              </div>
            </motion.li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Each row is one post on one platform, with that platform&apos;s own numbers. Engaged is likes, comments, shares and saves per view. &quot;Your average&quot; is the average views of every post in this range.
      </p>
    </section>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-1 sm:block sm:text-right">
      <dt className="text-muted-foreground sm:text-xs">{k}</dt>
      <dd className="font-semibold tabular sm:text-sm">{v}</dd>
    </div>
  );
}
