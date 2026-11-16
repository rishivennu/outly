import { describe, expect, test, beforeAll } from "bun:test";
import { db } from "../lib/db";
import { articleJsonLd, breadcrumbJsonLd, categoriesWithCounts, categorySlug, clampPage, collectionJsonLd, findCategory, getPublished, jsonLdString, pageHref, publishedPosts, relatedPosts, showUpdated } from "../lib/blog/public";
import { tocWorthy } from "../components/blog/Toc";

const DAY = 86_400_000;
const T0 = new Date("2026-10-01T09:00:00Z").getTime();
const at = (d: number) => new Date(T0 + d * DAY);

type Seed = { slug: string; status?: string; category?: string; day?: number; title?: string; excerpt?: string; primaryKeyword?: string; tags?: string[] };
async function seed(s: Seed) {
  return db.blogPost.create({
    data: {
      slug: s.slug,
      title: s.title ?? `Post ${s.slug}`,
      excerpt: s.excerpt ?? "",
      bodyMd: "## One\n\nBody text.",
      category: s.category ?? "Growth",
      tags: JSON.stringify(s.tags ?? []),
      primaryKeyword: s.primaryKeyword ?? `kw ${s.slug}`,
      status: s.status ?? "published",
      readingMin: 4,
      wordCount: 900,
      publishedAt: (s.status ?? "published") === "published" || s.status === "approved" ? at(s.day ?? 0) : null,
    },
  });
}

beforeAll(async () => {
  await db.blogSource.deleteMany({});
  await db.blogPost.deleteMany({});
  for (let i = 1; i <= 14; i++) await seed({ slug: `bulk-${i}`, category: i % 2 ? "Growth" : "Scheduling", day: i });
  await seed({ slug: "growth-lower", category: "growth", day: 15 });
  await seed({ slug: "searchable", category: "Tools & Workflow", day: 16, title: "Batch Filming Without Burnout", excerpt: "Record a month of hooks in one afternoon.", primaryKeyword: "content batching", tags: ["Editing", "Planning"] });
  await seed({ slug: "draft-pending", status: "pending", category: "Growth", day: 30, title: "Batch pending draft" });
  await seed({ slug: "draft-approved", status: "approved", category: "Secret", day: 31, title: "Batch approved but held" });
  await seed({ slug: "draft-rejected", status: "rejected", category: "Growth", day: 32 });
  await db.blogPost.create({ data: { slug: "no-date", title: "Published without date", status: "published", category: "Growth" } });
});

describe("published-only", () => {
  test("listing never returns pending, approved, rejected or undated rows", async () => {
    const all = await publishedPosts({ perPage: 50 });
    expect(all.total).toBe(16);
    const slugs = all.items.map((p) => p.slug);
    for (const s of ["draft-pending", "draft-approved", "draft-rejected", "no-date"]) expect(slugs).not.toContain(s);
  });
  test("getPublished returns null for drafts, unknown and absurd slugs", async () => {
    expect(await getPublished("draft-pending")).toBeNull();
    expect(await getPublished("draft-approved")).toBeNull();
    expect(await getPublished("nope")).toBeNull();
    expect(await getPublished("x".repeat(200))).toBeNull();
    const p = await getPublished("searchable");
    expect(p?.title).toBe("Batch Filming Without Burnout");
    expect(p?.tags).toEqual(["Editing", "Planning"]);
    expect(p?.bodyMd).toContain("## One");
  });
  test("categories only count published posts and merge case variants", async () => {
    const cats = await categoriesWithCounts();
    expect(cats.find((c) => c.slug === "secret")).toBeUndefined();
    const growth = cats.find((c) => c.slug === "growth")!;
    expect(growth.count).toBe(8);
    expect(growth.name).toBe("Growth");
    expect(cats[0].slug).toBe("growth");
    expect(cats.find((c) => c.slug === "tools-workflow")?.name).toBe("Tools & Workflow");
  });
});

describe("ordering and pagination", () => {
  test("newest first, 12 per page", async () => {
    const p1 = await publishedPosts({ page: 1 });
    expect(p1.perPage).toBe(12);
    expect(p1.items).toHaveLength(12);
    expect(p1.pages).toBe(2);
    expect(p1.items[0].slug).toBe("searchable");
    const times = p1.items.map((p) => p.publishedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const p2 = await publishedPosts({ page: 2 });
    expect(p2.items).toHaveLength(4);
    expect(p2.items.map((p) => p.slug)).not.toContain(p1.items[11].slug);
    expect(p2.items.at(-1)!.slug).toBe("bulk-1");
  });
  test("page past the end is empty but keeps the total", async () => {
    const r = await publishedPosts({ page: 9 });
    expect(r.items).toEqual([]);
    expect(r.total).toBe(16);
  });
  test("clampPage", () => {
    expect(clampPage("3")).toBe(3);
    expect(clampPage("0")).toBe(1);
    expect(clampPage("-2")).toBe(1);
    expect(clampPage("abc")).toBe(1);
    expect(clampPage(undefined)).toBe(1);
    expect(clampPage("2.7")).toBe(2);
  });
});

describe("search", () => {
  test("matches title, excerpt, keyword and tags, any case", async () => {
    for (const q of ["batch filming", "MONTH OF HOOKS", "Content Batching", "editing"]) {
      const r = await publishedPosts({ q });
      expect(r.items.map((p) => p.slug)).toEqual(["searchable"]);
    }
  });
  test("never surfaces drafts whose titles match", async () => {
    const r = await publishedPosts({ q: "batch" });
    expect(r.items.map((p) => p.slug)).toEqual(["searchable"]);
  });
  test("blank query is no filter", async () => {
    expect((await publishedPosts({ q: "   " })).total).toBe(16);
  });
});

describe("category", () => {
  test("filters by slug across spellings", async () => {
    const r = await publishedPosts({ category: "growth", perPage: 50 });
    expect(r.total).toBe(8);
    expect(r.items[0].slug).toBe("growth-lower");
    expect(r.items.every((p) => p.category.toLowerCase() === "growth")).toBe(true);
  });
  test("unknown or draft-only category is empty", async () => {
    expect((await publishedPosts({ category: "secret" })).total).toBe(0);
    expect((await publishedPosts({ category: "nothing" })).total).toBe(0);
    expect(await findCategory("secret")).toBeNull();
    expect((await findCategory("TOOLS-WORKFLOW"))?.name).toBe("Tools & Workflow");
  });
  test("categorySlug keeps stop words and strips symbols and accents", () => {
    expect(categorySlug("Tools & Workflow")).toBe("tools-workflow");
    expect(categorySlug("How to Grow")).toBe("how-to-grow");
    expect(categorySlug("  Créateur's Guide ")).toBe("createurs-guide");
    expect(categorySlug("Growth")).toBe(categorySlug("growth"));
  });
});

describe("related", () => {
  test("same category newest first, never itself", async () => {
    const r = await relatedPosts({ slug: "growth-lower", category: "growth" }, 3);
    expect(r.map((p) => p.slug)).toEqual(["bulk-13", "bulk-11", "bulk-9"]);
  });
  test("tops up with the newest others when the category is small", async () => {
    const r = await relatedPosts({ slug: "searchable", category: "Tools & Workflow" }, 3);
    expect(r.map((p) => p.slug)).toEqual(["growth-lower", "bulk-14", "bulk-13"]);
  });
  test("no category still gets recent posts", async () => {
    const r = await relatedPosts({ slug: "bulk-1", category: "" }, 3);
    expect(r.map((p) => p.slug)).toEqual(["searchable", "growth-lower", "bulk-14"]);
  });
});

describe("pure helpers", () => {
  test("jsonLdString cannot close the script tag", () => {
    const s = jsonLdString({ headline: "</script><script>alert(1)</script>", x: "a\u2028b" });
    expect(s).not.toContain("</");
    expect(s).not.toContain("<");
    expect(s).not.toContain("\u2028");
    expect(JSON.parse(s)).toEqual({ headline: "</script><script>alert(1)</script>", x: "a\u2028b" });
  });
  test("articleJsonLd", async () => {
    const p = (await getPublished("searchable"))!;
    const ld = articleJsonLd("https://outlly.com", p);
    expect(ld["@type"]).toBe("Article");
    expect(ld.url).toBe("https://outlly.com/blog/searchable");
    expect(ld.mainEntityOfPage["@id"]).toBe(ld.url);
    expect(ld.datePublished).toBe(at(16).toISOString());
    expect(ld.author.name).toBe("Outlly Team");
    expect(ld.keywords).toBe("content batching, Editing, Planning");
  });
  test("breadcrumb and collection", () => {
    const b = breadcrumbJsonLd("https://outlly.com", [{ name: "Home", path: "/" }, { name: "Blog", path: "/blog" }]);
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: "https://outlly.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://outlly.com/blog" },
    ]);
    const c = collectionJsonLd("https://outlly.com", { type: "CollectionPage", name: "G", description: "d", path: "/blog/category/g", posts: [] });
    expect(c.url).toBe("https://outlly.com/blog/category/g");
    expect((c as any).mainEntity.itemListElement).toEqual([]);
  });
  test("showUpdated only after more than a day", () => {
    expect(showUpdated(at(0), new Date(T0 + DAY - 1))).toBe(false);
    expect(showUpdated(at(0), new Date(T0 + DAY + 1))).toBe(true);
    expect(showUpdated(at(0), at(-3))).toBe(false);
  });
  test("pageHref", () => {
    expect(pageHref("/blog")).toBe("/blog");
    expect(pageHref("/blog", { page: 1, q: "  " })).toBe("/blog");
    expect(pageHref("/blog", { page: 3 })).toBe("/blog?page=3");
    expect(pageHref("/blog", { q: "a b&c", page: 2 })).toBe("/blog?q=a+b%26c&page=2");
  });
  test("toc needs four H2s", () => {
    const h = (level: 2 | 3) => ({ level, text: "x", id: "x" });
    expect(tocWorthy([h(2), h(2), h(2), h(3), h(3)])).toBe(false);
    expect(tocWorthy([h(2), h(2), h(2), h(2)])).toBe(true);
  });
});
