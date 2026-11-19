import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { invalidate } from "../cache";
import { ownedPost, postView } from "../services";

/**
 * R1219: archive = take a post out of the active views (Content, Calendar, Home) without touching the platforms
 * or its numbers. The record, its destinations and its analytics stay; the Archived tab lists it; unarchive puts
 * it back exactly as it was. A booked or in-flight post can't be archived: it would still go out, unseen.
 */
export async function setArchived(userId: string, postId: string, archived: boolean) {
  const post = await ownedPost(userId, postId);
  if (archived && (post.status === "scheduled" || post.status === "publishing"))
    throw new HttpError(409, post.status === "scheduled" ? "It's booked to go out. Take it off the schedule first, then archive it." : "It's being sent right now. Wait until it's done, then archive it.", "IN_FLIGHT");
  if (!!post.archivedAt === archived) return postView(post);
  const updated = await db.post.update({ where: { id: post.id }, data: { archivedAt: archived ? new Date() : null }, include: { targets: true, media: true, reviews: { orderBy: { createdAt: "desc" } }, items: { include: { media: true }, orderBy: { position: "asc" } } } });
  invalidate(`pulse:${userId}:`);
  return postView(updated);
}
