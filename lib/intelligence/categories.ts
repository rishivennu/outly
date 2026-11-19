import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { assertPostScope } from "../profiles";
import { classifyTopic, type CategoryDef } from "./core";
import { ensureItemForPost } from "./memory";
import { CATEGORIES_PER_OWNER, TAGS_PER_ITEM, nameKey, normaliseKeywords, normaliseName, normaliseTopic, parseKeywords, postText, uniqueIds } from "./categories-core";

/**
 * R1237: the owner's content categories (pillars) and each item's topic. Every read and write is scoped by ownerId
 * (the workspace); a post is also checked against a member's account scope, the same as everywhere else.
 * Suggestions are deterministic keyword matches (classifyTopic), never AI.
 */

export interface CategoryView {
  id: string;
  name: string;
  keywords: string[];
  source: string;
  items: number;
}
export interface CategoryRef {
  id: string;
  name: string;
}
export interface PostTags {
  topic: string | null;
  categories: CategoryRef[];
  suggestion: CategoryRef | null;
  available: CategoryView[];
}

const NOT_FOUND = "We couldn't find that category.";
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

export async function listCategories(ownerId: string): Promise<CategoryView[]> {
  const rows = await db.contentCategory.findMany({ where: { ownerId }, include: { _count: { select: { items: true } } } });
  return rows.map((r) => ({ id: r.id, name: r.name, keywords: parseKeywords(r.keywords), source: r.source, items: r._count.items })).sort(byName);
}

async function assertFreeName(ownerId: string, name: string, exceptId?: string) {
  if (!name) throw new HttpError(400, "Give the category a name.", "BAD_NAME");
  const all = await db.contentCategory.findMany({ where: { ownerId }, select: { id: true, name: true } });
  const twin = all.find((c) => c.id !== exceptId && nameKey(c.name) === nameKey(name));
  if (twin) throw new HttpError(409, `You already have a category called ${twin.name}.`, "DUPLICATE_NAME");
  return all.length;
}

const view = (r: { id: string; name: string; keywords: string | null; source: string }, items = 0): CategoryView => ({ id: r.id, name: r.name, keywords: parseKeywords(r.keywords), source: r.source, items });

export async function createCategory(ownerId: string, input: { name: string; keywords?: string[] | null }): Promise<CategoryView> {
  const name = normaliseName(input.name);
  const count = await assertFreeName(ownerId, name);
  if (count >= CATEGORIES_PER_OWNER) throw new HttpError(400, `${CATEGORIES_PER_OWNER} categories is the most. Merge or delete one first.`, "TOO_MANY");
  try {
    const row = await db.contentCategory.create({ data: { ownerId, name, keywords: JSON.stringify(normaliseKeywords(input.keywords)) } });
    return view(row);
  } catch (e) {
    // Two creates raced on the unique (ownerId, name).
    if (isUnique(e)) throw new HttpError(409, `You already have a category called ${name}.`, "DUPLICATE_NAME");
    throw e;
  }
}

/** Renames a category and/or replaces its keywords. A field not sent stays as it is. */
export async function renameCategory(ownerId: string, id: string, input: { name?: string | null; keywords?: string[] | null }): Promise<CategoryView> {
  const row = await db.contentCategory.findFirst({ where: { id, ownerId }, include: { _count: { select: { items: true } } } });
  if (!row) throw new HttpError(404, NOT_FOUND);
  const data: { name?: string; keywords?: string } = {};
  if (input.name !== undefined && input.name !== null) {
    data.name = normaliseName(input.name);
    await assertFreeName(ownerId, data.name, id);
  }
  if (input.keywords !== undefined) data.keywords = JSON.stringify(normaliseKeywords(input.keywords));
  try {
    const next = await db.contentCategory.update({ where: { id }, data });
    return view(next, row._count.items);
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, `You already have a category called ${data.name}.`, "DUPLICATE_NAME");
    throw e;
  }
}

/** Deletes the category and its tags on every item. The items themselves stay. */
export async function deleteCategory(ownerId: string, id: string): Promise<void> {
  const row = await db.contentCategory.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!row) throw new HttpError(404, NOT_FOUND);
  await db.$transaction([db.contentItemCategory.deleteMany({ where: { categoryId: id } }), db.contentCategory.deleteMany({ where: { id, ownerId } })]);
}

/** Replaces the item's categories with `categoryIds` (up to 5). The item and every category must be the owner's. */
export async function tagItem(ownerId: string, itemId: string, categoryIds: string[]): Promise<CategoryRef[]> {
  const ids = uniqueIds(categoryIds);
  if (ids.length > TAGS_PER_ITEM) throw new HttpError(400, `Up to ${TAGS_PER_ITEM} categories on one post.`, "TOO_MANY_TAGS");
  const item = await db.contentItem.findFirst({ where: { id: itemId, ownerId }, select: { id: true } });
  if (!item) throw new HttpError(404, "We couldn't find that content.");
  const cats = ids.length ? await db.contentCategory.findMany({ where: { id: { in: ids }, ownerId }, select: { id: true, name: true } }) : [];
  if (cats.length !== ids.length) throw new HttpError(404, "We couldn't find one of those categories.", "BAD_CATEGORY");
  await db.$transaction([
    db.contentItemCategory.deleteMany({ where: { itemId } }),
    ...ids.map((categoryId) => db.contentItemCategory.create({ data: { itemId, categoryId } })),
  ]);
  return ids.map((id) => cats.find((c) => c.id === id)!).map((c) => ({ id: c.id, name: c.name }));
}

async function scopedPost(ownerId: string, postId: string) {
  const post = await db.post.findFirst({
    where: { id: postId, userId: ownerId },
    select: { id: true, title: true, story: true, hook: true, targets: { select: { socialAccountId: true } }, variation: { select: { itemId: true } } },
  });
  if (!post) throw new HttpError(404, "We couldn't find that post.");
  await assertPostScope(ownerId, post.targets);
  return post;
}

/** The post's item id, made (as a manual item) when the post has none yet. */
async function itemIdFor(ownerId: string, post: { id: string; variation: { itemId: string } | null }): Promise<string> {
  if (post.variation) return post.variation.itemId;
  const r = await ensureItemForPost(ownerId, post.id, { origin: "manual" });
  if (!r) throw new HttpError(404, "We couldn't find that post.");
  return r.item.id;
}

export async function tagPost(ownerId: string, postId: string, categoryIds: string[]): Promise<CategoryRef[]> {
  const post = await scopedPost(ownerId, postId);
  return tagItem(ownerId, await itemIdFor(ownerId, post), categoryIds);
}

/** Sets (or, with null or blank, clears) the topic of the post's item. Returns the stored topic. */
export async function setTopic(ownerId: string, postId: string, topic: string | null): Promise<string | null> {
  const post = await scopedPost(ownerId, postId);
  const itemId = await itemIdFor(ownerId, post);
  const next = normaliseTopic(topic);
  await db.contentItem.updateMany({ where: { id: itemId, ownerId }, data: { topic: next } });
  return next;
}

function suggest(post: { title: string | null; story: string | null; hook: string | null }, cats: CategoryView[]): CategoryRef | null {
  const defs: CategoryDef[] = cats.filter((c) => c.keywords.length).map((c) => ({ id: c.id, name: c.name, keywords: c.keywords }));
  if (!defs.length) return null;
  const hit = classifyTopic(postText(post), defs);
  return hit ? { id: hit.id, name: hit.name } : null;
}

/** The category whose keywords best match the post's title, words and hook. Null when no category has keywords or none match. */
export async function suggestForPost(ownerId: string, postId: string): Promise<CategoryRef | null> {
  const post = await scopedPost(ownerId, postId);
  return suggest(post, await listCategories(ownerId));
}

/** What the tag control shows. Read only: a post without an item reads as untagged and gets none made here. */
export async function tagsForPost(ownerId: string, postId: string): Promise<PostTags> {
  const post = await scopedPost(ownerId, postId);
  const [available, item] = await Promise.all([
    listCategories(ownerId),
    post.variation
      ? db.contentItem.findFirst({ where: { id: post.variation.itemId, ownerId }, select: { topic: true, categories: { select: { category: { select: { id: true, name: true } } } } } })
      : Promise.resolve(null),
  ]);
  const categories = (item?.categories ?? []).map((c) => c.category).sort(byName);
  const s = suggest(post, available);
  return { topic: item?.topic ?? null, categories, suggestion: s && !categories.some((c) => c.id === s.id) ? s : null, available };
}
