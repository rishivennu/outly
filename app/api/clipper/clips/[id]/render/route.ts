import { z } from "zod";
import { realUserId } from "@/lib/auth";
import { json, route } from "@/lib/http";
import { reportRender } from "@/lib/clipper/jobs";
import { EXECUTORS } from "@/lib/clipper/settings-core";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("status", [
  z.object({ status: z.literal("rendering"), executor: z.enum(EXECUTORS).optional() }),
  z.object({ status: z.literal("rendered"), mediaId: z.string().min(1), executor: z.enum(EXECUTORS).optional() }),
  z.object({ status: z.literal("failed"), error: z.string().max(500), executor: z.enum(EXECUTORS).optional() }),
]);

/** R1321: the executor reports a render. "rendered" names the uploaded 9:16 Media, which must be the owner's. */
export const POST = route(
  async (req, { user, params }) => {
    const b = body.parse(await req.json());
    return json({ clip: await reportRender(user.id, params.id, b, { id: realUserId(user), role: user.role }) });
  },
  { limit: [60, 60_000] },
);
