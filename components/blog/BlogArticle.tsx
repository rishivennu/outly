import Link from "next/link";
import { cn } from "@/lib/utils";
import { SplitLines } from "@/components/shared/SplitLines";

/**
 * R1180: the one article layout. The public page (app/(marketing)/blog/[slug]) and the admin Preview tab
 * (components/admin/blog/ReviewDesk.tsx) both render this, so what the admin approves is what readers get.
 * Server and client safe: no data loading, no hooks. `html` comes from renderMarkdown, which escapes everything it
 * did not generate. A centred reading column, in this order: category, title, intro, byline, image, body, then the
 * caller's footer (share, the Outlly call to action). `mobile` forces phone sizes for the admin's phone preview,
 * where the viewport is still a desktop one.
 */
export interface BlogArticleProps {
  title: string;
  excerpt?: string;
  category?: string;
  categoryHref?: string;
  author: string;
  readingMin: number;
  /** ISO date and its label; null for a draft. */
  published?: { iso: string; label: string } | null;
  updated?: { iso: string; label: string } | null;
  /** Shown in place of the date while the article is not live (admin preview). */
  draftNote?: string;
  image?: { src: string; alt: string } | null;
  html: string;
  /** Optional "On this page" block, shown before the body. */
  toc?: React.ReactNode;
  footer?: React.ReactNode;
  mobile?: boolean;
  className?: string;
}

export function BlogArticle({ title, excerpt, category, categoryHref, author, readingMin, published, updated, draftNote, image, html, toc, footer, mobile = false, className }: BlogArticleProps) {
  const cat = category?.trim();
  const catClass = "text-[13px] font-semibold uppercase tracking-[0.12em] text-lime-ink dark:text-lime";
  return (
    <div className={cn("blog-article", mobile && "blog-article--mobile", className)}>
      <header>
        {cat && (categoryHref ? (
          <Link href={categoryHref} className={cn(catClass, "inline-flex min-h-11 items-center underline-offset-4 hover:underline")}>
            {cat}
          </Link>
        ) : (
          <p className={cn(catClass, "flex min-h-11 items-center")}>{cat}</p>
        ))}
        <SplitLines className={cn("display mt-2 text-balance", mobile ? "text-[1.875rem] leading-[1.15]" : "text-[clamp(1.75rem,2.6vw+1rem,2.75rem)] leading-[1.1]")}>{title}</SplitLines>
        {excerpt?.trim() && <p className={cn("mt-4 text-pretty leading-relaxed text-muted-foreground", mobile ? "text-[16px]" : "text-[17px] sm:text-[18px]")}>{excerpt}</p>}
        <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-muted-foreground">
          <span>
            By <span className="font-medium text-foreground">{author}</span>
          </span>
          <span aria-hidden="true">·</span>
          {published ? (
            <span>
              <time dateTime={published.iso}>{published.label}</time>
            </span>
          ) : (
            <span>{draftNote || "Not published yet"}</span>
          )}
          {updated && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Updated <time dateTime={updated.iso}>{updated.label}</time>
              </span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>{readingMin} min read</span>
        </p>
      </header>

      {image?.src && (
        // A plain img on purpose: the admin preview may show an upload that is not on an allowed image host yet.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.src} alt={image.alt} width={1280} height={720} decoding="async" className="mt-8 aspect-video w-full rounded-2xl object-cover" />
      )}

      {toc && <div className="mt-8">{toc}</div>}

      <div className={cn("blog-prose mt-8", mobile && "blog-prose--mobile")} dangerouslySetInnerHTML={{ __html: html }} />

      {footer && <div className="mt-12 grid gap-10">{footer}</div>}
    </div>
  );
}
