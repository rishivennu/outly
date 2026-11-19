import "server-only";
import { db } from "../db";
import { ownedPost, postView } from "../services";
import { lineageAfterCreate } from "../intelligence/lineage";

/**
 * "Duplicate" from the post sheet: a fresh draft of the same video, ready to edit. The copy keeps everything
 * that decides where it goes and what goes with it: the account each destination is tied to (1037, so a copy
 * never jumps to another brand's default account), the first comment, and the approval gate (a copy of a post
 * that needed a teammate's yes still needs one). The cover image is deliberately not copied: the file belongs
 * to the post that uploaded it and is deleted with it.
 */
export async function duplicatePost(userId: string, postId: string) {
  const src = await ownedPost(userId, postId);
  const copy = await db.post.create({
    data: {
      userId,
      mediaId: src.mediaId,
      title: src.title ? `${src.title} (copy)` : null,
      story: src.story,
      storyMeta: src.storyMeta,
      hook: src.hook,
      requireApproval: src.requireApproval,
      format: src.format,
      items: { create: src.items.map((i) => ({ mediaId: i.mediaId, position: i.position, altText: i.altText })) },
      targets: {
        create: src.targets.map((t) => ({
          platform: t.platform,
          socialAccountId: t.socialAccountId,
          title: t.title,
          caption: t.caption,
          description: t.description,
          hashtags: t.hashtags,
          firstComment: t.firstComment,
        })),
      },
    },
  });
  // R1234: the copy is an adaptation of the source, filed under the source's Content Memory item.
  await lineageAfterCreate(userId, copy.id, src.id, { origin: "adapt" });
  return postView(await ownedPost(userId, copy.id));
}
