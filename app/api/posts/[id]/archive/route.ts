import { z } from "zod";
import { json, route } from "@/lib/http";
import { setArchived } from "@/lib/posts/archive";

export const dynamic = "force-dynamic";

const body = z.object({ archived: z.boolean().default(true) });

/** R1219: archive (or unarchive) a post. Nothing happens on the platforms; the numbers stay. */
export const POST = route(async (req, { user, params }) => {
  const { archived } = body.parse(await req.json().catch(() => ({})));
  return json({ post: await setArchived(user.id, params.id, archived) });
});
