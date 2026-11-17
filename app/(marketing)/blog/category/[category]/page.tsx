import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Shell } from "@/components/marketing/bits";
import { Breadcrumbs } from "@/components/blog/Breadcrumbs";
import { CategoryNav } from "@/components/blog/CategoryNav";
import { SplitLines } from "@/components/shared/SplitLines";
import { JsonLd } from "@/components/blog/JsonLd";
import { Pagination } from "@/components/blog/Pagination";
import { PostGrid } from "@/components/blog/PostCard";
import { breadcrumbJsonLd, categoriesWithCounts, clampPage, collectionJsonLd, pageHref, publishedPosts } from "@/lib/blog/public";
import { env } from "@/lib/env";

export const revalidate = 300;

type Props = { params: Promise<{ category: string }>; searchParams: Promise<{ page?: string | string[] }> };
const cats = cache(() => categoriesWithCounts());
const resolve = async (raw: string) => {
  const slug = decodeURIComponent(raw).toLowerCase();
  const all = await cats();
  return { all, cat: all.find((c) => c.slug === slug) ?? null };
};
const lead = (name: string) => `Outlly guides on ${name.toLowerCase()} for creators, newest first.`;
const pageOf = (sp: { page?: string | string[] }) => clampPage(Array.isArray(sp.page) ? sp.page[0] : sp.page);

export async function generateMetadata(props: Props): Promise<Metadata> {
  const [{ category }, sp] = await Promise.all([props.params, props.searchParams]);
  const { cat } = await resolve(category);
  if (!cat) return { title: "Topic not found", robots: { index: false } };
  const page = pageOf(sp);
  const path = `/blog/category/${cat.slug}`;
  return {
    title: page > 1 ? `${cat.name} articles, page ${page}` : `${cat.name} articles`,
    description: lead(cat.name),
    alternates: { canonical: pageHref(path, { page }) },
    openGraph: { title: `${cat.name} articles · Outlly`, description: lead(cat.name), url: path, type: "website" },
    twitter: { card: "summary", title: `${cat.name} articles · Outlly`, description: lead(cat.name) },
  };
}

export default async function CategoryPage(props: Props) {
  const [{ category }, sp] = await Promise.all([props.params, props.searchParams]);
  const { all, cat } = await resolve(category);
  if (!cat) notFound();
  const page = pageOf(sp);
  const list = await publishedPosts({ category: cat.slug, page });
  const path = `/blog/category/${cat.slug}`;
  const base = env.APP_URL.replace(/\/+$/, "");

  return (
    <section className="py-12 sm:py-20">
      <JsonLd data={collectionJsonLd(base, { type: "CollectionPage", name: `${cat.name} articles`, description: lead(cat.name), path, posts: list.items })} />
      <JsonLd data={breadcrumbJsonLd(base, [{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }, { name: cat.name, path }])} />
      <Shell>
        <Breadcrumbs trail={[{ name: "Blog", href: "/blog" }, { name: cat.name }]} />
        <div className="mt-6 rounded-[1.75rem] border border-border bg-card p-6 sm:p-10">
          <p className="inline-flex min-h-8 items-center gap-2 rounded-full border border-border px-3.5 text-[13px] font-medium leading-none text-muted-foreground">
            <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-lime" />
            Topic
          </p>
          <SplitLines className="display mt-6 max-w-2xl text-balance text-[clamp(2.4rem,5.2vw,4rem)]">{cat.name}</SplitLines>
          <p className="mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted-foreground sm:text-lg">
            {lead(cat.name)} {cat.count} {cat.count === 1 ? "article" : "articles"}.
          </p>
        </div>
        <div className="mt-8">
          <CategoryNav categories={all} current={cat.slug} />
        </div>
        <div className="mt-12">
          {list.items.length ? (
            <PostGrid posts={list.items} headingLevel={2} />
          ) : (
            <p className="text-base text-muted-foreground">There is no page {page} in this topic.</p>
          )}
        </div>
        <Pagination path={path} page={page} pages={list.pages} />
      </Shell>
    </section>
  );
}
