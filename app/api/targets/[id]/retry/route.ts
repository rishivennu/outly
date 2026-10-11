import { json, route } from "@/lib/http";
import { ownedTarget, retryTarget, ownedPost, postView } from "@/lib/services";

export const POST = route(
  async (_req, { user, params }) => {
    const t = await ownedTarget(user.id, params.id);
    await retryTarget(user.id, t.id);
    return json({ post: await postView(await ownedPost(user.id, t.postId)) }, { status: 202 });
  },
  { limit: [20, 60_000] },
);
