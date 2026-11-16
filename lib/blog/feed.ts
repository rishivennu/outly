import "server-only";
import { categorySlug } from "./public";

export interface FeedItem {
  slug: string;
  title: string;
  excerpt: string;
  metaDescription: string;
  category: string;
  publishedAt: Date | null;
  updatedAt: Date;
}

export const xmlEscape = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function rssXml(items: FeedItem[], base: string): string {
  const root = base.replace(/\/+$/, "");
  const built = items[0] ? (items[0].publishedAt ?? items[0].updatedAt) : new Date();
  const entries = items
    .map((p) => {
      const link = `${root}/blog/${p.slug}`;
      const cat = p.category.trim();
      return [
        "    <item>",
        `      <title>${xmlEscape(p.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
        `      <pubDate>${(p.publishedAt ?? p.updatedAt).toUTCString()}</pubDate>`,
        `      <description>${xmlEscape(p.excerpt.trim() || p.metaDescription.trim())}</description>`,
        cat ? `      <category domain="${xmlEscape(`${root}/blog/category/${categorySlug(cat)}`)}">${xmlEscape(cat)}</category>` : "",
        "      <dc:creator>Outlly Team</dc:creator>",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Outlly Blog</title>
    <link>${xmlEscape(`${root}/blog`)}</link>
    <description>Practical answers to the problems creators run into on Reels, Shorts and X.</description>
    <language>en</language>
    <lastBuildDate>${built.toUTCString()}</lastBuildDate>
    <atom:link href="${xmlEscape(`${root}/blog/feed.xml`)}" rel="self" type="application/rss+xml" />
${entries}
  </channel>
</rss>
`;
}
