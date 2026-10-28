import "server-only";
import type { Post } from "@prisma/client";
import { db } from "./db";
import { HttpError } from "./http";
import { randomToken, sha256 } from "./crypto";
import { realUserId, type SessionUser } from "./auth";
import { ownedPost } from "./services";
import { approveBlock, shouldLogEdit } from "./collab-core";

/**
 * Draft collaboration (1037): who changed what, comments, and approvals given inside the team.
 * Every write is scoped through ownedPost, so a member limited to some accounts can't reach other posts.
 */

const actorOf = (u: SessionUser) => ({ id: realUserId(u), name: u.actor?.name ?? u.name });

export type NoteView = { id: string; kind: "comment" | "edit" | "approved" | "changes"; body: string; authorName: string; mine: boolean; createdAt: string };

export async function notesFor(u: SessionUser, postId: string): Promise<NoteView[]> {
  await ownedPost(u.id, postId);
  const me = realUserId(u);
  const rows = await db.postNote.findMany({ where: { postId }, orderBy: { createdAt: "asc" }, take: 200 });
  return rows.map((n) => ({ id: n.id, kind: n.kind as NoteView["kind"], body: n.body, authorName: n.authorName, mine: n.authorId === me, createdAt: n.createdAt.toISOString() }));
}

/** Stamps a real edit on the post (and an activity line at most every 15 minutes per person). */
export async function recordEdit(u: SessionUser, post: Pick<Post, "id">) {
  const a = actorOf(u);
  await db.post.update({ where: { id: post.id }, data: { editedAt: new Date(), editedBy: a.name.slice(0, 80), editedById: a.id } });
  const last = await db.postNote.findFirst({ where: { postId: post.id }, orderBy: { createdAt: "desc" }, select: { kind: true, authorId: true, createdAt: true } });
  if (shouldLogEdit(last, a.id)) await db.postNote.create({ data: { postId: post.id, authorId: a.id, authorName: a.name.slice(0, 80), kind: "edit", body: "Edited the draft" } });
}

/** A comment. When a teammate writes it, the owner hears about it in their notices. */
export async function addComment(u: SessionUser, postId: string, body: string) {
  const post = await ownedPost(u.id, postId);
  const a = actorOf(u);
  const text = body.trim().slice(0, 2000);
  if (!text) throw new HttpError(400, "Write something first.", "VALIDATION");
  const n = await db.postNote.create({ data: { postId: post.id, authorId: a.id, authorName: a.name.slice(0, 80), kind: "comment", body: text } });
  if (u.actor) await notifyOwner(u.id, post, `${a.name} commented`, text, `note-${n.id}`);
  return n;
}

/**
 * An approval (or a request for changes) from inside the team. It's stored as a decided review, so every
 * existing gate (launch, schedule, the Approvals board) treats it exactly like a client's review link.
 */
export async function teamDecide(u: SessionUser, postId: string, decision: "approved" | "changes_requested", note?: string | null) {
  const post = await ownedPost(u.id, postId);
  if (post.status === "published" || post.status === "publishing") throw new HttpError(409, "This one has already gone out.");
  const a = actorOf(u);
  const block = approveBlock(u.role, a.id, post.editedById);
  if (block) throw new HttpError(403, block, "ROLE");
  const text = note?.trim().slice(0, 2000) || null;
  if (decision === "changes_requested" && !text) throw new HttpError(400, "Tell them what to change.", "VALIDATION");
  const now = new Date();
  await db.$transaction([
    db.reviewRequest.create({ data: { postId: post.id, tokenHash: sha256(`team:${randomToken(24)}`), reviewerName: `${a.name.slice(0, 60)} (team)`, status: decision, note: text, decidedAt: now, expiresAt: now } }),
    db.postNote.create({ data: { postId: post.id, authorId: a.id, authorName: a.name.slice(0, 80), kind: decision === "approved" ? "approved" : "changes", body: text ?? (decision === "approved" ? "Approved it" : "Asked for changes") } }),
  ]);
  if (u.actor) await notifyOwner(u.id, post, decision === "approved" ? `${a.name} approved a post` : `${a.name} asked for changes`, text ?? (post.title ?? "A draft"), `decide-${post.id}-${now.getTime()}`);
}

async function notifyOwner(ownerId: string, post: Pick<Post, "id" | "title">, title: string, body: string, key: string) {
  await db.notice
    .create({ data: { userId: ownerId, kind: "draft_note", tone: "info", title: title.slice(0, 120), body: `${post.title ? `${post.title.slice(0, 60)}: ` : ""}${body}`.slice(0, 300), href: `/create?post=${post.id}`, action: "Open draft", key } })
    .catch(() => {}); // dedupe clash = already told
}
