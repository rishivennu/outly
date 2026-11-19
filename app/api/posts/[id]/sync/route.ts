import { json, route } from "@/lib/http";
import { ownedPost, postView } from "@/lib/services";
import { reconcilePost } from "@/lib/posts/reconcile";

export const dynamic = "force-dynamic";

/** R1219: ask every platform this post is live on whether it is still there, then return the post as recorded. */
export const POST = route(
  async (_req, { user, params }) => {
    await ownedPost(user.id, params.id);
    const sync = await reconcilePost(user.id, params.id);
    return json({ sync, post: await postView(await ownedPost(user.id, params.id)) });
  },
  { limit: [30, 60_000] },
);
