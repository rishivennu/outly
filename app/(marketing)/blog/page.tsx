import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Rss } from "lucide-react";
import { Shell } from "@/components/marketing/bits";
import { SplitLines } from "@/components/shared/SplitLines";
import { CategoryNav } from "@/components/blog/CategoryNav";
import { JsonLd } from "@/components/blog/JsonLd";
import { Pagination } from "@/components/blog/Pagination";
import { FeaturedPost, PostGrid } from "@/components/blog/PostCard";
import { SearchForm } from "@/components/blog/SearchForm";
import { categoriesWithCounts, clampPage, collectionJsonLd, pageHref, publishedPosts } from "@/lib/blog/public";
import { env } from "@/lib/env";

export const revalidate = 300;

const TITLE = "Blog";
const LEAD = "Practical guides for creators: growing an audience, planning content and publishing to every platform without burning out.";

type Props = { searchParams: Promise<{ q?: string | string[]; page?: string | string[] }> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const shortDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);

export async function generateMetadata(props: Props): Promise<Metadata> {
  const sp = await props.searchParams;
  const q = one(sp.q).trim();
  const page = clampPage(one(sp.page));
  return {
    title: page > 1 ? `${TITLE}, page ${page}` : TITLE,
    description: LEAD,
    alternates: { canonical: pageHref("/blog", { page }), types: { "application/rss+xml": "/blog/feed.xml" } },
    openGraph: { title: `${TITLE} · Outlly`, description: LEAD, url: "/blog", type: "website" },
    twitter: { card: "summary", title: `${TITLE} · Outlly`, description: LEAD },
    // Search results are thin, endless pages: readable by people, kept out of the index.
    ...(q ? { robots: { index: false, follow: true } } : {}),
  };
}

/** One bento tile: a lime diamond, the label, the figure, then a hairline and a caption. */
function Stat({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="flex flex-col rounded-[1.5rem] border border-border bg-card p-5">
      <p className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <span aria-hidden="true" className="h-2 w-2 rotate-45 bg-lime" />
        {label}
      </p>
      <p className="display mt-3 pb-4 text-[clamp(1.75rem,1.6vw+1rem,2.25rem)] tabular-nums">{value}</p>
      <p className="mt-auto border-t border-border pt-3 text-[13px] text-muted-foreground">{caption}</p>
    </div>
  );
}

export default async function BlogPage(props: Props) {
  const sp = await props.searchParams;
  const q = one(sp.q).trim().slice(0, 100);
  const page = clampPage(one(sp.page));
  const [list, categories, all] = await Promise.all([publishedPosts({ q, page }), categoriesWithCounts(), q ? publishedPosts({ perPage: 1 }) : undefined]);
  const total = all ? all.total : list.total;
  const newest = all ? all.items[0] : page === 1 ? list.items[0] : undefined;
  const base = env.APP_URL.replace(/\/+$/, "");
  const showFeatured = !q && page === 1 && list.items.length > 0;
  const featured = showFeatured ? list.items[0] : undefined;
  const rest = showFeatured ? list.items.slice(1) : list.items;

  return (
    <section className="py-12 sm:py-20">
      <JsonLd data={collectionJsonLd(base, { type: "Blog", name: "Outlly Blog", description: LEAD, path: "/blog", posts: list.items })} />
      <Shell>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">
          <div className="flex flex-col justify-between rounded-[1.75rem] border border-border bg-card p-6 sm:p-10">
            <div>
              <p className="inline-flex min-h-8 items-center gap-2 rounded-full border border-border px-3.5 text-[13px] font-medium leading-none text-muted-foreground">
                <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-lime" />
                The Outlly blog
              </p>
              <SplitLines className="display mt-6 max-w-[14ch] text-balance text-[clamp(2.4rem,5.2vw,4rem)]">
                Guides for creators who <span className="accent-serif">publish</span> everywhere.
              </SplitLines>
              <p className="mt-6 max-w-xl text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-lg">{LEAD}</p>
            </div>
            <SearchForm q={q} className="mt-8" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Stat label="Articles" value={String(total)} caption="Published so far" />
            <Stat label="Topics" value={String(categories.length)} caption="Pick one below" />
            <Stat label="Latest" value={newest ? shortDate(newest.publishedAt) : "Soon"} caption={newest ? "Newest article" : "First article coming"} />
            <Link href="/blog/feed.xml" className="group flex flex-col justify-between rounded-[1.5rem] border border-border bg-card p-5 text-foreground hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex items-center justify-between text-[13px] font-medium text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Rss aria-hidden="true" className="h-4 w-4" />
                  RSS feed
                </span>
                <span aria-hidden="true" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-lime text-lime-foreground transition-transform duration-200 group-hover:-translate-y-0.5">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </span>
              <span className="mt-3 text-[15px] font-semibold leading-snug">Follow new guides in your reader</span>
            </Link>
          </div>
        </div>

        <div className="mt-8">
          <CategoryNav categories={categories} />
        </div>

        {q && (
          <p role="status" className="mt-10 text-[15px] text-muted-foreground">
            {list.total === 0 ? "No articles match" : `${list.total} ${list.total === 1 ? "article matches" : "articles match"}`} &ldquo;{q}&rdquo;.{" "}
            <Link href="/blog" className="inline-flex min-h-11 items-center font-medium text-foreground underline decoration-border underline-offset-4">
              Clear search
            </Link>
          </p>
        )}

        {featured && (
          <div className="mt-10">
            <FeaturedPost post={featured} />
          </div>
        )}

        {rest.length > 0 && (
          <div className="mt-14">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
              <h2 className="display text-[clamp(1.5rem,1.4vw+1rem,1.875rem)]">{q ? "Results" : page > 1 ? `Latest articles, page ${page}` : "Latest articles"}</h2>
              <p className="text-[14px] text-muted-foreground">
                {list.total} {list.total === 1 ? "article" : "articles"}
                {list.pages > 1 ? `, page ${page} of ${list.pages}` : ""}
              </p>
            </div>
            <div className="mt-6">
              <PostGrid posts={rest} />
            </div>
          </div>
        )}

        {list.total === 0 && !q && (
          <div className="mt-10 rounded-[1.75rem] border border-border bg-card p-8">
            <h2 className="text-[19px] font-semibold tracking-tight">The first articles are on their way</h2>
            <p className="mt-2 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">New guides are published here as soon as they are ready. In the meantime, the help centre answers the common questions.</p>
            <Link href="/help" className="mt-4 inline-flex min-h-11 items-center font-medium underline decoration-border underline-offset-4">
              Visit the help centre
            </Link>
          </div>
        )}
        {list.total > 0 && list.items.length === 0 && (
          <p className="mt-12 text-base text-muted-foreground">
            There is no page {page}.{" "}
            <Link href={pageHref("/blog", { q })} className="inline-flex min-h-11 items-center font-medium text-foreground underline decoration-border underline-offset-4">
              Go to the first page
            </Link>
          </p>
        )}

        <Pagination path="/blog" page={page} pages={list.pages} q={q} />
      </Shell>
    </section>
  );
}
