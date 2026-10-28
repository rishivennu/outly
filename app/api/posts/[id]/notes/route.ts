import { z } from "zod";
import { json, route } from "@/lib/http";
import { addComment, notesFor } from "@/lib/collab";

export const dynamic = "force-dynamic";

/** Draft collaboration (1037): the activity and comments on one post. Every role can read and comment. */
export const GET = route(async (_req, { user, params }) => json({ notes: await notesFor(user, params.id) }), { limit: [300, 60_000] });

const body = z.object({ body: z.string().trim().min(1, "Write something first.").max(2000) });

export const POST = route(
  async (req, { user, params }) => {
    const { body: text } = body.parse(await req.json());
    await addComment(user, params.id, text);
    return json({ notes: await notesFor(user, params.id) }, { status: 201 });
  },
  { limit: [30, 60_000] },
);
