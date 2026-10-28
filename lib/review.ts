import "server-only";
import type { Media, Post, PostTarget, ReviewRequest } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./http";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";
import { mediaView, ownedPost, targetView } from "./services";
import { approvalCurrent } from "./collab-core";

export const REVIEW_TTL_MS = 7 * 24 * 3600 * 1000;

export type ReviewStatus = "pending" | "approved" | "changes_requested";

/** The link is the credential: we hand the token out once and keep only its digest. */
export function hashReviewToken(token: string) {
  return sha256(token);
}

export function reviewUrl(token: string) {
  return `${env.APP_URL}/review/${token}`;
}

export function isExpired(r: Pick<ReviewRequest, "expiresAt">, now = new Date()) {
  return r.expiresAt.getTime() <= now.getTime();
}

/** A token is usable exactly once, and only before it expires. */
export function canDecide(r: Pick<ReviewRequest, "status" | "expiresAt">, now = new Date()) {
  return r.status === "pending" && !isExpired(r, now);
}

export function reviewView(r: ReviewRequest) {
  return {
    id: r.id,
    status: r.status as ReviewStatus,
    reviewerName: r.reviewerName,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt.toISOString(),
    expired: isExpired(r),
  };
}
export type ReviewView = ReturnType<typeof reviewView>;

/** Newest request first; the most recent one is the post's current review state. */
export async function reviewsForPost(postId: string) {
  return db.reviewRequest.findMany({ where: { postId }, orderBy: { createdAt: "desc" } });
}

/** createdById: the team member making the link, null for the owner (see isApproved). */
export async function createReviewRequest(userId: string, postId: string, createdById: string | null = null) {
  const post = await ownedPost(userId, postId);
  if (post.status === "published" || post.status === "publishing")
    throw new HttpError(409, "This one has already gone out, so there's nothing left to review.");
  const token = randomToken(32);
  const review = await db.reviewRequest.create({
    data: { postId: post.id, tokenHash: hashReviewToken(token), expiresAt: new Date(Date.now() + REVIEW_TTL_MS), createdById },
  });
  return { review, token, url: reviewUrl(token) };
}

export async function findByToken(token: string) {
  if (!token || token.length < 20) return null;
  return db.reviewRequest.findUnique({ where: { tokenHash: hashReviewToken(token) } });
}

/** What the reviewer sees: the video, the per-platform copy, and nothing of the creator's account. */
export async function reviewPackage(token: string) {
  const review = await findByToken(token);
  if (!review) return null;
  const post = (await db.post.findUnique({
    where: { id: review.postId },
    include: { targets: true, media: true, user: { select: { name: true } } },
  })) as (Post & { targets: PostTarget[]; media: Media; user: { name: string } }) | null;
  if (!post) return null;
  return {
    review: reviewView(review),
    open: canDecide(review),
    creatorName: post.user.name,
    post: {
      title: post.title,
      hook: post.hook,
      story: post.story,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      media: await mediaView(post.media),
      targets: post.targets.map(targetView),
    },
  };
}
export type ReviewPackage = NonNullable<Awaited<ReturnType<typeof reviewPackage>>>;

/**
 * Records the one decision this token carries. The update is conditional on the row still being
 * pending, so two reviewers clicking at the same moment cannot both write a verdict.
 */
export async function decideReview(token: string, input: { reviewerName: string; decision: "approved" | "changes_requested"; note?: string | null }) {
  const review = await findByToken(token);
  if (!review) throw new HttpError(404, "This review link doesn't exist any more.", "REVIEW_GONE");
  if (isExpired(review)) throw new HttpError(410, "This review link has expired. Ask for a fresh one.", "REVIEW_EXPIRED");
  if (review.status !== "pending") throw new HttpError(409, "This link has already been used.", "REVIEW_USED");
  if (input.decision === "changes_requested" && !input.note?.trim())
    throw new HttpError(400, "Tell them what to change.", "VALIDATION");
  const claimed = await db.reviewRequest.updateMany({
    where: { id: review.id, status: "pending" },
    data: {
      status: input.decision,
      reviewerName: input.reviewerName.trim().slice(0, 80),
      note: input.note?.trim() ? input.note.trim().slice(0, 2000) : null,
      decidedAt: new Date(),
    },
  });
  if (claimed.count !== 1) throw new HttpError(409, "This link has already been used.", "REVIEW_USED");
  return db.reviewRequest.findUniqueOrThrow({ where: { id: review.id } });
}

/** True when the post is cleared to go out: approval is either not required or already given. */
type Gate = Pick<Post, "id" | "requireApproval"> & { editedAt?: Date | null; editedById?: string | null };

export async function isApproved(post: Gate) {
  if (!post.requireApproval) return true;
  // 1037: an approval only clears the version it saw. A later edit (anyone's) needs approving again.
  const known = post.editedAt !== undefined && post.editedById !== undefined;
  const row = known ? null : await db.post.findUnique({ where: { id: post.id }, select: { editedAt: true, editedById: true } });
  const editedAt = known ? post.editedAt ?? null : row?.editedAt ?? null;
  const editedById = known ? post.editedById ?? null : row?.editedById ?? null;
  // A member can't clear their own change through a review link they made and then opened themselves.
  const notSelf = editedById ? { OR: [{ createdById: null }, { createdById: { not: editedById } }] } : {};
  const approved = await db.reviewRequest.findMany({ where: { postId: post.id, status: "approved", ...(editedAt ? { decidedAt: { gte: editedAt } } : {}), ...notSelf }, select: { status: true, decidedAt: true }, take: 1 });
  return approvalCurrent(approved, editedAt);
}

export const NEEDS_APPROVAL_MESSAGE = "This one needs a teammate's approval before it goes out.";

export async function assertApproved(post: Gate) {
  if (!(await isApproved(post))) throw new HttpError(409, NEEDS_APPROVAL_MESSAGE, "NEEDS_APPROVAL");
}
