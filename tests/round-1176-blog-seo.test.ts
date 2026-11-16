import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

// revalidatePath needs a Next request; outside one it throws. Record the paths instead.
const paths: string[] = [];
const realCache = require("next/cache");
mock.module("next/cache", () => ({ ...realCache, revalidatePath: (p: string) => paths.push(p), revalidateTag: () => {} }));

import { db } from "../lib/db";
import { env } from "../lib/env";
import sitemap from "../app/sitemap";
import { GET as feedGET } from "../app/(marketing)/blog/feed.xml/route";
import { GET as keyGET } from "../app/api/indexnow-key/route";
import { pingIndexNow } from "../lib/blog/indexnow";
import { rssXml, xmlEscape } from "../lib/blog/feed";
import { revalidateBlog } from "../lib/blog/posts";

const realFetch = globalThis.fetch;
const setKey = (k: string) => ((env as { INDEXNOW_KEY: string }).INDEXNOW_KEY = k);
afterEach(() => {
  globalThis.fetch = realFetch;
  setKey("");
});

beforeAll(async () => {
  const day = (n: number) => new Date(Date.UTC(2026, 10, n, 9));
  await db.blogPost.create({ data: { slug: "reach-dropped-overnight", title: "Reach dropped & <b>views</b> fell", excerpt: "What to check first when reach falls.", metaDescription: "meta one", category: "Tips for the Creator", status: "published", publishedAt: day(10) } });
  await db.blogPost.create({ data: { slug: "shorts-stop-getting-views", title: "Shorts stop getting views", excerpt: "", metaDescription: "Why Shorts decay after a week.", category: "YouTube", status: "published", publishedAt: day(12) } });
  await db.blogPost.create({ data: { slug: "draft-hook-guide", title: "Draft hook guide", category: "Craft", status: "pending" } });
  await db.blogPost.create({ data: { slug: "rejected-idea", title: "Rejected idea", category: "Craft", status: "rejected" } });
});

describe("sitemap", () => {
  test("keeps the static pages and lists published articles and their categories only", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url.replace(/^https?:\/\/[^/]+/, ""));
    for (const p of ["/", "/privacy", "/terms", "/help", "/contact", "/security", "/status", "/changelog", "/blog"]) expect(urls).toContain(p);
    expect(urls).toContain("/blog/reach-dropped-overnight");
    expect(urls).toContain("/blog/shorts-stop-getting-views");
    expect(urls).toContain("/blog/category/tips-for-the-creator");
    expect(urls).toContain("/blog/category/youtube");
    expect(urls.some((u) => u.includes("draft-hook-guide") || u.includes("rejected-idea") || u.endsWith("/craft"))).toBe(false);
    const blog = entries.find((e) => e.url.endsWith("/blog"))!;
    expect(blog.priority).toBe(0.7);
    expect(blog.changeFrequency).toBe("weekly");
    const row = await db.blogPost.findUnique({ where: { slug: "reach-dropped-overnight" } });
    const post = entries.find((e) => e.url.endsWith("/blog/reach-dropped-overnight"))!;
    expect(new Date(post.lastModified!).getTime()).toBe(row!.updatedAt.getTime());
  });

  test("a database failure still returns the static entries", async () => {
    const real = db.blogPost.findMany;
    (db.blogPost as any).findMany = async () => {
      throw new Error("db down");
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const urls = (await sitemap()).map((e) => e.url);
      expect(urls.length).toBeGreaterThanOrEqual(8);
      expect(urls.some((u) => u.endsWith("/changelog"))).toBe(true);
    } finally {
      (db.blogPost as any).findMany = real;
      console.warn = warn;
    }
  });
});

describe("RSS feed", () => {
  test("escapes & and < in every text field", () => {
    expect(xmlEscape(`a & <b> "c" 'd'`)).toBe("a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;");
    const xml = rssXml([{ slug: "x", title: "Tom & Jerry <script>", excerpt: "1 < 2 & 3", metaDescription: "", category: "Q&A", publishedAt: new Date(Date.UTC(2026, 0, 1)), updatedAt: new Date() }], "https://outlly.com/");
    expect(xml).toContain("<title>Tom &amp; Jerry &lt;script&gt;</title>");
    expect(xml).toContain("<description>1 &lt; 2 &amp; 3</description>");
    expect(xml).toContain(">Q&amp;A</category>");
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("<link>https://outlly.com/blog/x</link>");
    expect(xml).toContain("Thu, 01 Jan 2026 00:00:00 GMT");
  });

  test("the route serves published posts, newest first, as application/rss+xml", async () => {
    const res = await feedGET();
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("Reach dropped &amp; &lt;b&gt;views&lt;/b&gt; fell");
    expect(xml).toContain("<description>Why Shorts decay after a week.</description>");
    expect(xml).toContain("<dc:creator>Outlly Team</dc:creator>");
    expect(xml).not.toContain("draft-hook-guide");
    expect(xml).not.toContain("rejected-idea");
    expect(xml.indexOf("shorts-stop-getting-views")).toBeLessThan(xml.indexOf("reach-dropped-overnight"));
  });
});

describe("IndexNow", () => {
  test("does nothing without a key", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    expect(await pingIndexNow(["https://outlly.com/blog/x"])).toEqual({ sent: false });
    expect(calls).toBe(0);
  });

  test("posts host, key, keyLocation and the url list when a key is set", async () => {
    setKey("abc12345def");
    const seen: { url: string; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const out = await pingIndexNow(["https://outlly.com/blog/x", "https://outlly.com/blog", "https://outlly.com/blog"]);
    expect(out).toEqual({ sent: true, status: 202 });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.indexnow.org/indexnow");
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.signal).toBeDefined();
    const body = JSON.parse(String(seen[0].init.body));
    const base = env.APP_URL.replace(/\/+$/, "");
    expect(body).toEqual({ host: new URL(base).host, key: "abc12345def", keyLocation: `${base}/api/indexnow-key`, urlList: ["https://outlly.com/blog/x", "https://outlly.com/blog"] });
  });

  test("never throws when the endpoint fails", async () => {
    setKey("abc12345def");
    const warn = console.warn;
    console.warn = () => {};
    try {
      globalThis.fetch = (async () => {
        throw new Error("timeout");
      }) as unknown as typeof fetch;
      expect(await pingIndexNow(["https://outlly.com/blog/x"])).toEqual({ sent: false });
      globalThis.fetch = (async () => new Response("bad", { status: 422 })) as unknown as typeof fetch;
      expect(await pingIndexNow(["https://outlly.com/blog/x"])).toEqual({ sent: false, status: 422 });
    } finally {
      console.warn = warn;
    }
  });

  test("key route is 404 when unset and the bare key as text/plain when set", async () => {
    expect(keyGET().status).toBe(404);
    setKey("abc12345def");
    const res = keyGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("abc12345def");
  });
});

describe("revalidateBlog", () => {
  test("refreshes the article, its category, the feed, the listing and the sitemap", () => {
    paths.length = 0;
    revalidateBlog("reach-dropped-overnight", "Tips for the Creator");
    expect(paths.sort()).toEqual(["/blog", "/blog/category/tips-for-the-creator", "/blog/feed.xml", "/blog/reach-dropped-overnight", "/sitemap.xml"]);
  });
});
