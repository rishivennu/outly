import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { isPlatform, type Platform } from "@/lib/domain";
import { bulkScheduleSchema } from "@/lib/validation";
import { bookBatch, planBatch } from "@/lib/posts/bulk-server";
import { deletePost } from "@/lib/posts/delete";

export const dynamic = "force-dynamic";

/** Suggested times for a batch of `count` videos going to `platforms`. */
export const GET = route(
  async (req, { user }) => {
    const q = req.nextUrl.searchParams;
    const platforms = (q.get("platforms") ?? "").split(",").filter(isPlatform) as Platform[];
    return json(await planBatch(user.id, platforms, Number(q.get("count")), user.timezone || "UTC"));
  },
  { limit: [60, 60_000] },
);

/** Create and schedule up to 10 posts at once. */
export const POST = route(
  async (req, { user }) => {
    // Booking a batch schedules and publishes, same as /api/posts/[id] launch, so editors are out (1037).
    if (user.role === "editor") throw new HttpError(403, "Editors can't publish. Send a review link, or ask the owner or a manager to launch it.", "ROLE");
    return json(await bookBatch(user.id, bulkScheduleSchema.parse(await req.json()), user), { status: 201 });
  },
  { limit: [10, 60_000] },
);

const bulkDeleteSchema = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) });

/**
 * 1148: the Content library's bulk Delete, one request for the lot (and one keepalive request if the tab closes
 * during Undo). Studio only: nothing is deleted on a platform. Each post goes through deletePost, so ownership,
 * the mid-send refusal and the post-slot refund all hold; one refusal doesn't stop the rest.
 */
export const DELETE = route(
  async (req, { user }) => {
    if (user.role === "editor") throw new HttpError(403, "Editors can't delete posts.", "ROLE");
    const { ids } = bulkDeleteSchema.parse(await req.json());
    const done: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const id of new Set(ids)) {
      try {
        await deletePost(user, id, { platforms: false, appOnlyAck: false });
        done.push(id);
      } catch (e) {
        failed.push({ id, error: e instanceof HttpError ? e.message : "Something got in the way." });
      }
    }
    return json({ done, failed });
  },
  { limit: [20, 60_000] },
);
