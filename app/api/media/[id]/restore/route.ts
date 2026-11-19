import { json, route } from "@/lib/http";
import { restoreMedia } from "@/lib/storage/lifecycle";

export const dynamic = "force-dynamic";

/** R1209: takes a file back out of Trash. */
export const POST = route(async (_req, { user, params }) => json(await restoreMedia(user.id, params.id)), { limit: [60, 60_000] });
