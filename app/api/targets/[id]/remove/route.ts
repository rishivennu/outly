import { z } from "zod";
import { json, route } from "@/lib/http";
import { ownedPost, ownedTarget, postView } from "@/lib/services";
import { removeFromPlatform } from "@/lib/social/remove";

const Body = z.object({ action: z.enum(["delete", "hide", "show"]).default("delete") });

/**
 * Take one live post down on the platform itself: delete it, or (YouTube) make it private / public again.
 * The studio keeps the record, marked removed. 409 + code NOT_SUPPORTED for Instagram and TikTok, whose APIs refuse.
 */
export const POST = route(
  async (req, { user, params }) => {
    const { action } = Body.parse(await req.json().catch(() => ({})));
    const t = await ownedTarget(user.id, params.id);
    await removeFromPlatform(user.id, t.id, action);
    return json({ post: await postView(await ownedPost(user.id, t.postId)) });
  },
  { limit: [20, 60_000] },
);

export const dynamic = "force-dynamic";
