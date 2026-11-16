import { db } from "@/lib/db";
import { rssXml } from "@/lib/blog/feed";
import { siteBase } from "@/lib/blog/indexnow";

export const revalidate = 300;

export async function GET() {
  const posts = await db.blogPost.findMany({
    where: { status: "published" },
    orderBy: { publishedAt: "desc" },
    take: 30,
    select: { slug: true, title: true, excerpt: true, metaDescription: true, category: true, publishedAt: true, updatedAt: true },
  });
  return new Response(rssXml(posts, siteBase()), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" },
  });
}
