import "server-only";
import { db } from "../db";
import { parseList } from "./types";

/**
 * R1176 public blog: the only reader-facing data access. Every query here is pinned to status "published",
 * so a draft, an approved-but-held or an unpublished article can never reach a public page by any path.
 */

export interface PublicPostCard {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  readingMin: number;
  publishedAt: Date;
  updatedAt: Date;
}
export interface PublicPost extends PublicPostCard {
  seoTitle: string;
  metaDescription: string;
  bodyMd: string;
  tags: string[];
  primaryKeyword: string;
  wordCount: number;
}
export interface CategoryCount {
  name: string;
  slug: string;
  count: number;
}

export const BLOG_PER_PAGE = 12;
const PUBLISHED = { status: "published", publishedAt: { not: null } } as const;
// Postgres needs `mode` for case-insensitive contains; SQLite's LIKE already ignores ASCII case and rejects `mode`.
const ci = (process.env.DATABASE_URL ?? "").startsWith("postgres") ? { mode: "insensitive" as const } : {};

const CARD = { slug: true, title: true, excerpt: true, category: true, author: true, readingMin: true, publishedAt: true, updatedAt: true } as const;
type CardRow = { slug: string; title: string; excerpt: string; category: string; author: string; readingMin: number; publishedAt: Date | null; updatedAt: Date };
const card = (r: CardRow): PublicPostCard => ({ ...r, publishedAt: r.publishedAt ?? r.updatedAt });

/** Category names become URL segments without the stop-word trimming slugify() does, so every name stays distinct. */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function clampPage(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
}

export async function categoriesWithCounts(): Promise<CategoryCount[]> {
  const rows = await db.blogPost.groupBy({ by: ["category"], where: { ...PUBLISHED, category: { not: "" } }, _count: { _all: true } });
  // "Growth" and "growth" are one category to a reader: merge on the slug, name after the most used spelling.
  const bySlug = new Map<string, { name: string; top: number; count: number }>();
  for (const r of rows) {
    const slug = categorySlug(r.category);
    if (!slug) continue;
    const n = r._count._all;
    const cur = bySlug.get(slug);
    if (!cur) bySlug.set(slug, { name: r.category.trim(), top: n, count: n });
    else {
      cur.count += n;
      if (n > cur.top) (cur.name = r.category.trim()), (cur.top = n);
    }
  }
  return [...bySlug.entries()].map(([slug, v]) => ({ name: v.name, slug, count: v.count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** The stored spellings behind a category slug, or null when no published article uses it. */
async function categoryNames(slug: string): Promise<string[] | null> {
  const rows = await db.blogPost.findMany({ where: { ...PUBLISHED, category: { not: "" } }, select: { category: true }, distinct: ["category"] });
  const names = rows.map((r) => r.category).filter((c) => categorySlug(c) === slug.toLowerCase());
  return names.length ? names : null;
}

export async function findCategory(slug: string): Promise<CategoryCount | null> {
  const s = slug.toLowerCase();
  return (await categoriesWithCounts()).find((c) => c.slug === s) ?? null;
}

export async function publishedPosts(opts: { category?: string; q?: string; page?: number; perPage?: number } = {}): Promise<{ items: PublicPostCard[]; total: number; page: number; perPage: number; pages: number }> {
  const perPage = Math.max(1, Math.min(opts.perPage ?? BLOG_PER_PAGE, 50));
  const page = clampPage(opts.page);
  const where: Record<string, unknown> = { ...PUBLISHED };
  if (opts.category) {
    const names = await categoryNames(opts.category);
    if (!names) return { items: [], total: 0, page, perPage, pages: 0 };
    where.category = { in: names };
  }
  const q = opts.q?.trim().slice(0, 100);
  if (q) where.OR = ["title", "excerpt", "primaryKeyword", "tags"].map((f) => ({ [f]: { contains: q, ...ci } }));
  const [rows, total] = await Promise.all([
    db.blogPost.findMany({ where, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip: (page - 1) * perPage, take: perPage, select: CARD }),
    db.blogPost.count({ where }),
  ]);
  return { items: rows.map(card), total, page, perPage, pages: Math.ceil(total / perPage) };
}

export async function getPublished(slug: string): Promise<PublicPost | null> {
  if (!slug || slug.length > 120) return null;
  const r = await db.blogPost.findFirst({ where: { ...PUBLISHED, slug }, select: { ...CARD, seoTitle: true, metaDescription: true, bodyMd: true, tags: true, primaryKeyword: true, wordCount: true } });
  if (!r) return null;
  return { ...card(r), seoTitle: r.seoTitle, metaDescription: r.metaDescription, bodyMd: r.bodyMd, tags: parseList(r.tags), primaryKeyword: r.primaryKeyword, wordCount: r.wordCount };
}

/** Same category first (newest first), then the newest of the rest. Never the post itself. */
export async function relatedPosts(post: { slug: string; category: string }, n = 3): Promise<PublicPostCard[]> {
  const names = post.category ? ((await categoryNames(categorySlug(post.category))) ?? [post.category]) : [];
  const same = names.length
    ? await db.blogPost.findMany({ where: { ...PUBLISHED, slug: { not: post.slug }, category: { in: names } }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: n, select: CARD })
    : [];
  const rest =
    same.length < n
      ? await db.blogPost.findMany({ where: { ...PUBLISHED, slug: { notIn: [post.slug, ...same.map((s) => s.slug)] } }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: n - same.length, select: CARD })
      : [];
  return [...same, ...rest].map(card);
}

/** An edit the same day is not news to a reader; only show "Updated" when it came more than a day later. */
export const showUpdated = (publishedAt: Date, updatedAt: Date) => updatedAt.getTime() - publishedAt.getTime() > 86_400_000;

export const blogDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);

/** JSON for a <script type="application/ld+json">: "<" and the JS line separators are escaped so no text can close the tag. */
export const jsonLdString = (data: unknown) =>
  JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

const ORG = (base: string) => ({ "@type": "Organization", name: "Outlly", url: `${base}/` });

export function breadcrumbJsonLd(base: string, trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: `${base}${t.path}` })),
  };
}

export function articleJsonLd(base: string, p: PublicPost) {
  const url = `${base}/blog/${p.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: (p.seoTitle || p.title).slice(0, 110),
    description: p.metaDescription || p.excerpt,
    datePublished: p.publishedAt.toISOString(),
    dateModified: (showUpdated(p.publishedAt, p.updatedAt) ? p.updatedAt : p.publishedAt).toISOString(),
    author: { ...ORG(base), name: p.author || "Outlly Team" },
    publisher: ORG(base),
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    articleSection: p.category || undefined,
    keywords: [p.primaryKeyword, ...p.tags].filter(Boolean).join(", ") || undefined,
    wordCount: p.wordCount || undefined,
    inLanguage: "en",
  };
}

export function collectionJsonLd(base: string, opts: { type: "Blog" | "CollectionPage"; name: string; description: string; path: string; posts: PublicPostCard[] }) {
  const url = `${base}${opts.path}`;
  const items = opts.posts.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${base}/blog/${p.slug}`, datePublished: p.publishedAt.toISOString() }));
  return {
    "@context": "https://schema.org",
    "@type": opts.type,
    name: opts.name,
    description: opts.description,
    url,
    publisher: ORG(base),
    ...(opts.type === "Blog" ? { blogPost: items } : { mainEntity: { "@type": "ItemList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, url: it.url, name: it.headline })) } }),
  };
}

/** Listing URLs: page 1 has no ?page so it shares the canonical address; an empty search is no search. */
export function pageHref(path: string, opts: { q?: string; page?: number } = {}): string {
  const sp = new URLSearchParams();
  if (opts.q?.trim()) sp.set("q", opts.q.trim());
  if (opts.page && opts.page > 1) sp.set("page", String(opts.page));
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}
