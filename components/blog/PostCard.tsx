import Link from "next/link";
import { blogDate, categorySlug, type PublicPostCard } from "@/lib/blog/public";
import { cn } from "@/lib/utils";

function Meta({ post, className }: { post: PublicPostCard; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]", className)}>
      <time dateTime={post.publishedAt.toISOString()}>{blogDate(post.publishedAt)}</time>
      <span aria-hidden="true">·</span>
      <span>{post.readingMin} min read</span>
    </p>
  );
}

/** The title is the link; the whole card is not, so the category link inside stays its own target. */
export function PostCard({ post, headingLevel = 3 }: { post: PublicPostCard; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="flex h-full flex-col rounded-[1.75rem] border border-border bg-card/60 p-7">
      {post.category && (
        <Link href={`/blog/category/${categorySlug(post.category)}`} className="-ml-1 inline-flex min-h-11 w-fit items-center rounded-full px-1 text-[13px] font-semibold text-lime-ink underline decoration-border underline-offset-4 hover:decoration-current dark:text-lime">
          {post.category}
        </Link>
      )}
      <H className="mt-1 text-pretty text-[19px] font-semibold leading-snug tracking-tight">
        <Link href={`/blog/${post.slug}`} className="underline decoration-border decoration-1 underline-offset-4 hover:decoration-lime hover:decoration-2">
          {post.title}
        </Link>
      </H>
      {post.excerpt && <p className="mt-3 line-clamp-3 text-pretty text-[15px] leading-relaxed text-muted-foreground">{post.excerpt}</p>}
      <Meta post={post} className="mt-auto pt-5 text-muted-foreground" />
    </article>
  );
}

export function FeaturedPost({ post }: { post: PublicPostCard }) {
  return (
    <article className="relative overflow-hidden rounded-[1.75rem] bg-foreground p-8 text-background sm:p-12">
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-lime">Latest article</p>
      <h2 className="display mt-4 max-w-3xl text-balance text-[clamp(1.75rem,2.4vw+1rem,2.75rem)]">
        <Link href={`/blog/${post.slug}`} className="underline decoration-background/30 decoration-2 underline-offset-[6px] hover:decoration-lime">
          {post.title}
        </Link>
      </h2>
      {post.excerpt && <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-background/80 sm:text-[17px]">{post.excerpt}</p>}
      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-background/80">
        {post.category && (
          <Link href={`/blog/category/${categorySlug(post.category)}`} className="inline-flex min-h-11 items-center text-[14px] font-semibold text-lime underline decoration-lime/40 underline-offset-4 hover:decoration-lime">
            {post.category}
          </Link>
        )}
        <Meta post={post} />
      </div>
    </article>
  );
}

export function PostGrid({ posts, headingLevel = 3 }: { posts: PublicPostCard[]; headingLevel?: 2 | 3 }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {posts.map((p) => (
        <li key={p.slug}>
          <PostCard post={p} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
