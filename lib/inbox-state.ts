import "server-only";
import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./http";
import { inScope, type Scope } from "./profiles-core";
import type { Platform } from "./domain";
import type { PublisherError } from "./social/types";

/**
 * Phase 2: read, unread and archive for comments. Comments are still read live from the platform (lib/inbox.ts);
 * only what the creator did with one is stored here (model InboxItemState), keyed by the account and the
 * platform's own comment id. Archive only hides it in Outlly: no platform is told anything.
 */

/** Platforms whose publisher in lib/social really lists comments. Facebook has no listComments, so it is left out. */
export const COMMENT_PLATFORMS = ["instagram", "youtube", "x"] as const satisfies readonly Platform[];
export const commentCapable = (p: string): p is (typeof COMMENT_PLATFORMS)[number] => (COMMENT_PLATFORMS as readonly string[]).includes(p);

/** "read" or "unread" once the creator has touched it; null = never opened, so Inbox decides from the reply state. */
export type ReadMark = "read" | "unread" | null;
export interface ItemState {
  read: ReadMark;
  archived: boolean;
}
export const NO_STATE: ItemState = { read: null, archived: false };

export const stateKey = (accountId: string, itemId: string) => `${accountId}:${itemId}`;

export function toState(row: { readAt: Date | null; archivedAt: Date | null } | null | undefined): ItemState {
  if (!row) return NO_STATE;
  return { read: row.readAt ? "read" : "unread", archived: !!row.archivedAt };
}

const item = z.object({ accountId: z.string().trim().min(1).max(64), itemId: z.string().trim().min(1).max(200) });
export const inboxStateSchema = z
  .object({
    items: z.array(item).min(1, "Pick at least one comment.").max(100, "That is too many at once. Try 100 or fewer."),
    read: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((b) => b.read !== undefined || b.archived !== undefined, "Nothing to change.");
export type InboxStatePatch = z.infer<typeof inboxStateSchema>;

/** What a write stores. A new row counts as seen unless it is being marked unread: archiving means it was dealt with. */
export function stateData(patch: Pick<InboxStatePatch, "read" | "archived">, now: Date) {
  const update: { readAt?: Date | null; archivedAt?: Date | null } = {};
  if (patch.read !== undefined) update.readAt = patch.read ? now : null;
  if (patch.archived !== undefined) update.archivedAt = patch.archived ? now : null;
  const create = { readAt: patch.read === false ? null : now, archivedAt: patch.archived ? now : null };
  return { update, create };
}

/**
 * Every stored state for these accounts. Best effort: a broken state table must never take the comments inbox
 * down with it, so a failure reads as "nothing marked yet".
 */
export async function loadCommentStates(userId: string, accountIds: string[]) {
  const out = new Map<string, ItemState>();
  const ids = Array.from(new Set(accountIds.filter(Boolean)));
  if (!ids.length) return out;
  try {
    const rows = await db.inboxItemState.findMany({
      where: { userId, kind: "comment", accountId: { in: ids } },
      select: { accountId: true, itemId: true, readAt: true, archivedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 5000,
    });
    for (const r of rows) out.set(stateKey(r.accountId, r.itemId), toState(r));
  } catch (e) {
    console.error("[inbox] comment state", e);
  }
  return out;
}

/**
 * Batch write. Every account must belong to this user (and to a scoped member's accounts): one foreign id and the
 * whole batch is refused with the same 404 a missing account gets, so nothing about other accounts leaks.
 */
export async function setCommentStates(userId: string, patch: InboxStatePatch, scope: Scope = null, now = new Date()) {
  const seen = new Set<string>();
  const items = patch.items.filter((i) => {
    const k = stateKey(i.accountId, i.itemId);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const accountIds = Array.from(new Set(items.map((i) => i.accountId)));
  const owned = await db.socialAccount.findMany({ where: { id: { in: accountIds }, userId }, select: { id: true } });
  const ok = new Set(owned.map((a) => a.id).filter((id) => inScope(scope, id)));
  if (accountIds.some((id) => !ok.has(id))) throw new HttpError(404, "We couldn't find that account.");
  const { update, create } = stateData(patch, now);
  const write = () =>
    db.$transaction(
      items.map((i) =>
        db.inboxItemState.upsert({
          where: { userId_accountId_kind_itemId: { userId, accountId: i.accountId, kind: "comment", itemId: i.itemId } },
          update,
          create: { userId, accountId: i.accountId, kind: "comment", itemId: i.itemId, ...create },
          select: { accountId: true, itemId: true, readAt: true, archivedAt: true },
        }),
      ),
    );
  // Upsert is read-then-insert on some providers: a second tab creating the same row in between is a unique clash.
  // The row exists by then, so running the batch again updates it.
  const rows = await write().catch((e: unknown) => {
    if ((e as { code?: string } | null)?.code !== "P2002") throw e;
    return write();
  });
  return rows.map((r) => ({ accountId: r.accountId, itemId: r.itemId, ...toState(r) }));
}

/**
 * Phase 2: what the platform said, in plain words, with the status that matches it. Before this a platform refusal
 * (a rate limit, a deleted comment) reached the creator as "Something got in the way".
 */
export function replyFailure(e: PublisherError): HttpError {
  const wait = e.retryAfterMs && e.retryAfterMs > 0 ? Math.ceil(e.retryAfterMs / 1000) : null;
  switch (e.code) {
    case "RATE_LIMITED":
      return new HttpError(429, wait ? `The platform asked us to slow down. Try again in ${wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`}.` : "The platform asked us to slow down. Try again in a minute.", "RATE_LIMITED", wait ? { retryAfter: wait } : undefined);
    case "AUTH_EXPIRED":
    case "NOT_CONNECTED":
      return new HttpError(409, "The platform signed Outlly out. Reconnect the account, then send it again.", "NOT_CONNECTED");
    case "FORBIDDEN":
      return new HttpError(403, "The platform isn't letting Outlly reply to this comment. It may have replies turned off.", "FORBIDDEN");
    case "MEDIA_REJECTED":
      return new HttpError(422, "The platform turned this reply down. The comment may have been deleted, or the text broke one of its rules.", "REJECTED");
    case "NETWORK":
    case "PLATFORM_DOWN":
      return new HttpError(502, "We couldn't reach the platform. Your reply wasn't sent. Try again in a minute.", "PLATFORM_DOWN");
    default:
      return new HttpError(502, "The platform didn't accept the reply. Nothing was posted. Try again.", "PLATFORM_ERROR");
  }
}
