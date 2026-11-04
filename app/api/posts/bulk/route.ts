import { HttpError, json, route } from "@/lib/http";
import { isPlatform, type Platform } from "@/lib/domain";
import { bulkScheduleSchema } from "@/lib/validation";
import { bookBatch, planBatch } from "@/lib/posts/bulk-server";

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
