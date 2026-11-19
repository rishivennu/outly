import "server-only";
import type { ContentItem, ContentVariation, Prisma } from "@prisma/client";
import { db } from "../db";
import { HttpError } from "../http";
import { firstSentence } from "../ai/adapt-core";
import { isObjective, type Objective } from "./core";

/**
 * R1233: Content Memory. A ContentItem is one idea; each Post made from it is a ContentVariation (the original and
 * every adaptation), so a platform post's numbers trace back to the idea. Every read and write is scoped by ownerId
 * (the workspace, Post.userId): a post id from another workspace is treated as not found, never linked.
 */

export type ContentOrigin = "manual" | "adapt" | "recommendation" | "backfill";
const ORIGINS: readonly ContentOrigin[] = ["manual", "adapt", "recommendation", "backfill"];
const originOf = (o: unknown): ContentOrigin => (ORIGINS.includes(o as ContentOrigin) ? (o as ContentOrigin) : "manual");

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";
const rowOf = (v: ContentVariation): ContentVariation => ({
  id: v.id,
  itemId: v.itemId,
  postId: v.postId,
  parentVariationId: v.parentVariationId,
  kind: v.kind,
  tone: v.tone,
  platform: v.platform,
  createdAt: v.createdAt,
});

/** The platform a post is mainly for: its first live (published, real) target, else its first target. */
function mainPlatform(targets: { platform: string; platformStatus: string; practice: boolean }[]): string | null {
  return (targets.find((t) => t.platformStatus === "published" && !t.practice) ?? targets[0])?.platform ?? null;
}

const postForItem = (ownerId: string, postId: string) =>
  db.post.findFirst({
    where: { id: postId, userId: ownerId },
    select: {
      id: true,
      title: true,
      story: true,
      format: true,
      targets: { select: { platform: true, platformStatus: true, practice: true }, orderBy: { createdAt: "asc" } },
      variation: { include: { item: true } },
    },
  });

export interface EnsureResult {
  item: ContentItem;
  variation: ContentVariation;
  created: boolean;
}

/**
 * The post's ContentItem, made (item and original variation in one transaction) when it has none. Idempotent: a
 * second call, or a race lost on the unique postId, returns the existing pair. Null when the post is not the owner's.
 */
export async function ensureItemForPost(ownerId: string, postId: string, opts: { origin?: ContentOrigin; brandKey?: string } = {}): Promise<EnsureResult | null> {
  const post = await postForItem(ownerId, postId);
  if (!post) return null;
  if (post.variation) {
    return { item: post.variation.item, variation: rowOf(post.variation), created: false };
  }
  const concept = post.story ? firstSentence(post.story, 140) || null : null;
  try {
    return await db.$transaction(async (tx) => {
      const item = await tx.contentItem.create({
        data: { ownerId, brandKey: opts.brandKey ?? "", title: post.title, concept, format: post.format, origin: originOf(opts.origin) },
      });
      const variation = await tx.contentVariation.create({ data: { itemId: item.id, postId: post.id, kind: "original", platform: mainPlatform(post.targets) } });
      return { item, variation, created: true };
    });
  } catch (e) {
    if (!isUnique(e)) throw e;
    const again = await postForItem(ownerId, postId);
    if (!again?.variation) throw e;
    return { item: again.variation.item, variation: rowOf(again.variation), created: false };
  }
}

/** True when `variationId` is `ancestorId` or sits below it: linking the other way round would make a loop. */
async function descendsFrom(variationId: string, ancestorId: string): Promise<boolean> {
  let id: string | null = variationId;
  for (let i = 0; id && i < 50; i++) {
    if (id === ancestorId) return true;
    const row: { parentVariationId: string | null } | null = await db.contentVariation.findUnique({ where: { id }, select: { parentVariationId: true } });
    id = row?.parentVariationId ?? null;
  }
  return false;
}

/**
 * Records that `childPostId` was adapted from `parentPostId`: the child becomes an `adapted` variation of the parent's
 * item, with the parent's variation as its parent. The parent gets an item first when it has none. A child already
 * filed under another item moves, and that item is archived once it has no variations left. Null when either post is
 * not the owner's, both ids are the same, or the link would make a loop.
 */
export async function attachAdaptation(
  ownerId: string,
  parentPostId: string,
  childPostId: string,
  opts: { tone?: string | null; origin?: ContentOrigin } = {},
): Promise<ContentVariation | null> {
  if (!parentPostId || !childPostId || parentPostId === childPostId) return null;
  const child = await postForItem(ownerId, childPostId);
  if (!child) return null;
  const parent = await ensureItemForPost(ownerId, parentPostId, { origin: opts.origin });
  if (!parent) return null;
  const tone = opts.tone?.trim().slice(0, 40) || null;
  const data = { itemId: parent.item.id, parentVariationId: parent.variation.id, kind: "adapted", tone, platform: mainPlatform(child.targets) };
  const existing = child.variation ? rowOf(child.variation) : null;
  if (existing?.itemId === parent.item.id && existing.parentVariationId === parent.variation.id) return existing;
  if (existing && (await descendsFrom(parent.variation.id, existing.id))) return null;
  if (!existing) {
    // Outside a transaction: on Postgres a failed insert aborts the transaction it is in, and a lost race here
    // (P2002) falls through to the move below.
    try {
      return await db.contentVariation.create({ data: { ...data, postId: child.id } });
    } catch (e) {
      if (!isUnique(e)) throw e;
    }
  }
  return db.$transaction(async (tx) => {
    const moved = await tx.contentVariation.update({ where: { postId: child.id }, data });
    if (existing && existing.itemId !== parent.item.id) {
      const left = await tx.contentVariation.count({ where: { itemId: existing.itemId } });
      // An item with no variations left is archived, never deleted: recommendations may still point at it.
      if (!left) await tx.contentItem.updateMany({ where: { id: existing.itemId, ownerId, archivedAt: null }, data: { archivedAt: new Date() } });
    }
    return moved;
  });
}

const itemInclude = {
  variations: {
    orderBy: { createdAt: "asc" },
    include: {
      post: {
        select: {
          id: true,
          title: true,
          format: true,
          status: true,
          publishedAt: true,
          targets: { select: { id: true, platform: true, platformStatus: true, platformUrl: true, practice: true, publishedAt: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  },
  categories: { include: { category: { select: { id: true, name: true } } } },
} satisfies Prisma.ContentItemInclude;
export type ContentItemView = Prisma.ContentItemGetPayload<{ include: typeof itemInclude }>;

/** Active items newest first, with their variations and each variation's platform targets. Cursor = the last item id seen. */
export async function listItems(ownerId: string, opts: { brandKey?: string; limit?: number; cursor?: string | null } = {}): Promise<{ items: ContentItemView[]; nextCursor: string | null }> {
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20) || 20));
  const where: Prisma.ContentItemWhereInput = { ownerId, archivedAt: null, ...(opts.brandKey !== undefined ? { brandKey: opts.brandKey } : {}) };
  // A cursor from another workspace (or a deleted item) restarts from the top instead of failing.
  const cursorOk = opts.cursor ? !!(await db.contentItem.findFirst({ where: { id: opts.cursor, ownerId }, select: { id: true } })) : false;
  const rows = await db.contentItem.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursorOk && opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: itemInclude,
  });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

/** Archives the owner's item. True when it is archived afterwards (already archived counts), false when it is not theirs. */
export async function archiveItem(ownerId: string, itemId: string): Promise<boolean> {
  await db.contentItem.updateMany({ where: { id: itemId, ownerId, archivedAt: null }, data: { archivedAt: new Date() } });
  return !!(await db.contentItem.findFirst({ where: { id: itemId, ownerId, archivedAt: { not: null } }, select: { id: true } }));
}

/* ------------------------------------------------------------------ brand profile */

export interface BrandProfileInput {
  objective: string;
  name?: string | null;
  audience?: string | null;
  pillars?: string[] | null;
  tone?: string | null;
  avoid?: string[] | null;
}
export interface BrandProfileView {
  ownerId: string;
  scopeKey: string;
  objective: Objective;
  name: string | null;
  audience: string | null;
  pillars: string[];
  tone: string | null;
  avoid: string[];
  updatedAt: string;
}

const MAX_LIST = 12;
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => text(x, 60)).filter((x): x is string => !!x))].slice(0, MAX_LIST) : [];
const parseList = (s: string | null): string[] => {
  if (!s) return [];
  try {
    return list(JSON.parse(s));
  } catch {
    return [];
  }
};
const scopeOf = (k: string | null | undefined) => (typeof k === "string" ? k.trim().slice(0, 100) : "");

function view(r: { ownerId: string; scopeKey: string; objective: string; name: string | null; audience: string | null; pillars: string | null; tone: string | null; avoid: string | null; updatedAt: Date }): BrandProfileView {
  return {
    ownerId: r.ownerId,
    scopeKey: r.scopeKey,
    // A row written before a vocabulary change still reads as a valid objective.
    objective: isObjective(r.objective) ? r.objective : "engagement",
    name: r.name,
    audience: r.audience,
    pillars: parseList(r.pillars),
    tone: r.tone,
    avoid: parseList(r.avoid),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Creates or replaces the brand profile of a workspace ("" scope) or one of its clients. 400 on an unknown objective. */
export async function upsertBrandProfile(ownerId: string, scopeKey: string, data: BrandProfileInput): Promise<BrandProfileView> {
  if (!data || !isObjective(data.objective)) throw new HttpError(400, "Choose an objective: awareness, engagement, community, traffic, leads or sales.", "BAD_OBJECTIVE");
  const scope = scopeOf(scopeKey);
  const fields = {
    objective: data.objective,
    name: text(data.name, 80),
    audience: text(data.audience, 300),
    pillars: JSON.stringify(list(data.pillars)),
    tone: text(data.tone, 120),
    avoid: JSON.stringify(list(data.avoid)),
  };
  const row = await db.brandProfile.upsert({
    where: { ownerId_scopeKey: { ownerId, scopeKey: scope } },
    create: { ownerId, scopeKey: scope, ...fields },
    update: fields,
  });
  return view(row);
}

export async function getBrandProfile(ownerId: string, scopeKey = ""): Promise<BrandProfileView | null> {
  const row = await db.brandProfile.findUnique({ where: { ownerId_scopeKey: { ownerId, scopeKey: scopeOf(scopeKey) } } });
  return row ? view(row) : null;
}

/** R1243: cap on the client list one owner sees, so the switcher stays one short request. */
export const BRAND_PROFILE_LIST_MAX = 200;

/**
 * R1243: every brand profile one owner has: the own brand (scopeKey "") first, then agency clients by name. Always
 * filtered by ownerId, so one workspace never sees another's clients.
 */
export async function listBrandProfiles(ownerId: string): Promise<BrandProfileView[]> {
  const rows = await db.brandProfile.findMany({ where: { ownerId }, orderBy: [{ scopeKey: "asc" }], take: BRAND_PROFILE_LIST_MAX });
  const all = rows.map(view);
  const label = (b: BrandProfileView) => (b.name ?? b.scopeKey).toLowerCase();
  return [...all.filter((b) => b.scopeKey === ""), ...all.filter((b) => b.scopeKey !== "").sort((a, b) => (label(a) < label(b) ? -1 : label(a) > label(b) ? 1 : a.scopeKey < b.scopeKey ? -1 : 1))];
}

/* ------------------------------------------------------------------ backfill */

/** The adaptedFrom post id in a storyMeta string, or null for anything that is not that exact shape. */
export function adaptedFromOf(storyMeta: string | null | undefined): string | null {
  if (typeof storyMeta !== "string" || !storyMeta.trim()) return null;
  try {
    const m: unknown = JSON.parse(storyMeta);
    if (!m || typeof m !== "object" || Array.isArray(m)) return null;
    const v = (m as Record<string, unknown>).adaptedFrom;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export interface BackfillResult {
  scanned: number;
  created: number;
  attached: number;
  nextCursor: string | null;
}

/**
 * Gives every real published post of the owner (a published, non-practice target) a ContentItem, oldest id first,
 * `batch` at a time. A post whose storyMeta names another post of the same owner in adaptedFrom joins that post's item
 * as an adaptation. Idempotent (posts with a variation are skipped) and resumable through nextCursor.
 */
export async function backfillOwner(ownerId: string, opts: { batch?: number; cursor?: string | null } = {}): Promise<BackfillResult> {
  const batch = Math.min(500, Math.max(1, Math.floor(opts.batch ?? 200) || 200));
  const posts = await db.post.findMany({
    where: {
      userId: ownerId,
      variation: { is: null },
      targets: { some: { platformStatus: "published", practice: false } },
      ...(opts.cursor ? { id: { gt: opts.cursor } } : {}),
    },
    orderBy: { id: "asc" },
    take: batch,
    select: { id: true, storyMeta: true },
  });
  let created = 0;
  let attached = 0;
  for (const p of posts) {
    const from = adaptedFromOf(p.storyMeta);
    const parentOk = from && from !== p.id ? !!(await db.post.findFirst({ where: { id: from, userId: ownerId }, select: { id: true } })) : false;
    if (parentOk && from) {
      const before = await db.contentVariation.count({ where: { postId: from } });
      const v = await attachAdaptation(ownerId, from, p.id, { origin: "backfill" });
      if (v) {
        attached++;
        if (!before) created++;
        continue;
      }
    }
    const r = await ensureItemForPost(ownerId, p.id, { origin: "backfill" });
    if (r?.created) created++;
  }
  return { scanned: posts.length, created, attached, nextCursor: posts.length === batch ? posts[posts.length - 1].id : null };
}
