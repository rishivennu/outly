import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { blogDate, categorySlug, type PublicPostCard } from "@/lib/blog/public";
import { cn } from "@/lib/utils";

/** Outlined pill, the blog's unit of metadata. Links keep a 44px row; plain chips sit at 32px. */
export const pill = "inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] font-medium leading-none";
export const pillLink = cn(pill, "min-h-11 text-lime-ink underline decoration-border underline-offset-4 hover:border-foreground/40 hover:decoration-current dark:text-lime");
export const pillChip = cn(pill, "min-h-8 text-muted-foreground");

function Meta({ post, className }: { post: PublicPostCard; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]", className)}>
      <time dateTime={post.publishedAt.toISOString()}>{blogDate(post.publishedAt)}</time>
      <span aria-hidden="true">&middot;</span>
      <span>{post.readingMin} min read</span>
    </p>
  );
}

/** The title is the link; the whole card is not, so the category link inside stays its own target. */
export function PostCard({ post, headingLevel = 3 }: { post: PublicPostCard; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="flex h-full flex-col rounded-[1.75rem] border border-border bg-card p-6 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {post.category ? (
          <Link href={`/blog/category/${categorySlug(post.category)}`} className={pillLink}>
            {post.category}
          </Link>
        ) : (
          <span />
        )}
        <span className={pillChip}>
          {post.readingMin} min
          <span className="sr-only"> read</span>
        </span>
      </div>
      <H className="mt-5 text-pretty text-[19px] font-semibold leading-snug tracking-tight">
        <Link href={`/blog/${post.slug}`} className="underline decoration-border decoration-1 underline-offset-4 hover:decoration-lime hover:decoration-2">
          {post.title}
        </Link>
      </H>
      {post.excerpt && <p className="mt-3 line-clamp-3 text-pretty text-[15px] leading-relaxed text-muted-foreground">{post.excerpt}</p>}
      <div className="mt-auto flex items-center justify-between gap-3 pt-6">
        <time dateTime={post.publishedAt.toISOString()} className="text-[13.5px] text-muted-foreground">
          {blogDate(post.publishedAt)}
        </time>
        <span aria-hidden="true" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground">
          <ArrowUpRight className="h-4 w-4" />
        </span>
      </div>
    </article>
  );
}

export function FeaturedPost({ post }: { post: PublicPostCard }) {
  return (
    <article className="rounded-[1.75rem] border border-border bg-card p-6 sm:p-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(pill, "min-h-8 border-transparent bg-lime text-lime-foreground")}>
              <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-current" />
              Latest article
            </span>
            {post.category && (
              <Link href={`/blog/category/${categorySlug(post.category)}`} className={pillLink}>
                {post.category}
              </Link>
            )}
          </div>
          <h2 className="display mt-6 max-w-3xl text-balance text-[clamp(1.75rem,2.4vw+1rem,2.75rem)]">
            <Link href={`/blog/${post.slug}`} className="underline decoration-border decoration-2 underline-offset-[6px] hover:decoration-lime">
              {post.title}
            </Link>
          </h2>
          {post.excerpt && <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-[17px]">{post.excerpt}</p>}
          <Meta post={post} className="mt-6 text-muted-foreground" />
        </div>
        <Link href={`/blog/${post.slug}`} className="inline-flex h-12 w-fit items-center gap-2 rounded-full bg-lime pl-6 pr-4 text-[15px] font-semibold text-lime-foreground transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          Read the article
          <ArrowUpRight aria-hidden="true" className="h-5 w-5" />
        </Link>
      </div>
    </article>
  );
}

export function PostGrid({ posts, headingLevel = 3 }: { posts: PublicPostCard[]; headingLevel?: 2 | 3 }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((p) => (
        <li key={p.slug}>
          <PostCard post={p} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
