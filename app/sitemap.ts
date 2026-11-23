import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { categorySlug } from "@/lib/blog/public";

const BASE = process.env.APP_URL ?? "http://localhost:3040";

export const revalidate = 300;

/** Published articles only; a DB hiccup still leaves the static pages in the sitemap. */
async function blogEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const posts = await db.blogPost.findMany({ where: { status: "published" }, orderBy: { publishedAt: "desc" }, select: { slug: true, category: true, updatedAt: true } });
    const latest = posts.reduce<Date | undefined>((m, p) => (!m || p.updatedAt > m ? p.updatedAt : m), undefined);
    const cats = new Map<string, Date>();
    for (const p of posts) {
      const slug = categorySlug(p.category);
      if (!slug) continue;
      const cur = cats.get(slug);
      if (!cur || p.updatedAt > cur) cats.set(slug, p.updatedAt);
    }
    return [
      { url: `${BASE}/blog`, lastModified: latest ?? new Date(), changeFrequency: "weekly", priority: 0.7 },
      ...[...cats].map(([slug, at]) => ({ url: `${BASE}/blog/category/${slug}`, lastModified: at, changeFrequency: "weekly" as const, priority: 0.5 })),
      ...posts.map((p) => ({ url: `${BASE}/blog/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
    ];
  } catch (e) {
    console.warn("[sitemap] blog entries skipped:", e instanceof Error ? e.message : e);
    return [{ url: `${BASE}/blog`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 }];
  }
}

/** Published and completed workshops (completed ones keep their replay page). */
async function workshopEntries(): Promise<MetadataRoute.Sitemap> {
  try {
    const rows = await db.workshop.findMany({ where: { status: { in: ["published", "completed"] } }, select: { slug: true, updatedAt: true } });
    return rows.map((w) => ({ url: `${BASE}/workshops/${w.slug}`, lastModified: w.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 }));
  } catch (e) {
    console.warn("[sitemap] workshop entries skipped:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Public pages only. Everything behind the login is noindex by virtue of the redirect. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  return [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/help`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/partners`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/security`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${BASE}/status`, lastModified: now, changeFrequency: "daily", priority: 0.3 },
    { url: `${BASE}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.4 },
    { url: `${BASE}/workshops`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    ...(await blogEntries()),
    ...(await workshopEntries()),
  ];
}
