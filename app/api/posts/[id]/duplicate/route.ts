import { db } from "@/lib/db";
import { json, route } from "@/lib/http";
import { ownedPost, postView } from "@/lib/services";

export const POST = route(async (_req, { user, params }) => {
  const src = await ownedPost(user.id, params.id);
  const copy = await db.post.create({
    data: {
      userId: user.id,
      mediaId: src.mediaId,
      title: src.title ? `${src.title} (copy)` : null,
      story: src.story,
      hook: src.hook,
      targets: {
        create: src.targets.map((t) => ({ platform: t.platform, title: t.title, caption: t.caption, description: t.description, hashtags: t.hashtags })),
      },
    },
  });
  return json({ post: await postView(await ownedPost(user.id, copy.id)) }, { status: 201 });
});
