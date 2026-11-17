import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Shell } from "@/components/marketing/bits";
import { BlogCta } from "@/components/blog/BlogCta";
import { Breadcrumbs } from "@/components/blog/Breadcrumbs";
import { JsonLd } from "@/components/blog/JsonLd";
import { BlogArticle } from "@/components/blog/BlogArticle";
import { PostGrid } from "@/components/blog/PostCard";
import { ShareControls } from "@/components/blog/ShareControls";
import { Toc, tocWorthy } from "@/components/blog/Toc";
import { renderMarkdown } from "@/lib/blog/markdown";
import { articleJsonLd, blogDate, breadcrumbJsonLd, categorySlug, getPublished, relatedPosts, showUpdated } from "@/lib/blog/public";
import { env } from "@/lib/env";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };
const load = cache((slug: string) => getPublished(slug));

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const p = await load(slug);
  if (!p) return { title: "Article not found", robots: { index: false } };
  const title = p.seoTitle || p.title;
  const description = p.metaDescription || p.excerpt;
  return {
    title,
    description,
    keywords: [p.primaryKeyword, ...p.tags].filter(Boolean),
    authors: [{ name: p.author }],
    alternates: { canonical: `/blog/${p.slug}` },
    openGraph: {
      type: "article",
      title,
      description,
      url: `/blog/${p.slug}`,
      publishedTime: p.publishedAt.toISOString(),
      modifiedTime: p.updatedAt.toISOString(),
      authors: [p.author],
      section: p.category || undefined,
      tags: p.tags,
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function ArticlePage(props: Props) {
  const { slug } = await props.params;
  const post = await load(slug);
  if (!post) notFound();
  const { html, headings } = renderMarkdown(post.bodyMd);
  const related = await relatedPosts(post, 3);
  const base = env.APP_URL.replace(/\/+$/, "");
  const url = `${base}/blog/${post.slug}`;
  const catHref = post.category ? `/blog/category/${categorySlug(post.category)}` : "";
  const trail = [{ name: "Blog", path: "/blog" }, ...(catHref ? [{ name: post.category, path: catHref }] : []), { name: post.title, path: `/blog/${post.slug}` }];
  const toc = tocWorthy(headings);

  return (
    <>
      <JsonLd data={articleJsonLd(base, post)} />
      <JsonLd data={breadcrumbJsonLd(base, [{ name: "Home", path: "/" }, ...trail])} />
      <article className="py-12 sm:py-16">
        <div className="mx-auto w-full max-w-[780px] px-5 sm:px-6">
          <Breadcrumbs trail={[{ name: "Blog", href: "/blog" }, ...(catHref ? [{ name: post.category, href: catHref }] : []), { name: post.title }]} />
          <BlogArticle
            className="mt-6"
            title={post.title}
            excerpt={post.excerpt}
            category={post.category}
            categoryHref={catHref || undefined}
            author={post.author}
            readingMin={post.readingMin}
            published={{ iso: post.publishedAt.toISOString(), label: blogDate(post.publishedAt) }}
            updated={showUpdated(post.publishedAt, post.updatedAt) ? { iso: post.updatedAt.toISOString(), label: blogDate(post.updatedAt) } : null}
            html={html}
            toc={toc ? <Toc headings={headings} /> : undefined}
            footer={
              <>
                <div className="border-t border-border pt-8">
                  <ShareControls url={url} title={post.title} />
                </div>
                <BlogCta />
              </>
            }
          />
        </div>
      </article>

      {related.length > 0 && (
        <section aria-labelledby="related-title" className="pb-20 sm:pb-28">
          <Shell>
            <h2 id="related-title" className="display text-[clamp(1.5rem,1.4vw+1rem,1.875rem)]">
              Related articles
            </h2>
            <div className="mt-6">
              <PostGrid posts={related} />
            </div>
          </Shell>
        </section>
      )}
    </>
  );
}
