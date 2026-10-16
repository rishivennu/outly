import { HttpError, json, route } from "@/lib/http";
import { cancelTargets, ownedPost, ownedTarget, postView } from "@/lib/services";

/** Stop one destination. 409 when it already reached the platform (processing or later), so the UI can say so. */
export const POST = route(
  async (_req, { user, params }) => {
    const t = await ownedTarget(user.id, params.id);
    const stopped = await cancelTargets(user.id, t.postId, [t.id]);
    const post = await postView(await ownedPost(user.id, t.postId));
    if (!stopped) throw new HttpError(409, "Too late to stop this one: it's already with the platform.");
    return json({ post, stopped });
  },
  { limit: [30, 60_000] },
);
