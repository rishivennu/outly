import { json, route } from "@/lib/http";
import { cancelTargets, ownedPost, postView } from "@/lib/services";

/** Stop every destination that hasn't reached its platform yet. The rest keep going. */
export const POST = route(
  async (_req, { user, params }) => {
    const stopped = await cancelTargets(user.id, params.id);
    return json({ post: await postView(await ownedPost(user.id, params.id)), stopped });
  },
  { limit: [20, 60_000] },
);
